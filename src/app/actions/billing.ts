'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

interface ActionResult {
  success: boolean
  error?: string
}

/**
 * Void a single billing record and its charges.
 * Creates reversal journal entries to correct scout balances.
 */
export async function voidBillingRecord(billingRecordId: string): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return { success: false, error: 'Only admins and treasurers can void billing records' }
  }

  // Fetch the billing record and verify it belongs to the user's unit
  const { data: record } = await supabase
    .from('billing_records')
    .select('id, unit_id, journal_entry_id, is_void')
    .eq('id', billingRecordId)
    .eq('unit_id', membership.unit_id)
    .single()

  if (!record) {
    return { success: false, error: 'Billing record not found' }
  }

  if (record.is_void) {
    return { success: false, error: 'Billing record is already voided' }
  }

  const adminSupabase = createAdminClient()
  const now = new Date().toISOString()

  // Void all charges on this record
  await adminSupabase
    .from('billing_charges')
    .update({
      is_void: true,
      void_reason: 'Record voided',
      voided_by: profile.id,
      voided_at: now,
    })
    .eq('billing_record_id', billingRecordId)

  // Void the billing record
  await adminSupabase
    .from('billing_records')
    .update({
      is_void: true,
      void_reason: 'Voided by treasurer',
      voided_by: profile.id,
      voided_at: now,
    })
    .eq('id', billingRecordId)

  // Void the original journal entry
  if (record.journal_entry_id) {
    await adminSupabase
      .from('journal_entries')
      .update({
        is_void: true,
        void_reason: 'Billing record voided',
      })
      .eq('id', record.journal_entry_id)

    // Get original journal lines to create reversals
    const { data: originalLines } = await adminSupabase
      .from('journal_lines')
      .select('account_id, debit, credit, memo, scout_account_id, target_balance')
      .eq('journal_entry_id', record.journal_entry_id)

    if (originalLines && originalLines.length > 0) {
      // Create reversal journal entry
      const { data: reversalEntry } = await adminSupabase
        .from('journal_entries')
        .insert({
          unit_id: membership.unit_id,
          entry_date: new Date().toISOString().split('T')[0],
          description: 'Void reversal',
          entry_type: 'adjustment',
          created_by: profile.id,
          is_posted: true,
          posted_at: now,
        })
        .select('id')
        .single()

      if (reversalEntry) {
        // Swap debits and credits
        const reversalLines = originalLines.map((line) => ({
          journal_entry_id: reversalEntry.id,
          account_id: line.account_id,
          debit: line.credit || 0,
          credit: line.debit || 0,
          memo: `Void: ${line.memo || ''}`,
          scout_account_id: line.scout_account_id,
          target_balance: line.target_balance,
        }))

        await adminSupabase.from('journal_lines').insert(reversalLines)
      }
    }
  }

  revalidatePath('/finances')
  revalidatePath('/finances/billing')
  revalidatePath('/finances/accounts')

  return { success: true }
}
