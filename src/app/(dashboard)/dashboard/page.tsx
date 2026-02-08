import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { isFinancialRole, isManagementRole, hasFilteredView } from '@/lib/roles'
import { getSquareEnvironment } from '@/lib/square/client'
import { SquareEnvironment } from 'square'
import Link from 'next/link'
import { RefreshCw, Mail, CalendarCheck, Award } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QuickPaymentDialog } from '@/components/payments/quick-payment-dialog'

interface ScoutAccount {
  id: string
  billing_balance: number | null
  funds_balance: number | null
  scout_id: string
  scouts: {
    id: string
    first_name: string
    last_name: string
    patrols: { name: string } | null
  } | null
}

interface JournalEntry {
  id: string
  entry_date: string
  description: string
  entry_type: string | null
  journal_lines: { debit: number | null; credit: number | null }[]
}

// Map entry_type to user-friendly labels
function formatEntryType(entryType: string | null): string {
  const typeMap: Record<string, string> = {
    payment: 'Payment',
    billing: 'Billing',
    funds_transfer: 'Funds Transfer',
    fundraising: 'Fundraising',
    refund: 'Refund',
    adjustment: 'Adjustment',
  }
  return typeMap[entryType || ''] || 'Entry'
}

// Calculate total amount from journal lines (sum of debits, which equals sum of credits)
function getEntryAmount(lines: { debit: number | null; credit: number | null }[]): number {
  return lines.reduce((sum, line) => sum + (line.debit || 0), 0)
}

interface JournalLine {
  id: string
  debit: number | null
  credit: number | null
  journal_entries: {
    entry_date: string
    description: string
  } | null
}

