import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { canAccessPage, isFinancialRole } from '@/lib/roles'
import { isFeatureEnabled, FeatureFlag } from '@/lib/feature-flags'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { QuickActionsCard } from '@/components/finances/quick-actions-card'
import { Receipt, CreditCard, TrendingDown, Wallet, PiggyBank, AlertTriangle } from 'lucide-react'
import { BankWidget } from '@/components/plaid/bank-widget'

interface ScoutAccount {
  id: string
  billing_balance: number | null
  funds_balance: number
  scouts: {
    id: string
    first_name: string
    last_name: string
    is_active: boolean | null
    patrols: { name: string } | null
  } | null
}

interface RecentActivity {
  id: string
  type: 'payment' | 'billing'
  description: string
  amount: number
  date: string
  scoutName: string
  scoutAccountId: string
}

export default async function FinancesOverviewPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }

  // Get user's unit membership
  const { data: membershipData } = await supabase
    .from('unit_memberships')
    .select('unit_id, role, units:units!unit_memberships_unit_id_fkey(name, unit_number)')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  interface Membership {
    unit_id: string
    role: string
    units: { name: string; unit_number: string } | null
  }

  const membership = membershipData as Membership | null

  if (!membership) {
    redirect('/login')
  }

  // Only admin and treasurer can access finances
  if (!canAccessPage(membership.role, 'finances')) {
    redirect('/roster')
  }

  const canTakeActions = isFinancialRole(membership.role)

  // Get all scout accounts
  const { data: accountsData } = await supabase
    .from('scout_accounts')
    .select(`
      id,
      billing_balance,
      funds_balance,
      scouts (
        id,
        first_name,
        last_name,
        is_active,
        patrols (name)
      )
    `)
    .eq('unit_id', membership.unit_id)
    .order('billing_balance', { ascending: true })

  const accounts = (accountsData as ScoutAccount[]) || []

  // Get unpaid billing charges for aging/overdue calculation
  const { data: unpaidChargesData } = await supabase
    .from('billing_charges')
    .select(`
      id,
      amount,
      scout_account_id,
      billing_records!inner (
        billing_date,
        description,
        unit_id
      )
    `)
    .eq('billing_records.unit_id', membership.unit_id)
    .eq('is_paid', false)
    .or('is_void.is.null,is_void.eq.false')

  interface UnpaidCharge {
    id: string
    amount: number
    scout_account_id: string
    billing_records: {
      billing_date: string
      description: string
      unit_id: string
    }
  }

  const unpaidCharges = (unpaidChargesData as UnpaidCharge[]) || []

  // Get payments for collection summary
  const { data: paymentsData } = await supabase
    .from('payments')
    .select(`
      id,
      amount,
      created_at,
      scout_accounts!inner (
        id,
        scouts!inner (
          first_name,
          last_name
        )
      )
    `)
    .eq('unit_id', membership.unit_id)
    .eq('status', 'completed')
    .is('voided_at', null)
    .order('created_at', { ascending: false })
    .limit(10)

  interface PaymentWithScout {
    id: string
    amount: number
    created_at: string
    scout_accounts: {
      id: string
      scouts: {
        first_name: string
        last_name: string
      }
    }
  }

  const recentPayments = (paymentsData as PaymentWithScout[]) || []

  // Get recent billing records
  const { data: billingData } = await supabase
    .from('billing_records')
    .select('id, description, total_amount, billing_date')
    .eq('unit_id', membership.unit_id)
    .or('is_void.is.null,is_void.eq.false')
    .order('billing_date', { ascending: false })
    .limit(10)

  interface BillingRecord {
    id: string
    description: string
    total_amount: number
    billing_date: string
  }

  const recentBilling = (billingData as BillingRecord[]) || []

  // Calculate totals
  const totalOwed = accounts
    .filter((a) => (a.billing_balance || 0) < 0)
    .reduce((sum, a) => sum + Math.abs(a.billing_balance || 0), 0)

  const totalFunds = accounts
    .reduce((sum, a) => sum + (a.funds_balance || 0), 0)

  const scoutsOwing = accounts.filter((a) => (a.billing_balance || 0) < 0)

  // Calculate overdue amount and account count (31+ days)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdueCharges = unpaidCharges.filter(charge => {
    const billingDate = new Date(charge.billing_records.billing_date)
    billingDate.setHours(0, 0, 0, 0)
    const daysOld = Math.floor((today.getTime() - billingDate.getTime()) / (1000 * 60 * 60 * 24))
    return daysOld >= 31
  })
  const overdueAmount = overdueCharges.reduce((sum, charge) => sum + charge.amount, 0)
  const overdueAccountCount = new Set(overdueCharges.map(c => c.scout_account_id)).size

  // Calculate this month's collections
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const { data: monthPaymentsData } = await supabase
    .from('payments')
    .select('amount')
    .eq('unit_id', membership.unit_id)
    .eq('status', 'completed')
    .is('voided_at', null)
    .gte('created_at', thisMonthStart.toISOString())

  const collectedThisMonth = (monthPaymentsData || [])
    .reduce((sum, p) => sum + (p.amount || 0), 0)

  // Build recent activity list (combined payments and billing)
  const recentActivity: RecentActivity[] = [
    ...recentPayments.map(p => ({
      id: p.id,
      type: 'payment' as const,
      description: 'Payment received',
      amount: p.amount,
      date: p.created_at,
      scoutName: `${p.scout_accounts.scouts.first_name} ${p.scout_accounts.scouts.last_name}`,
      scoutAccountId: p.scout_accounts.id,
    })),
    ...recentBilling.map(b => ({
      id: b.id,
      type: 'billing' as const,
      description: b.description,
      amount: b.total_amount,
      date: b.billing_date,
      scoutName: 'Multiple scouts',
      scoutAccountId: '',
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10)

  // Transform accounts into scouts format for QuickActionsCard
  const scoutsForActions = accounts
    .filter((acc) => acc.scouts)
    .map((acc) => ({
      id: acc.scouts!.id,
      first_name: acc.scouts!.first_name,
      last_name: acc.scouts!.last_name,
      is_active: acc.scouts!.is_active,
      scout_accounts: {
        id: acc.id,
        billing_balance: acc.billing_balance,
        funds_balance: acc.funds_balance,
      },
      patrols: acc.scouts!.patrols,
    }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Finances</h1>
        <p className="mt-1 text-stone-600">
          Financial overview for {membership.units?.name || 'your unit'}
        </p>
      </div>

      <FinanceSubnav />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Total Owed
            </CardDescription>
            <CardTitle className="text-2xl text-error">
              {formatCurrency(totalOwed)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              From {scoutsOwing.length} scout{scoutsOwing.length !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Overdue (31+ days)
            </CardDescription>
            <CardTitle className={`text-2xl ${overdueAmount > 0 ? 'text-warning' : 'text-stone-400'}`}>
              {overdueAmount > 0 ? formatCurrency(overdueAmount) : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {overdueAccountCount > 0
                ? `${overdueAccountCount} scout${overdueAccountCount !== 1 ? 's' : ''} need follow-up`
                : 'All current'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <PiggyBank className="h-4 w-4" />
              Scout Funds Held
            </CardDescription>
            <CardTitle className="text-2xl text-stone-700">
              {formatCurrency(totalFunds)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Fundraising & credits
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Collected This Month
            </CardDescription>
            <CardTitle className={`text-2xl ${collectedThisMonth > 0 ? 'text-success' : 'text-stone-400'}`}>
              {collectedThisMonth > 0 ? formatCurrency(collectedThisMonth) : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions (for admin/treasurer only) */}
      {canTakeActions && (
        <QuickActionsCard
          unitId={membership.unit_id}
          unitName={membership.units?.name || 'your unit'}
          scouts={scoutsForActions}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Who Owes Money */}
        <Card>
          <CardHeader>
            <CardTitle>Who Owes Money</CardTitle>
            <CardDescription>
              {scoutsOwing.length} scout{scoutsOwing.length !== 1 ? 's' : ''} with outstanding balance
            </CardDescription>
          </CardHeader>
          <CardContent>
            {scoutsOwing.length > 0 ? (
              <div className="space-y-3">
                {scoutsOwing.slice(0, 10).map((account) => (
                  <div key={account.id} className="flex items-center justify-between">
                    <div>
                      <Link
                        href={`/finances/accounts/${account.id}`}
                        className="font-medium text-forest-600 hover:text-forest-800 hover:underline"
                      >
                        {account.scouts?.first_name} {account.scouts?.last_name}
                      </Link>
                      <p className="text-xs text-stone-500">
                        {account.scouts?.patrols?.name || 'No patrol'}
                      </p>
                    </div>
                    <span className="font-medium text-error">
                      {formatCurrency(Math.abs(account.billing_balance || 0))}
                    </span>
                  </div>
                ))}
                {scoutsOwing.length > 10 && (
                  <Link
                    href="/finances/accounts"
                    className="block text-center text-sm text-forest-600 hover:text-forest-800"
                  >
                    View all {scoutsOwing.length} scouts →
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-success">No scouts currently owe money!</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest payments and billing</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length > 0 ? (
              <div className="space-y-3">
                {recentActivity.map((activity) => (
                  <div key={`${activity.type}-${activity.id}`} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`rounded-full p-1.5 ${
                        activity.type === 'payment'
                          ? 'bg-success/10 text-success'
                          : 'bg-stone-100 text-stone-600'
                      }`}>
                        {activity.type === 'payment' ? (
                          <CreditCard className="h-4 w-4" />
                        ) : (
                          <Receipt className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {activity.type === 'payment' ? (
                            activity.scoutAccountId ? (
                              <Link
                                href={`/finances/accounts/${activity.scoutAccountId}`}
                                className="text-forest-600 hover:text-forest-800 hover:underline"
                              >
                                {activity.scoutName}
                              </Link>
                            ) : (
                              activity.scoutName
                            )
                          ) : (
                            activity.description
                          )}
                        </p>
                        <p className="text-xs text-stone-500">
                          {new Date(activity.date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span className={`font-medium ${
                      activity.type === 'payment' ? 'text-success' : 'text-stone-700'
                    }`}>
                      {activity.type === 'payment' ? '+' : ''}{formatCurrency(activity.amount)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-stone-500">No recent activity</p>
            )}
          </CardContent>
        </Card>

        {/* Bank Account Widget (admin/treasurer only, when enabled) */}
        {canTakeActions && isFeatureEnabled(FeatureFlag.BANK_INTEGRATION) && <BankWidget />}
      </div>
    </div>
  )
}
