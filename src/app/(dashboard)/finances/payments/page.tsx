import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canAccessPage } from '@/lib/roles'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { SquareHistoryTab } from '@/components/payments/square-history-tab'

export default async function PaymentsPage() {
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

  // Verify unit has an active Square connection
  const { data: squareCredentials } = await supabase
    .from('unit_square_credentials')
    .select('id')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .single()

  if (!squareCredentials) {
    redirect('/finances')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Finances</h1>
        <p className="mt-1 text-stone-600">
          Financial overview for {membership.units?.name || 'your unit'}
        </p>
      </div>

      <FinanceSubnav />

      <SquareHistoryTab unitId={membership.unit_id} />
    </div>
  )
}
