'use client'

import { useState, useTransition } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { MeritBadgeIcon, getCategoryColors } from './merit-badge-icon'
import { BadgeRequirementAssignDialog } from './badge-requirement-assign-dialog'
import { StartMeritBadgeDialog } from './start-merit-badge-dialog'
import {
  Star,
  Users,
  UserPlus,
  CheckCircle,
  Circle,
  Clock,
  FileText,
  ExternalLink,
  Check,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { LinkifiedText } from '@/components/ui/linkified-text'

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

interface Requirement {
  id: string
  version_year: number | null
  merit_badge_id: string
  requirement_number: string
  parent_requirement_id: string | null
  sub_requirement_letter: string | null
  description: string
  display_order: number
  is_header?: boolean | null
}

interface RequirementProgress {
  id: string
  requirement_id: string
  status: string
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

interface MeritBadgeDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  badge: MeritBadge
  requirements: Requirement[]
  scouts: Scout[]
  unitId: string
  canEdit: boolean
  isLoading?: boolean
}

/**
 * Extract display label from requirement_number when sub_requirement_letter is null.
 * Handles bracket notation like "2d[1]" → "1" and parenthetical like "5a(1)" → "1"
 */
function getSubReqDisplayLabel(req: Requirement): string {
  // Use sub_requirement_letter if available
  if (req.sub_requirement_letter) {
    return req.sub_requirement_letter
  }

  const num = req.requirement_number

  // Check for bracket notation: "2d[1]" → "1"
  const bracketMatch = num.match(/\[(\d+)\]$/)
  if (bracketMatch) {
    return bracketMatch[1]
  }

  // Check for parenthetical: "5a(1)" → "1"
  const parenMatch = num.match(/\(([^)]+)\)$/)
  if (parenMatch) {
    return parenMatch[1]
  }

  // Check for simple letter suffix: "2d" → "d"
  const letterMatch = num.match(/\d+([a-z])$/i)
  if (letterMatch) {
    return letterMatch[1].toLowerCase()
  }

  // Fallback to full requirement number
  return num
}

