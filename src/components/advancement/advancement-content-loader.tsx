import { createClient } from '@/lib/supabase/server'
import { UnitAdvancementContent } from './unit-advancement-content'
import { getUnitAdvancementSummary } from '@/app/actions/advancement'

/**
 * PERFORMANCE OPTIMIZATION:
 * getRankRequirementsForUnit and getRankBrowserData are NOT fetched here.
 * These queries take 7-9 seconds and were blocking the entire page load.
 *
 * Instead, they are lazy-loaded by LazyRankBrowser when the user views
 * the Ranks tab. This makes initial page load fast (~1-2s) at the cost
 * of showing a skeleton in the Ranks tab until its data loads.
 */

interface AdvancementContentLoaderProps {
  unitId: string
  canEdit: boolean
  currentUserName: string
  initialTab: 'ranks' | 'badges' | 'summary'
}

/**
 * Async server component that fetches essential advancement data.
 * Designed to be wrapped in a Suspense boundary for streaming.
 *
 * PERFORMANCE OPTIMIZATION:
 * - Only fetches data needed for the initial tab
 * - Heavy rankProgress query is SKIPPED when starting on 'ranks' tab (default)
 * - Summary tab data (rankProgress) loads client-side when that tab is visited
 *
 * Rank browser data is lazy-loaded client-side by LazyRankBrowser.
 */
export async function AdvancementContentLoader({
  unitId,
  canEdit,
  currentUserName,
  initialTab,
}: AdvancementContentLoaderProps) {
  const supabase = await createClient()

  // Determine what data we need based on initial tab
  // The heavy rankProgress query is ONLY needed for 'summary' tab
  const needsRankProgress = initialTab === 'summary'

  // Fast queries that always run
  const summaryPromise = getUnitAdvancementSummary(unitId)

  const pendingApprovalsPromise = supabase
    .from('scout_rank_requirement_progress')
    .select(`
      id,
      status,
      approval_status,
      submission_notes,
      submitted_at,
      scout_rank_progress (
        id,
        scout_id,
        scouts (
          id,
          first_name,
          last_name
        ),
        bsa_ranks (
          name
        )
      ),
      bsa_rank_requirements (
        requirement_number,
        description
      )
    `)
    .eq('approval_status', 'pending_approval')
    .order('submitted_at', { ascending: false })

  const pendingBadgeApprovalsPromise = (async () => {
    const { data: scouts } = await supabase
      .from('scouts')
      .select('id')
      .eq('unit_id', unitId)
      .eq('is_active', true)
    const scoutIds = scouts?.map(s => s.id) || []
    if (scoutIds.length === 0) return { data: [] as unknown[] }
    return supabase
      .from('scout_merit_badge_progress')
      .select(`
        id,
        status,
        completed_at,
        scout_id,
        scouts (
          id,
          first_name,
          last_name
        ),
        bsa_merit_badges (
          id,
          name,
          is_eagle_required
        )
      `)
      .eq('status', 'completed')
      .in('scout_id', scoutIds)
      .order('completed_at', { ascending: false })
  })()

  // SLOW query - ONLY load if summary tab is initial
  // This is the query that was causing 7+ second loads
  const rankProgressPromise = needsRankProgress ? (async () => {
    const { data: unitScouts } = await supabase
      .from('scouts')
      .select('id')
      .eq('unit_id', unitId)
      .eq('is_active', true)
    const scoutIds = unitScouts?.map(s => s.id) || []
    if (scoutIds.length === 0) return { data: [] as unknown[] }
    return supabase
      .from('scout_rank_progress')
      .select(`
        id,
        scout_id,
        status,
        awarded_at,
        bsa_ranks (
          id,
          code,
          name,
          display_order
        ),
        scout_rank_requirement_progress (
          id,
          status,
          completed_at
        )
      `)
      .in('scout_id', scoutIds)
  })() : Promise.resolve({ data: [] as unknown[] })

  // Fetch in parallel
  const [
    summaryResult,
    pendingApprovalsResult,
    pendingBadgeApprovalsResult,
    rankProgressResult,
  ] = await Promise.all([
    summaryPromise,
    pendingApprovalsPromise,
    pendingBadgeApprovalsPromise,
    rankProgressPromise,
  ])

  // Extract data from results
  const summary = summaryResult.success ? summaryResult.data : null
  const rankProgressData = rankProgressResult.data

  interface RankProgress {
    id: string
    scout_id: string
    status: string
    awarded_at: string | null
    bsa_ranks: { id: string; code: string; name: string; display_order: number } | null
    scout_rank_requirement_progress: Array<{ id: string; status: string; completed_at: string | null }>
  }

  const rankProgress = (rankProgressData || []) as RankProgress[]

  // Format scouts for component
  const scouts = (summary?.scouts || []).map(s => ({
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    rank: s.rank,
    is_active: true as const,
    patrols: s.patrol_name ? { name: s.patrol_name } : null,
  }))

  // Type definitions for pending approvals
  interface PendingApproval {
    id: string
    status: string
    approval_status: string | null
    submission_notes: string | null
    submitted_at: string | null
    scout_rank_progress: {
      id: string
      scout_id: string
      scouts: { id: string; first_name: string; last_name: string } | null
      bsa_ranks: { name: string } | null
    } | null
    bsa_rank_requirements: { requirement_number: string; description: string } | null
  }

  interface PendingBadgeApproval {
    id: string
    status: string
    completed_at: string | null
    scout_id: string
    scouts: { id: string; first_name: string; last_name: string } | null
    bsa_merit_badges: { id: string; name: string; is_eagle_required: boolean | null } | null
  }

  const pendingApprovals = (pendingApprovalsResult.data || []) as PendingApproval[]
  const pendingBadgeApprovals = (pendingBadgeApprovalsResult.data || []) as PendingBadgeApproval[]

  // NOTE: prefetchedRankData is undefined - LazyRankBrowser will fetch on demand
  // This is the key optimization that makes initial page load fast

  return (
    <UnitAdvancementContent
      scouts={scouts}
      rankProgress={rankProgress}
      pendingApprovals={pendingApprovals}
      pendingBadgeApprovals={pendingBadgeApprovals}
      stats={{
        rankProgressPercent: summary?.rankStats.avgProgressPercent || 0,
        scoutsWorkingOnRanks: summary?.rankStats.scoutsWorkingOnRanks || 0,
        meritBadgesInProgress: summary?.badgeStats.inProgress || 0,
        meritBadgesEarned: summary?.badgeStats.earned || 0,
      }}
      prefetchedRankData={undefined}
      unitId={unitId}
      canEdit={canEdit}
      currentUserName={currentUserName}
      initialTab={initialTab}
    />
  )
}
