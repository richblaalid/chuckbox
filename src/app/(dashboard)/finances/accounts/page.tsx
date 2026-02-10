import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { hasFilteredView, isFinancialRole } from '@/lib/roles'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { ImportUndoBanner } from '@/components/finances/import-undo-banner'
import { UnifiedAccountsView } from '@/components/finances/unified-accounts-view'
import type { ScoutAccountRow } from '@/components/finances/unified-scout-accounts-table'

interface ScoutAccount {
  id: string
  billing_balance: number | null
  funds_balance: number
  scout_id: string
  scouts: {
    id: string
    first_name: string
    last_name: string
    is_active: boolean | null
    unit_id: string
    patrols: {
      name: string
    } | null
  } | null
}

export default async function AccountsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Get user's profile (profile_id is now separate from auth user id)
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) return null

  // Get user's unit membership
  const { data: membershipData } = await supabase
    .from('unit_memberships')
    .select('unit_id, role, units:units!unit_memberships_unit_id_fkey(name)')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  const membership = membershipData as { unit_id: string; role: string; units: { name: string } | null } | null

  if (!membership) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h1 className="text-2xl font-bold text-stone-900">No Unit Access</h1>
        <p className="mt-2 text-stone-600">
          You are not currently a member of any unit.
        </p>
      </div>
    )
  }

  const role = membership.role
  const isParent = role === 'parent'
  const isScout = role === 'scout'
  const canTakeActions = isFinancialRole(role)

  // For parents/scouts, get their linked scout IDs
  let linkedScoutIds: string[] = []

  if (isParent) {
    const { data: guardianData } = await supabase
      .from('scout_guardians')
      .select('scout_id')
      .eq('profile_id', profile.id)
    linkedScoutIds = (guardianData || []).map((g) => g.scout_id)
  }

  if (isScout) {
    const { data: scoutData } = await supabase
      .from('scouts')
      .select('id')
      .eq('profile_id', profile.id)
      .single()

    if (scoutData) {
      linkedScoutIds = [scoutData.id]
    }
  }

  // Get scout accounts (filtered for parents/scouts)
  let accountsQuery = supabase
    .from('scout_accounts')
    .select(`
      id,
      billing_balance,
      funds_balance,
      scout_id,
      scouts (
        id,
        first_name,
        last_name,
        is_active,
        unit_id,
        patrols (
          name
        )
      )
    `)
    .eq('unit_id', membership.unit_id)
    .order('billing_balance', { ascending: true })

  if (hasFilteredView(role) && linkedScoutIds.length > 0) {
    accountsQuery = accountsQuery.in('scout_id', linkedScoutIds)
  } else if (hasFilteredView(role)) {
    // No linked scouts, will show empty
    accountsQuery = accountsQuery.eq('id', 'none')
  }

  const { data: accountsData } = await accountsQuery
  const rawAccounts = (accountsData as ScoutAccount[]) || []

  // Get oldest unpaid billing date for each account (for overdue calculation)
  const accountIds = rawAccounts.map((a) => a.id)
  const oldestChargesByAccount: Record<string, string> = {}

  if (accountIds.length > 0) {
    const { data: unpaidChargesData } = await supabase
      .from('billing_charges')
      .select(`
        scout_account_id,
        billing_records!inner (
          billing_date
        )
      `)
      .in('scout_account_id', accountIds)
      .eq('is_paid', false)
      .or('is_void.is.null,is_void.eq.false')
      .order('billing_records(billing_date)', { ascending: true })

    interface UnpaidCharge {
      scout_account_id: string
      billing_records: { billing_date: string }
    }

    for (const charge of (unpaidChargesData as UnpaidCharge[]) || []) {
      // Only keep the oldest (first) date per account
      if (!oldestChargesByAccount[charge.scout_account_id]) {
        oldestChargesByAccount[charge.scout_account_id] = charge.billing_records.billing_date
      }
    }
  }

  // Calculate days overdue for each account
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Transform accounts for the unified table
  const accounts: ScoutAccountRow[] = rawAccounts.map((acc) => {
    const oldestDate = oldestChargesByAccount[acc.id]
    let daysOverdue = 0

    if (oldestDate) {
      const chargeDate = new Date(oldestDate)
      chargeDate.setHours(0, 0, 0, 0)
      daysOverdue = Math.floor((today.getTime() - chargeDate.getTime()) / (1000 * 60 * 60 * 24))
    }

    return {
      id: acc.id,
      scoutId: acc.scout_id,
      scoutName: acc.scouts ? `${acc.scouts.last_name}, ${acc.scouts.first_name}` : 'Unknown',
      patrolName: acc.scouts?.patrols?.name || null,
      billingBalance: acc.billing_balance || 0,
      fundsBalance: acc.funds_balance || 0,
      lastActivity: null, // Would need to add this to the query
      isActive: acc.scouts?.is_active ?? true,
      daysOverdue,
    }
  })

  // Extract unique patrols
  const patrols = [...new Set(accounts.map((a) => a.patrolName).filter(Boolean))] as string[]

  // Transform scouts for billing form
  const scoutsForBilling = rawAccounts
    .filter((acc) => acc.scouts)
    .map((acc) => ({
      id: acc.scouts!.id,
      first_name: acc.scouts!.first_name,
      last_name: acc.scouts!.last_name,
      is_active: acc.scouts!.is_active,
      scout_accounts: { id: acc.id },
      patrols: acc.scouts!.patrols,
    }))

  // Transform scouts for payment form (needs billing_balance and funds_balance)
  const scoutsForPayment = rawAccounts
    .filter((acc) => acc.scouts)
    .map((acc) => ({
      id: acc.scouts!.id,
      first_name: acc.scouts!.first_name,
      last_name: acc.scouts!.last_name,
      scout_accounts: {
        id: acc.id,
        billing_balance: acc.billing_balance,
        funds_balance: acc.funds_balance,
      },
    }))

  // Get Square configuration for payments
  let squareConfig: { applicationId: string; locationId: string; environment: 'sandbox' | 'production' } | undefined

  if (canTakeActions) {
    const { data: credentials } = await supabase
      .from('unit_square_credentials')
      .select('location_id')
      .eq('unit_id', membership.unit_id)
      .eq('is_active', true)
      .single()

    if (credentials?.location_id) {
      squareConfig = {
        applicationId: process.env.SQUARE_APPLICATION_ID || '',
        locationId: credentials.location_id,
        environment: (process.env.SQUARE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
      }
    }
  }

  // Get most recent active import batch for undo banner
  let latestBatch: { id: string; created_at: string; row_count: number } | null = null
  let canUndo = false

  if (isFinancialRole(role)) {
    const { data: batchData } = await supabase
      .from('balance_import_batches')
      .select('id, created_at, row_count')
      .eq('unit_id', membership.unit_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (batchData && batchData.created_at) {
      latestBatch = {
        id: batchData.id,
        created_at: batchData.created_at,
        row_count: batchData.row_count,
      }

      // Check if there's subsequent activity (would disable undo)
      const { data: newerEntries } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('unit_id', membership.unit_id)
        .gt('created_at', batchData.created_at)
        .is('balance_import_batch_id', null)
        .limit(1)

      canUndo = !newerEntries || newerEntries.length === 0
    }
  }

  // Calculate totals - now using separate billing and funds balances
  const totalOwed = rawAccounts
    .filter((a) => (a.billing_balance || 0) < 0)
    .reduce((sum, a) => sum + Math.abs(a.billing_balance || 0), 0)

  const totalFunds = rawAccounts
    .reduce((sum, a) => sum + (a.funds_balance || 0), 0)

  const scoutsWithDebt = rawAccounts.filter((a) => (a.billing_balance || 0) < 0).length
  const scoutsWithFunds = rawAccounts.filter((a) => (a.funds_balance || 0) > 0).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">
          {isScout ? 'My Account' : isParent ? 'Family Accounts' : 'Scout Accounts'}
        </h1>
        <p className="mt-1 text-stone-600">
          {isScout
            ? 'View your account balance and transactions'
            : isParent
              ? 'View your scouts\' account balances'
              : 'View and manage scout financial accounts'}
        </p>
      </div>

      <FinanceSubnav />

      {/* Undo Banner for recent imports */}
      {isFinancialRole(role) && latestBatch && canUndo && (
        <ImportUndoBanner
          batchId={latestBatch.id}
          importedAt={latestBatch.created_at}
          rowCount={latestBatch.row_count}
        />
      )}

      {/* Summary Cards (only for management/financial roles) */}
      {isFinancialRole(role) && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Owed to Unit</CardDescription>
              <CardTitle className="text-2xl text-error">
                {formatCurrency(totalOwed)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                From {scoutsWithDebt} scout{scoutsWithDebt !== 1 ? 's' : ''}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Scout Funds Held</CardDescription>
              <CardTitle className="text-2xl text-success">
                {formatCurrency(totalFunds)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                For {scoutsWithFunds} scout{scoutsWithFunds !== 1 ? 's' : ''}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Accounts</CardDescription>
              <CardTitle className="text-2xl text-stone-900">
                {accounts.length}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Active scout accounts
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Unified Accounts View with table, bulk actions, and action dialogs */}
      <UnifiedAccountsView
        unitId={membership.unit_id}
        unitName={membership.units?.name}
        scouts={accounts}
        patrols={patrols}
        scoutsForBilling={scoutsForBilling}
        scoutsForPayment={scoutsForPayment}
        canTakeActions={canTakeActions}
        squareConfig={squareConfig}
      />
    </div>
  )
}
