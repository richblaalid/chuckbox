'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { UnitRankPanel } from './unit-rank-panel'
import { RankTrailVisualization } from './rank-trail-visualization'
import { Award, Loader2 } from 'lucide-react'
import { getRanksList, getRankDataForRank } from '@/app/actions/advancement'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * PERFORMANCE OPTIMIZATION: Per-Rank Loading
 *
 * Instead of loading ALL ranks × ALL scouts × ALL requirements upfront (35,000+ rows),
 * we now:
 * 1. Load just the ranks list initially (tiny query, ~7 rows)
 * 2. Load data for ONE rank at a time when selected
 * 3. Cache loaded data so switching ranks is instant
 *
 * This reduces initial load from 7-9 seconds to <1 second.
 */

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

interface ScoutProgress {
  scoutId: string
  firstName: string
  lastName: string
  rankProgressId: string | null
  status: string | null
  requirementProgress: Array<{
    requirementId: string
    status: string
  }>
}

// Cache structure for per-rank data
interface RankDataCache {
  requirements: Requirement[]
  scoutProgress: ScoutProgress[]
}

// Scout type expected by UnitRankPanel
interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_rank_progress: Array<{
    id: string
    rank_id: string
    status: string
    scout_rank_requirement_progress: Array<{
      id: string
      requirement_id: string
      status: string
    }>
  }>
}

/**
 * Transform the flat ScoutProgress format to the nested Scout format
 * expected by UnitRankPanel.
 */
function transformScoutProgressToScouts(scoutProgress: ScoutProgress[], rankId: string): Scout[] {
  return scoutProgress.map(sp => ({
    id: sp.scoutId,
    first_name: sp.firstName,
    last_name: sp.lastName,
    is_active: true,
    scout_rank_progress: sp.rankProgressId ? [{
      id: sp.rankProgressId,
      rank_id: rankId,
      status: sp.status || 'not_started',
      scout_rank_requirement_progress: sp.requirementProgress.map(rp => ({
        id: `${sp.rankProgressId}-${rp.requirementId}`, // Generate a unique ID
        requirement_id: rp.requirementId,
        status: rp.status,
      })),
    }] : [],
  }))
}

interface LazyRankBrowserProps {
  unitId: string
  canEdit: boolean
  currentUserName?: string
  // Prefetched data is no longer used - we always load per-rank
  prefetchedData?: unknown
}

function RankSelectorSkeleton() {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-12 rounded-full flex-shrink-0" />
      ))}
    </div>
  )
}

function RankContentSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-4 w-64 mt-2" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-stone-50">
              <Skeleton className="h-5 w-5 rounded flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function LazyRankBrowser({
  unitId,
  canEdit,
  currentUserName = 'Leader',
}: LazyRankBrowserProps) {
  // State for ranks list (loaded once)
  const [ranks, setRanks] = useState<Rank[]>([])
  const [ranksLoading, setRanksLoading] = useState(true)
  const [ranksError, setRanksError] = useState<string | null>(null)

  // State for selected rank
  const [selectedRankCode, setSelectedRankCode] = useState<string>('scout')
  const [rankDataLoading, setRankDataLoading] = useState(false)

  // Cache for loaded rank data (persists across rank switches)
  const rankDataCache = useRef<Map<string, RankDataCache>>(new Map())

  // Current rank's data (from cache or loading)
  const [currentRankData, setCurrentRankData] = useState<RankDataCache | null>(null)

  // Load ranks list on mount (fast query)
  useEffect(() => {
    async function loadRanks() {
      setRanksLoading(true)
      setRanksError(null)

      try {
        const result = await getRanksList()
        if (!result.success) {
          setRanksError(result.error || 'Failed to load ranks')
          return
        }
        setRanks(result.data?.ranks || [])
      } catch (err) {
        console.error('Error loading ranks:', err)
        setRanksError('An unexpected error occurred')
      } finally {
        setRanksLoading(false)
      }
    }

    loadRanks()
  }, [])

  // Load rank data when selection changes
  // Inlined to avoid dependency on callback that changes with unitId
  useEffect(() => {
    if (ranks.length === 0) return

    const selectedRank = ranks.find(r => r.code === selectedRankCode)
    if (!selectedRank) return

    // Capture rank ID before async function to satisfy TypeScript
    const rankId = selectedRank.id

    // Check cache first
    if (rankDataCache.current.has(rankId)) {
      setCurrentRankData(rankDataCache.current.get(rankId)!)
      return
    }

    // Load data with cleanup to prevent state updates after unmount
    let cancelled = false

    async function loadData() {
      setRankDataLoading(true)
      try {
        const result = await getRankDataForRank(unitId, rankId)
        if (cancelled) return

        if (!result.success) {
          console.error('Failed to load rank data:', result.error)
          return
        }

        const data: RankDataCache = {
          requirements: result.data?.requirements || [],
          scoutProgress: result.data?.scoutProgress || [],
        }

        // Cache the data
        rankDataCache.current.set(rankId, data)
        setCurrentRankData(data)
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading rank data:', err)
        }
      } finally {
        if (!cancelled) {
          setRankDataLoading(false)
        }
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [selectedRankCode, ranks, unitId])

  // Handle rank selection
  const handleRankSelect = useCallback((code: string) => {
    setSelectedRankCode(code)
  }, [])

  // Loading state for initial ranks
  if (ranksLoading) {
    return (
      <div className="space-y-4">
        <RankSelectorSkeleton />
        <RankContentSkeleton />
      </div>
    )
  }

  // Error state
  if (ranksError) {
    return (
      <div className="p-4 text-center text-red-600">
        <p>{ranksError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-sm underline"
        >
          Try again
        </button>
      </div>
    )
  }

  const currentRank = ranks.find(r => r.code === selectedRankCode)

  // Get scouts working on this rank (if we have data)
  const scoutsWorkingOnRank = currentRankData?.scoutProgress.filter(
    sp => sp.status === 'in_progress'
  ) || []

  return (
    <div className="space-y-4">
      {/* Trail to Eagle rank selector */}
      <RankTrailVisualization
        rankProgress={[]}
        currentRank={null}
        selectedRank={selectedRankCode}
        onRankClick={handleRankSelect}
        selectorMode
        compact
      />

      {/* Loading indicator for rank data */}
      {rankDataLoading && (
        <RankContentSkeleton />
      )}

      {/* Requirements panel for selected rank */}
      {!rankDataLoading && currentRankData && currentRank && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-amber-600" />
                {currentRank.name} Requirements
              </CardTitle>
              <Badge variant="secondary">
                {scoutsWorkingOnRank.length} scouts working
              </Badge>
            </div>
            <CardDescription>
              {currentRank.description || `Requirements for ${currentRank.name} rank`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UnitRankPanel
              rank={currentRank}
              requirements={currentRankData.requirements}
              scouts={transformScoutProgressToScouts(currentRankData.scoutProgress, currentRank.id)}
              unitId={unitId}
              canEdit={canEdit}
              currentUserName={currentUserName}
            />
          </CardContent>
        </Card>
      )}

      {/* No data yet and not loading */}
      {!rankDataLoading && !currentRankData && currentRank && (
        <Card>
          <CardContent className="py-8 text-center text-stone-500">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            Loading {currentRank.name} requirements...
          </CardContent>
        </Card>
      )}
    </div>
  )
}