export function MeritBadgeDetailSheet({
  open,
  onOpenChange,
  badge,
  requirements,
  scouts,
  unitId,
  canEdit,
  isLoading = false,
}: MeritBadgeDetailSheetProps) {
  const router = useRouter()
  const [selectedRequirement, setSelectedRequirement] = useState<Requirement | null>(null)
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false)
  const [isStartDialogOpen, setIsStartDialogOpen] = useState(false)

  const colors = getCategoryColors(badge.category)

  // Get scouts tracking this badge
  const scoutsTracking = scouts.filter((scout) =>
    scout.scout_merit_badge_progress.some(
      (p) => p.merit_badge_id === badge.id && ['in_progress', 'completed'].includes(p.status)
    )
  )

  // Get scouts who have earned this badge
  const scoutsEarned = scouts.filter((scout) =>
    scout.scout_merit_badge_progress.some(
      (p) => p.merit_badge_id === badge.id && p.status === 'awarded'
    )
  )

  // Get scouts who haven't started this badge
  const scoutsNotStarted = scouts.filter(
    (scout) =>
      !scout.scout_merit_badge_progress.some((p) => p.merit_badge_id === badge.id)
  )

  // Sort requirements
  const sortedRequirements = [...requirements].sort((a, b) => a.display_order - b.display_order)

  // Get completion stats for a requirement across all tracking scouts
  const getRequirementStats = (requirementId: string) => {
    let completed = 0
    scoutsTracking.forEach((scout) => {
      const badgeProgress = scout.scout_merit_badge_progress.find(
        (p) => p.merit_badge_id === badge.id
      )
      if (badgeProgress) {
        const reqProgress = badgeProgress.scout_merit_badge_requirement_progress.find(
          (rp) => rp.requirement_id === requirementId
        )
        if (reqProgress && ['completed', 'approved'].includes(reqProgress.status)) {
          completed++
        }
      }
    })
    return { completed, total: scoutsTracking.length }
  }

  const handleAssignClick = (requirement: Requirement) => {
    setSelectedRequirement(requirement)
    setIsAssignDialogOpen(true)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="text-left">
            {/* Badge Hero */}
            <div className="flex items-start gap-4">
              <MeritBadgeIcon badge={badge} size="xl" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-xl">{badge.name}</SheetTitle>
                  {badge.is_eagle_required && (
                    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                      <Star className="mr-1 h-3 w-3 fill-amber-500 text-amber-500" />
                      Eagle Required
                    </Badge>
                  )}
                </div>
                <SheetDescription className="mt-1">
                  <Badge variant="outline" className="text-xs">
                    {badge.category || 'General'}
                  </Badge>
                </SheetDescription>
              </div>
            </div>

            {/* Description */}
            {badge.description && (
              <p className="mt-4 text-sm text-stone-600"><LinkifiedText text={badge.description} /></p>
            )}

            {/* Pamphlet Link */}
            {badge.pamphlet_url && (
              <div className="mt-4">
                <a
                  href={badge.pamphlet_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-pine-200 bg-pine-50 px-3 py-2 text-sm font-medium text-pine-700 transition-colors hover:bg-pine-100"
                >
                  <FileText className="h-4 w-4" />
                  Download Merit Badge Pamphlet
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </SheetHeader>

          {/* Stats */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-blue-50 p-3 text-center">
              <div className="flex items-center justify-center gap-1">
                <Clock className="h-4 w-4 text-blue-600" />
                <span className="text-xl font-bold text-blue-900">
                  {scoutsTracking.length}
                </span>
              </div>
              <p className="text-xs text-blue-600">In Progress</p>
            </div>
            <div className="rounded-lg bg-green-50 p-3 text-center">
              <div className="flex items-center justify-center gap-1">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-xl font-bold text-green-900">
                  {scoutsEarned.length}
                </span>
              </div>
              <p className="text-xs text-green-600">Earned</p>
            </div>
            <div className="rounded-lg bg-stone-50 p-3 text-center">
              <div className="flex items-center justify-center gap-1">
                <Users className="h-4 w-4 text-stone-600" />
                <span className="text-xl font-bold text-stone-900">
                  {sortedRequirements.filter((r) => !r.sub_requirement_letter).length}
                </span>
              </div>
              <p className="text-xs text-stone-600">Requirements</p>
            </div>
          </div>

          {/* Scouts Tracking */}
          {scoutsTracking.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold text-stone-900">
                Scouts Tracking ({scoutsTracking.length})
              </h3>
              <div className="space-y-2">
                {scoutsTracking.map((scout) => {
                  const progress = scout.scout_merit_badge_progress.find(
                    (p) => p.merit_badge_id === badge.id
                  )
                  // Count main requirements (no sub_requirement_letter)
                  const mainReqs = sortedRequirements.filter((r) => !r.sub_requirement_letter)
                  const mainReqIds = new Set(mainReqs.map((r) => r.id))
                  const reqsCompleted =
                    progress?.scout_merit_badge_requirement_progress.filter(
                      (rp) =>
                        ['completed', 'approved'].includes(rp.status) &&
                        mainReqIds.has(rp.requirement_id)
                    ).length || 0
                  const totalReqs = mainReqs.length
                  const percent = totalReqs > 0 ? Math.round((reqsCompleted / totalReqs) * 100) : 0

                  return (
                    <div
                      key={scout.id}
                      className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-stone-900">
                          {scout.first_name} {scout.last_name}
                        </p>
                        {progress?.counselor_name && (
                          <p className="text-xs text-stone-500">
                            Counselor: {progress.counselor_name}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-stone-900">
                          {reqsCompleted}/{totalReqs}
                        </p>
                        <Progress value={percent} className="mt-1 h-1.5 w-16" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Start Tracking Button */}
          {canEdit && scoutsNotStarted.length > 0 && (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsStartDialogOpen(true)}
                className="w-full"
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Start Tracking for Scout
              </Button>
            </div>
          )}

          {/* Requirements */}
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-stone-900">Requirements</h3>
            <div className="space-y-3">
              {/* Get main requirements (no sub_requirement_letter) */}
              {sortedRequirements
                .filter((req) => !req.sub_requirement_letter)
                .map((mainReq) => {
                  const stats = getRequirementStats(mainReq.id)
                  // Get sub-requirements for this main requirement
                  const subReqs = sortedRequirements.filter(
                    (req) =>
                      req.parent_requirement_id === mainReq.id ||
                      (req.requirement_number === mainReq.requirement_number &&
                        req.sub_requirement_letter)
                  )

                  return (
                    <div
                      key={mainReq.id}
                      className="rounded-lg border border-stone-200 bg-white"
                    >
                      {/* Main requirement header */}
                      <div className="flex items-start justify-between gap-2 p-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-forest-100 text-sm font-semibold text-forest-700">
                              {mainReq.requirement_number}
                            </span>
                            {stats.completed > 0 && stats.total > 0 && (
                              <span className="text-xs text-stone-400">
                                {stats.completed}/{stats.total} done
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-stone-900"><LinkifiedText text={mainReq.description} /></p>
                        </div>
                        {canEdit && scoutsTracking.length > 0 && subReqs.length === 0 && !mainReq.is_header && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAssignClick(mainReq)}
                            className="shrink-0 text-xs"
                          >
                            <Check className="mr-1 h-3 w-3" />
                            Sign Off
                          </Button>
                        )}
                      </div>

                      {/* Sub-requirements */}
                      {subReqs.length > 0 && (
                        <div className="border-t border-stone-100 bg-stone-50/50 px-3 py-2">
                          <div className="space-y-2 pl-4">
                            {subReqs.map((subReq) => {
                              const subStats = getRequirementStats(subReq.id)
                              return (
                                <div
                                  key={subReq.id}
                                  className="flex items-start justify-between gap-2 rounded-md bg-white p-2"
                                >
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-stone-100 text-xs font-medium text-stone-600">
                                        {getSubReqDisplayLabel(subReq)}
                                      </span>
                                      {subStats.completed > 0 && subStats.total > 0 && (
                                        <span className="text-xs text-stone-400">
                                          {subStats.completed}/{subStats.total}
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-1 text-xs text-stone-600">
                                      <LinkifiedText text={subReq.description} />
                                    </p>
                                  </div>
                                  {canEdit && scoutsTracking.length > 0 && !subReq.is_header && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleAssignClick(subReq)}
                                      className="h-6 shrink-0 px-2 text-xs"
                                    >
                                      <Check className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>

          {isLoading && (
            <div className="mt-6 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 text-center">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-stone-300 border-t-forest-600" />
              <p className="mt-2 text-sm text-stone-500">Loading requirements...</p>
            </div>
          )}

          {!isLoading && sortedRequirements.length === 0 && (
            <div className="mt-6 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 text-center">
              <p className="text-sm text-stone-500">
                No requirements found for this badge
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Assign Requirement Dialog */}
      {selectedRequirement && (
        <BadgeRequirementAssignDialog
          open={isAssignDialogOpen}
          onOpenChange={setIsAssignDialogOpen}
          requirement={selectedRequirement}
          badge={badge}
          allScouts={scouts}
          unitId={unitId}
        />
      )}

      {/* Start Tracking Dialog */}
      <StartMeritBadgeDialog
        open={isStartDialogOpen}
        onOpenChange={setIsStartDialogOpen}
        badge={badge}
        scoutsNotStarted={scoutsNotStarted}
        unitId={unitId}
      />
    </>
  )
}
