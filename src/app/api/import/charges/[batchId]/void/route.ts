import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteParams {
  params: Promise<{ batchId: string }>
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { batchId } = await params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    const { data: membership } = await supabase
      .from('unit_memberships')
      .select('unit_id, role')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .single()

    if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only admins and treasurers can void charges' },
        { status: 403 }
      )
    }

    // Verify batch exists and belongs to unit
    const { data: batch } = await supabase
      .from('billing_import_batches')
      .select('id, unit_id')
      .eq('id', batchId)
      .eq('unit_id', membership.unit_id)
      .single()

    if (!batch) {
      return NextResponse.json({ error: 'Import batch not found' }, { status: 404 })
    }

    const adminSupabase = createAdminClient()
    const unitId = membership.unit_id
    const now = new Date().toISOString()

    // Get all billing records in this batch
    const { data: records } = await adminSupabase
      .from('billing_records')
      .select('id, journal_entry_id')
      .eq('billing_import_batch_id', batchId)
      .eq('unit_id', unitId)

    if (!records || records.length === 0) {
      return NextResponse.json({ error: 'No billing records found in batch' }, { status: 400 })
    }

    const recordIds = records.map((r) => r.id)
    const journalEntryIds = records
      .map((r) => r.journal_entry_id)
      .filter((id): id is string => id !== null)

    // Void all billing charges in these records
    await adminSupabase
      .from('billing_charges')
      .update({
        is_void: true,
        void_reason: 'Batch void',
        voided_by: profile.id,
        voided_at: now,
      })
      .in('billing_record_id', recordIds)

    // Void all billing records
    await adminSupabase
      .from('billing_records')
      .update({
        is_void: true,
        void_reason: 'Batch void',
        voided_by: profile.id,
        voided_at: now,
      })
      .in('id', recordIds)

    // Void associated journal entries
    if (journalEntryIds.length > 0) {
      await adminSupabase
        .from('journal_entries')
        .update({
          is_void: true,
          void_reason: 'Batch void',
        })
        .in('id', journalEntryIds)
    }

    // Create reversal journal entries for each original entry
    // This ensures the scout balances are corrected via the database trigger
    const { data: accounts } = await adminSupabase
      .from('accounts')
      .select('id, code')
      .eq('unit_id', unitId)
      .in('code', ['1100', '4000'])

    const receivablesAccount = accounts?.find((a) => a.code === '1100')
    const incomeAccount = accounts?.find((a) => a.code === '4000')

    if (receivablesAccount && incomeAccount) {
      // Get the original journal lines to reverse them
      for (const journalEntryId of journalEntryIds) {
        const { data: originalLines } = await adminSupabase
          .from('journal_lines')
          .select('account_id, debit, credit, memo, scout_account_id, target_balance')
          .eq('journal_entry_id', journalEntryId)

        if (!originalLines || originalLines.length === 0) continue

        // Create reversal journal entry
        const { data: reversalEntry } = await adminSupabase
          .from('journal_entries')
          .insert({
            unit_id: unitId,
            entry_date: new Date().toISOString().split('T')[0],
            description: `Void reversal`,
            entry_type: 'adjustment',
            created_by: profile.id,
            is_posted: true,
            posted_at: now,
          })
          .select('id')
          .single()

        if (!reversalEntry) continue

        // Reverse each line (swap debits and credits)
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

    return NextResponse.json({
      success: true,
      voided: records.length,
    })
  } catch (error) {
    console.error('Batch void error:', error)
    return NextResponse.json(
      { error: 'Failed to void batch' },
      { status: 500 }
    )
  }
}
