'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  ChevronDown,
  ChevronRight,
  Check,
  CheckSquare,
  Calendar,
  Award,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { RankIcon } from './rank-icon'
import { HierarchicalRequirementsList } from './hierarchical-requirements-list'
import { BulkApprovalSheet } from './bulk-approval-sheet'
import type { AdvancementStatus } from '@/types/advancement'

interface RankProgressCardProps {
  rank: {
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
      }
    }>
  }
  scoutId: string
  unitId: string
  canEdit: boolean
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

export function RankProgressCard({ rank, scoutId, unitId, canEdit }: RankProgressCardProps) {
  const [isExpanded, setIsExpanded] = useState(rank.status === 'in_progress')

  // Sort requirements by number
  const sortedRequirements = useMemo(() => {
    return [...rank.scout_rank_requirement_progress].sort((a, b) => {
      const numA = a.bsa_rank_requirements?.requirement_number || '0'
      const numB = b.bsa_rank_requirements?.requirement_number || '0'
      return compareRequirementNumbers(numA, numB)
    })
  }, [rank.scout_rank_requirement_progress])

  const completedCount = sortedRequirements.filter(
    (r) => r.status === 'completed' || r.status === 'approved' || r.status === 'awarded'
  ).length
  const totalCount = sortedRequirements.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const incompleteCount = totalCount - completedCount

  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    not_started: { bg: 'bg-stone-100', text: 'text-stone-600', label: 'Not Started' },
    in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Progress' },
    completed: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Completed' },
    approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Approved' },
    awarded: { bg: 'bg-gradient-to-r from-amber-100 to-yellow-100', text: 'text-amber-800', label: 'Awarded' },
  }

  const config = statusConfig[rank.status] || statusConfig.not_started

  // Requirements formatted for bulk approval
  const bulkRequirements = sortedRequirements.map(req => ({
    id: req.bsa_rank_requirements.id,
    requirementProgressId: req.id,
    requirementNumber: req.bsa_rank_requirements.requirement_number,
    description: req.bsa_rank_requirements.description,
    status: req.status as AdvancementStatus,
  }))

  return (
    <Card
      className={cn(
        'overflow-hidden transition-all',
        rank.status === 'in_progress' && 'border-blue-200 shadow-sm shadow-blue-100',
        rank.status === 'awarded' && 'border-amber-200 shadow-sm shadow-amber-100'
      )}
    >
      <CardContent className="p-0">
        {/* Header */}
        <button
          className={cn(
            'flex w-full items-center justify-between p-4 text-left transition-colors',
            rank.status === 'in_progress' && 'bg-gradient-to-r from-blue-50/50 to-transparent',
            rank.status === 'awarded' && 'bg-gradient-to-r from-amber-50/50 to-transparent',
            'hover:bg-stone-50/50'
          )}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-4">
            {/* Expand/Collapse Icon */}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100">
              {isExpanded ? (
                <ChevronDown className="h-5 w-5 text-stone-500" />
              ) : (
                <ChevronRight className="h-5 w-5 text-stone-500" />
              )}
            </div>

            {/* Rank Badge - Larger */}
            <div className="relative">
              <RankIcon
                rank={{
                  code: rank.bsa_ranks.code,
                  name: rank.bsa_ranks.name,
                  image_url: rank.bsa_ranks.image_url,
                }}
                size="lg"
              />
              {rank.status === 'awarded' && (
                <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-amber-500 shadow-sm">
                  <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                </div>
              )}
            </div>

            {/* Rank Info */}
            <div>
              <h3 className="text-lg font-semibold text-stone-900">{rank.bsa_ranks.name}</h3>

              {/* Progress Bar for active ranks */}
              {rank.status !== 'not_started' && rank.status !== 'awarded' && (
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        rank.status === 'in_progress'
                          ? 'bg-gradient-to-r from-blue-500 to-blue-400'
                          : 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                      )}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="text-sm text-stone-500">
                    {completedCount}/{totalCount}
                  </span>
                </div>
              )}

              {/* Award Date for completed ranks */}
              {rank.awarded_at && (
                <div className="mt-1 flex items-center gap-1.5 text-sm text-amber-700">
                  <Calendar className="h-3.5 w-3.5" />
                  Awarded {new Date(rank.awarded_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>

          {/* Status Badge */}
          <Badge className={cn(config.bg, config.text, 'border-0')}>
            {rank.status === 'awarded' && <Award className="mr-1 h-3 w-3" />}
            {config.label}
          </Badge>
        </button>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="border-t bg-stone-50/30">
            {/* Toolbar for bulk actions */}
            {canEdit && incompleteCount > 0 && (
              <div className="flex items-center justify-between border-b bg-white/50 px-4 py-2">
                <span className="text-xs text-stone-500">
                  {incompleteCount} requirement{incompleteCount !== 1 ? 's' : ''} remaining
                </span>
                <BulkApprovalSheet
                  type="rank"
                  requirements={bulkRequirements}
                  itemName={rank.bsa_ranks.name}
                  unitId={unitId}
                  scoutId={scoutId}
                  trigger={
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                      <CheckSquare className="h-3.5 w-3.5" />
                      Bulk Approve
                    </Button>
                  }
                />
              </div>
            )}

            {/* Requirements List */}
            <div className="px-2 py-2">
              <HierarchicalRequirementsList
                requirements={sortedRequirements.map(req => ({
                  id: req.bsa_rank_requirements.id,
                  requirementProgressId: req.id,
                  requirementNumber: req.bsa_rank_requirements.requirement_number,
                  description: req.bsa_rank_requirements.description,
                  status: req.status as AdvancementStatus,
                  completedAt: req.completed_at,
                  completedBy: req.completed_by,
                  notes: req.notes,
                  approvalStatus: req.approval_status,
                }))}
                unitId={unitId}
                canEdit={canEdit}
              />
            </div>

            {/* Footer Actions */}
            {canEdit && rank.status === 'in_progress' && completedCount === totalCount && totalCount > 0 && (
              <div className="flex justify-end border-t bg-emerald-50/50 px-4 py-3">
                <Button size="sm" variant="success">
                  <Award className="mr-2 h-4 w-4" />
                  Submit for Approval
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
