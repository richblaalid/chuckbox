import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SetupWizard } from '@/components/onboarding/setup-wizard'

export default async function SetupPage() {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
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
    redirect('/dashboard')
  }

  // Get user's admin membership and unit info
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select(`
      unit_id,
      role,
      units:units!unit_memberships_unit_id_fkey (
        id,
        name,
        unit_number,
        unit_type,
        council
      )
    `)
    .eq('profile_id', profile.id)
    .eq('role', 'admin')
    .eq('status', 'active')
    .maybeSingle()

  // If no admin membership, redirect to dashboard
  if (!membership) {
    redirect('/dashboard')
  }

  const unit = membership.units as {
    id: string
    name: string
    unit_number: string
    unit_type: string
    council: string | null
  }

  // Fetch needs_setup separately (column may not be in generated types yet)
  const { data: unitData } = await supabase
    .from('units')
    .select('needs_setup')
    .eq('id', unit.id)
    .single()

  const needsSetup = (unitData as { needs_setup?: boolean | null } | null)?.needs_setup ?? false

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
