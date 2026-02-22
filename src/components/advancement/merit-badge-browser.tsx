'use client'

import { useState, useMemo, useTransition, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MeritBadgeGridCard } from './merit-badge-grid-card'
import { UnitMeritBadgePanel } from './unit-merit-badge-panel'
import { Search, Award, Star, Users, Filter } from 'lucide-react'
import { getMeritBadgeRequirements } from '@/app/actions/advancement'
import type { BsaMeritBadge, BsaMeritBadgeRequirement } from '@/types/advancement'

// Local alias for the merit badge type used in this component
type MeritBadge = BsaMeritBadge

interface RequirementProgress {
  id: string
  requirement_id: string
  status: string
  completed_at?: string | null
  completed_by?: string | null
  notes?: string | null
}

interface BadgeProgress {
  id: string
  merit_badge_id: string
  status: string
  counselor_name: string | null
  started_at: string | null
  completed_at: string | null
  awarded_at: string | null
  scout_merit_badge_requirement_progress: RequirementProgress[]
}

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_merit_badge_progress: BadgeProgress[]
}

interface MeritBadgeBrowserProps {
  badges: MeritBadge[]
  requirements: BsaMeritBadgeRequirement[] // May be truncated due to Supabase 1000 row limit
  scouts: Scout[]
  categories: string[]
  unitId: string
  canEdit: boolean
  currentUserName?: string
  /** Called when data changes (e.g., after sign-offs) to trigger a refresh */
  onDataChange?: () => void
  /** Badge ID from URL search param — drives selection state */
  selectedBadgeId?: string | null
  /** Callback to update URL when badge selection changes */
  onBadgeChange?: (badgeId: string | null) => void
}

type FilterType = 'all' | 'eagle' | 'in_progress' | 'category'

