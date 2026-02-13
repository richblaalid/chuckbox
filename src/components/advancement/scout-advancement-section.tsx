'use client'

import { useState, useMemo, useEffect, useRef, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LeadershipTimeline } from './leadership-timeline'
import { ActivityStats } from './activity-stats'
import { RankTrailVisualization } from './rank-trail-visualization'
import { ScoutRankPanel } from './scout-rank-panel'
import { MeritBadgeSashView } from './merit-badge-sash-view'
import { ScoutMeritBadgePanel } from './scout-merit-badge-panel'
import { getRankRequirements, getCurrentUserInfo, getCurrentUserProfile } from '@/app/actions/advancement'
import {
  Award,
  Medal,
  Users,
  Activity,
  TentTree,
  Footprints,
  Heart,
} from 'lucide-react'
import type { RankProgress as RankProgressType } from '@/types/advancement'

// All BSA rank codes in order
const RANK_ORDER = ['scout', 'tenderfoot', 'second_class', 'first_class', 'star', 'life', 'eagle']

interface RankProgress {
  id: string
  status: string
  started_at: string | null
  completed_at: string | null
  approved_at: string | null
  awarded_at: string | null
  bsa_ranks: {
    id: string
    code: string
    name: string
    display_order: number
    image_url?: string | null
  }
  scout_rank_requirement_progress: Array<{
    id: string
    status: string
    completed_at: string | null
    completed_by: string | null
    notes: string | null
    approval_status: string | null
    bsa_rank_requirements: {
      id: string
      requirement_number: string
      description: string
      parent_requirement_id: string | null
      is_alternative: boolean | null
      alternatives_group: string | null
      is_header: boolean | null
    }
  }>
}

interface MeritBadgeProgress {
  id: string
  status: string
  started_at: string | null
  completed_at: string | null
  awarded_at: string | null
  counselor_name: string | null
  requirement_version_year?: number | null
  bsa_merit_badges: {
    id: string
    code: string | null
    name: string
    is_eagle_required: boolean | null
    category: string | null
    image_url?: string | null
  }
  scout_merit_badge_requirement_progress: Array<{
    id: string
    status: string
    completed_at: string | null
    completed_by?: string | null
    notes?: string | null
    approval_status?: string | null
    requirement_id?: string
    bsa_merit_badge_requirements?: {
      id: string
      requirement_number: string
      description: string
      parent_requirement_id?: string | null
    }
  }>
}

interface LeadershipHistory {
  id: string
  start_date: string
  end_date: string | null
  notes: string | null
  bsa_leadership_positions: {
    id: string
    code: string | null
    name: string
    qualifies_for_star: boolean | null
    qualifies_for_life: boolean | null
    qualifies_for_eagle: boolean | null
    min_tenure_months: number | null
  }
}

interface ActivityEntry {
  id: string
  activity_type: 'camping' | 'hiking' | 'service' | 'conservation'
  activity_date: string
  value: number
  description: string | null
  location: string | null
}

interface ActivityTotals {
  camping: number
  hiking: number
  service: number
  conservation: number
}

interface ScoutAdvancementSectionProps {
  scoutId: string
  unitId: string
  scoutName: string
  currentRank: string | null
  rankProgress: RankProgress[]
  meritBadgeProgress: MeritBadgeProgress[]
  leadershipHistory: LeadershipHistory[]
  activityEntries: ActivityEntry[]
  activityTotals: ActivityTotals
  canEdit: boolean
  canSubmit?: boolean // Parents can submit requirements for approval
}

// Compute the "next" rank based on current rank or progress
function computeNextRank(currentRank: string | null, rankProgress: RankProgress[]): string {
  // Find the highest awarded rank from progress
  const awardedRanks = rankProgress
    .filter(rp => rp.status === 'awarded')
    .map(rp => rp.bsa_ranks.code)

  // Find any in-progress rank
  const inProgressRank = rankProgress.find(rp => rp.status === 'in_progress')
  if (inProgressRank) {
    return inProgressRank.bsa_ranks.code
  }

  // If we have awarded ranks, find the next one after the highest
  if (awardedRanks.length > 0) {
    const highestIndex = Math.max(...awardedRanks.map(code => RANK_ORDER.indexOf(code)))
    const nextIndex = highestIndex + 1
    if (nextIndex < RANK_ORDER.length) {
      return RANK_ORDER[nextIndex]
    }
    // If they have Eagle, show Eagle
    return 'eagle'
  }

  // Check currentRank from scout record as fallback
  if (currentRank) {
    const normalized = currentRank.toLowerCase().replace(/\s+/g, '_')
    const currentIndex = RANK_ORDER.indexOf(normalized)
    if (currentIndex >= 0 && currentIndex < RANK_ORDER.length - 1) {
      return RANK_ORDER[currentIndex + 1]
    }
    if (currentIndex === RANK_ORDER.length - 1) {
      return 'eagle' // Already at Eagle
    }
  }

  // Default to Scout rank
  return 'scout'
}

