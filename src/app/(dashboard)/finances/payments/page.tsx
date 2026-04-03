import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canAccessPage } from '@/lib/roles'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { UnifiedPaymentsList } from '@/components/payments/unified-payments-list'

export default async function PaymentsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!profile) redirect('/login')

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

  if (!membership) redirect('/login')
  if (!canAccessPage(membership.role, 'payments')) redirect('/roster')

  // Fetch payments with related data
  const { data: payments } = await supabase
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
      square_receipt_url,
      journal_entry_id,
      scout_account_id,
      voided_at,
      voided_by,
      void_reason,
      recorded_by,
      reconciliation_status,
      scout_account:scout_accounts(
        id,
        scout:scouts(id, first_name, last_name)
      )
    `)
    .eq('unit_id', membership.unit_id)
    .order('created_at', { ascending: false })

  // Fetch recorded_by profile names separately
  const recordedByIds = [
    ...new Set(
      (payments || [])
        .map((p) => p.recorded_by)
        .filter((id): id is string => id !== null)
    ),
  ]

  let recordedByMap: Record<string, string> = {}
  if (recordedByIds.length > 0) {
    const { data: recordedByProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', recordedByIds)
    if (recordedByProfiles) {
      recordedByMap = Object.fromEntries(
        recordedByProfiles.map((p) => [p.id, p.full_name || 'Unknown'])
      )
    }
  }

  // Fetch voided_by profile names separately
  const voidedByIds = [
    ...new Set(
      (payments || [])
        .map((p) => p.voided_by)
        .filter((id): id is string => id !== null)
    ),
  ]

  let voidedByMap: Record<string, string> = {}
  if (voidedByIds.length > 0) {
    const { data: voidedByProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', voidedByIds)
    if (voidedByProfiles) {
      voidedByMap = Object.fromEntries(
        voidedByProfiles.map((p) => [p.id, p.full_name || 'Unknown'])
      )
    }
  }

  // Fetch unreconciled Square transactions
  const { data: unreconciledSquare } = await supabase
    .from('square_transactions')
    .select('*')
    .eq('unit_id', membership.unit_id)
    .is('payment_id', null)
    .order('square_created_at', { ascending: false })

  // Check Square connection status
  const { data: squareCredentials } = await supabase
    .from('unit_square_credentials')
    .select('id')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .maybeSingle()

  // Fetch scouts for dialogs (Record Payment, Reconcile)
  const { data: scouts } = await supabase
    .from('scouts')
    .select(`
      id,
      first_name,
      last_name,
      scout_accounts(id, billing_balance, funds_balance)
    `)
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .order('last_name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Finances</h1>
        <p className="mt-1 text-stone-600">
          Financial overview for {membership.units?.name || 'your unit'}
        </p>
      </div>

      <FinanceSubnav />

      <UnifiedPaymentsList
        payments={payments || []}
        recordedByMap={recordedByMap}
        voidedByMap={voidedByMap}
        unreconciledSquareTransactions={unreconciledSquare || []}
        hasSquareConnection={!!squareCredentials}
        scouts={scouts || []}
        unitId={membership.unit_id}
        userRole={membership.role}
      />
    </div>
  )
}
