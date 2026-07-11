import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getSquareClientForUnitPublic } from '@/lib/square/client'
import { createHash } from 'crypto'
import { z } from 'zod'
import { logger } from '@/lib/logger'

interface RouteParams {
  params: Promise<{ token: string }>
}

// Zod schema for process payment request validation
const processPaymentSchema = z.object({
  sourceId: z.string().min(1, 'Payment source is required'),
  amountCents: z.number().int().min(100, 'Minimum payment is $1.00').max(10000000, 'Maximum payment is $100,000').optional(),
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

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params

    if (!token || token.length !== 64) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    // Parse and validate request body
    const rawBody = await request.json()
    const parseResult = processPaymentSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstError?.message || 'Invalid request data' },
        { status: 400 }
      )
    }

    const { sourceId, amountCents: requestedAmountCents } = parseResult.data

    // Use service client to bypass RLS
    const supabase = await createServiceClient()

    // Fetch and validate payment link
    const { data: paymentLink, error: linkError } = await supabase
      .from('payment_links')
      .select(
        `
        id,
        amount,
        base_amount,
        fee_amount,
        fees_passed_to_payer,
        description,
        status,
        expires_at,
        unit_id,
        scout_account_id,
        billing_charge_id,
        scout_accounts (
          id,
          scout_id,
          scouts (
            first_name,
            last_name
          )
        )
      `
      )
      .eq('token', token)
      .single()

    if (linkError || !paymentLink) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
    }

    // Validate link status
    if (paymentLink.status !== 'pending') {
      return NextResponse.json(
        { error: `This payment link has already been ${paymentLink.status}` },
        { status: 400 }
      )
    }

    // Check expiration
    if (new Date(paymentLink.expires_at) < new Date()) {
      await supabase
        .from('payment_links')
        .update({ status: 'expired' })
        .eq('id', paymentLink.id)

      return NextResponse.json({ error: 'This payment link has expired' }, { status: 400 })
    }

    // Get Square client for this unit (using public/service client version)
    const squareClient = await getSquareClientForUnitPublic(paymentLink.unit_id)
    if (!squareClient) {
      return NextResponse.json(
        { error: 'Square is not connected for this unit' },
        { status: 400 }
      )
    }

    // Get the location ID from credentials
    const { data: squareCredentials } = await supabase
      .from('unit_square_credentials')
      .select('location_id')
      .eq('unit_id', paymentLink.unit_id)
      .eq('is_active', true)
      .single()

    const locationId = squareCredentials?.location_id
    if (!locationId) {
      return NextResponse.json({ error: 'No Square location found' }, { status: 400 })
    }

    // Validate scout account ID exists
    if (!paymentLink.scout_account_id) {
      return NextResponse.json({ error: 'Payment link is not associated with a scout account' }, { status: 400 })
    }

    // Get current billing balance from scout account
    const { data: scoutAccountBalance } = await supabase
      .from('scout_accounts')
      .select('billing_balance')
      .eq('id', paymentLink.scout_account_id)
      .single()

    const currentBillingBalance = scoutAccountBalance?.billing_balance || 0
    const currentBalanceCents = Math.round(Math.abs(currentBillingBalance) * 100)

    // Get unit fee settings
    const { data: unitSettings } = await supabase
      .from('units')
      .select('processing_fee_percent, processing_fee_fixed, pass_fees_to_payer')
      .eq('id', paymentLink.unit_id)
      .single()

    const feePercent = Number(unitSettings?.processing_fee_percent) || SQUARE_FEE_PERCENT
    const feeFixedCents = Math.round((Number(unitSettings?.processing_fee_fixed) || 0.10) * 100)
    const feesPassedToPayer = unitSettings?.pass_fees_to_payer || false

    // Use requested amount or fall back to current balance
    const baseAmountCents = requestedAmountCents || currentBalanceCents

    // Validate amount is within allowed range
    if (baseAmountCents < 100) {
      return NextResponse.json({ error: 'Minimum payment is $1.00' }, { status: 400 })
    }
    if (baseAmountCents > currentBalanceCents) {
      return NextResponse.json(
        { error: `Payment amount cannot exceed current balance of $${(currentBalanceCents / 100).toFixed(2)}` },
        { status: 400 }
      )
    }

    // Calculate fee if passed to payer
    let feeAmountCents = 0
    let totalAmountCents = baseAmountCents

    if (feesPassedToPayer) {
      feeAmountCents = Math.ceil((baseAmountCents * feePercent) + feeFixedCents)
      totalAmountCents = baseAmountCents + feeAmountCents
    }

    // Square still charges their fee on the total transaction
    const squareFeeCents = calculateFee(totalAmountCents)
    const netCents = totalAmountCents - squareFeeCents

    // Convert to dollars for accounting
    const totalAmountDollars = totalAmountCents / 100
    const baseAmountDollars = baseAmountCents / 100
    const squareFeeDollars = squareFeeCents / 100
    const netDollars = netCents / 100

    // Create a deterministic idempotency key to prevent duplicate payments on retry
    // Based on: payment link ID, amount, and source token (unique per card submission)
    const idempotencyKey = createHash('sha256')
      .update(`${paymentLink.id}-${totalAmountCents}-${sourceId}`)
      .digest('hex')
      .slice(0, 45) // Square idempotency keys max 45 chars

    // Get scout name for description
    const scoutAccount = paymentLink.scout_accounts as {
      id: string
      scout_id: string
      scouts: { first_name: string; last_name: string }
    }
    const scout = scoutAccount?.scouts
    const scoutName = scout ? `${scout.first_name} ${scout.last_name}` : 'Scout'
    const paymentNote = paymentLink.description || `Payment for ${scoutName}`

    // Create payment in Square
    const squareResponse = await squareClient.payments.create({
      sourceId,
      idempotencyKey,
      amountMoney: {
        amount: BigInt(totalAmountCents),
        currency: 'USD',
      },
      locationId,
      note: paymentNote,
      referenceId: paymentLink.scout_account_id || undefined,
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

    // Process all database operations atomically via RPC
    // This ensures journal entries, payment records, billing charges, and Square
    // transaction sync all succeed or fail together
    const cardDetails = squarePayment.cardDetails

    const { data: rpcResult, error: rpcError } = await supabase.rpc('process_payment_link_payment', {
      p_payment_link_id: paymentLink.id,
      p_scout_account_id: paymentLink.scout_account_id,
      p_base_amount_cents: baseAmountCents,
      p_total_amount_cents: totalAmountCents,
      p_fee_amount_cents: squareFeeCents,
      p_net_amount_cents: netCents,
      p_square_payment_id: squarePayment.id!,
      p_square_receipt_url: squarePayment.receiptUrl || '',
      p_square_order_id: squarePayment.orderId || '',
      p_scout_name: scoutName,
      p_fees_passed_to_payer: feesPassedToPayer,
      p_card_details: {
        card_brand: cardDetails?.card?.cardBrand || null,
        last_4: cardDetails?.card?.last4 || null,
        cardholder_name: cardDetails?.card?.cardholderName || null,
      },
      p_buyer_email: squarePayment.buyerEmailAddress || undefined,
      p_payment_note: paymentNote,
    })

    if (rpcError) {
      logger.payment.error('Failed to process payment in database', rpcError)
      // Payment succeeded in Square but failed to record in database
      // Log the Square payment ID for manual reconciliation
      return NextResponse.json(
        {
          error: 'Payment processed but failed to record. Please contact the unit.',
          squarePaymentId: squarePayment.id,
        },
        { status: 500 }
      )
    }

    // Extract results from RPC response
    const result = rpcResult as {
      success: boolean
      payment_id: string
      journal_entry_id: string
      amount: number
      credited_amount: number
      fee_amount: number
      net_amount: number
      fees_passed_to_payer: boolean
      receipt_url: string | null
      remaining_balance: number
      overpayment_transferred: boolean
      overpayment_amount: number
    }

    return NextResponse.json({
      success: true,
      payment: {
        id: result.payment_id,
        squarePaymentId: squarePayment.id,
        amount: result.amount,
        creditedAmount: result.credited_amount,
        feeAmount: result.fee_amount,
        netAmount: result.net_amount,
        feesPassedToPayer: result.fees_passed_to_payer,
        receiptUrl: squarePayment.receiptUrl,
        status: squarePayment.status,
        remainingBalance: result.remaining_balance,
      },
    })
  } catch (error) {
    // Log full error for debugging but return sanitized message to client
    logger.payment.error('Payment link payment error', error)

    const userMessage = sanitizeSquareError(error)
    return NextResponse.json({ error: userMessage }, { status: 400 })
  }
}
