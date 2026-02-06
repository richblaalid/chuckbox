import { Skeleton } from '@/components/ui/skeleton'

/**
 * Skeleton loading state for the advancement content.
 * Matches the layout of UnitAdvancementContent to prevent layout shift.
 */
export function AdvancementContentSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats Row Skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          'from-emerald-50 to-green-50',
          'from-amber-50 to-orange-50',
          'from-blue-50 to-indigo-50',
          'from-rose-50 to-red-50',
        ].map((gradient, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-lg border bg-gradient-to-br ${gradient} p-3`}
          >
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-6 w-12 mb-1" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>

      {/* Tabs Skeleton */}
      <div className="space-y-4">
        {/* Tab List */}
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
          <Skeleton className="h-9 flex-1 rounded-md" />
          <Skeleton className="h-9 flex-1 rounded-md" />
          <Skeleton className="h-9 flex-1 rounded-md" />
        </div>

        {/* Tab Content - Rank Browser Skeleton */}
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          {/* Rank Trail */}
          <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-12 rounded-full flex-shrink-0" />
            ))}
          </div>

          {/* Requirements List */}
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
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
        </div>
      </div>
    </div>
  )
}
