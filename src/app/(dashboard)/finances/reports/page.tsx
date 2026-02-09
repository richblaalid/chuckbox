import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AccessDenied } from '@/components/ui/access-denied'
import { formatCurrency } from '@/lib/utils'
import { canAccessPage } from '@/lib/roles'
import { AgingReport } from '@/components/reports/aging-report'
import { CollectionSummary } from '@/components/reports/collection-summary'
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report'
import { IncomeExpenseReport } from '@/components/reports/income-expense-report'
import { DuesByPatrolReport } from '@/components/reports/dues-by-patrol-report'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import Link from 'next/link'

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

interface JournalEntry {
  id: string
  entry_date: string
  description: string
  entry_type: string | null
  is_posted: boolean | null
  is_void: boolean | null
  journal_lines: {
    debit: number | null
    credit: number | null
  }[]
}

export default async function ReportsPage() {
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
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h1 className="text-2xl font-bold text-stone-900">No Unit Access</h1>
        <p className="mt-2 text-stone-600">
          You are not currently a member of any unit.
        </p>
      </div>
    )
  }

  // Check role-based access
  if (!canAccessPage(membership.role, 'reports')) {
    return <AccessDenied message="Only administrators, treasurers, and leaders can access reports." />
  }

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

  // Get recent journal entries
  const { data: entriesData } = await supabase
    .from('journal_entries')
    .select(`
      id,
      entry_date,
      description,
      entry_type,
      is_posted,
      is_void,
      journal_lines (
        debit,
        credit
      )
    `)
    .eq('unit_id', membership.unit_id)
    .eq('is_posted', true)
    .order('entry_date', { ascending: false })
    .limit(50)

  const entries = (entriesData as JournalEntry[]) || []

  // Get unpaid billing charges for aging report
  const { data: unpaidChargesData } = await supabase
    .from('billing_charges')
    .select(`
      id,
      amount,
      billing_records!inner (
        billing_date,
        description,
        unit_id
      ),
      scout_accounts!inner (
        id,
        scouts!inner (
          first_name,
          last_name,
          patrols (name)
        )
      )
    `)
    .eq('billing_records.unit_id', membership.unit_id)
    .eq('is_paid', false)
    .or('is_void.is.null,is_void.eq.false')

  interface UnpaidChargeRow {
    id: string
    amount: number
    billing_records: {
      billing_date: string
      description: string
      unit_id: string
    }
    scout_accounts: {
      id: string
      scouts: {
        first_name: string
        last_name: string
        patrols: { name: string } | null
      }
    }
  }

  const agingCharges = ((unpaidChargesData as UnpaidChargeRow[]) || []).map(charge => ({
    id: charge.id,
    amount: charge.amount,
    billing_date: charge.billing_records.billing_date,
    description: charge.billing_records.description,
    scout_name: `${charge.scout_accounts.scouts.first_name} ${charge.scout_accounts.scouts.last_name}`,
    scout_account_id: charge.scout_accounts.id,
    patrol: charge.scout_accounts.scouts.patrols?.name || null,
  }))

  // Get payments for collection summary
  const { data: paymentsData } = await supabase
    .from('payments')
    .select('id, amount, net_amount, fee_amount, payment_method, created_at')
    .eq('unit_id', membership.unit_id)
    .eq('status', 'completed')
    .is('voided_at', null)

  interface PaymentRow {
    id: string
    amount: number
    net_amount: number
    fee_amount: number | null
    payment_method: string | null
    created_at: string
  }

  const paymentsForReport = (paymentsData as PaymentRow[]) || []

  // Get billing records for collection rate calculation
  const { data: allBillingData } = await supabase
    .from('billing_records')
    .select('id, total_amount, billing_date')
    .eq('unit_id', membership.unit_id)
    .or('is_void.is.null,is_void.eq.false')

  interface BillingRow {
    id: string
    total_amount: number
    billing_date: string
  }

  const billingForReport = (allBillingData as BillingRow[]) || []

  // Calculate totals
  const totalOwed = accounts
    .filter((a) => (a.billing_balance || 0) < 0)
    .reduce((sum, a) => sum + Math.abs(a.billing_balance || 0), 0)

  const totalFunds = accounts
    .reduce((sum, a) => sum + (a.funds_balance || 0), 0)

  // Calculate overdue amount (31+ days)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdueAmount = agingCharges
    .filter(charge => {
      const billingDate = new Date(charge.billing_date)
      billingDate.setHours(0, 0, 0, 0)
      const daysOld = Math.floor((today.getTime() - billingDate.getTime()) / (1000 * 60 * 60 * 24))
      return daysOld >= 31
    })
    .reduce((sum, charge) => sum + charge.amount, 0)

  // Calculate this month's collections
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const collectedThisMonth = paymentsForReport
    .filter(payment => new Date(payment.created_at) >= thisMonthStart)
    .reduce((sum, payment) => sum + payment.amount, 0)

  // Net billing for patrol table
  const netBilling = accounts.reduce((sum, a) => sum + (a.billing_balance || 0), 0)

  // Group by patrol
  const patrolBalances = accounts.reduce(
    (groups, account) => {
      const patrol = account.scouts?.patrols?.name || 'No Patrol'
      if (!groups[patrol]) {
        groups[patrol] = { billing: 0, funds: 0, count: 0, owing: 0 }
      }
      groups[patrol].billing += account.billing_balance || 0
      groups[patrol].funds += account.funds_balance || 0
      groups[patrol].count += 1
      if ((account.billing_balance || 0) < 0) {
        groups[patrol].owing += Math.abs(account.billing_balance || 0)
      }
      return groups
    },
    {} as Record<string, { billing: number; funds: number; count: number; owing: number }>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Reports</h1>
        <p className="mt-1 text-stone-600">
          Financial reports for {membership.units?.name || 'your unit'}
        </p>
      </div>

      <FinanceSubnav showFinancialTabs={true} />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Owed</CardDescription>
            <CardTitle className="text-2xl text-error">
              {formatCurrency(totalOwed)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Overdue (31+ days)</CardDescription>
            <CardTitle className={`text-2xl ${overdueAmount > 0 ? 'text-warning' : 'text-stone-400'}`}>
              {overdueAmount > 0 ? formatCurrency(overdueAmount) : '—'}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Scout Funds Held</CardDescription>
            <CardTitle className="text-2xl text-stone-700">
              {formatCurrency(totalFunds)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Collected This Month</CardDescription>
            <CardTitle className={`text-2xl ${collectedThisMonth > 0 ? 'text-success' : 'text-stone-400'}`}>
              {collectedThisMonth > 0 ? formatCurrency(collectedThisMonth) : '—'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Balance Sheet */}
      <BalanceSheetReport unitName={membership.units?.name || 'Your Unit'} />

      {/* Income & Expense Statement */}
      <IncomeExpenseReport unitName={membership.units?.name || 'Your Unit'} />

      {/* Aging Report */}
      <AgingReport charges={agingCharges} />

      {/* Dues by Patrol */}
      <DuesByPatrolReport unitName={membership.units?.name || 'Your Unit'} />

      {/* Collection & Cash Flow */}
      <CollectionSummary payments={paymentsForReport} billingRecords={billingForReport} />

      {/* Balance by Patrol */}
      <Card>
        <CardHeader>
          <CardTitle>Balance by Patrol</CardTitle>
          <CardDescription>Summary of balances grouped by patrol</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm font-medium text-stone-500">
                  <th className="pb-3 pr-4">Patrol</th>
                  <th className="pb-3 pr-4 text-center">Scouts</th>
                  <th className="pb-3 pr-4 text-right">Total Owed</th>
                  <th className="pb-3 text-right">Net Balance</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(patrolBalances)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([patrol, data]) => (
                    <tr key={patrol} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium text-stone-900">
                        {patrol}
                      </td>
                      <td className="py-3 pr-4 text-center text-stone-600">
                        {data.count}
                      </td>
                      <td className="py-3 pr-4 text-right text-error">
                        {data.owing > 0 ? formatCurrency(data.owing) : '—'}
                      </td>
                      <td
                        className={`py-3 text-right font-medium ${
                          data.billing < 0 ? 'text-error' : 'text-success'
                        }`}
                      >
                        {formatCurrency(data.billing)}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-medium">
                  <td className="py-3 pr-4">Total</td>
                  <td className="py-3 pr-4 text-center">{accounts.length}</td>
                  <td className="py-3 pr-4 text-right text-error">
                    {formatCurrency(totalOwed)}
                  </td>
                  <td
                    className={`py-3 text-right ${
                      netBilling < 0 ? 'text-error' : 'text-success'
                    }`}
                  >
                    {formatCurrency(netBilling)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Scouts Owing */}
      <Card>
        <CardHeader>
          <CardTitle>Scouts Owing</CardTitle>
          <CardDescription>
            {accounts.filter((a) => (a.billing_balance || 0) < 0).length} scouts with
            outstanding balance
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.filter((a) => (a.billing_balance || 0) < 0).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm font-medium text-stone-500">
                    <th className="pb-3 pr-4">Scout</th>
                    <th className="pb-3 pr-4">Patrol</th>
                    <th className="pb-3 text-right">Amount Owed</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts
                    .filter((a) => (a.billing_balance || 0) < 0)
                    .map((account) => (
                      <tr key={account.id} className="border-b last:border-0">
                        <td className="py-3 pr-4">
                          <Link
                            href={`/finances/accounts/${account.id}`}
                            className="font-medium text-forest-600 hover:text-forest-800"
                          >
                            {account.scouts?.first_name} {account.scouts?.last_name}
                          </Link>
                        </td>
                        <td className="py-3 pr-4 text-stone-600">
                          {account.scouts?.patrols?.name || '—'}
                        </td>
                        <td className="py-3 text-right font-medium text-error">
                          {formatCurrency(Math.abs(account.billing_balance || 0))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-success">No scouts currently owe money!</p>
          )}
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>Recent financial activity</CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm font-medium text-stone-500">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Description</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const totalAmount = entry.journal_lines.reduce(
                      (sum, line) => sum + (line.debit || 0),
                      0
                    )
                    return (
                      <tr
                        key={entry.id}
                        className={`border-b last:border-0 ${entry.is_void ? 'opacity-50' : ''}`}
                      >
                        <td className="py-3 pr-4 text-stone-600">
                          {entry.entry_date}
                        </td>
                        <td className="py-3 pr-4">
                          <p className="font-medium text-stone-900">
                            {entry.description}
                          </p>
                          {entry.is_void && (
                            <span className="text-xs text-error">(VOID)</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="rounded bg-stone-100 px-2 py-1 text-xs capitalize">
                            {entry.entry_type || 'entry'}
                          </span>
                        </td>
                        <td className="py-3 text-right font-medium">
                          {formatCurrency(totalAmount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-stone-500">No transactions yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
