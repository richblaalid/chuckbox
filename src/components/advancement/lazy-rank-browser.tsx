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
  is_header: boolean | null
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
  /** Rank code from URL search param — drives selection state */
  selectedRankCode?: string | null
  /** Callback to update URL when rank selection changes */
  onRankChange?: (rankCode: string | null) => void
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
  selectedRankCode: selectedRankCodeProp,
  onRankChange,
}: LazyRankBrowserProps) {
  // State for ranks list (loaded once)
  const [ranks, setRanks] = useState<Rank[]>([])
  const [ranksLoading, setRanksLoading] = useState(true)
  const [ranksError, setRanksError] = useState<string | null>(null)

  // Internal selected rank state — controlled by URL prop when provided
  const [activeRankCode, setActiveRankCode] = useState<string | null>(null)
  const [rankDataLoading, setRankDataLoading] = useState(false)

  // Refresh key - increment to force re-fetch of current rank data
  const [refreshKey, setRefreshKey] = useState(0)

  // Cache for loaded rank data (persists across rank switches)
  const rankDataCache = useRef<Map<string, RankDataCache>>(new Map())

  // Current rank's data (from cache or loading)
  const [currentRankData, setCurrentRankData] = useState<RankDataCache | null>(null)

  // Track which rank's data is currently loaded (to distinguish refresh from rank switch)
  const [loadedRankId, setLoadedRankId] = useState<string | null>(null)

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

  // Set default rank when ranks load — use URL prop if provided, otherwise first rank
  useEffect(() => {
    if (ranks.length > 0 && activeRankCode === null) {
      const initial = selectedRankCodeProp || ranks[0].code
      setActiveRankCode(initial)
    }
  }, [ranks, activeRankCode, selectedRankCodeProp])

  // Sync URL prop changes (e.g., browser Back changes ?rank= param)
  useEffect(() => {
    if (selectedRankCodeProp == null) return // no URL override
    if (selectedRankCodeProp === activeRankCode) return // already in sync
    setActiveRankCode(selectedRankCodeProp)
  }, [selectedRankCodeProp, activeRankCode])

  // Load rank data when selection changes
  // Inlined to avoid dependency on callback that changes with unitId
  useEffect(() => {
    if (ranks.length === 0 || activeRankCode === null) return

    const selectedRank = ranks.find(r => r.code === activeRankCode)
    if (!selectedRank) return

    // Capture rank ID before async function to satisfy TypeScript
    const rankId = selectedRank.id

    // Determine if this is a rank switch (different rank) vs refresh (same rank)
    const isRankSwitch = loadedRankId !== null && loadedRankId !== rankId

    // When switching ranks, clear old data immediately so we show skeleton
    if (isRankSwitch) {
      setCurrentRankData(null)
      setLoadedRankId(null)
    }

    // Check cache first
    if (rankDataCache.current.has(rankId)) {
      setCurrentRankData(rankDataCache.current.get(rankId)!)
      setLoadedRankId(rankId)
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
        setLoadedRankId(rankId)
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
  }, [activeRankCode, ranks, unitId, refreshKey, loadedRankId])

  // Handle rank selection — update internal state and notify parent for URL sync
  const handleRankSelect = useCallback((code: string) => {
    setActiveRankCode(code)
    onRankChange?.(code)
  }, [onRankChange])

  // Handle data change (called after sign-off to invalidate cache)
  const handleDataChange = useCallback(() => {
    // Clear the cache for the current rank so fresh data is fetched
    if (activeRankCode) {
      const selectedRank = ranks.find(r => r.code === activeRankCode)
      if (selectedRank) {
        rankDataCache.current.delete(selectedRank.id)
        // Increment refresh key to trigger re-fetch via useEffect
        setRefreshKey(k => k + 1)
      }
    }
  }, [activeRankCode, ranks])

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

  // Brief loading state between ranks loading and default selection being set
  if (activeRankCode === null) {
    return (
      <div className="space-y-4">
        <RankSelectorSkeleton />
        <RankContentSkeleton />
      </div>
    )
  }

  const currentRank = ranks.find(r => r.code === activeRankCode)

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
        selectedRank={activeRankCode}
        onRankClick={handleRankSelect}
        selectorMode
        compact
      />

      {/* Loading indicator for rank data - only show if no data yet */}
      {rankDataLoading && !currentRankData && (
        <RankContentSkeleton />
      )}

      {/* Requirements panel for selected rank - show even during refresh */}
      {currentRankData && currentRank && (
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
              onDataChange={handleDataChange}
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
