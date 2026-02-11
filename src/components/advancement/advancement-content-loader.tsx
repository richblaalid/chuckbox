import { createClient } from '@/lib/supabase/server'
import { UnitAdvancementContent } from './unit-advancement-content'
import { getUnitAdvancementSummary, getPendingSignoffs } from '@/app/actions/advancement'

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

  // OPTIMIZATION: Fetch summary first to get scout IDs, then reuse them
  // This eliminates duplicate scout queries in badge/rank progress queries
  const summaryResult = await getUnitAdvancementSummary(unitId)
  const scoutIds = summaryResult.success
    ? summaryResult.data?.scouts.map(s => s.id) || []
    : []

  // Get pending signoffs using the unified function (reuses batched query logic)
  // Limit to 20 for the summary view
  const pendingSignoffsPromise = getPendingSignoffs(unitId, 20)

  // SLOW query - ONLY load if summary tab is initial
  // Uses scout IDs from summary (no extra query)
  const rankProgressPromise = needsRankProgress && scoutIds.length > 0
    ? supabase
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
    : Promise.resolve({ data: [] as unknown[] })

  // Fetch remaining queries in parallel
  const [
    pendingSignoffs,
    rankProgressResult,
  ] = await Promise.all([
    pendingSignoffsPromise,
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

  // NOTE: prefetchedRankData is undefined - LazyRankBrowser will fetch on demand
  // This is the key optimization that makes initial page load fast

  return (
    <UnitAdvancementContent
      scouts={scouts}
      rankProgress={rankProgress}
      pendingSignoffs={pendingSignoffs}
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
