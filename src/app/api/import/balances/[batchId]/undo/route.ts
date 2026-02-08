import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface UndoResult {
  success: boolean
  error?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
): Promise<NextResponse<UndoResult>> {
  const { batchId } = await params
  const supabase = await createClient()

  // Verify authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json(
      { success: false, error: 'Profile not found' },
      { status: 403 }
    )
  }

  // Get user's unit and verify admin/treasurer role
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return NextResponse.json(
      { success: false, error: 'Only admins and treasurers can undo imports' },
      { status: 403 }
    )
  }

  const unitId = membership.unit_id
  const adminSupabase = createAdminClient()

  // Get the batch and verify it belongs to user's unit
  const { data: batch, error: batchError } = await adminSupabase
    .from('balance_import_batches')
    .select('id, unit_id, status, created_at')
    .eq('id', batchId)
    .eq('unit_id', unitId)
    .single()

  if (batchError || !batch) {
    return NextResponse.json(
      { success: false, error: 'Import batch not found' },
      { status: 404 }
    )
  }

  // Validate batch status
  if (batch.status !== 'active') {
    return NextResponse.json(
      { success: false, error: 'This import has already been undone' },
      { status: 400 }
    )
  }

  // Check if this is the most recent active batch for this unit
  const { data: newerBatches } = await adminSupabase
    .from('balance_import_batches')
    .select('id')
    .eq('unit_id', unitId)
    .eq('status', 'active')
    .gt('created_at', batch.created_at)

  if (newerBatches && newerBatches.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Cannot undo this import. There are newer imports that must be undone first.',
      },
      { status: 400 }
    )
  }

  // Get all journal entries for this batch
  const { data: journalEntries, error: entriesError } = await adminSupabase
    .from('journal_entries')
    .select(
      `
      id,
      unit_id,
      description,
      journal_lines (
        id,
        account_id,
        scout_account_id,
        debit,
        credit,
        memo,
        target_balance
      )
    `
    )
    .eq('balance_import_batch_id', batchId)

  if (entriesError) {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve journal entries' },
      { status: 500 }
    )
  }

  if (!journalEntries || journalEntries.length === 0) {
    // No entries to reverse, just mark as undone
    await adminSupabase
      .from('balance_import_batches')
      .update({
        status: 'undone',
        undone_at: new Date().toISOString(),
        undone_by: profile.id,
      })
      .eq('id', batchId)

    return NextResponse.json({ success: true })
  }

  // Check for subsequent activity on affected accounts
  // Get all scout account IDs affected by this batch
  const affectedScoutAccountIds = new Set<string>()
  for (const entry of journalEntries) {
    const lines = entry.journal_lines as Array<{
      scout_account_id: string | null
    }>
    for (const line of lines) {
      if (line.scout_account_id) {
        affectedScoutAccountIds.add(line.scout_account_id)
      }
    }
  }

  if (affectedScoutAccountIds.size > 0) {
    // Check for journal entries on these accounts after the batch was created
    // that are NOT part of this batch
    const { data: subsequentActivity } = await adminSupabase
      .from('journal_lines')
      .select(
        `
        id,
        journal_entry:journal_entries!inner (
          id,
          created_at,
          balance_import_batch_id
        )
      `
      )
      .in('scout_account_id', Array.from(affectedScoutAccountIds))
      .gt('journal_entries.created_at', batch.created_at)
      .neq('journal_entries.balance_import_batch_id', batchId)
      .limit(1)

    if (subsequentActivity && subsequentActivity.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Cannot undo this import. There has been subsequent financial activity on the affected accounts.',
        },
        { status: 400 }
      )
    }
  }

  // Create reversing entries for each original entry
  const today = new Date().toISOString().split('T')[0]

  for (const originalEntry of journalEntries) {
    const lines = originalEntry.journal_lines as Array<{
      id: string
      account_id: string
      scout_account_id: string | null
      debit: number | null
      credit: number | null
      memo: string | null
      target_balance: string | null
    }>

    // Create the reversing journal entry
    const { data: reversalEntry, error: reversalError } = await adminSupabase
      .from('journal_entries')
      .insert({
        unit_id: unitId,
        entry_date: today,
        description: `Reversal: ${originalEntry.description}`,
        entry_type: 'balance_import_reversal',
        is_posted: true,
        posted_at: new Date().toISOString(),
        created_by: profile.id,
        balance_import_batch_id: batchId,
      })
      .select('id')
      .single()

    if (reversalError || !reversalEntry) {
      return NextResponse.json(
        { success: false, error: 'Failed to create reversal entry' },
        { status: 500 }
      )
    }

    // Create reversing journal lines (swap debit and credit)
    const reversalLines = lines.map((line) => ({
      journal_entry_id: reversalEntry.id,
      account_id: line.account_id,
      scout_account_id: line.scout_account_id,
      debit: line.credit || 0, // Swap: original credit becomes debit
      credit: line.debit || 0, // Swap: original debit becomes credit
      memo: line.memo ? `Reversal: ${line.memo}` : 'Reversal',
      target_balance: line.target_balance,
    }))

    const { error: linesError } = await adminSupabase
      .from('journal_lines')
      .insert(reversalLines)

    if (linesError) {
      return NextResponse.json(
        { success: false, error: 'Failed to create reversal lines' },
        { status: 500 }
      )
    }
  }

  // Mark batch as undone
  const { error: updateError } = await adminSupabase
    .from('balance_import_batches')
    .update({
      status: 'undone',
      undone_at: new Date().toISOString(),
      undone_by: profile.id,
    })
    .eq('id', batchId)

  if (updateError) {
    return NextResponse.json(
      { success: false, error: 'Failed to update batch status' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
