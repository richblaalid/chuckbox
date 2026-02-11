'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  ChevronRight,
  Sparkles,
  Check,
  Loader2,
  ArrowRight,
} from 'lucide-react'
import { markRequirementComplete } from '@/app/actions/advancement'
import type { RankProgress } from '@/types/advancement'

interface WhatsNextCardProps {
  rankProgress: RankProgress[]
  scoutId: string
  unitId: string
  canEdit: boolean
  onViewRank?: (rankId: string) => void
}

interface NextRequirement {
  id: string
  requirementProgressId: string
  requirementNumber: string
  description: string
  rankName: string
  rankId: string
}

// Helper to compare alphanumeric requirement numbers (e.g., "2a" < "2b" < "3" < "10a")
function compareRequirementNumbers(a: string, b: string): number {
  const parseReq = (s: string) => {
    const match = s.match(/^(\d+)([a-z]*)$/i)
    if (!match) return { num: 0, suffix: s }
    return { num: parseInt(match[1], 10), suffix: match[2].toLowerCase() }
  }
  const parsedA = parseReq(a)
  const parsedB = parseReq(b)
  if (parsedA.num !== parsedB.num) return parsedA.num - parsedB.num
  return parsedA.suffix.localeCompare(parsedB.suffix)
}

function getNextRequirements(rankProgress: RankProgress[], limit: number = 5): NextRequirement[] {
  const items: NextRequirement[] = []

  // Find the current in-progress rank
  const currentRank = rankProgress.find(r => r.status === 'in_progress')
  if (!currentRank) return items

  // Get incomplete requirements, sorted by requirement number
  const sortedReqs = [...currentRank.scout_rank_requirement_progress].sort((a, b) => {
    const numA = a.bsa_rank_requirements?.requirement_number || '0'
    const numB = b.bsa_rank_requirements?.requirement_number || '0'
    return compareRequirementNumbers(numA, numB)
  })

  for (const req of sortedReqs) {
    if (!req.bsa_rank_requirements) continue
    const isComplete = ['completed', 'approved', 'awarded'].includes(req.status)
    if (!isComplete && items.length < limit) {
      items.push({
        id: req.bsa_rank_requirements.id,
        requirementProgressId: req.id,
        requirementNumber: req.bsa_rank_requirements.requirement_number,
        description: req.bsa_rank_requirements.description,
        rankName: currentRank.bsa_ranks.name,
        rankId: currentRank.bsa_ranks.id,
      })
    }
  }

  return items
}

export function WhatsNextCard({
  rankProgress,
  scoutId,
  unitId,
  canEdit,
  onViewRank,
}: WhatsNextCardProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)

  const nextRequirements = getNextRequirements(rankProgress)
  const currentRank = rankProgress.find(r => r.status === 'in_progress')

  if (nextRequirements.length === 0) {
    // No requirements to show - either all done or no rank in progress
    if (!currentRank) {
      return null // Don't show the card if there's no rank in progress
    }

    // All requirements complete!
    return (
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50">
        <CardContent className="flex items-center gap-4 p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <Sparkles className="h-6 w-6 text-emerald-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-emerald-900">All Requirements Complete!</h3>
            <p className="text-sm text-emerald-700">
              Ready to submit {currentRank.bsa_ranks.name} for approval
            </p>
          </div>
          {canEdit && (
            <Button size="sm" variant="success">
              Submit for Approval
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  const handleQuickApprove = async (requirementProgressId: string) => {
    if (loadingId || !canEdit) return

    setLoadingId(requirementProgressId)
    try {
      const result = await markRequirementComplete(requirementProgressId, unitId)
      if (result.success) {
        setSuccessId(requirementProgressId)
        setTimeout(() => setSuccessId(null), 2000)
      }
    } catch (error) {
      console.error('Error approving requirement:', error)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Card className="overflow-hidden border-amber-200/60 bg-gradient-to-br from-amber-50/80 via-white to-orange-50/50">
      <CardHeader className="border-b border-amber-100/60 bg-amber-50/30 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shadow-sm">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold text-amber-900">
                What&apos;s Next
              </CardTitle>
              <p className="text-xs text-amber-700/80">
                {nextRequirements.length} requirements to go for {currentRank?.bsa_ranks.name}
              </p>
            </div>
          </div>
          {onViewRank && currentRank && (
            <Button
              variant="ghost"
              size="sm"
              className="text-amber-700 hover:bg-amber-100 hover:text-amber-900"
              onClick={() => onViewRank(currentRank.bsa_ranks.id)}
            >
              View All
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-amber-100/60">
          {nextRequirements.map((req, index) => {
            const isLoading = loadingId === req.requirementProgressId
            const isSuccess = successId === req.requirementProgressId

            return (
              <li
                key={req.requirementProgressId}
                className={cn(
                  'group flex items-start gap-3 p-4 transition-colors',
                  isSuccess ? 'bg-emerald-50' : 'hover:bg-amber-50/50',
                  index === 0 && 'bg-amber-50/40'
                )}
              >
                {/* Requirement number badge */}
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all',
                    isSuccess
                      ? 'bg-emerald-500 text-white'
                      : index === 0
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'bg-amber-100 text-amber-700'
                  )}
                >
                  {isSuccess ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    req.requirementNumber
                  )}
                </div>

                {/* Description */}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm leading-relaxed',
                      isSuccess
                        ? 'text-emerald-700 line-through'
                        : index === 0
                          ? 'font-medium text-stone-900'
                          : 'text-stone-700'
                    )}
                  >
                    {req.description.length > 120
                      ? `${req.description.slice(0, 120)}...`
                      : req.description}
                  </p>
                  {index === 0 && !isSuccess && (
                    <Badge
                      variant="outline"
                      className="mt-1.5 border-amber-300 bg-amber-50 text-[10px] font-medium text-amber-700"
                    >
                      Up Next
                    </Badge>
                  )}
                </div>

                {/* Quick approve button */}
                {canEdit && !isSuccess && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'shrink-0 opacity-0 transition-opacity group-hover:opacity-100',
                      index === 0 && 'opacity-100',
                      'text-amber-700 hover:bg-amber-100 hover:text-amber-900'
                    )}
                    onClick={() => handleQuickApprove(req.requirementProgressId)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        Approve
                      </>
                    )}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>

        {/* Footer with action hint */}
        {canEdit && nextRequirements.length > 1 && (
          <div className="border-t border-amber-100/60 bg-amber-50/20 px-4 py-2.5">
            <p className="flex items-center gap-1.5 text-xs text-amber-600">
              <ArrowRight className="h-3 w-3" />
              Hover over any requirement to quick approve
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
