'use client'

import { useEffect, useState } from 'react'
import { AdvancementSummaryView } from './advancement-summary-view'
import { getSummaryTabData } from '@/app/actions/advancement'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

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

interface LazySummaryViewProps {
  scouts: Scout[]
  // If rankProgress is provided (prefetched), use it; otherwise lazy-load
  rankProgress?: RankProgress[]
  pendingApprovals: PendingApproval[]
  pendingBadgeApprovals: PendingBadgeApproval[]
  onPendingApprovalsClick?: () => void
  canEdit: boolean
  unitId: string
}

function SummarySkeleton() {
  return (
    <div className="space-y-4">
      {/* Pending approvals card skeleton */}
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="pt-0">
          <Skeleton className="h-4 w-64" />
        </CardContent>
      </Card>

      {/* Ready for BOR skeleton */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Close to advancement skeleton */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Lazy-loading wrapper for AdvancementSummaryView.
 * If rankProgress is provided, renders immediately.
 * Otherwise, fetches data on mount and shows skeleton.
 */
export function LazySummaryView({
  scouts,
  rankProgress: prefetchedRankProgress,
  pendingApprovals,
  pendingBadgeApprovals,
  onPendingApprovalsClick,
  canEdit,
  unitId,
}: LazySummaryViewProps) {
  const [rankProgress, setRankProgress] = useState<RankProgress[] | null>(
    prefetchedRankProgress || null
  )
  const [loading, setLoading] = useState(!prefetchedRankProgress)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // If we already have data, don't fetch
    if (prefetchedRankProgress) return

    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        const result = await getSummaryTabData(unitId)
        if (!result.success) {
          setError(result.error || 'Failed to load data')
          return
        }
        setRankProgress(result.data?.rankProgress || [])
      } catch (err) {
        console.error('Error loading summary data:', err)
        setError('An unexpected error occurred')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [unitId, prefetchedRankProgress])

  if (loading) {
    return <SummarySkeleton />
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-red-600">
          <p>{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-sm underline"
          >
            Try again
          </button>
        </CardContent>
      </Card>
    )
  }

  return (
    <AdvancementSummaryView
      scouts={scouts}
      rankProgress={rankProgress || []}
      pendingApprovals={pendingApprovals}
      pendingBadgeApprovals={pendingBadgeApprovals}
      onPendingApprovalsClick={onPendingApprovalsClick}
      canEdit={canEdit}
    />
  )
}
