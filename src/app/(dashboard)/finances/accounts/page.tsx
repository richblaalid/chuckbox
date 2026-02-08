import Link from 'next/link'
import { Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { hasFilteredView, isFinancialRole } from '@/lib/roles'
import { AccountsList } from '@/components/accounts/accounts-list'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { ImportUndoBanner } from '@/components/finances/import-undo-banner'

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
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  const membership = membershipData as { unit_id: string; role: string } | null

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
  const accounts = (accountsData as ScoutAccount[]) || []

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
  const totalOwed = accounts
    .filter((a) => (a.billing_balance || 0) < 0)
    .reduce((sum, a) => sum + Math.abs(a.billing_balance || 0), 0)

  const totalFunds = accounts
    .reduce((sum, a) => sum + (a.funds_balance || 0), 0)

  const scoutsWithDebt = accounts.filter((a) => (a.billing_balance || 0) < 0).length
  const scoutsWithFunds = accounts.filter((a) => (a.funds_balance || 0) > 0).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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
        {isFinancialRole(role) && (
          <Link href="/settings/import/balances">
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              Import Balances
            </Button>
          </Link>
        )}
      </div>

      <FinanceSubnav showFinancialTabs={canTakeActions} />

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

      {/* Accounts List */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isScout ? 'Account Details' : isParent ? 'Your Scouts' : 'All Scout Accounts'}
          </CardTitle>
          <CardDescription>
            {accounts.length} account{accounts.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AccountsList accounts={accounts} showPatrolFilter={!hasFilteredView(role)} />
        </CardContent>
      </Card>
    </div>
  )
}