export function ScoutAdvancementSection({
  scoutId,
  unitId,
  scoutName,
  currentRank,
  rankProgress,
  meritBadgeProgress,
  leadershipHistory,
  activityEntries,
  activityTotals,
  canEdit,
  canSubmit = false,
}: ScoutAdvancementSectionProps) {
  const [activeTab, setActiveTab] = useState('rank')

  // State for selected merit badge (for detail view)
  // Store just the ID so we always get fresh data from props after router.refresh()
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null)

  // Derive the full badge from meritBadgeProgress so it updates when props change
  const selectedBadge = useMemo(() => {
    if (!selectedBadgeId) return null
    return meritBadgeProgress.find(b => b.id === selectedBadgeId) || null
  }, [selectedBadgeId, meritBadgeProgress])

  // Compute default selected rank
  const defaultSelectedRank = useMemo(() => {
    return computeNextRank(currentRank, rankProgress)
  }, [currentRank, rankProgress])

  const [selectedRank, setSelectedRank] = useState<string>(defaultSelectedRank)

  // State for fetched requirements when rank has no progress
  type RankRequirementsData = Awaited<ReturnType<typeof getRankRequirements>>
  const [fetchedRequirements, setFetchedRequirements] = useState<RankRequirementsData>(null)

  // Use transition for non-blocking data fetches
  const [isPendingRequirements, startRequirementsTransition] = useTransition()

  // Track fetch request to handle race conditions
  const fetchRequestRef = useRef<string | null>(null)

  // State for current user info (for completion dialogs)
  const [currentUserName, setCurrentUserName] = useState<string>('')

  // Fetch current user info on mount (for leaders and parents)
  useEffect(() => {
    if (canEdit) {
      // Leaders: use getCurrentUserInfo which verifies role
      getCurrentUserInfo(unitId).then(result => {
        if (result.success && result.data) {
          setCurrentUserName(result.data.fullName)
        }
      })
    } else if (canSubmit) {
      // Parents: use getCurrentUserProfile which just gets profile info
      getCurrentUserProfile().then(result => {
        if (result.success && result.data) {
          setCurrentUserName(result.data.fullName)
        }
      })
    }
  }, [unitId, canEdit, canSubmit])

  // Calculate progress statistics
  const earnedBadges = meritBadgeProgress.filter((b) => b.status === 'awarded')
  const eagleRequiredEarned = earnedBadges.filter((b) => b.bsa_merit_badges.is_eagle_required === true)
  const currentLeadership = leadershipHistory.filter((l) => !l.end_date)

  // Type cast for the new components
  const typedRankProgress = rankProgress as unknown as RankProgressType[]

  // Find the selected rank's progress data
  const selectedRankProgress = useMemo(() => {
    return rankProgress.find(
      rp => rp.bsa_ranks.code === selectedRank ||
            rp.bsa_ranks.name.toLowerCase().replace(/\s+/g, '_') === selectedRank
    ) || null
  }, [rankProgress, selectedRank])

  // Fetch requirements when selected rank has no progress
  // Use startTransition to avoid synchronous setState warning
  useEffect(() => {
    if (!selectedRankProgress && selectedRank) {
      // No progress for this rank - fetch the raw requirements
      const requestId = selectedRank
      fetchRequestRef.current = requestId

      startRequirementsTransition(() => {
        // Clear previous requirements inside transition
        setFetchedRequirements(null)
      })

      getRankRequirements(selectedRank).then(data => {
        // Only update if this is still the current request
        if (fetchRequestRef.current === requestId) {
          startRequirementsTransition(() => {
            setFetchedRequirements(data)
          })
        }
      }).catch(err => {
        console.error('Error fetching rank requirements:', err)
        if (fetchRequestRef.current === requestId) {
          startRequirementsTransition(() => {
            setFetchedRequirements(null)
          })
        }
      })
    } else {
      // Clear fetched requirements when we have progress data
      fetchRequestRef.current = null
      startRequirementsTransition(() => {
        setFetchedRequirements(null)
      })
    }
  }, [selectedRank, selectedRankProgress])

  // Derive loading state from pending transition
  const isLoadingRequirements = isPendingRequirements || Boolean(
    !selectedRankProgress && selectedRank && !fetchedRequirements
  )

  // Handle clicking a rank in the trail
  const handleRankClick = (rankCode: string) => {
    setSelectedRank(rankCode)
  }

  return (
    <div className="space-y-4">
      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border bg-gradient-to-br from-amber-50 to-orange-50 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <Medal className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-amber-900">{earnedBadges.length}</p>
            <p className="text-xs text-amber-700">Merit Badges</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-gradient-to-br from-blue-50 to-indigo-50 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
            <Award className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-blue-900">{eagleRequiredEarned.length}/14</p>
            <p className="text-xs text-blue-700">Eagle Required</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-gradient-to-br from-emerald-50 to-green-50 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
            <Users className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-emerald-900">
              {currentLeadership.length > 0 ? currentLeadership[0].bsa_leadership_positions.name.split(' ')[0] : '—'}
            </p>
            <p className="text-xs text-emerald-700">Leadership</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border bg-gradient-to-br from-purple-50 to-violet-50 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
            <Activity className="h-5 w-5 text-purple-600" />
          </div>
          <div className="flex gap-2 text-xs">
            <span className="flex items-center gap-0.5 text-purple-800">
              <TentTree className="h-3 w-3" />
              {activityTotals.camping}
            </span>
            <span className="flex items-center gap-0.5 text-purple-800">
              <Footprints className="h-3 w-3" />
              {activityTotals.hiking.toFixed(0)}
            </span>
            <span className="flex items-center gap-0.5 text-purple-800">
              <Heart className="h-3 w-3" />
              {activityTotals.service.toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      {/* Main Advancement Card with Tabs */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-forest-600" />
                Advancement Details
              </CardTitle>
              <CardDescription>
                Track progress for ranks, merit badges, and activities
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Tabbed Content */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="rank" className="gap-1.5">
                <Award className="h-4 w-4 hidden sm:inline" />
                Ranks
              </TabsTrigger>
              <TabsTrigger value="badges" className="gap-1.5">
                <Medal className="h-4 w-4 hidden sm:inline" />
                Badges
              </TabsTrigger>
              <TabsTrigger value="leadership" className="gap-1.5">
                <Users className="h-4 w-4 hidden sm:inline" />
                Leadership
              </TabsTrigger>
              <TabsTrigger value="activities" className="gap-1.5">
                <Activity className="h-4 w-4 hidden sm:inline" />
                Activities
              </TabsTrigger>
            </TabsList>

            {/* Ranks Tab - includes trail visualization */}
            <TabsContent value="rank" className="mt-4 space-y-4">
              {/* Trail to Eagle - only visible in Ranks tab */}
              <RankTrailVisualization
                rankProgress={typedRankProgress}
                currentRank={currentRank}
                onRankClick={handleRankClick}
                selectedRank={selectedRank}
                compact
              />

              {/* Scout Rank Panel - min-height prevents layout shift during loading */}
              <div className="min-h-[400px]">
                <ScoutRankPanel
                  rank={selectedRankProgress}
                  scoutId={scoutId}
                  unitId={unitId}
                  canEdit={canEdit}
                  canSubmit={canSubmit}
                  rankName={selectedRank.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  currentUserName={currentUserName}
                  rankRequirementsData={fetchedRequirements}
                  isLoading={isLoadingRequirements}
                />
              </div>
            </TabsContent>

            <TabsContent value="badges" className="mt-4">
              {selectedBadge ? (
                // Detail view for selected badge
                <ScoutMeritBadgePanel
                  badge={selectedBadge}
                  scoutId={scoutId}
                  unitId={unitId}
                  canEdit={canEdit}
                  canSubmit={canSubmit}
                  onBack={() => setSelectedBadgeId(null)}
                  currentUserName={currentUserName}
                />
              ) : (
                // Grid view with sash layout
                <MeritBadgeSashView
                    meritBadgeProgress={meritBadgeProgress}
                    onBadgeClick={(badge) => setSelectedBadgeId(badge.id)}
                    scoutId={scoutId}
                    unitId={unitId}
                    canEdit={canEdit}
                  />
              )}
            </TabsContent>

            <TabsContent value="leadership" className="mt-4">
              <LeadershipTimeline
                history={leadershipHistory}
                scoutId={scoutId}
                unitId={unitId}
                canEdit={canEdit}
              />
            </TabsContent>

            <TabsContent value="activities" className="mt-4">
              <ActivityStats
                entries={activityEntries}
                totals={activityTotals}
                scoutId={scoutId}
                unitId={unitId}
                canEdit={canEdit}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
