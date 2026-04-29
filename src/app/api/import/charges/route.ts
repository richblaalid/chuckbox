import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

interface ChargeImportRow {
  scoutId?: string
  scoutAccountId?: string
  amount?: number
  description?: string
  date?: string
  reference?: string
  memo?: string
  action: 'import' | 'skip' | 'manual_match'
  manualMatchScoutId?: string
}

interface ImportRequest {
  unitId: string
  fileName?: string
  rows: ChargeImportRow[]
}

interface ImportResult {
  success: boolean
  batchId?: string
  imported: number
  skipped: number
  totalAmount: number
  errors: Array<{ scoutName: string; amount: number; error: string }>
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ImportResult>> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, totalAmount: 0, errors: [] },
      { status: 401 }
    )
  }

  const membership = await getCurrentMembership(supabase, getRequestedUnitId(request))
  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        skipped: 0,
        totalAmount: 0,
        errors: [{ scoutName: '', amount: 0, error: 'Only admins and treasurers can import charges' }],
      },
      { status: 403 }
    )
  }

  const profile = { id: membership.profile_id }

  let data: ImportRequest
  try {
    data = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, totalAmount: 0, errors: [] },
      { status: 400 }
    )
  }

  const { fileName, rows } = data
  const unitId = membership.unit_id

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, totalAmount: 0, errors: [] },
      { status: 400 }
    )
  }

  const importRows = rows.filter(
    (r) => r.action === 'import' || r.action === 'manual_match'
  )

  if (importRows.length === 0) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: rows.length, totalAmount: 0, errors: [] },
      { status: 400 }
    )
  }

  const adminSupabase = createAdminClient()

  // Get system accounts for journal entries
  const { data: accounts } = await adminSupabase
    .from('accounts')
    .select('id, code')
    .eq('unit_id', unitId)
    .in('code', ['1100', '4000']) // Receivables and Dues Income

  const receivablesAccount = accounts?.find((a) => a.code === '1100')
  const incomeAccount = accounts?.find((a) => a.code === '4000')

  if (!receivablesAccount || !incomeAccount) {
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        skipped: 0,
        totalAmount: 0,
        errors: [{ scoutName: '', amount: 0, error: 'System accounts not found (1100, 4000)' }],
      },
      { status: 500 }
    )
  }

  // Create import batch
  const totalAmount = importRows.reduce((sum, r) => sum + (r.amount || 0), 0)

  const { data: batch, error: batchError } = await adminSupabase
    .from('billing_import_batches')
    .insert({
      unit_id: unitId,
      created_by: profile.id,
      filename: fileName || null,
      total_records: importRows.length,
      total_amount: totalAmount,
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        skipped: 0,
        totalAmount: 0,
        errors: [{ scoutName: '', amount: 0, error: 'Failed to create import batch' }],
      },
      { status: 500 }
    )
  }

  const errors: Array<{ scoutName: string; amount: number; error: string }> = []
  let imported = 0
  let importedAmount = 0

  for (const row of importRows) {
    try {
      // Resolve scout account ID
      let scoutAccountId = row.scoutAccountId

      if (!scoutAccountId && row.action === 'manual_match' && row.manualMatchScoutId) {
        const { data: account } = await adminSupabase
          .from('scout_accounts')
          .select('id')
          .eq('scout_id', row.manualMatchScoutId)
          .eq('unit_id', unitId)
          .single()

        scoutAccountId = account?.id
      }

      if (!scoutAccountId) {
        errors.push({ scoutName: 'Unknown', amount: row.amount || 0, error: 'Could not find scout account' })
        continue
      }

      // Get scout name for records
      const { data: scoutAccount } = await adminSupabase
        .from('scout_accounts')
        .select('scouts(first_name, last_name)')
        .eq('id', scoutAccountId)
        .eq('unit_id', unitId)
        .single()

      const scout = scoutAccount?.scouts as { first_name: string; last_name: string } | null
      const scoutName = scout ? `${scout.first_name} ${scout.last_name}` : 'Unknown Scout'

      const amount = row.amount || 0
      if (amount <= 0) {
        errors.push({ scoutName, amount, error: 'Amount must be greater than zero' })
        continue
      }

      const description = row.description || 'Billing charge'
      const billingDate = row.date || new Date().toISOString().split('T')[0]

      // 1. Create billing_record
      const { data: billingRecord, error: brError } = await adminSupabase
        .from('billing_records')
        .insert({
          unit_id: unitId,
          description,
          billing_date: billingDate,
          total_amount: amount,
          created_by: profile.id,
          billing_import_batch_id: batch.id,
        })
        .select('id')
        .single()

      if (brError || !billingRecord) {
        errors.push({ scoutName, amount, error: 'Failed to create billing record' })
        continue
      }

      // 2. Create billing_charge
      const { error: bcError } = await adminSupabase
        .from('billing_charges')
        .insert({
          billing_record_id: billingRecord.id,
          scout_account_id: scoutAccountId,
          amount,
        })

      if (bcError) {
        errors.push({ scoutName, amount, error: 'Failed to create billing charge' })
        continue
      }

      // 3. Create journal entry (debit receivables, credit income)
      const { data: journalEntry, error: jeError } = await adminSupabase
        .from('journal_entries')
        .insert({
          unit_id: unitId,
          entry_date: billingDate,
          description: `Billing: ${description} - ${scoutName}`,
          entry_type: 'billing',
          created_by: profile.id,
          is_posted: true,
          posted_at: new Date().toISOString(),
          reference: row.reference || null,
        })
        .select('id')
        .single()

      if (jeError || !journalEntry) {
        errors.push({ scoutName, amount, error: 'Failed to create journal entry' })
        continue
      }

      // Link journal entry to billing record
      await adminSupabase
        .from('billing_records')
        .update({ journal_entry_id: journalEntry.id })
        .eq('id', billingRecord.id)

      // 4. Create journal lines
      const { error: jlError } = await adminSupabase
        .from('journal_lines')
        .insert([
          {
            journal_entry_id: journalEntry.id,
            account_id: receivablesAccount.id,
            scout_account_id: scoutAccountId,
            debit: amount,
            credit: 0,
            memo: row.memo || description,
            target_balance: 'billing',
          },
          {
            journal_entry_id: journalEntry.id,
            account_id: incomeAccount.id,
            debit: 0,
            credit: amount,
            memo: row.memo || description,
          },
        ])

      if (jlError) {
        errors.push({ scoutName, amount, error: 'Failed to create journal lines' })
        continue
      }

      // Note: scout_accounts.billing_balance is updated automatically by
      // the trigger_update_scout_balance_insert database trigger

      imported++
      importedAmount += amount
    } catch (err) {
      errors.push({
        scoutName: 'Unknown',
        amount: row.amount || 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Update batch with actual imported count
  await adminSupabase
    .from('billing_import_batches')
    .update({
      total_records: imported,
      total_amount: importedAmount,
    })
    .eq('id', batch.id)

  return NextResponse.json({
    success: errors.length === 0,
    batchId: batch.id,
    imported,
    skipped: rows.length - importRows.length,
    totalAmount: importedAmount,
    errors,
  })
}