export default async function DashboardPage() {
  const supabase = await createClient()

  // Get current user
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
        <h1 className="text-2xl font-bold text-stone-900">Welcome to ChuckBox</h1>
        <p className="mt-2 text-stone-600">
          You are not currently a member of any unit. Please contact your unit administrator.
        </p>
      </div>
    )
  }

  const role = membership.role
  const isParent = role === 'parent'
  const isScout = role === 'scout'

  // For parents/scouts, get their linked scout accounts
  let linkedScoutIds: string[] = []
  let linkedScoutAccountId: string | null = null

  if (isParent) {
    const { data: guardianData } = await supabase
      .from('scout_guardians')
      .select('scout_id')
      .eq('profile_id', profile.id)
    linkedScoutIds = (guardianData || []).map((g) => g.scout_id)
  }

  if (isScout) {
    // Find the scout record linked to this user's profile
    const { data: scoutData } = await supabase
      .from('scouts')
      .select('id, scout_accounts(id)')
      .eq('profile_id', profile.id)
      .single()

    if (scoutData) {
      linkedScoutIds = [scoutData.id]
      linkedScoutAccountId = (scoutData.scout_accounts as { id: string } | null)?.id || null
    }
  }

  // Get scout accounts with balances (filtered for parents/scouts)
  let scoutAccountsQuery = supabase
    .from('scout_accounts')
    .select(
      `
      id,
      billing_balance,
      funds_balance,
      scout_id,
      scouts (
        id,
        first_name,
        last_name,
        patrols ( name )
      )
    `
    )
    .eq('unit_id', membership.unit_id)

  if (hasFilteredView(role) && linkedScoutIds.length > 0) {
    scoutAccountsQuery = scoutAccountsQuery.in('scout_id', linkedScoutIds)
  } else if (hasFilteredView(role)) {
    // No linked scouts, will show empty
    scoutAccountsQuery = scoutAccountsQuery.eq('id', 'none')
  }

  const { data: scoutAccountsData } = await scoutAccountsQuery
  const scoutAccounts = scoutAccountsData as ScoutAccount[] | null

  // Calculate summary stats
  const totalScouts = scoutAccounts?.length || 0
  const totalBalance = scoutAccounts?.reduce((sum, acc) => sum + (acc.billing_balance || 0), 0) || 0
  const scoutsOwing = scoutAccounts?.filter((acc) => (acc.billing_balance || 0) < 0).length || 0

  // Get recent journal entries (for management roles)
  let recentTransactions: JournalEntry[] | null = null
  if (isManagementRole(role)) {
    const { data: recentTransactionsData } = await supabase
      .from('journal_entries')
      .select('id, entry_date, description, entry_type, journal_lines(debit, credit)')
      .eq('unit_id', membership.unit_id)
      .eq('is_posted', true)
      .order('entry_date', { ascending: false })
      .limit(5)
    recentTransactions = recentTransactionsData as JournalEntry[] | null
  }

  // Get recent transactions for scout's own account
  let scoutRecentTransactions: JournalLine[] | null = null
  if (isScout && linkedScoutAccountId) {
    const { data: journalLinesData } = await supabase
      .from('journal_lines')
      .select(`
        id,
        debit,
        credit,
        journal_entries (
          entry_date,
          description
        )
      `)
      .eq('scout_account_id', linkedScoutAccountId)
      .order('created_at', { ascending: false })
      .limit(5)
    scoutRecentTransactions = journalLinesData as JournalLine[] | null
  }

  // Get Square credentials for payment integration (management roles only)
  let squareConfig: { applicationId: string; locationId: string; environment: 'sandbox' | 'production' } | undefined
  if (isFinancialRole(role)) {
    const { data: squareCredentials } = await supabase
      .from('unit_square_credentials')
      .select('location_id')
      .eq('unit_id', membership.unit_id)
      .eq('is_active', true)
      .maybeSingle()

    if (squareCredentials?.location_id) {
      squareConfig = {
        applicationId: process.env.SQUARE_APPLICATION_ID || '',
        locationId: squareCredentials.location_id,
        environment: getSquareEnvironment() === SquareEnvironment.Production ? 'production' : 'sandbox',
      }
    }
  }

  // Scout Dashboard - Simple view with their own account
  if (isScout) {
    const myAccount = scoutAccounts?.[0]
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-stone-900">My Account</h1>
          <p className="mt-1 text-stone-600">View your scout account balance and activity</p>
        </div>

        {myAccount ? (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Current Balance</CardDescription>
                <CardTitle
                  className={`text-4xl ${(myAccount.billing_balance || 0) < 0 ? 'text-error' : 'text-success'}`}
                >
                  {formatCurrency(myAccount.billing_balance || 0)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {(myAccount.billing_balance || 0) < 0 ? 'Amount owed' : 'Credit balance'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Your recent account transactions</CardDescription>
              </CardHeader>
              <CardContent>
                {scoutRecentTransactions && scoutRecentTransactions.length > 0 ? (
                  <div className="space-y-4">
                    {scoutRecentTransactions.map((line) => (
                      <div key={line.id} className="flex items-center justify-between border-b pb-2">
                        <div>
                          <p className="font-medium">{line.journal_entries?.description}</p>
                          <p className="text-sm text-stone-500">{line.journal_entries?.entry_date}</p>
                        </div>
                        <span
                          className={`font-medium ${line.debit ? 'text-error' : 'text-success'}`}
                        >
                          {line.debit
                            ? `-${formatCurrency(line.debit)}`
                            : `+${formatCurrency(line.credit || 0)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-stone-500">No recent activity</p>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="border-dashed border-amber-200 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700/30">
            <CardContent className="py-8 text-center">
              <p className="text-stone-600 dark:text-stone-300">No account found. Please contact your unit administrator.</p>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // Parent Dashboard - Family balance overview
  if (isParent) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-stone-900">Family Dashboard</h1>
          <p className="mt-1 text-stone-600">View your scouts&apos; account balances</p>
        </div>

        {scoutAccounts && scoutAccounts.length > 0 ? (
          <>
            {/* Family Balance Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Family Balance</CardDescription>
                <CardTitle
                  className={`text-4xl ${totalBalance < 0 ? 'text-error' : 'text-success'}`}
                >
                  {formatCurrency(totalBalance)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {totalBalance < 0 ? 'Total amount owed' : 'Total credit balance'}
                </p>
              </CardContent>
            </Card>

            {/* Individual Scout Accounts */}
            <Card>
              <CardHeader>
                <CardTitle>Scout Accounts</CardTitle>
                <CardDescription>Individual account balances</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {scoutAccounts.map((account) => (
                    <Link
                      key={account.id}
                      href={`/finances/accounts/${account.id}`}
                      className="flex items-center justify-between rounded-lg border p-4 shadow-sm transition-all duration-200 hover:bg-amber-50/50 hover:border-amber-200 hover:shadow-md hover:-translate-y-0.5 dark:hover:bg-amber-900/10 dark:hover:border-amber-700/30"
                    >
                      <div>
                        <p className="font-medium text-stone-900">
                          {account.scouts?.first_name} {account.scouts?.last_name}
                        </p>
                        {account.scouts?.patrols?.name && (
                          <p className="text-sm text-stone-500">{account.scouts.patrols?.name}</p>
                        )}
                      </div>
                      <span
                        className={`text-lg font-bold ${
                          (account.billing_balance || 0) < 0 ? 'text-error' : 'text-success'
                        }`}
                      >
                        {formatCurrency(account.billing_balance || 0)}
                      </span>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="border-dashed border-amber-200 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700/30">
            <CardContent className="py-8 text-center">
              <p className="text-stone-600 dark:text-stone-300">No scouts linked to your account. Please contact your unit administrator.</p>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  // Management Dashboard (Admin, Treasurer, Leader)
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Dashboard</h1>
        <p className="mt-1 text-stone-600">Overview of your unit&apos;s finances</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Scouts</CardDescription>
            <CardTitle className="text-3xl">{totalScouts}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Active scout accounts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Scouts Owing</CardDescription>
            <CardTitle className={`text-3xl ${scoutsOwing > 0 ? 'text-error' : 'text-success'}`}>
              {scoutsOwing}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {scoutsOwing > 0 ? 'Need follow-up' : 'All current'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Troop Funds</CardDescription>
            <CardTitle className="text-xl text-stone-400">—</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-amber-700 font-medium">Coming soon</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Next Event</CardDescription>
            <CardTitle className="text-xl text-stone-400">—</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-amber-700 font-medium">Coming soon</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {isFinancialRole(role) && (
              <Button asChild className="gap-2">
                <Link href="/settings/import">
                  <RefreshCw className="h-4 w-4" />
                  Sync Scoutbook
                </Link>
              </Button>
            )}
            {/* Advancement Tracking */}
            <Button asChild variant="accent" className="gap-2">
              <Link href="/advancement?tab=summary">
                <Award className="h-4 w-4" />
                Advancement
              </Link>
            </Button>
            {/* Record Payment - opens dialog */}
            {isFinancialRole(role) && scoutAccounts && scoutAccounts.length > 0 && (
              <QuickPaymentDialog
                unitId={membership.unit_id}
                scouts={scoutAccounts.map((acc) => ({
                  id: acc.scouts?.id || acc.scout_id,
                  first_name: acc.scouts?.first_name || '',
                  last_name: acc.scouts?.last_name || '',
                  scout_accounts: {
                    id: acc.id,
                    billing_balance: acc.billing_balance,
                    funds_balance: acc.funds_balance,
                  },
                }))}
                squareConfig={squareConfig}
              />
            )}
            {/* Future: Send Payment Reminders */}
            {isFinancialRole(role) && scoutsOwing > 0 && (
              <Button variant="outline" disabled className="gap-2" title="Coming soon">
                <Mail className="h-4 w-4" />
                Send Reminders
                <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">Soon</span>
              </Button>
            )}
            {/* Future: Record Attendance */}
            <Button variant="outline" disabled className="gap-2" title="Coming soon">
              <CalendarCheck className="h-4 w-4" />
              Record Attendance
              <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">Soon</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        {isFinancialRole(role) && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Transactions</CardTitle>
                <CardDescription>Latest financial activity</CardDescription>
              </div>
              <Link
                href="/finances"
                className="text-sm text-forest-600 hover:text-forest-800 hover:underline"
              >
                View all →
              </Link>
            </CardHeader>
            <CardContent>
              {recentTransactions && recentTransactions.length > 0 ? (
                <div className="space-y-4">
                  {recentTransactions.map((tx) => {
                    const amount = getEntryAmount(tx.journal_lines || [])
                    const isPayment = tx.entry_type === 'payment'
                    return (
                      <div key={tx.id} className="flex items-center justify-between border-b pb-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{tx.description}</p>
                          <div className="flex items-center gap-2 text-sm text-stone-500">
                            <span>{new Date(tx.entry_date).toLocaleDateString()}</span>
                            <span className="text-stone-300">•</span>
                            <span>{formatEntryType(tx.entry_type)}</span>
                          </div>
                        </div>
                        <span className={`font-medium ml-3 ${isPayment ? 'text-success' : 'text-stone-700'}`}>
                          {isPayment ? '+' : ''}{formatCurrency(amount)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-stone-500">No recent transactions</p>
              )}
            </CardContent>
          </Card>
        )}

        <Card className={!isFinancialRole(role) ? 'lg:col-span-2' : ''}>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Scout Account Summary</CardTitle>
              <CardDescription>Current balances</CardDescription>
            </div>
            <Link
              href="/finances/accounts"
              className="text-sm text-forest-600 hover:text-forest-800 hover:underline"
            >
              View all →
            </Link>
          </CardHeader>
          <CardContent>
            {scoutAccounts && scoutAccounts.length > 0 ? (
              <div className="space-y-2">
                {scoutAccounts.slice(0, 5).map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between border-b pb-2"
                  >
                    <div>
                      <p className="font-medium">
                        {account.scouts?.first_name} {account.scouts?.last_name}
                      </p>
                      {account.scouts?.patrols?.name && (
                        <p className="text-xs text-stone-500">{account.scouts.patrols?.name}</p>
                      )}
                    </div>
                    <span
                      className={`font-medium ${
                        (account.billing_balance || 0) < 0 ? 'text-error' : 'text-success'
                      }`}
                    >
                      {formatCurrency(account.billing_balance || 0)}
                    </span>
                  </div>
                ))}
                {scoutAccounts.length > 5 && (
                  <p className="text-center text-sm text-stone-500">
                    +{scoutAccounts.length - 5} more scouts
                  </p>
                )}
              </div>
            ) : (
              <p className="text-stone-500">No scout accounts yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
