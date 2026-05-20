'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface ReconcileToScoutParams {
  type: 'scout'
  squareTransactionId: string
  unitId: string
  scoutAccountId: string
  scoutName: string
  amount: number       // in dollars
  feeAmount: number    // in dollars
  netAmount: number    // in dollars
  squarePaymentId: string
  squareCreatedAt: string  // original transaction date
  receiptUrl: string | null
  allocations?: Array<{ chargeId: string; amount: number }>
  notes?: string
  entryDate?: string  // YYYY-MM-DD from client's local timezone
}

interface ReconcileNotScoutParams {
  type: 'not_scout'
  squareTransactionId: string
  unitId: string
  amount: number
  feeAmount: number
  netAmount: number
  squarePaymentId: string
  squareCreatedAt: string  // original transaction date
  receiptUrl: string | null
  notes?: string
  entryDate?: string  // YYYY-MM-DD from client's local timezone
}

type ReconcileParams = ReconcileToScoutParams | ReconcileNotScoutParams

interface ActionResult {
  success: boolean
  error?: string
  paymentId?: string
}

export async function reconcileSquareTransaction(params: ReconcileParams): Promise<ActionResult> {
  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile) return { success: false, error: 'Profile not found' }

  // Permission check
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('unit_id', params.unitId)
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return { success: false, error: 'Permission denied' }
  }

  // Verify the Square transaction exists and is unreconciled
  const { data: sqTxn } = await supabase
    .from('square_transactions')
    .select('id, payment_id')
    .eq('id', params.squareTransactionId)
    .single()

  if (!sqTxn) return { success: false, error: 'Square transaction not found' }
  if (sqTxn.payment_id) return { success: false, error: 'Transaction already reconciled' }

  try {
    const paymentDate = params.entryDate || new Date().toISOString().split('T')[0]

    const isScout = params.type === 'scout'
    const creditAccountCode = isScout ? '1200' : '4900'
    const description = isScout
      ? `Card payment reconciled for ${(params as ReconcileToScoutParams).scoutName}`
      : `Card payment reconciled — ${params.notes || 'not scout-related'}`

    // Create journal entry
    const { data: journalEntry, error: journalError } = await supabase
      .from('journal_entries')
      .insert({
        unit_id: params.unitId,
        entry_date: paymentDate,
        description,
        entry_type: 'payment',
        is_posted: true,
      })
      .select()
      .single()

    if (journalError || !journalEntry) {
      return { success: false, error: 'Failed to create journal entry' }
    }

    // Get accounts
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('unit_id', params.unitId)
      .in('code', ['1000', creditAccountCode])

    const bankAccount = accounts?.find(a => a.code === '1000')
    const creditAccount = accounts?.find(a => a.code === creditAccountCode)

    if (!bankAccount || !creditAccount) {
      await supabase.from('journal_entries').delete().eq('id', journalEntry.id)
      return { success: false, error: `Required accounts not found (1000, ${creditAccountCode})` }
    }

    // Create journal lines (double-entry)
    const scoutAccountId = isScout ? (params as ReconcileToScoutParams).scoutAccountId : null
    const { error: linesError } = await supabase.from('journal_lines').insert([
      {
        journal_entry_id: journalEntry.id,
        account_id: bankAccount.id,
        scout_account_id: null,
        debit: params.netAmount,
        credit: 0,
        memo: 'Card payment received (net of fees)',
      },
      {
        journal_entry_id: journalEntry.id,
        account_id: creditAccount.id,
        scout_account_id: scoutAccountId,
        debit: 0,
        credit: params.amount,
        memo: isScout ? 'Payment received' : (params.notes || 'Non-scout card payment'),
      },
    ])

    if (linesError) {
      await supabase.from('journal_entries').delete().eq('id', journalEntry.id)
      return { success: false, error: 'Failed to create journal lines' }
    }

    // Create payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        unit_id: params.unitId,
        scout_account_id: scoutAccountId,
        amount: params.amount,
        fee_amount: params.feeAmount,
        net_amount: params.netAmount,
        payment_method: 'card',
        status: 'completed',
        created_at: params.squareCreatedAt,
        journal_entry_id: journalEntry.id,
        square_payment_id: params.squarePaymentId,
        square_receipt_url: params.receiptUrl,
        recorded_by: profile.id,
        reconciliation_status: isScout ? 'reconciled' : 'not_scout_related',
        notes: params.notes || null,
      })
      .select('id')
      .single()

    if (paymentError) {
      return { success: false, error: 'Failed to create payment record' }
    }

    // Link square_transactions to the new payment
    await supabase
      .from('square_transactions')
      .update({ payment_id: payment.id })
      .eq('id', params.squareTransactionId)

    // If scout reconciliation: handle allocations and overpayment
    if (isScout) {
      const scoutParams = params as ReconcileToScoutParams
      if (scoutParams.allocations && scoutParams.allocations.length > 0) {
        const allocationRows = scoutParams.allocations.map(alloc => ({
          payment_id: payment.id,
          billing_charge_id: alloc.chargeId,
          amount: alloc.amount,
        }))

        await supabase.from('payment_allocations').insert(allocationRows)

        // Update paid_amount on each billing charge
        for (const alloc of scoutParams.allocations) {
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
    }

    revalidatePath('/finances')
    revalidatePath('/finances/payments')
    revalidatePath('/finances/accounts')
    revalidatePath('/dashboard')

    return { success: true, paymentId: payment.id }
  } catch (err) {
    console.error('reconcileSquareTransaction error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}
