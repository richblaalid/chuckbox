import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { allocatePayment, type OutstandingCharge } from '@/lib/payment-allocation'

interface RouteParams {
  params: Promise<{ token: string }>
}

const payWithBalanceSchema = z.object({
  amountCents: z.number().int().min(1, 'Amount must be at least 1 cent'),
})

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params

    if (!token || token.length !== 64) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    // Parse and validate request body
    const rawBody = await request.json()
    const parseResult = payWithBalanceSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstError?.message || 'Invalid request data' },
        { status: 400 }
      )
    }

    const { amountCents } = parseResult.data

    // Use service client to bypass RLS (public payment page)
    const supabase = await createServiceClient()

    // Fetch and validate payment link
    const { data: paymentLink, error: linkError } = await supabase
      .from('payment_links')
      .select(`
        id,
        amount,
        base_amount,
        description,
        status,
        expires_at,
        unit_id,
        scout_account_id,
        billing_charge_id,
        scout_accounts (
          id,
          scout_id,
          billing_balance,
          funds_balance,
          scouts (
            first_name,
            last_name
          )
        )
      `)
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

    // Get scout account info
    const scoutAccount = paymentLink.scout_accounts as {
      id: string
      scout_id: string
      billing_balance: number | null
      funds_balance: number
      scouts: { first_name: string; last_name: string }
    }

    if (!scoutAccount) {
      return NextResponse.json({ error: 'Scout account not found' }, { status: 404 })
    }

    const fundsBalance = Number(scoutAccount.funds_balance) || 0
    const availableFundsCents = Math.round(fundsBalance * 100)

    // Validate available funds
    if (availableFundsCents <= 0) {
      return NextResponse.json(
        { error: 'No Scout Funds available' },
        { status: 400 }
      )
    }

    if (amountCents > availableFundsCents) {
      return NextResponse.json(
        { error: `Requested amount exceeds available Scout Funds of $${(availableFundsCents / 100).toFixed(2)}` },
        { status: 400 }
      )
    }

    // Get charge amount if this is a charge-specific link
    let chargeAmountCents = 0
    if (paymentLink.billing_charge_id) {
      const { data: chargeData } = await supabase
        .from('billing_charges')
        .select('amount, is_paid, is_void')
        .eq('id', paymentLink.billing_charge_id)
        .single()

      // Type assertion for migration-added columns
      const charge = chargeData as unknown as {
        amount: number
        is_paid: boolean | null
        is_void: boolean | null
      } | null

      if (charge) {
        if (charge.is_paid) {
          return NextResponse.json({ error: 'This charge has already been paid' }, { status: 400 })
        }
        if (charge.is_void) {
          return NextResponse.json({ error: 'This charge has been voided' }, { status: 400 })
        }
        chargeAmountCents = Math.round(Number(charge.amount) * 100)
      }
    }

    const amountDollars = amountCents / 100
    const scout = scoutAccount.scouts
    const scoutName = `${scout.first_name} ${scout.last_name}`

    // Determine allocations:
    // - Charge-specific link: allocate entirely to that charge.
    // - Generic link: FIFO across the scout's outstanding charges.
    let allocations: Array<{ charge_id: string; amount: number }> | null = null

    if (paymentLink.billing_charge_id) {
      allocations = [{ charge_id: paymentLink.billing_charge_id, amount: amountDollars }]
    } else {
      const { data: chargesData } = await supabase
        .from('billing_charges')
        .select('id, amount, paid_amount, is_paid, billing_records!inner(billing_date, created_at)')
        .eq('scout_account_id', scoutAccount.id)
        .or('is_void.is.null,is_void.eq.false')

      const outstanding: OutstandingCharge[] = (chargesData || [])
        .filter((c) => !c.is_paid && c.amount - (c.paid_amount || 0) > 0)
        .map((c) => {
          const record = c.billing_records as unknown as { billing_date: string; created_at: string | null } | null
          return {
            id: c.id,
            billingRecordId: '',
            description: '',
            amount: c.amount,
            paidAmount: c.paid_amount || 0,
            billingDate: record?.billing_date || '',
            createdAt: record?.created_at || '',
          }
        })

      const fifo = allocatePayment(outstanding, amountDollars)
      allocations = fifo.length > 0 ? fifo.map((a) => ({ charge_id: a.chargeId, amount: a.amount })) : null
    }

    // Transfer funds from Scout Funds to Billing using RPC
    const { data: transferResult, error: transferError } = await supabase.rpc('transfer_funds_to_billing', {
      p_scout_account_id: scoutAccount.id,
      p_amount: amountDollars,
      p_description: `Payment applied to: ${paymentLink.description}`,
      p_allocations: allocations,
    })

    if (transferError) {
      console.error('Failed to transfer funds:', transferError)
      return NextResponse.json(
        { error: transferError.message || 'Failed to transfer Scout Funds' },
        { status: 500 }
      )
    }

    // Create payment record for tracking
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        unit_id: paymentLink.unit_id,
        scout_account_id: scoutAccount.id,
        amount: amountDollars,
        fee_amount: 0,
        net_amount: amountDollars,
        payment_method: 'balance',
        status: 'completed',
        notes: `Scout Funds transfer applied to: ${paymentLink.description}`,
      })
      .select()
      .single()

    if (paymentError) {
      console.error('Failed to create payment record:', paymentError)
      // Transfer succeeded but payment record failed - log but don't fail
    }

    // Mark billing charge as paid if fully covered
    let chargeMarkedPaid = false
    if (paymentLink.billing_charge_id && amountCents >= chargeAmountCents && chargeAmountCents > 0) {
      const { error: chargeError } = await supabase
        .from('billing_charges')
        .update({ is_paid: true })
        .eq('id', paymentLink.billing_charge_id)

      if (!chargeError) {
        chargeMarkedPaid = true
      }
    }

    // Update payment link
    // If charge is fully paid, mark as completed. Otherwise keep pending.
    const newLinkStatus = chargeMarkedPaid ? 'completed' : 'pending'
    await supabase
      .from('payment_links')
      .update({
        status: newLinkStatus,
        payment_id: payment?.id || null,
        completed_at: chargeMarkedPaid ? new Date().toISOString() : null,
      })
      .eq('id', paymentLink.id)

    // Get updated balances from transfer result
    const result = transferResult as {
      success: boolean
      new_funds_balance: number
      new_billing_balance: number
    }

    return NextResponse.json({
      success: true,
      payment: {
        id: payment?.id || 'unknown',
        amount: amountDollars,
        paymentMethod: 'balance',
        scoutName,
      },
      chargeMarkedPaid,
      remainingCredit: result.new_funds_balance,
      remainingBalance: result.new_billing_balance < 0 ? Math.abs(result.new_billing_balance) : 0,
    })
  } catch (error) {
    console.error('Pay with balance error:', error)
    return NextResponse.json(
      { error: 'Failed to process balance payment' },
      { status: 500 }
    )
  }
}
