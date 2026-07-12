import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { unstable_noStore as noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/dashboard/sidebar'
import { MobileNav } from '@/components/dashboard/mobile-nav'
import { MainContent } from '@/components/dashboard/main-content'
import { PostHogIdentify } from '@/components/providers/posthog-identify'
import { SentryIdentify } from '@/components/providers/sentry-identify'
import { UnitProvider, UnitMembership, UnitGroup } from '@/components/providers/unit-context'
import { SidebarProvider } from '@/components/providers/sidebar-context'
import { ToastProvider } from '@/components/ui/toast'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Opt out of caching for auth checks - must be fresh for security
  noStore()

  const supabase = await createClient()

  // Use getUser() to validate the session with Supabase servers
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  // Get user's profile to check if active and get their name
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, full_name, is_active, email')
    .eq('user_id', user.id)
    .single()

  // Check if user is inactive (soft deleted)
  if (profile && profile.is_active === false) {
    // Sign out the user and redirect to login
    await supabase.auth.signOut()
    redirect('/login?error=account_deactivated')
  }

  // Sync auth email to profile if they differ (happens after email change)
  if (profile && user.email && profile.email !== user.email) {
    await supabase
      .from('profiles')
      .update({ email: user.email, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
  }

  // Get display name (prefer first + last, fall back to full_name)
  const userName = profile?.first_name && profile?.last_name
    ? `${profile.first_name} ${profile.last_name}`
    : profile?.full_name || null

  // Get all user's unit memberships (use profile.id, not user.id)
  const { data: membershipsData } = profile ? await supabase
    .from('unit_memberships')
    .select('role, unit_id, units:units!unit_memberships_unit_id_fkey(id, name, unit_number, unit_type, logo_url)')
    .eq('profile_id', profile.id)
    .eq('status', 'active') : { data: null }

  const memberships: UnitMembership[] = (membershipsData || []).map(m => ({
    role: m.role,
    unit_id: m.unit_id,
    units: m.units as UnitMembership['units']
  }))

  // Group memberships feature not yet implemented
  const groupMemberships: { role: string; unit_groups: UnitGroup | null }[] = []

  // Determine primary unit for PostHog
  const primaryMembership = memberships[0]
  const primaryUnit = primaryMembership?.units

  return (
    <div className="min-h-screen">
      <PostHogIdentify
        userId={user.id}
        email={user.email}
        role={primaryMembership?.role || groupMemberships[0]?.role}
        unitId={primaryUnit?.id}
        unitName={primaryUnit?.name}
      />
      <SentryIdentify
        userId={user.id}
        email={user.email}
        role={primaryMembership?.role || groupMemberships[0]?.role}
        unitId={primaryUnit?.id}
      />
      <Suspense fallback={null}>
        <ToastProvider>
          <SidebarProvider>
            <UnitProvider
              memberships={memberships}
              groupMemberships={groupMemberships}
              initialUnitId={primaryUnit?.id}
            >
              {/* Desktop Sidebar - hidden on mobile */}
              <Sidebar user={user} userName={userName} className="hidden md:flex" />

              {/* Mobile Header - hidden on desktop */}
              <MobileNav user={user} userName={userName} className="md:hidden" />

              {/* Main Content - offset on desktop for sidebar */}
              <MainContent>{children}</MainContent>
            </UnitProvider>
          </SidebarProvider>
        </ToastProvider>
      </Suspense>
    </div>
  )
}
