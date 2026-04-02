'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { formatCurrency } from '@/lib/utils'
import { todayLocalDate } from '@/lib/date-utils'

interface QuickPaymentParams {
  unitId: string
  scoutAccountId: string
  scoutName: string
  amountDollars: number
  method: 'cash' | 'check'
  reference?: string
  notes?: string
  allocations?: Array<{ chargeId: string; amount: number }>
}

interface ActionResult {
  success: boolean
  error?: string
  paymentId?: string
}

/**
 * Record a quick payment (cash or check) for a scout account.
 * Creates the necessary journal entries for double-entry accounting.
 */
export async function recordQuickPayment(params: QuickPaymentParams): Promise<ActionResult> {
  const { unitId, scoutAccountId, scoutName, amountDollars, method, reference, notes } = params

  if (amountDollars <= 0) {
    return { success: false, error: 'Amount must be greater than zero' }
  }

  const supabase = await createClient()

  // Verify user is authenticated and has permission
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Get current user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Check if user has treasurer or admin role
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('unit_id', unitId)
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return { success: false, error: 'Permission denied. Only admins and treasurers can record payments.' }
  }

  // Verify scout account belongs to this unit
  const { data: scoutAccount } = await supabase
    .from('scout_accounts')
    .select('id, scouts(unit_id)')
    .eq('id', scoutAccountId)
    .single()

  if (!scoutAccount) {
    return { success: false, error: 'Scout account not found' }
  }

  const scoutUnitId = (scoutAccount.scouts as { unit_id: string } | null)?.unit_id
  if (scoutUnitId !== unitId) {
    return { success: false, error: 'Scout does not belong to this unit' }
  }

  try {
    const paymentDate = todayLocalDate()

    // Build enriched description with allocation details when charges are specified
    let journalDescription = `${method.charAt(0).toUpperCase() + method.slice(1)} payment from ${scoutName}`
    if (params.allocations && params.allocations.length > 0) {
      const chargeIds = params.allocations.map((a) => a.chargeId)
      const { data: charges } = await supabase
        .from('billing_charges')
        .select('id, billing_records(description)')
        .in('id', chargeIds)

      if (charges && charges.length > 0) {
        const allocationDetails = params.allocations
          .map((alloc) => {
            const charge = charges.find((c) => c.id === alloc.chargeId)
            const chargeDescription = (charge?.billing_records as { description: string } | null)?.description
            return chargeDescription ? `${chargeDescription} (${formatCurrency(alloc.amount)})` : null
          })
          .filter(Boolean)

        if (allocationDetails.length > 0) {
          journalDescription += ` — ${allocationDetails.join(', ')}`
        }
      }
    }

    // Create journal entry
    const { data: journalEntry, error: journalError } = await supabase
      .from('journal_entries')
      .insert({
        unit_id: unitId,
        entry_date: paymentDate,
        description: journalDescription,
        entry_type: 'payment',
        reference: reference || null,
        is_posted: true,
      })
      .select()
      .single()

    if (journalError || !journalEntry) {
      console.error('Failed to create journal entry:', journalError)
      return { success: false, error: 'Failed to create payment record' }
    }

    // Get required accounts (bank and accounts receivable)
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('unit_id', unitId)
      .in('code', ['1000', '1200'])

    if (!accounts || accounts.length < 2) {
      // Rollback journal entry
      await supabase.from('journal_entries').delete().eq('id', journalEntry.id)
      return { success: false, error: 'Required accounts not found. Please check unit setup.' }
    }

    const bankAccount = accounts.find((a) => a.code === '1000')
    const receivableAccount = accounts.find((a) => a.code === '1200')

    if (!bankAccount || !receivableAccount) {
      await supabase.from('journal_entries').delete().eq('id', journalEntry.id)
      return { success: false, error: 'Bank or receivable account not found' }
    }

    // Create journal lines (double-entry: debit bank, credit receivable)
    const { error: linesError } = await supabase.from('journal_lines').insert([
      {
        journal_entry_id: journalEntry.id,
        account_id: bankAccount.id,
        scout_account_id: null,
        debit: amountDollars,
        credit: 0,
        memo: `${method} payment from ${scoutName}`,
      },
      {
        journal_entry_id: journalEntry.id,
        account_id: receivableAccount.id,
        scout_account_id: scoutAccountId,
        debit: 0,
        credit: amountDollars,
        memo: 'Payment received',
      },
    ])

    if (linesError) {
      console.error('Failed to create journal lines:', linesError)
      await supabase.from('journal_entries').delete().eq('id', journalEntry.id)
      return { success: false, error: 'Failed to record payment details' }
    }

    // Create payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        unit_id: unitId,
        scout_account_id: scoutAccountId,
        amount: amountDollars,
        fee_amount: 0,
        net_amount: amountDollars,
        payment_method: method,
        status: 'completed',
        journal_entry_id: journalEntry.id,
        recorded_by: profile.id,
        notes: [reference ? `Check #${reference}` : null, notes].filter(Boolean).join(' - ') || null,
      })
      .select('id')
      .single()

    if (paymentError) {
      console.error('Failed to create payment record:', paymentError)
      // Don't rollback journal - the accounting is correct
    }

    // Persist charge allocations (supplementary — does not fail the payment)
    if (params.allocations && params.allocations.length > 0 && payment?.id) {
      const allocationRows = params.allocations.map((alloc) => ({
        payment_id: payment.id,
        billing_charge_id: alloc.chargeId,
        amount: alloc.amount,
      }))

      const { error: allocError } = await supabase
        .from('payment_allocations')
        .insert(allocationRows)

      if (allocError) {
        console.error('Failed to create payment allocations:', allocError)
        // Don't fail the payment — allocations are supplementary
      }

      // Update paid_amount on each billing charge
      for (const alloc of params.allocations) {
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

    // Check for overpayment and auto-transfer to Scout Funds
    const { data: updatedAccount } = await supabase
      .from('scout_accounts')
      .select('billing_balance')
      .eq('id', scoutAccountId)
      .single()

    if (updatedAccount && (updatedAccount.billing_balance || 0) > 0) {
      const overpaymentAmount = updatedAccount.billing_balance || 0
      const { error: transferError } = await supabase.rpc('auto_transfer_overpayment', {
        p_scout_account_id: scoutAccountId,
        p_amount: overpaymentAmount,
      })

      if (transferError) {
        console.error('Failed to transfer overpayment:', transferError)
        // Don't fail the payment, just log the error
      }
    }

    // Revalidate relevant paths
    revalidatePath('/finances')
    revalidatePath('/finances/payments')
    revalidatePath('/finances/accounts')
    revalidatePath('/dashboard')

    return { success: true, paymentId: payment?.id }
  } catch (err) {
    console.error('recordQuickPayment error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

export async function updatePaymentNotes(
  paymentId: string,
  notes: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile) return { success: false, error: 'Profile not found' }

  // Get payment to check unit
  const { data: payment } = await supabase
    .from('payments')
    .select('unit_id, voided_at')
    .eq('id', paymentId)
    .single()
  if (!payment) return { success: false, error: 'Payment not found' }
  if (payment.voided_at) return { success: false, error: 'Cannot edit voided payment' }

  // Check permission
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('unit_id', payment.unit_id)
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return { success: false, error: 'Permission denied' }
  }

  const { error } = await supabase
    .from('payments')
    .update({ notes: notes.trim() || null })
    .eq('id', paymentId)

  if (error) return { success: false, error: 'Failed to update notes' }

  revalidatePath('/finances/payments')
  return { success: true }
}
