'use client'

import { UnitAdvancementStats } from './unit-advancement-stats'
import { UnitAdvancementTabs } from './unit-advancement-tabs'
import type { PendingSignoff } from '@/types/advancement'

interface Scout {
  id: string
  first_name: string
  last_name: string
  rank: string | null
  patrols: { name: string } | null
}

interface RankProgress {
  id: string
  scout_id: string
  status: string
  awarded_at: string | null
  bsa_ranks: { id: string; code: string; name: string; display_order: number } | null
  scout_rank_requirement_progress: Array<{ id: string; status: string; completed_at: string | null }>
}

// Types for prefetched rank browser data
interface Rank {
  id: string
  code: string
  name: string
  display_order: number
  is_eagle_required: boolean | null
  description: string | null
}

interface Requirement {
  id: string
  version_year: number | null
  rank_id: string
  requirement_number: string
  parent_requirement_id: string | null
  sub_requirement_letter: string | null
  description: string
  is_alternative: boolean | null
  alternatives_group: string | null
  display_order: number
}

interface RankRequirementProgress {
  id: string
  requirement_id: string
  status: string
}

interface ScoutRankProgress {
  id: string
  rank_id: string
  status: string
  scout_rank_requirement_progress: RankRequirementProgress[]
}

interface ScoutWithRankProgress {
  id: string
  first_name: string
  last_name: string
  rank: string | null
  is_active: boolean | null
  scout_rank_progress: ScoutRankProgress[]
}

interface PrefetchedRankData {
  ranks: Rank[]
  requirements: Requirement[]
  scouts: ScoutWithRankProgress[]
}

type TabValue = 'ranks' | 'badges' | 'summary'

interface UnitAdvancementContentProps {
  // Summary tab data (loaded upfront)
  scouts: Scout[]
  rankProgress: RankProgress[]
  pendingSignoffs: PendingSignoff[]
  stats: {
    rankProgressPercent: number
    scoutsWorkingOnRanks: number
    meritBadgesInProgress: number
    meritBadgesEarned: number
  }
  // Prefetched rank browser data (for instant Ranks tab load)
  prefetchedRankData?: PrefetchedRankData
  // Common props
  unitId: string
  canEdit: boolean
  currentUserName?: string
  // Initial tab to display (defaults to 'ranks')
  initialTab?: TabValue
}

export function UnitAdvancementContent({
  scouts,
  rankProgress,
  pendingSignoffs,
  stats,
  prefetchedRankData,
  unitId,
  canEdit,
  currentUserName = 'Leader',
  initialTab = 'ranks',
}: UnitAdvancementContentProps) {
  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <UnitAdvancementStats
        rankProgressPercent={stats.rankProgressPercent}
        scoutsWorkingOnRanks={stats.scoutsWorkingOnRanks}
        meritBadgesInProgress={stats.meritBadgesInProgress}
        meritBadgesEarned={stats.meritBadgesEarned}
        pendingApprovalsCount={pendingSignoffs.length}
      />

      {/* Tabbed Content - Ranks prefetched, Merit Badges lazy loaded */}
      <UnitAdvancementTabs
        scouts={scouts}
        rankProgress={rankProgress}
        pendingSignoffs={pendingSignoffs}
        prefetchedRankData={prefetchedRankData}
        unitId={unitId}
        canEdit={canEdit}
        currentUserName={currentUserName}
        initialTab={initialTab}
      />
    </div>
  )
}
