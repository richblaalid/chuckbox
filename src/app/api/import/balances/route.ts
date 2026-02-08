import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface BalanceImportRow {
  scoutId?: string // If matched
  scoutAccountId?: string // If matched
  firstName?: string
  lastName?: string
  bsaMemberId?: string
  billingBalance?: number
  fundsBalance?: number
  action: 'import' | 'skip' | 'manual_match'
  manualMatchScoutId?: string // For manual matching
}

interface ImportRequest {
  mode: 'set' | 'adjust'
  rows: BalanceImportRow[]
}

interface ImportResult {
  success: boolean
  batchId?: string
  imported: number
  skipped: number
  errors: string[]
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ImportResult>> {
  const supabase = await createClient()

  // Verify authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, errors: ['Unauthorized'] },
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
      { success: false, imported: 0, skipped: 0, errors: ['Profile not found'] },
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
      {
        success: false,
        imported: 0,
        skipped: 0,
        errors: ['Only admins and treasurers can import balances'],
      },
      { status: 403 }
    )
  }

  const unitId = membership.unit_id

  // Parse request body
  let data: ImportRequest
  try {
    data = await request.json()
  } catch {
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        skipped: 0,
        errors: ['Invalid request body'],
      },
      { status: 400 }
    )
  }

  const { mode, rows } = data

  // Validate mode field
  if (mode !== 'set' && mode !== 'adjust') {
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        skipped: 0,
        errors: ['Invalid mode: must be "set" or "adjust"'],
      },
      { status: 400 }
    )
  }

  // Validate rows field
  if (!Array.isArray(rows)) {
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        skipped: 0,
        errors: ['Invalid rows: must be an array'],
      },
      { status: 400 }
    )
  }

  const importRows = rows.filter(
    (r) => r.action === 'import' || r.action === 'manual_match'
  )

  if (importRows.length === 0) {
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        skipped: rows.length,
        errors: ['No rows to import'],
      },
      { status: 400 }
    )
  }

  const adminSupabase = createAdminClient()
  const errors: string[] = []
  let imported = 0
  const skipped = rows.filter((r) => r.action === 'skip').length

  // Create import batch
  const { data: batch, error: batchError } = await adminSupabase
    .from('balance_import_batches')
    .insert({
      unit_id: unitId,
      imported_by: profile.id,
      mode,
      row_count: importRows.length,
      status: 'active',
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        skipped: 0,
        errors: ['Failed to create import batch'],
      },
      { status: 500 }
    )
  }

  // Get system accounts for journal entries
  const { data: accounts } = await adminSupabase
    .from('accounts')
    .select('id, code')
    .eq('unit_id', unitId)
    .in('code', ['1100', '2100']) // Receivables and Scout Funds Liability

  const receivablesAccount = accounts?.find((a) => a.code === '1100')
  const fundsLiabilityAccount = accounts?.find((a) => a.code === '2100')

  if (!receivablesAccount || !fundsLiabilityAccount) {
    return NextResponse.json(
      {
        success: false,
        imported: 0,
        skipped: 0,
        errors: ['System accounts not found'],
      },
      { status: 500 }
    )
  }

  // Process each row
  for (const row of importRows) {
    try {
      // Determine scout account ID
      let scoutAccountId = row.scoutAccountId

      if (
        !scoutAccountId &&
        row.action === 'manual_match' &&
        row.manualMatchScoutId
      ) {
        // Get account for manually matched scout
        const { data: account } = await adminSupabase
          .from('scout_accounts')
          .select('id')
          .eq('scout_id', row.manualMatchScoutId)
          .eq('unit_id', unitId)
          .single()

        scoutAccountId = account?.id
      }

      if (!scoutAccountId) {
        errors.push(
          `Could not find account for ${row.firstName} ${row.lastName}`
        )
        continue
      }

      // Get current balances - verify account belongs to user's unit
      const { data: currentAccount } = await adminSupabase
        .from('scout_accounts')
        .select(
          'billing_balance, funds_balance, scout_id, scouts(first_name, last_name)'
        )
        .eq('id', scoutAccountId)
        .eq('unit_id', unitId)
        .single()

      if (!currentAccount) {
        errors.push(`Account not found: ${scoutAccountId}`)
        continue
      }

      const scout = currentAccount.scouts as {
        first_name: string
        last_name: string
      } | null
      const scoutName = scout
        ? `${scout.first_name} ${scout.last_name}`
        : 'Unknown Scout'

      const currentBilling = currentAccount.billing_balance || 0
      const currentFunds = currentAccount.funds_balance || 0

      // Calculate new balances
      let newBilling: number
      let newFunds: number

      if (mode === 'set') {
        newBilling = row.billingBalance ?? currentBilling
        newFunds = row.fundsBalance ?? currentFunds
      } else {
        // Adjust mode
        newBilling = currentBilling + (row.billingBalance ?? 0)
        newFunds = currentFunds + (row.fundsBalance ?? 0)
      }

      // Ensure funds stays non-negative
      if (newFunds < 0) {
        errors.push(`${scoutName}: Funds balance cannot be negative`)
        continue
      }

      // Calculate differences for journal entries
      const billingDiff = newBilling - currentBilling
      const fundsDiff = newFunds - currentFunds

      // Create journal entry if there are changes
      if (billingDiff !== 0 || fundsDiff !== 0) {
        const entryType = mode === 'set' ? 'beginning_balance' : 'adjustment'
        const description =
          mode === 'set'
            ? `Beginning balance import - ${scoutName}`
            : `Balance adjustment import - ${scoutName}`

        // Create journal entry
        const { data: journalEntry, error: journalError } = await adminSupabase
          .from('journal_entries')
          .insert({
            unit_id: unitId,
            entry_date: new Date().toISOString().split('T')[0],
            description,
            entry_type: entryType,
            balance_import_batch_id: batch.id,
            created_by: profile.id,
            is_posted: true,
            posted_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (journalError || !journalEntry) {
          errors.push(`${scoutName}: Failed to create journal entry`)
          continue
        }

        // Create journal lines
        const journalLines: Array<{
          journal_entry_id: string
          account_id: string
          scout_account_id: string
          debit: number
          credit: number
          memo: string
          target_balance: string
        }> = []

        if (billingDiff !== 0) {
          // Billing balance change
          // If billing goes more negative (more owed), debit receivables
          // If billing goes less negative (less owed), credit receivables
          if (billingDiff < 0) {
            // More owed = debit receivables
            journalLines.push({
              journal_entry_id: journalEntry.id,
              account_id: receivablesAccount.id,
              scout_account_id: scoutAccountId,
              debit: Math.abs(billingDiff),
              credit: 0,
              memo: `Billing balance: ${currentBilling} → ${newBilling}`,
              target_balance: 'billing',
            })
          } else {
            // Less owed = credit receivables
            journalLines.push({
              journal_entry_id: journalEntry.id,
              account_id: receivablesAccount.id,
              scout_account_id: scoutAccountId,
              debit: 0,
              credit: billingDiff,
              memo: `Billing balance: ${currentBilling} → ${newBilling}`,
              target_balance: 'billing',
            })
          }
        }

        if (fundsDiff !== 0) {
          // Funds balance change
          // If funds increase, credit liability (unit owes scout more)
          // If funds decrease, debit liability (unit owes scout less)
          if (fundsDiff > 0) {
            journalLines.push({
              journal_entry_id: journalEntry.id,
              account_id: fundsLiabilityAccount.id,
              scout_account_id: scoutAccountId,
              debit: 0,
              credit: fundsDiff,
              memo: `Funds balance: ${currentFunds} → ${newFunds}`,
              target_balance: 'funds',
            })
          } else {
            journalLines.push({
              journal_entry_id: journalEntry.id,
              account_id: fundsLiabilityAccount.id,
              scout_account_id: scoutAccountId,
              debit: Math.abs(fundsDiff),
              credit: 0,
              memo: `Funds balance: ${currentFunds} → ${newFunds}`,
              target_balance: 'funds',
            })
          }
        }

        if (journalLines.length > 0) {
          const { error: linesError } = await adminSupabase
            .from('journal_lines')
            .insert(journalLines)

          if (linesError) {
            errors.push(`${scoutName}: Failed to create journal lines`)
            continue
          }
        }
        // Note: scout_accounts balances are updated automatically by
        // the trigger_update_scout_balance_insert database trigger
      }

      imported++
    } catch (err) {
      errors.push(
        `Error processing row: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // Update batch row count with actual imported count
  await adminSupabase
    .from('balance_import_batches')
    .update({ row_count: imported })
    .eq('id', batch.id)

  return NextResponse.json({
    success: errors.length === 0,
    batchId: batch.id,
    imported,
    skipped,
    errors,
  })
}
