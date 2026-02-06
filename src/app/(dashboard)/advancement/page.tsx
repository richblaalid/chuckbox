import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isFeatureEnabled, FeatureFlag } from '@/lib/feature-flags'
import { AdvancementContentLoader } from '@/components/advancement/advancement-content-loader'
import { AdvancementContentSkeleton } from '@/components/advancement/advancement-content-skeleton'

interface AdvancementPageProps {
  searchParams: Promise<{ tab?: string }>
}

/**
 * Advancement Page with Streaming
 *
 * Architecture:
 * 1. Header renders immediately (no data dependency)
 * 2. Content streams in via Suspense when data is ready
 *
 * This improves LCP by showing meaningful content (header) instantly
 * while data-dependent content loads in the background.
 */
export default async function AdvancementPage({ searchParams }: AdvancementPageProps) {
  const { tab } = await searchParams
  const initialTab = (tab === 'summary' || tab === 'badges' || tab === 'ranks') ? tab : 'ranks'

  // Check feature flag
  if (!isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)) {
    redirect('/dashboard')
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Get user's profile and membership
  // These queries are fast and needed for auth/routing decisions
  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .single()

  if (!profileData) redirect('/setup')

  const currentUserName = profileData.first_name && profileData.last_name
    ? `${profileData.first_name} ${profileData.last_name}`
    : 'Leader'

  const { data: membershipData } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profileData.id)
    .eq('status', 'active')
    .single()

  if (!membershipData) redirect('/setup')

  const membership = membershipData as { unit_id: string; role: string }
  const canEdit = ['admin', 'treasurer', 'leader'].includes(membership.role)

  // ==========================================
  // STREAMING RENDER
  // Header renders instantly, content streams via Suspense
  // ==========================================

  return (
    <div className="space-y-6">
      {/* Header - Renders immediately (no data dependency) */}
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Advancement</h1>
        <p className="text-stone-500">Track rank progress, merit badges, and activities across the unit</p>
      </div>

      {/* Main Content - Streams when data is ready */}
      <Suspense fallback={<AdvancementContentSkeleton />}>
        <AdvancementContentLoader
          unitId={membership.unit_id}
          canEdit={canEdit}
          currentUserName={currentUserName}
          initialTab={initialTab}
        />
      </Suspense>
    </div>
  )
}
