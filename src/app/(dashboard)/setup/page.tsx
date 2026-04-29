import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/data/cached-queries'
import { SetupWizard } from '@/components/onboarding/setup-wizard'

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>
}) {
  const { unit: requestedUnitId } = await searchParams
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Setup requires admin role on the selected unit
  const membership = await getCurrentMembership(requestedUnitId)
  if (!membership || membership.role !== 'admin') {
    redirect('/dashboard')
  }

  // Fetch unit info + needs_setup flag in one query
  const { data: unitRow } = await supabase
    .from('units')
    .select('id, name, unit_number, unit_type, council, needs_setup')
    .eq('id', membership.unit_id)
    .single<{
      id: string
      name: string
      unit_number: string
      unit_type: string
      council: string | null
      needs_setup?: boolean | null
    }>()

  if (!unitRow) {
    redirect('/dashboard')
  }

  const unit = unitRow
  const needsSetup = unitRow.needs_setup ?? false

  // Check if setup is already complete by querying with service role
  // Note: setup_completed_at column will be added by migration 20260118000000_unit_provisioning.sql
  // For now, we'll allow access to the setup page if the user is an admin

  // Get roster summary
  const [{ count: adultCount }, { count: scoutCount }, { data: patrols }] = await Promise.all([
    supabase
      .from('unit_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('unit_id', unit.id),
    supabase
      .from('scouts')
      .select('*', { count: 'exact', head: true })
      .eq('unit_id', unit.id),
    supabase
      .from('patrols')
      .select('id, name')
      .eq('unit_id', unit.id)
      .eq('is_active', true),
  ])

  return (
    <SetupWizard
      unitId={unit.id}
      unitName={unit.name}
      unitType={unit.unit_type}
      council={unit.council}
      needsSetup={needsSetup}
      rosterSummary={{
        adultCount: adultCount || 0,
        scoutCount: scoutCount || 0,
        patrolCount: patrols?.length || 0,
        patrols: patrols?.map(p => p.name) || [],
      }}
    />
  )
}
