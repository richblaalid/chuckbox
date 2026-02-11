'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Award, Medal, BarChart3 } from 'lucide-react'
import { LazyRankBrowser } from './lazy-rank-browser'
import { LazyMeritBadgeBrowser } from './lazy-merit-badge-browser'
import { LazySummaryView } from './lazy-summary-view'
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

interface UnitAdvancementTabsProps {
  // Summary tab data (loaded upfront)
  scouts: Scout[]
  rankProgress: RankProgress[]
  pendingSignoffs: PendingSignoff[]
  // Prefetched rank browser data (for instant Ranks tab load)
  prefetchedRankData?: PrefetchedRankData
  // Common props for lazy-loaded tabs
  unitId: string
  canEdit: boolean
  currentUserName?: string
  // Initial tab to display (defaults to 'ranks')
  initialTab?: TabValue
}

export function UnitAdvancementTabs({
  scouts,
  rankProgress,
  pendingSignoffs,
  prefetchedRankData,
  unitId,
  canEdit,
  currentUserName = 'Leader',
  initialTab = 'ranks',
}: UnitAdvancementTabsProps) {
  // Track which tabs have been visited to enable lazy loading
  // Include both ranks (prefetched) and the initial tab
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(
    new Set(['ranks', initialTab])
  )

  const handleTabChange = (value: string) => {
    setVisitedTabs((prev) => {
      if (prev.has(value)) return prev
      const next = new Set(prev)
      next.add(value)
      return next
    })
  }

  return (
    <Tabs defaultValue={initialTab} className="w-full" onValueChange={handleTabChange}>
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="ranks" className="gap-1.5">
          <Award className="h-4 w-4 hidden sm:inline" />
          Ranks
        </TabsTrigger>
        <TabsTrigger value="badges" className="gap-1.5">
          <Medal className="h-4 w-4 hidden sm:inline" />
          Merit Badges
        </TabsTrigger>
        <TabsTrigger value="summary" className="gap-1.5">
          <BarChart3 className="h-4 w-4 hidden sm:inline" />
          Summary
        </TabsTrigger>
      </TabsList>

      {/* Rank Requirements Tab - Prefetched server-side for instant load */}
      <TabsContent value="ranks" className="mt-4">
        {visitedTabs.has('ranks') && (
          <LazyRankBrowser
            unitId={unitId}
            canEdit={canEdit}
            currentUserName={currentUserName}
            prefetchedData={prefetchedRankData}
          />
        )}
      </TabsContent>

      {/* Merit Badges Tab - Lazy loaded on click */}
      <TabsContent value="badges" className="mt-4">
        {visitedTabs.has('badges') && (
          <LazyMeritBadgeBrowser
            unitId={unitId}
            canEdit={canEdit}
            currentUserName={currentUserName}
          />
        )}
      </TabsContent>

      {/* Summary Tab - Data lazy-loaded when visited (unless prefetched) */}
      <TabsContent value="summary" className="mt-4">
        {visitedTabs.has('summary') && (
          <LazySummaryView
            scouts={scouts}
            rankProgress={rankProgress.length > 0 ? rankProgress : undefined}
            pendingSignoffs={pendingSignoffs}
            canEdit={canEdit}
            unitId={unitId}
          />
        )}
      </TabsContent>
    </Tabs>
  )
}
