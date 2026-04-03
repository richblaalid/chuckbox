import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { canAccessPage, isFinancialRole } from '@/lib/roles'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { OverviewActions } from '@/components/finances/overview-actions'
import type { ScoutOwing } from '@/components/finances/scouts-owing-table'
import { Receipt, CreditCard, TrendingDown, PiggyBank, AlertTriangle } from 'lucide-react'
import { BankBalanceCard } from '@/components/plaid/bank-balance-card'

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

  // Check if unit has an active payment processor connection
  const { data: squareCredentials } = await supabase
    .from('unit_square_credentials')
    .select('id')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .single()

  const hasPaymentProcessor = !!squareCredentials

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

  // Build a map of last payment date per scout_account_id from recent payments
  // We query more payments to cover all accounts that owe money
  const { data: allPaymentsData } = await supabase
    .from('payments')
    .select('scout_account_id, created_at')
    .eq('unit_id', membership.unit_id)
    .eq('status', 'completed')
    .is('voided_at', null)
    .order('created_at', { ascending: false })

  const lastPaymentByAccount = new Map<string, string>()
  for (const payment of (allPaymentsData as Array<{ scout_account_id: string; created_at: string }>) || []) {
    if (!lastPaymentByAccount.has(payment.scout_account_id)) {
      lastPaymentByAccount.set(payment.scout_account_id, payment.created_at)
    }
  }

  // Get recent billing records with per-scout charge details (used by both Outstanding Bills and Recent Activity)
  const { data: billingRecordsData } = await supabase
    .from('billing_records')
    .select(`
      id,
      description,
      billing_date,
      created_at,
      total_amount,
      is_void,
      billing_import_batch_id,
      billing_charges (
        id,
        amount,
        is_paid,
        scout_account_id,
        scout_accounts (
          scouts (
            first_name,
            last_name
          )
        )
      )
    `)
    .eq('unit_id', membership.unit_id)
    .or('is_void.is.null,is_void.eq.false')
    .order('created_at', { ascending: false })
    .limit(50)

  type BillingRecordWithCharges = {
    id: string
    description: string
    billing_date: string
    created_at: string | null
    total_amount: number
    is_void: boolean | null
    billing_import_batch_id: string | null
    billing_charges: Array<{
      id: string
      amount: number
      is_paid: boolean | null
      scout_account_id: string
      scout_accounts: {
        scouts: {
          first_name: string
          last_name: string
        }
      } | null
    }>
  }

  const rawBillingRecords = (billingRecordsData as unknown as BillingRecordWithCharges[]) || []

  // Group billing records that share the same batch OR same description+date into single entries
  // This collapses 20 individual "Summer Camp" charges into one grouped row
  interface BillingRecordSummary {
    id: string
    description: string
    billing_date: string
    created_at: string | null
    total_amount: number
    is_void: boolean | null
    charges: Array<{
      id: string
      amount: number
      is_paid: boolean | null
      scout_account_id: string
      scout_first_name: string
      scout_last_name: string
    }>
  }

  const groupedMap = new Map<string, BillingRecordSummary>()

  for (const record of rawBillingRecords) {
    // Group key: batch ID if from import, otherwise record ID (no grouping)
    const groupKey = record.billing_import_batch_id
      ? `batch:${record.billing_import_batch_id}`
      : `record:${record.id}`

    const charges = (record.billing_charges || []).map((charge) => ({
      id: charge.id,
      amount: charge.amount,
      is_paid: charge.is_paid,
      scout_account_id: charge.scout_account_id,
      scout_first_name: charge.scout_accounts?.scouts?.first_name || 'Unknown',
      scout_last_name: charge.scout_accounts?.scouts?.last_name || '',
    }))

    const existing = groupedMap.get(groupKey)
    if (existing) {
      existing.charges.push(...charges)
      existing.total_amount += record.total_amount
    } else {
      groupedMap.set(groupKey, {
        id: record.id,
        description: record.description,
        billing_date: record.billing_date,
        created_at: record.created_at,
        total_amount: record.total_amount,
        is_void: record.is_void,
        charges,
      })
    }
  }

  const billingRecordsSummary: BillingRecordSummary[] = Array.from(groupedMap.values())
    .sort((a, b) => {
      // Sort by created_at (full timestamp) for accurate time ordering
      const timeA = a.created_at || a.billing_date
      const timeB = b.created_at || b.billing_date
      return timeB.localeCompare(timeA)
    })
    .map((group) => ({
      ...group,
      charges: group.charges.sort((a, b) =>
        `${a.scout_last_name} ${a.scout_first_name}`.localeCompare(`${b.scout_last_name} ${b.scout_first_name}`)
      ),
    }))
    .slice(0, 10)

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
    ...billingRecordsSummary.map(b => {
      const chargeCount = b.charges.length
      let scoutName: string
      let scoutAccountId = ''
      if (chargeCount === 1) {
        scoutName = `${b.charges[0].scout_first_name} ${b.charges[0].scout_last_name}`.trim()
        scoutAccountId = b.charges[0].scout_account_id
      } else if (chargeCount > 1) {
        scoutName = `${chargeCount} scouts`
      } else {
        scoutName = 'Unknown'
      }
      return {
        id: b.id,
        type: 'billing' as const,
        description: b.description,
        amount: b.total_amount,
        date: b.created_at || b.billing_date,
        scoutName,
        scoutAccountId,
      }
    }),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5)

  // Transform accounts into scouts format for FinanceActionBar
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

  // Build ScoutOwing[] for the scouts-owing table
  // Group unpaid charges by scout_account_id to find the oldest charge date
  const oldestUnpaidByAccount = new Map<string, string>()
  for (const charge of unpaidCharges) {
    const existing = oldestUnpaidByAccount.get(charge.scout_account_id)
    if (!existing || charge.billing_records.billing_date < existing) {
      oldestUnpaidByAccount.set(charge.scout_account_id, charge.billing_records.billing_date)
    }
  }

  const scoutsOwingData: ScoutOwing[] = scoutsOwing
    .filter((acc) => acc.scouts)
    .map((acc) => {
      const oldestChargeDate = oldestUnpaidByAccount.get(acc.id)
      let daysOverdue = 0
      if (oldestChargeDate) {
        const chargeDate = new Date(oldestChargeDate)
        chargeDate.setHours(0, 0, 0, 0)
        daysOverdue = Math.max(0, Math.floor((today.getTime() - chargeDate.getTime()) / (1000 * 60 * 60 * 24)))
      }

      return {
        scoutId: acc.scouts!.id,
        scoutAccountId: acc.id,
        scoutName: `${acc.scouts!.first_name} ${acc.scouts!.last_name}`,
        amountOwed: Math.abs(acc.billing_balance || 0),
        lastPaymentDate: lastPaymentByAccount.get(acc.id) || null,
        daysOverdue,
      }
    })
    .sort((a, b) => b.amountOwed - a.amountOwed)

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

        <BankBalanceCard
          fallbackValue={totalOwed - totalFunds}
          fallbackLabel="Net to Collect"
          fallbackDescription="After applying scout credits"
        />
      </div>

      {/* Action Bar + Scouts Owing Table (for admin/treasurer only) */}
      {canTakeActions && (
        <OverviewActions
          unitId={membership.unit_id}
          unitName={membership.units?.name || 'your unit'}
          scouts={scoutsForActions}
          scoutsOwing={scoutsOwingData}
        />
      )}

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest payments and billing</CardDescription>
            </div>
            <Link
              href="/finances/accounts"
              className="text-sm text-forest-600 hover:text-forest-800 hover:underline"
            >
              View all
            </Link>
          </div>
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
                        {activity.scoutAccountId ? (
                          <Link
                            href={`/finances/accounts/${activity.scoutAccountId}`}
                            className="text-forest-600 hover:text-forest-800 hover:underline"
                          >
                            {activity.scoutName}
                          </Link>
                        ) : (
                          activity.scoutName
                        )}
                      </p>
                      <p className="text-xs text-stone-500">
                        {activity.type === 'billing' && (
                          <span>{activity.description} · </span>
                        )}
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
    </div>
  )
}
