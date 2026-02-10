import { createClient, createServiceClient } from '@/lib/supabase/server'
import { formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AccountActions } from '@/components/accounts/account-actions'
import { PaginatedTransactionHistory } from '@/components/finances/paginated-transaction-history'
import { isFinancialRole } from '@/lib/roles'
import { getDefaultLocationId } from '@/lib/square/client'
import { FinanceSubnav } from '@/components/finances/finance-subnav'

interface AccountPageProps {
  params: Promise<{ id: string }>
}

export default async function AccountDetailPage({ params }: AccountPageProps) {
  const { id } = await params
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

  // Get user's membership role and unit info
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role, unit_id')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  const userRole = membership?.role || 'parent'
  const unitId = membership?.unit_id
  const canRecordPayment = isFinancialRole(userRole)
  const canTakeActions = isFinancialRole(userRole)

  // Check if user is a parent (guardian of this scout)
  const { data: guardianCheck } = await supabase
    .from('scout_guardians')
    .select('id')
    .eq('profile_id', profile.id)
    .limit(1)

  const isParent = (guardianCheck?.length ?? 0) > 0 && !canRecordPayment

  // Get account with scout info - this RLS check verifies user can access this account
  const { data: accountData } = await supabase
    .from('scout_accounts')
    .select(`
      id,
      billing_balance,
      funds_balance,
      created_at,
      updated_at,
      scouts (
        id,
        first_name,
        last_name,
        rank,
        is_active,
        patrols (
          name
        )
      )
    `)
    .eq('id', id)
    .single()

  if (!accountData) {
    notFound()
  }

  interface ScoutAccount {
    id: string
    billing_balance: number | null
    funds_balance: number
    created_at: string | null
    updated_at: string | null
    scouts: {
      id: string
      first_name: string
      last_name: string
      rank: string | null
      is_active: boolean | null
      patrols: {
        name: string
      } | null
    } | null
  }

  const account = accountData as ScoutAccount
  const billingBalance = account.billing_balance || 0
  const fundsBalance = account.funds_balance || 0
  const scoutName = `${account.scouts?.first_name} ${account.scouts?.last_name}`

  // Get Square configuration for payments
  const serviceClient = await createServiceClient()
  const squareApplicationId = process.env.SQUARE_APPLICATION_ID || ''
  const squareEnvironment = (process.env.SQUARE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production'
  let squareLocationId: string | null = null

  if (unitId && (canRecordPayment || (isParent && billingBalance < 0))) {
    const { data: credentials } = await serviceClient
      .from('unit_square_credentials')
      .select('location_id')
      .eq('unit_id', unitId)
      .eq('is_active', true)
      .single()

    if (credentials) {
      squareLocationId = credentials.location_id
      if (!squareLocationId) {
        squareLocationId = await getDefaultLocationId(unitId)
      }
    }
  }

  // For AccountActions, only pass config if locationId is available (non-null)
  const squareConfigForActions = squareLocationId
    ? { applicationId: squareApplicationId, locationId: squareLocationId, environment: squareEnvironment }
    : null

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link href="/finances/accounts" className="text-sm text-stone-500 hover:text-stone-700">
          Accounts
        </Link>
        <span className="text-stone-400">/</span>
        <span className="text-sm text-stone-900">{scoutName}</span>
      </div>

      {/* Header with Balance and Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-stone-900">{scoutName}</h1>
          <p className="mt-1 text-stone-600">
            {account.scouts?.patrols?.name && `${account.scouts.patrols.name} Patrol`}
            {account.scouts?.patrols?.name && account.scouts?.rank && ' • '}
            {account.scouts?.rank}
          </p>
          {account.scouts && (
            <Link
              href={`/scouts/${account.scouts.id}`}
              className="mt-2 inline-block text-sm text-forest-600 hover:text-forest-800 hover:underline"
            >
              View Scout Profile →
            </Link>
          )}
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          {/* Billing Balance */}
          <div className="flex gap-6">
            <div className="text-right">
              <p className="text-sm text-stone-500">Amount Owed</p>
              <p
                className={`text-2xl font-bold ${
                  billingBalance < 0 ? 'text-error' : 'text-stone-900'
                }`}
              >
                {billingBalance < 0 ? formatCurrency(Math.abs(billingBalance)) : '$0.00'}
              </p>
            </div>
            {/* Scout Funds */}
            <div className="text-right">
              <p className="text-sm text-stone-500">Scout Funds</p>
              <p
                className={`text-2xl font-bold ${
                  fundsBalance > 0 ? 'text-success' : 'text-stone-900'
                }`}
              >
                {formatCurrency(fundsBalance)}
              </p>
            </div>
          </div>
          {account.scouts && (
            <AccountActions
              scoutId={account.scouts.id}
              scoutAccountId={account.id}
              scoutName={scoutName}
              billingBalance={billingBalance}
              fundsBalance={fundsBalance}
              userRole={userRole}
              isParent={isParent}
              squareConfig={squareConfigForActions}
              unitId={unitId}
            />
          )}
        </div>
      </div>

      <FinanceSubnav />

      {/* Transaction History with Pagination */}
      <PaginatedTransactionHistory
        scoutAccountId={account.id}
        title="Transaction History"
        description="All transactions on this account"
      />
    </div>
  )
}
