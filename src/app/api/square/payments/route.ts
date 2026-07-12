import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { getSquareClientForUnit, getDefaultLocationId } from '@/lib/square/client'
import { createHash } from 'crypto'
import { z } from 'zod'
import { logger } from '@/lib/logger'

// Zod schema for payment request validation
const createPaymentSchema = z.object({
  scoutAccountId: z.string().uuid('Invalid scout account ID'),
  amountCents: z.number().int().min(100, 'Minimum payment is $1.00').max(10000000, 'Maximum payment is $100,000'),
  sourceId: z.string().min(1, 'Payment source is required'),
  description: z.string().max(500, 'Description must be under 500 characters').optional(),
  billingChargeId: z.string().uuid('Invalid billing charge ID').optional(),
  allocations: z
    .array(
      z.object({
        chargeId: z.string().uuid(),
        amount: z.number().positive(),
      })
    )
    .optional(),
})

// Square fee: 2.6% + $0.10 per transaction
const SQUARE_FEE_PERCENT = 0.026
const SQUARE_FEE_FIXED_CENTS = 10

// Map Square error codes to user-friendly messages
function sanitizeSquareError(error: unknown): string {
  if (error && typeof error === 'object' && 'errors' in error) {
    const squareErrors = (error as { errors: Array<{ code?: string; category?: string }> }).errors
    const firstError = squareErrors?.[0]

    // Map known error codes to friendly messages
    const errorMap: Record<string, string> = {
      'CARD_DECLINED': 'Your card was declined. Please try a different payment method.',
      'CVV_FAILURE': 'The security code (CVV) is incorrect. Please check and try again.',
      'ADDRESS_VERIFICATION_FAILURE': 'Address verification failed. Please check your billing address.',
      'INVALID_EXPIRATION': 'The card expiration date is invalid.',
      'EXPIRED_CARD': 'This card has expired. Please use a different card.',
      'INSUFFICIENT_FUNDS': 'Insufficient funds. Please try a different payment method.',
      'GENERIC_DECLINE': 'Your card was declined. Please try a different payment method.',
      'CARD_NOT_SUPPORTED': 'This card type is not supported. Please try a different card.',
      'INVALID_CARD': 'Invalid card number. Please check and try again.',
      'INVALID_LOCATION': 'Payment processing is temporarily unavailable.',
      'TRANSACTION_LIMIT': 'This payment exceeds your card\'s transaction limit.',
    }

    if (firstError?.code && errorMap[firstError.code]) {
      return errorMap[firstError.code]
    }

    // For payment-related errors, give a generic decline message
    if (firstError?.category === 'PAYMENT_METHOD_ERROR') {
      return 'Payment was declined. Please check your card details or try a different payment method.'
    }
  }

  // Default generic message - don't expose internal details
  return 'Unable to process payment. Please try again or contact support.'
}

