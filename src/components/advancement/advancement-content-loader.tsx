import { createClient } from '@/lib/supabase/server'
import { UnitAdvancementContent } from './unit-advancement-content'
import {
  getUnitAdvancementSummary,
  getRankRequirementsForUnit,
  getRankBrowserData,
} from '@/app/actions/advancement'

interface AdvancementContentLoaderProps {
  unitId: string
  canEdit: boolean
  currentUserName: string
  initialTab: 'ranks' | 'badges' | 'summary'
}

/**
 * Async server component that fetches all advancement data.
 * Designed to be wrapped in a Suspense boundary for streaming.
 *
 * Data fetching happens here (server), then renders the client component
 * with all the data it needs.
 */
export async function AdvancementContentLoader({
  unitId,
  canEdit,
  currentUserName,
  initialTab,
}: AdvancementContentLoaderProps) {
  const supabase = await createClient()

  // Fetch all data in parallel
  const [
    summaryResult,
    pendingApprovalsResult,
    pendingBadgeApprovalsResult,
    rankRequirementsResult,
    rankBrowserDataResult,
    rankProgressResult,
  ] = await Promise.all([
    // Optimized summary stats
    getUnitAdvancementSummary(unitId),

    // Pending rank requirement approvals (needed for modal)
    supabase
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
      .order('submitted_at', { ascending: false }),

    // Pending badge approvals (needed for modal)
    (async () => {
      const { data: scouts } = await supabase
        .from('scouts')
        .select('id')
        .eq('unit_id', unitId)
        .eq('is_active', true)
      const scoutIds = scouts?.map(s => s.id) || []
      if (scoutIds.length === 0) return { data: [] }
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
    })(),

    // Rank requirements (for Ranks tab - prefetched)
    getRankRequirementsForUnit(),

    // Scouts with rank progress (for Ranks tab - prefetched)
    getRankBrowserData(unitId),

    // Rank progress data for summary tab
    (async () => {
      const { data: unitScouts } = await supabase
        .from('scouts')
        .select('id')
        .eq('unit_id', unitId)
        .eq('is_active', true)
      const scoutIds = unitScouts?.map(s => s.id) || []
      if (scoutIds.length === 0) return { data: [] }
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
    })(),
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

  // Build prefetched rank data for instant Ranks tab load
  const prefetchedRankData = (rankRequirementsResult.success && rankBrowserDataResult.success)
    ? {
        ranks: rankRequirementsResult.data?.ranks || [],
        requirements: rankRequirementsResult.data?.requirements || [],
        scouts: rankBrowserDataResult.data?.scouts || [],
      }
    : undefined

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
      prefetchedRankData={prefetchedRankData}
      unitId={unitId}
      canEdit={canEdit}
      currentUserName={currentUserName}
      initialTab={initialTab}
    />
  )
}
