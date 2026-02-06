'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { MeritBadgeBrowser } from './merit-badge-browser'
import { getMeritBadgeBrowserData, getMeritBadgeCategories } from '@/app/actions/advancement'
import { Skeleton } from '@/components/ui/skeleton'

interface LazyMeritBadgeBrowserProps {
  unitId: string
  canEdit: boolean
  currentUserName?: string
}

// Types matching what MeritBadgeBrowser expects
interface MeritBadge {
  id: string
  code: string
  name: string
  category: string | null
  description: string | null
  is_eagle_required: boolean | null
  is_active: boolean | null
  image_url: string | null
  pamphlet_url: string | null
}

interface MeritBadgeRequirementProgress {
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
  scout_merit_badge_requirement_progress: MeritBadgeRequirementProgress[]
}

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_merit_badge_progress: BadgeProgress[]
}

function MeritBadgeBrowserSkeleton() {
  return (
    <div className="space-y-4">
      {/* Search and filters skeleton */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Skeleton className="h-10 flex-1" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      {/* Badge grid skeleton */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function LazyMeritBadgeBrowser({
  unitId,
  canEdit,
  currentUserName = 'Leader',
}: LazyMeritBadgeBrowserProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [badges, setBadges] = useState<MeritBadge[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [scouts, setScouts] = useState<Scout[]>([])

  // Refresh key - increment to force re-fetch of scout data after sign-offs
  const [refreshKey, setRefreshKey] = useState(0)

  // Track if data has been loaded at least once (to avoid showing skeleton on refresh)
  const hasLoadedOnce = useRef(false)

  useEffect(() => {
    let cancelled = false
    const isInitialLoad = !hasLoadedOnce.current

    async function loadData() {
      // Only show loading skeleton on initial load, not on refresh
      if (isInitialLoad) {
        setIsLoading(true)
      }
      setError(null)

      try {
        // Fetch categories and browser data in parallel
        const [categoriesResult, browserDataResult] = await Promise.all([
          getMeritBadgeCategories(),
          getMeritBadgeBrowserData(unitId),
        ])

        if (cancelled) return

        if (!categoriesResult.success) {
          setError(categoriesResult.error || 'Failed to load categories')
          return
        }

        if (!browserDataResult.success) {
          setError(browserDataResult.error || 'Failed to load badge data')
          return
        }

        setCategories(categoriesResult.data || [])
        setBadges(browserDataResult.data?.badges || [])
        setScouts(browserDataResult.data?.scouts || [])
        hasLoadedOnce.current = true
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading merit badge browser data:', err)
          setError('An unexpected error occurred')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [unitId, refreshKey])

  // Handle data change (called after sign-off to refresh scout data)
  const handleDataChange = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  // Only show skeleton on initial load (no data yet)
  if (isLoading && badges.length === 0) {
    return <MeritBadgeBrowserSkeleton />
  }

  if (error) {
    return (
      <div className="p-4 text-center text-red-600">
        <p>{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-sm underline"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <MeritBadgeBrowser
      badges={badges}
      requirements={[]} // Requirements fetched on-demand per badge
      scouts={scouts}
      categories={categories}
      unitId={unitId}
      canEdit={canEdit}
      currentUserName={currentUserName}
      onDataChange={handleDataChange}
    />
  )
}
