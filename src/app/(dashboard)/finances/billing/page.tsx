import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canAccessPage, isFinancialRole } from '@/lib/roles'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { BillingManagementView, type BillingRecordEntry } from '@/components/billing/billing-management-view'

interface BillingPageProps {
  searchParams: Promise<{ status?: string }>
}

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const params = await searchParams
  const initialStatus = ['all', 'unpaid', 'paid', 'voided'].includes(params.status || '')
    ? (params.status as 'all' | 'unpaid' | 'paid' | 'voided')
    : undefined
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }

  const { data: membershipData } = await supabase
    .from('unit_memberships')
    .select('unit_id, role, units:units!unit_memberships_unit_id_fkey(name)')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  const membership = membershipData as {
    unit_id: string
    role: string
    units: { name: string } | null
  } | null

  if (!membership) {
    redirect('/login')
  }

  if (!canAccessPage(membership.role, 'finances')) {
    redirect('/roster')
  }

  // Check if unit has an active payment processor connection
  const { data: squareCredentials } = await supabase
    .from('unit_square_credentials')
    .select('id')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .single()

  const hasPaymentProcessor = !!squareCredentials
  const canTakeActions = isFinancialRole(membership.role)

  // Fetch ALL billing records with charges and scout details
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
        is_void,
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
    .order('created_at', { ascending: false })

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
      is_void: boolean | null
      scout_account_id: string
      scout_accounts: {
        scouts: {
          first_name: string
          last_name: string
        }
      } | null
    }>
  }

  const rawRecords = (billingRecordsData as unknown as BillingRecordWithCharges[]) || []

  // Group records by batch (same as finances overview)
  const groupedMap = new Map<string, BillingRecordEntry>()

  for (const record of rawRecords) {
    const groupKey = record.billing_import_batch_id
      ? `batch:${record.billing_import_batch_id}`
      : `record:${record.id}`

    const charges = (record.billing_charges || []).map((charge) => ({
      id: charge.id,
      amount: charge.amount,
      is_paid: charge.is_paid,
      is_void: charge.is_void,
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
        batch_id: record.billing_import_batch_id,
        charges,
      })
    }
  }

  const records = Array.from(groupedMap.values())

  // Fetch scouts for billing form and payment form
  const { data: scoutsData } = await supabase
    .from('scouts')
    .select(`
      id,
      first_name,
      last_name,
      is_active,
      scout_accounts (
        id,
        billing_balance,
        funds_balance
      ),
      patrols (name)
    `)
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .order('last_name')
    .order('first_name')

  type Scout = {
    id: string
    first_name: string
    last_name: string
    is_active: boolean | null
    scout_accounts: { id: string; billing_balance: number | null; funds_balance: number | null } | null
    patrols: { name: string } | null
  }

  const scouts = (scoutsData as unknown as Scout[]) || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Finances</h1>
        <p className="mt-1 text-stone-600">
          Financial overview for {membership.units?.name || 'your unit'}
        </p>
      </div>

      <FinanceSubnav showPaymentsTab={hasPaymentProcessor} />

      {canTakeActions ? (
        <BillingManagementView
          records={records}
          scouts={scouts}
          unitId={membership.unit_id}
          initialStatus={initialStatus}
        />
      ) : (
        <div className="text-center py-12 text-stone-500">
          Only administrators and treasurers can manage billing.
        </div>
      )}
    </div>
  )
}