function calculateFee(amountCents: number): number {
  return Math.round(amountCents * SQUARE_FEE_PERCENT + SQUARE_FEE_FIXED_CENTS)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's profile (profile_id is separate from auth user id)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    // Membership lookup via the multi-unit helper. All downstream unit-scoped
    // queries (scout_account validation, journal entry, payment record, etc.)
    // continue to use membership.unit_id, never trusting body fields for auth.
    const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
    if (!membership) {
      return NextResponse.json({ error: 'No active membership found' }, { status: 403 })
    }

    // Use profile for email to pass to Square
    const userProfile = profile

    // Parse and validate request body
    const rawBody = await request.json()
    const parseResult = createPaymentSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstError?.message || 'Invalid request data' },
        { status: 400 }
      )
    }

    const { scoutAccountId, amountCents, sourceId, description, billingChargeId, allocations } = parseResult.data

    // Verify the scout account belongs to this unit
    const { data: scoutAccount } = await supabase
      .from('scout_accounts')
      .select('id, scout_id, unit_id, billing_balance, funds_balance, scouts(first_name, last_name)')
      .eq('id', scoutAccountId)
      .eq('unit_id', membership.unit_id)
      .single()

    if (!scoutAccount) {
      return NextResponse.json({ error: 'Scout account not found' }, { status: 404 })
    }

    // Get Square client for this unit
    const squareClient = await getSquareClientForUnit(membership.unit_id)
    if (!squareClient) {
      return NextResponse.json(
        { error: 'Square is not connected for this unit' },
        { status: 400 }
      )
    }

    // Get the location ID
    const locationId = await getDefaultLocationId(membership.unit_id)
    if (!locationId) {
      return NextResponse.json(
        { error: 'No Square location found' },
        { status: 400 }
      )
    }

    // Calculate amounts
    const feeCents = calculateFee(amountCents)
    const netCents = amountCents - feeCents
    const amountDollars = amountCents / 100
    const feeDollars = feeCents / 100
    const netDollars = netCents / 100

    // Create a deterministic idempotency key to prevent duplicate payments on retry
    // Based on: user ID, scout account, amount, and source token (unique per card submission)
    const idempotencyKey = createHash('sha256')
      .update(`${user.id}-${scoutAccountId}-${amountCents}-${sourceId}`)
      .digest('hex')
      .slice(0, 45) // Square idempotency keys max 45 chars

    // Get scout name for description
    const scout = scoutAccount.scouts as { first_name: string; last_name: string } | null
    const scoutName = scout ? `${scout.first_name} ${scout.last_name}` : 'Unknown Scout'
    const paymentNote = description || `Payment for ${scoutName}`

    // Create payment in Square
    const squareResponse = await squareClient.payments.create({
      sourceId,
      idempotencyKey,
      amountMoney: {
        amount: BigInt(amountCents),
        currency: 'USD',
      },
      locationId,
      note: paymentNote,
      referenceId: scoutAccountId,
      buyerEmailAddress: userProfile?.email || undefined,
    })

    if (!squareResponse.payment) {
      return NextResponse.json(
        { error: 'Failed to create payment in Square' },
        { status: 500 }
      )
    }

    const squarePayment = squareResponse.payment

    // Check if payment was successful
    if (squarePayment.status !== 'COMPLETED') {
      return NextResponse.json(
        {
          error: `Payment ${squarePayment.status?.toLowerCase()}`,
          status: squarePayment.status,
        },
        { status: 400 }
      )
    }

    // Create journal entry for the payment
    const paymentDate = new Date().toISOString().split('T')[0]

    const { data: journalEntry, error: journalError } = await supabase
      .from('journal_entries')
      .insert({
        unit_id: membership.unit_id,
        entry_date: paymentDate,
        description: `Square payment from ${scoutName}`,
        entry_type: 'payment',
        reference: squarePayment.id,
        is_posted: true,
      })
      .select()
      .single()

    if (journalError || !journalEntry) {
      logger.square.error('Failed to create journal entry', journalError)
      // Payment succeeded in Square but failed to record - this needs attention
      return NextResponse.json(
        {
          error: 'Payment processed but failed to record. Please contact support.',
          squarePaymentId: squarePayment.id,
        },
        { status: 500 }
      )
    }

    // Get accounts for journal lines
    const { data: accountsData } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('unit_id', membership.unit_id)
      .in('code', ['1000', '1200', '5600']) // Bank, Scout AR, Payment Fees

    const accounts = accountsData || []
    const bankAccount = accounts.find((a) => a.code === '1000')
    const receivableAccount = accounts.find((a) => a.code === '1200')
    const feeAccount = accounts.find((a) => a.code === '5600')

    if (!bankAccount || !receivableAccount) {
      logger.square.error('Required accounts not found')
      return NextResponse.json(
        {
          error: 'Payment processed but accounts not configured. Please contact support.',
          squarePaymentId: squarePayment.id,
        },
        { status: 500 }
      )
    }

    // Create journal lines
    const journalLines = [
      // Debit bank account (net amount received)
      {
        journal_entry_id: journalEntry.id,
        account_id: bankAccount.id,
        scout_account_id: null,
        debit: netDollars,
        credit: 0,
        memo: `Square payment from ${scoutName}`,
        target_balance: null,
      },
      // Credit scout's billing balance (full amount to reduce what they owe)
      {
        journal_entry_id: journalEntry.id,
        account_id: receivableAccount.id,
        scout_account_id: scoutAccountId,
        debit: 0,
        credit: amountDollars,
        memo: 'Payment received via Square',
        target_balance: 'billing',
      },
    ]

    // Add fee expense if we have the fee account
    if (feeAccount && feeDollars > 0) {
      journalLines.push({
        journal_entry_id: journalEntry.id,
        account_id: feeAccount.id,
        scout_account_id: null,
        debit: feeDollars,
        credit: 0,
        memo: 'Square processing fee',
        target_balance: null,
      })
    }

    const { error: linesError } = await supabase
      .from('journal_lines')
      .insert(journalLines)

    if (linesError) {
      logger.square.error('Failed to create journal lines', linesError)
    }

    // Create payment record
    const { data: paymentRecord, error: paymentError } = await supabase
      .from('payments')
      .insert({
        unit_id: membership.unit_id,
        scout_account_id: scoutAccountId,
        amount: amountDollars,
        fee_amount: feeDollars,
        net_amount: netDollars,
        payment_method: 'card',
        square_payment_id: squarePayment.id,
        square_receipt_url: squarePayment.receiptUrl,
        status: 'completed',
        journal_entry_id: journalEntry.id,
        notes: paymentNote,
      })
      .select()
      .single()

    if (paymentError) {
      logger.square.error('Failed to create payment record', paymentError)
    }

    // If there's a billing charge, mark it as paid
    if (billingChargeId) {
      await supabase
        .from('billing_charges')
        .update({ is_paid: true })
        .eq('id', billingChargeId)
        .eq('scout_account_id', scoutAccountId)
    }

    // Persist charge allocations if provided
    if (allocations && allocations.length > 0 && paymentRecord?.id) {
      const allocationRows = allocations.map((alloc) => ({
        payment_id: paymentRecord.id,
        billing_charge_id: alloc.chargeId,
        amount: alloc.amount,
      }))

      const { error: allocError } = await supabase
        .from('payment_allocations')
        .insert(allocationRows)

      if (allocError) {
        logger.square.error('Failed to create payment allocations', allocError)
      }

      for (const alloc of allocations) {
        const { data: charge } = await supabase
          .from('billing_charges')
          .select('paid_amount')
          .eq('id', alloc.chargeId)
          .single()

        if (charge) {
          await supabase
            .from('billing_charges')
            .update({ paid_amount: (charge.paid_amount || 0) + alloc.amount })
            .eq('id', alloc.chargeId)
        }
      }
    }

    // Sync the transaction to square_transactions
    const cardDetails = squarePayment.cardDetails
    await supabase.from('square_transactions').insert({
      unit_id: membership.unit_id,
      square_payment_id: squarePayment.id!,
      square_order_id: squarePayment.orderId,
      amount_money: amountCents,
      fee_money: feeCents,
      net_money: netCents,
      currency: 'USD',
      status: squarePayment.status!,
      source_type: squarePayment.sourceType,
      card_brand: cardDetails?.card?.cardBrand,
      last_4: cardDetails?.card?.last4,
      receipt_url: squarePayment.receiptUrl,
      receipt_number: squarePayment.receiptNumber,
      payment_id: paymentRecord?.id,
      scout_account_id: scoutAccountId,
      is_reconciled: true,
      square_created_at: squarePayment.createdAt!,
      buyer_email_address: squarePayment.buyerEmailAddress || userProfile?.email || null,
      cardholder_name: cardDetails?.card?.cardholderName || null,
      note: paymentNote,
    })

    return NextResponse.json({
      success: true,
      payment: {
        id: paymentRecord?.id,
        squarePaymentId: squarePayment.id,
        amount: amountDollars,
        feeAmount: feeDollars,
        netAmount: netDollars,
        receiptUrl: squarePayment.receiptUrl,
        status: squarePayment.status,
      },
    })
  } catch (error) {
    // Log full error for debugging but return sanitized message to client
    logger.square.error('Square payment error', error)

    const userMessage = sanitizeSquareError(error)
    return NextResponse.json({ error: userMessage }, { status: 400 })
  }
}