export function MeritBadgeBrowser({
  badges,
  requirements,
  scouts,
  categories,
  unitId,
  canEdit,
  currentUserName = 'Leader',
  onDataChange,
  selectedBadgeId,
  onBadgeChange,
}: MeritBadgeBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedBadge, setSelectedBadge] = useState<MeritBadge | null>(null)
  const [badgeRequirements, setBadgeRequirements] = useState<BsaMeritBadgeRequirement[]>([])
  const [isLoadingRequirements, setIsLoadingRequirements] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Cache fetched requirements to avoid re-fetching on back-navigation
  const requirementsCache = useRef<Map<string, BsaMeritBadgeRequirement[]>>(new Map())

  // Sync selection state with URL search param (selectedBadgeId)
  useEffect(() => {
    // Already in sync — skip
    if (selectedBadgeId === selectedBadge?.id) return
    if (selectedBadgeId == null && selectedBadge === null) return

    // URL says no badge → clear selection (browser Back)
    if (selectedBadgeId == null) {
      setSelectedBadge(null)
      setBadgeRequirements([])
      return
    }

    // URL says badge selected but badges haven't loaded yet → wait for next render
    if (badges.length === 0) return

    // Find and select the badge from the loaded list
    const badge = badges.find(b => b.id === selectedBadgeId)
    if (!badge) return

    // Check cache first to avoid re-fetching
    const cached = requirementsCache.current.get(badge.id)
    if (cached) {
      setSelectedBadge(badge)
      setBadgeRequirements(cached)
    } else {
      // Fetch requirements (sets selectedBadge and caches results)
      setSelectedBadge(badge)
      setIsLoadingRequirements(true)
      startTransition(async () => {
        try {
          const reqs = await getMeritBadgeRequirements(badge.id)
          const typedReqs = reqs as BsaMeritBadgeRequirement[]
          requirementsCache.current.set(badge.id, typedReqs)
          setBadgeRequirements(typedReqs)
        } catch (error) {
          console.error('Error fetching requirements:', error)
          setBadgeRequirements([])
        } finally {
          setIsLoadingRequirements(false)
        }
      })
    }
  }, [selectedBadgeId, badges]) // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate badge stats
  const badgeStats = useMemo(() => {
    const stats = new Map<string, { inProgress: number; completed: number }>()

    badges.forEach((badge) => {
      let inProgress = 0
      let completed = 0

      scouts.forEach((scout) => {
        const progress = scout.scout_merit_badge_progress.find(
          (p) => p.merit_badge_id === badge.id
        )
        if (progress) {
          if (progress.status === 'awarded') {
            completed++
          } else if (['in_progress', 'completed'].includes(progress.status)) {
            inProgress++
          }
        }
      })

      stats.set(badge.id, { inProgress, completed })
    })

    return stats
  }, [badges, scouts])

  // Count badges with scouts in progress
  const badgesInProgress = useMemo(() => {
    return badges.filter((badge) => {
      const stats = badgeStats.get(badge.id)
      return stats && stats.inProgress > 0
    }).length
  }, [badges, badgeStats])

  // Filter badges
  const filteredBadges = useMemo(() => {
    let result = badges

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (badge) =>
          badge.name.toLowerCase().includes(query) ||
          badge.category?.toLowerCase().includes(query) ||
          badge.description?.toLowerCase().includes(query)
      )
    }

    // Type filter
    if (activeFilter === 'eagle') {
      result = result.filter((badge) => badge.is_eagle_required)
    } else if (activeFilter === 'in_progress') {
      result = result.filter((badge) => {
        const stats = badgeStats.get(badge.id)
        return stats && stats.inProgress > 0
      })
    } else if (activeFilter === 'category' && selectedCategory) {
      result = result.filter((badge) => badge.category === selectedCategory)
    }

    return result
  }, [badges, searchQuery, activeFilter, selectedCategory, badgeStats])

  const eagleRequiredCount = badges.filter((b) => b.is_eagle_required).length

  const handleBadgeClick = async (badge: MeritBadge) => {
    setSelectedBadge(badge)
    onBadgeChange?.(badge.id)

    // Check cache first
    const cached = requirementsCache.current.get(badge.id)
    if (cached) {
      setBadgeRequirements(cached)
      return
    }

    // Fetch requirements on-demand for this specific badge
    setIsLoadingRequirements(true)
    startTransition(async () => {
      try {
        const reqs = await getMeritBadgeRequirements(badge.id)
        const typedReqs = reqs as BsaMeritBadgeRequirement[]
        requirementsCache.current.set(badge.id, typedReqs)
        setBadgeRequirements(typedReqs)
      } catch (error) {
        console.error('Error fetching requirements:', error)
        setBadgeRequirements([])
      } finally {
        setIsLoadingRequirements(false)
      }
    })
  }

  const handleBack = () => {
    setSelectedBadge(null)
    setBadgeRequirements([])
    onBadgeChange?.(null)
  }

  // Flash prevention: when refreshing with ?badge=<uuid>, badges haven't loaded yet.
  // Show loading state instead of briefly flashing the grid.
  if (!selectedBadge && selectedBadgeId && badges.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center text-stone-500">
          <Award className="mx-auto h-8 w-8 animate-pulse text-stone-400" />
          <p className="mt-2 text-sm">Loading merit badge...</p>
        </div>
      </div>
    )
  }

  // Show unit-mode requirements view if a badge is selected
  if (selectedBadge) {
    return (
      <UnitMeritBadgePanel
        badge={selectedBadge}
        requirements={badgeRequirements}
        scouts={scouts}
        unitId={unitId}
        canEdit={canEdit}
        isLoading={isLoadingRequirements}
        onBack={handleBack}
        currentUserName={currentUserName}
        onDataChange={onDataChange}
      />
    )
  }

  // Show grid view
  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          onClick={() => {
            setActiveFilter('all')
            setSelectedCategory(null)
          }}
          className={`group rounded-xl border p-4 text-left transition-all hover:shadow-md ${
            activeFilter === 'all'
              ? 'border-forest-300 bg-forest-50 shadow-sm'
              : 'border-stone-200 bg-white hover:border-stone-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className={`rounded-lg p-2 ${activeFilter === 'all' ? 'bg-forest-100' : 'bg-stone-100 group-hover:bg-stone-200'}`}>
              <Award className={`h-4 w-4 ${activeFilter === 'all' ? 'text-forest-700' : 'text-stone-600'}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-stone-900">{badges.length}</p>
              <p className="text-xs text-stone-500">All Badges</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => {
            setActiveFilter('eagle')
            setSelectedCategory(null)
          }}
          className={`group rounded-xl border p-4 text-left transition-all hover:shadow-md ${
            activeFilter === 'eagle'
              ? 'border-amber-300 bg-amber-50 shadow-sm'
              : 'border-stone-200 bg-white hover:border-stone-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className={`rounded-lg p-2 ${activeFilter === 'eagle' ? 'bg-amber-100' : 'bg-stone-100 group-hover:bg-stone-200'}`}>
              <Star className={`h-4 w-4 ${activeFilter === 'eagle' ? 'text-amber-700' : 'text-stone-600'}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-stone-900">{eagleRequiredCount}</p>
              <p className="text-xs text-stone-500">Eagle Required</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => {
            setActiveFilter('in_progress')
            setSelectedCategory(null)
          }}
          className={`group rounded-xl border p-4 text-left transition-all hover:shadow-md ${
            activeFilter === 'in_progress'
              ? 'border-blue-300 bg-blue-50 shadow-sm'
              : 'border-stone-200 bg-white hover:border-stone-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className={`rounded-lg p-2 ${activeFilter === 'in_progress' ? 'bg-blue-100' : 'bg-stone-100 group-hover:bg-stone-200'}`}>
              <Users className={`h-4 w-4 ${activeFilter === 'in_progress' ? 'text-blue-700' : 'text-stone-600'}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-stone-900">{badgesInProgress}</p>
              <p className="text-xs text-stone-500">In Progress</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setActiveFilter('category')}
          className={`group rounded-xl border p-4 text-left transition-all hover:shadow-md ${
            activeFilter === 'category'
              ? 'border-purple-300 bg-purple-50 shadow-sm'
              : 'border-stone-200 bg-white hover:border-stone-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className={`rounded-lg p-2 ${activeFilter === 'category' ? 'bg-purple-100' : 'bg-stone-100 group-hover:bg-stone-200'}`}>
              <Filter className={`h-4 w-4 ${activeFilter === 'category' ? 'text-purple-700' : 'text-stone-600'}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-stone-900">{categories.length}</p>
              <p className="text-xs text-stone-500">Categories</p>
            </div>
          </div>
        </button>
      </div>

      {/* Search and Category Filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            type="search"
            placeholder="Search merit badges..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {activeFilter === 'category' && (
          <div className="flex flex-wrap gap-2">
            {categories.sort().map((category) => (
              <Button
                key={category}
                variant={selectedCategory === category ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(category === selectedCategory ? null : category)}
                className="text-xs"
              >
                {category}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">
          Showing {filteredBadges.length} of {badges.length} badges
          {activeFilter === 'eagle' && ' (Eagle Required)'}
          {activeFilter === 'in_progress' && ' (In Progress)'}
          {activeFilter === 'category' && selectedCategory && ` in ${selectedCategory}`}
        </p>
      </div>

      {/* Badge Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {filteredBadges.map((badge) => {
          const stats = badgeStats.get(badge.id) || { inProgress: 0, completed: 0 }
          return (
            <MeritBadgeGridCard
              key={badge.id}
              badge={badge}
              inProgressCount={stats.inProgress}
              completedCount={stats.completed}
              onClick={() => handleBadgeClick(badge)}
            />
          )
        })}
      </div>

      {filteredBadges.length === 0 && (
        <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-12 text-center">
          <Award className="mx-auto h-12 w-12 text-stone-300" />
          <p className="mt-4 text-stone-500">No badges found matching your criteria</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchQuery('')
              setActiveFilter('all')
              setSelectedCategory(null)
            }}
            className="mt-4"
          >
            Clear filters
          </Button>
        </div>
      )}
    </div>
  )
}
