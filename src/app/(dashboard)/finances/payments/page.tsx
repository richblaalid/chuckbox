import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import { AccessDenied } from '@/components/ui/access-denied'
import { formatCurrency } from '@/lib/utils'
import { canAccessPage, canPerformAction, isAdmin } from '@/lib/roles'
import { QuickPaymentForm } from '@/components/payments/quick-payment-form'
import { AddFundsForm } from '@/components/payments/add-funds-form'
import { PaymentsList } from '@/components/payments/payments-list'
import { PaymentsTabs } from '@/components/payments/payments-tabs'
import { SquareHistoryTab } from '@/components/payments/square-history-tab'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { getDefaultLocationId } from '@/lib/square/client'
import Link from 'next/link'

interface Payment {
  id: string
  amount: number
  fee_amount: number | null
  net_amount: number
  payment_method: string | null
  status: string | null
  created_at: string | null
  notes: string | null
  square_payment_id: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  scout_account_id: string
  scout_accounts: {
    scouts: {
      first_name: string
      last_name: string
    } | null
  } | null
}

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance: number | null
    funds_balance?: number
  } | null
}

interface FundraiserType {
  id: string
  name: string
  description: string | null
}

export default async function PaymentsPage() {
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

  // Check role-based access
  if (!canAccessPage(membership.role, 'payments')) {
    return <AccessDenied message="You don't have permission to view payments." />
  }

  const canRecordPayment = canPerformAction(membership.role, 'record_payments')

  // Get scouts with balances, Square credentials, and fundraiser types in parallel
  interface SquareCredentialsData {
    merchant_id: string
    location_id: string | null
    environment: 'sandbox' | 'production'
  }

  // Run scouts, credentials, and fundraiser types queries in parallel
  const [scoutsResult, credentialsResult, fundraiserTypesResult] = await Promise.all([
    supabase
      .from('scouts')
      .select(`
        id,
        first_name,
        last_name,
        scout_accounts (
          id,
          billing_balance,
          funds_balance
        )
      `)
      .eq('unit_id', membership.unit_id)
      .eq('is_active', true)
      .order('last_name'),
    supabase
      .from('unit_square_credentials')
      .select('merchant_id, location_id, environment')
      .eq('unit_id', membership.unit_id)
      .eq('is_active', true)
      .single(),
    supabase
      .from('fundraiser_types')
      .select('id, name, description')
      .eq('unit_id', membership.unit_id)
      .eq('is_active', true)
      .order('name'),
  ])

  const scouts = (scoutsResult.data as Scout[]) || []
  const fundraiserTypes = (fundraiserTypesResult.data as FundraiserType[]) || []
  let squareCredentials: SquareCredentialsData | null = null

  if (credentialsResult.data) {
    squareCredentials = credentialsResult.data as SquareCredentialsData

    // Get location ID if not cached
    if (!squareCredentials.location_id) {
      const locationId = await getDefaultLocationId(membership.unit_id)
      if (locationId) {
        squareCredentials = { ...squareCredentials, location_id: locationId }
      }
    }
  }

  const squareApplicationId = process.env.SQUARE_APPLICATION_ID || ''
  const squareEnvironment = (process.env.SQUARE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production'
  const isSquareConnected = !!squareCredentials && !!squareCredentials.location_id

  const canVoidPayments = isAdmin(membership.role)

  // Get recent payments
  const { data: paymentsData } = await supabase
    .from('payments')
    .select(`
      id,
      amount,
      fee_amount,
      net_amount,
      payment_method,
      status,
      created_at,
      notes,
      square_payment_id,
      voided_at,
      voided_by,
      void_reason,
      scout_account_id,
      scout_accounts (
        scouts (
          first_name,
          last_name
        )
      )
    `)
    .eq('unit_id', membership.unit_id)
    .order('created_at', { ascending: false })
    .limit(20)

  const payments = (paymentsData as Payment[]) || []

  // Calculate totals
  const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0)
  const totalFees = payments.reduce((sum, p) => sum + (p.fee_amount || 0), 0)
  const netCollected = payments.reduce((sum, p) => sum + p.net_amount, 0)

  // Content for Record Payments tab
  const recordPaymentsContent = (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Collected</CardDescription>
            <CardTitle className="text-2xl text-success">
              {formatCurrency(totalCollected)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-stone-500">
              From {payments.length} payment{payments.length !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Processing Fees</CardDescription>
            <CardTitle className="text-2xl text-error">
              {formatCurrency(totalFees)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-stone-500">
              Card payment fees
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Net Received</CardDescription>
            <CardTitle className="text-2xl text-info">
              {formatCurrency(netCollected)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-stone-500">
              After fees
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Record Payment */}
      {canRecordPayment && (
        <CollapsibleCard
          title="Record Payment"
          description={isSquareConnected
            ? 'Accept card payments or record cash/check payments'
            : 'Record cash, check, or other payments'}
        >
          <QuickPaymentForm
            unitId={membership.unit_id}
            scouts={scouts}
            squareConfig={isSquareConnected ? {
              applicationId: squareApplicationId,
              locationId: squareCredentials!.location_id!,
              environment: squareEnvironment,
            } : undefined}
          />
        </CollapsibleCard>
      )}

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Payments</CardTitle>
          <CardDescription>
            {payments.length} payment{payments.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentsList payments={payments} canVoid={canVoidPayments} />
        </CardContent>
      </Card>

      {/* Square Connection Prompt (only show if not connected) */}
      {!isSquareConnected && (
        <Card className="border-dashed border-stone-300">
          <CardHeader>
            <CardTitle className="text-stone-500">Online Payments</CardTitle>
          </CardHeader>
          <CardContent className="text-stone-500">
            <p>
              Connect your Square account to accept online card payments from scouts and parents.
            </p>
            <Link
              href="/settings"
              className="mt-3 inline-flex items-center text-sm font-medium text-forest-600 hover:text-forest-700"
            >
              Connect Square &rarr;
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )

  // Content for Add Funds tab
  const addFundsContent = (
    <div className="space-y-6">
      {canRecordPayment ? (
        <CollapsibleCard
          title="Add Scout Funds"
          description="Credit fundraising earnings to scout accounts (e.g., wreath sales, popcorn sales)"
          defaultOpen
        >
          <AddFundsForm
            unitId={membership.unit_id}
            scouts={scouts}
            fundraiserTypes={fundraiserTypes}
          />
        </CollapsibleCard>
      ) : (
        <Card>
          <CardContent className="py-6">
            <p className="text-stone-500">
              You don&apos;t have permission to add funds to scout accounts.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )

  // Content for Square History tab
  const squareHistoryContent = (
    <SquareHistoryTab unitId={membership.unit_id} />
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Payments</h1>
        <p className="mt-1 text-stone-600">
          Record and track payments from scouts
        </p>
      </div>

      <FinanceSubnav showFinancialTabs={true} />

      <PaymentsTabs
        recordPaymentsContent={recordPaymentsContent}
        addFundsContent={addFundsContent}
        squareHistoryContent={squareHistoryContent}
        showSquareTab={isSquareConnected}
      />
    </div>
  )
}
