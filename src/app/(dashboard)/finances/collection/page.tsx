import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AccessDenied } from '@/components/ui/access-denied'
import { formatCurrency } from '@/lib/utils'
import { canAccessPage } from '@/lib/roles'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { OverdueTable } from '@/components/collection/overdue-table'
import { AlertTriangle, Clock, Users, DollarSign } from 'lucide-react'

interface OverdueAccount {
  id: string
  billing_balance: number
  scout_id: string
  scouts: {
    id: string
    first_name: string
    last_name: string
    is_active: boolean | null
    patrols: { name: string } | null
  } | null
  oldest_unpaid_date: string | null
  days_overdue: number
  // Guardian info for sending reminders
  guardians: {
    profile_id: string
    profiles: {
      id: string
      email: string | null
      first_name: string | null
      last_name: string | null
    } | null
  }[]
}

interface CollectionSettings {
  overdue_threshold_days: number
  overdue_threshold_amount_cents: number
  reminder_email_subject: string
  reminder_email_template: string
}

const DEFAULT_SETTINGS: CollectionSettings = {
  overdue_threshold_days: 30,
  overdue_threshold_amount_cents: 0,
  reminder_email_subject: 'Payment Reminder - {unit_name}',
  reminder_email_template: 'default',
}

export default async function CollectionPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) return null

  // Get user's unit membership
  const { data: membershipData } = await supabase
    .from('unit_memberships')
    .select('unit_id, role, units:units!unit_memberships_unit_id_fkey(name, collection_settings)')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  interface Membership {
    unit_id: string
    role: string
    units: { name: string; collection_settings: CollectionSettings | null } | null
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

  // Check role-based access - only admin/treasurer can access collection
  if (!canAccessPage(membership.role, 'billing')) {
    return <AccessDenied message="Only administrators and treasurers can access the collection center." />
  }

  const unitName = membership.units?.name || 'Your Unit'
  const settings: CollectionSettings = membership.units?.collection_settings || DEFAULT_SETTINGS

  // Get overdue accounts (billing_balance < 0)
  // Join with billing_charges to find oldest unpaid charge date
  const { data: overdueAccountsData } = await supabase
    .from('scout_accounts')
    .select(`
      id,
      billing_balance,
      scout_id,
      scouts (
        id,
        first_name,
        last_name,
        is_active,
        patrols (name)
      )
    `)
    .eq('unit_id', membership.unit_id)
    .lt('billing_balance', 0)
    .order('billing_balance', { ascending: true })

  // Get oldest unpaid billing date for each account
  const accountIds = (overdueAccountsData || []).map(a => a.id)

  let oldestChargesByAccount: Record<string, string> = {}

  if (accountIds.length > 0) {
    // Get oldest unpaid charge date per account
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

    // Group by account and take oldest date
    interface UnpaidCharge {
      scout_account_id: string
      billing_records: { billing_date: string }
    }

    for (const charge of (unpaidChargesData as UnpaidCharge[]) || []) {
      if (!oldestChargesByAccount[charge.scout_account_id]) {
        oldestChargesByAccount[charge.scout_account_id] = charge.billing_records.billing_date
      }
    }
  }

  // Get guardian info for each scout
  const scoutIds = (overdueAccountsData || []).map(a => a.scout_id)
  let guardiansByScout: Record<string, { profile_id: string; profiles: { id: string; email: string | null; first_name: string | null; last_name: string | null } | null }[]> = {}

  if (scoutIds.length > 0) {
    const { data: guardiansData } = await supabase
      .from('scout_guardians')
      .select(`
        scout_id,
        profile_id,
        profiles (
          id,
          email,
          first_name,
          last_name
        )
      `)
      .in('scout_id', scoutIds)

    interface GuardianRow {
      scout_id: string
      profile_id: string
      profiles: { id: string; email: string | null; first_name: string | null; last_name: string | null } | null
    }

    for (const g of (guardiansData as GuardianRow[]) || []) {
      if (!guardiansByScout[g.scout_id]) {
        guardiansByScout[g.scout_id] = []
      }
      guardiansByScout[g.scout_id].push({
        profile_id: g.profile_id,
        profiles: g.profiles,
      })
    }
  }

  // Calculate days overdue for each account
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  interface ScoutAccountRow {
    id: string
    billing_balance: number
    scout_id: string
    scouts: {
      id: string
      first_name: string
      last_name: string
      is_active: boolean | null
      patrols: { name: string } | null
    } | null
  }

  const overdueAccounts: OverdueAccount[] = ((overdueAccountsData as ScoutAccountRow[]) || []).map(account => {
    const oldestDate = oldestChargesByAccount[account.id] || null
    let daysOverdue = 0

    if (oldestDate) {
      const chargeDate = new Date(oldestDate)
      chargeDate.setHours(0, 0, 0, 0)
      daysOverdue = Math.floor((today.getTime() - chargeDate.getTime()) / (1000 * 60 * 60 * 24))
    }

    return {
      ...account,
      oldest_unpaid_date: oldestDate,
      days_overdue: daysOverdue,
      guardians: guardiansByScout[account.scout_id] || [],
    }
  })

  // Calculate summary stats
  const totalOverdue = overdueAccounts.reduce((sum, a) => sum + Math.abs(a.billing_balance), 0)
  const accountsOver30Days = overdueAccounts.filter(a => a.days_overdue >= 30).length
  const accountsOver60Days = overdueAccounts.filter(a => a.days_overdue >= 60).length
  const accountsWithGuardians = overdueAccounts.filter(a => a.guardians.some(g => g.profiles?.email)).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Collection Center</h1>
        <p className="mt-1 text-stone-600">
          Manage overdue accounts and send payment reminders for {unitName}
        </p>
      </div>

      <FinanceSubnav showFinancialTabs={true} />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Total Overdue
            </CardDescription>
            <CardTitle className="text-2xl text-error">
              {formatCurrency(totalOverdue)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              From {overdueAccounts.length} account{overdueAccounts.length !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              30+ Days Overdue
            </CardDescription>
            <CardTitle className={`text-2xl ${accountsOver30Days > 0 ? 'text-warning' : 'text-stone-400'}`}>
              {accountsOver30Days}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {accountsOver30Days > 0 ? 'Needs attention' : 'All current'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              60+ Days Overdue
            </CardDescription>
            <CardTitle className={`text-2xl ${accountsOver60Days > 0 ? 'text-error' : 'text-stone-400'}`}>
              {accountsOver60Days}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {accountsOver60Days > 0 ? 'Critical follow-up' : 'None'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Can Contact
            </CardDescription>
            <CardTitle className="text-2xl text-stone-700">
              {accountsWithGuardians}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Have guardian email on file
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Overdue Accounts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Overdue Accounts</CardTitle>
          <CardDescription>
            {overdueAccounts.length} account{overdueAccounts.length !== 1 ? 's' : ''} with outstanding balance
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overdueAccounts.length > 0 ? (
            <OverdueTable
              accounts={overdueAccounts}
              unitId={membership.unit_id}
              unitName={unitName}
              defaultThresholdDays={settings.overdue_threshold_days}
            />
          ) : (
            <div className="py-12 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mb-4">
                <DollarSign className="h-6 w-6 text-success" />
              </div>
              <p className="text-lg font-medium text-stone-900">All accounts current!</p>
              <p className="text-stone-500 mt-1">No overdue balances to collect.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
