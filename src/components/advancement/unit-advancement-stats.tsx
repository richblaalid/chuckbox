'use client'

import { Star, Award, Clock, Medal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UnitAdvancementStatsProps {
  rankProgressPercent: number
  scoutsWorkingOnRanks: number
  meritBadgesInProgress: number
  meritBadgesEarned: number
  pendingApprovalsCount: number
}

export function UnitAdvancementStats({
  rankProgressPercent,
  scoutsWorkingOnRanks,
  meritBadgesInProgress,
  meritBadgesEarned,
  pendingApprovalsCount,
}: UnitAdvancementStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* Rank Progress */}
      <div className="flex items-center gap-3 rounded-lg border bg-gradient-to-br from-emerald-50 to-green-50 p-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
          <Star className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <p className="text-xl font-bold text-emerald-900">{rankProgressPercent}%</p>
          <p className="text-xs text-emerald-700">
            {scoutsWorkingOnRanks} scouts on ranks
          </p>
        </div>
      </div>

      {/* Merit Badges */}
      <div className="flex items-center gap-3 rounded-lg border bg-gradient-to-br from-amber-50 to-orange-50 p-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
          <Medal className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <p className="text-xl font-bold text-amber-900">{meritBadgesInProgress}</p>
          <p className="text-xs text-amber-700">{meritBadgesEarned} earned</p>
        </div>
      </div>

      {/* Eagle Required (placeholder for now) */}
      <div className="flex items-center gap-3 rounded-lg border bg-gradient-to-br from-blue-50 to-indigo-50 p-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
          <Award className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <p className="text-xl font-bold text-blue-900">—</p>
          <p className="text-xs text-blue-700">Eagle Required</p>
        </div>
      </div>

      {/* Pending Approvals - Display only (approvals handled inline in Summary) */}
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border bg-gradient-to-br from-rose-50 to-red-50 p-3',
          pendingApprovalsCount === 0 && 'opacity-75'
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100">
          <Clock className="h-5 w-5 text-rose-600" />
        </div>
        <div>
          <p className="text-xl font-bold text-rose-900">{pendingApprovalsCount}</p>
          <p className="text-xs text-rose-700">Pending Approvals</p>
        </div>
      </div>
    </div>
  )
}
