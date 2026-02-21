'use client'

import { useState, useMemo, useTransition } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MeritBadgeIcon } from './merit-badge-icon'
import { HierarchicalRequirementsList } from './hierarchical-requirements-list'
import { ScoutSelectionDialog } from './scout-selection-dialog'
import { MultiSelectActionBar } from './multi-select-action-bar'
import { cn } from '@/lib/utils'
import { ArrowLeft, Award, Star, Loader2 } from 'lucide-react'
import { VersionYearBadge } from '@/components/ui/version-year-badge'
import { bulkSignOffForScouts } from '@/app/actions/advancement'
import { useRouter } from 'next/navigation'
import { PamphletLink } from './pamphlet-link'
import type { BsaMeritBadge, BsaMeritBadgeRequirement } from '@/types/advancement'


interface RequirementProgress {
  id: string
  requirement_id: string
  status: string
}

interface BadgeProgress {
  id: string
  merit_badge_id: string
  status: string
  scout_merit_badge_requirement_progress: RequirementProgress[]
}

interface Scout {
  id: string
  first_name: string
  last_name: string
  is_active: boolean | null
  scout_merit_badge_progress: BadgeProgress[]
}

interface UnitMeritBadgePanelProps {
  badge: BsaMeritBadge
  requirements: BsaMeritBadgeRequirement[]
  scouts: Scout[]
  unitId: string
  canEdit: boolean
  isLoading?: boolean
  onBack: () => void
  currentUserName?: string
  /** Called when data changes (e.g., after sign-offs) to trigger a refresh */
  onDataChange?: () => void
}

/**
 * UnitMeritBadgePanel - Unit-wide view for signing off merit badge requirements across multiple scouts.
 * Used in the /advancement page to allow leaders to sign off requirements for selected scouts.
 */
export function UnitMeritBadgePanel({
  badge,
  requirements,
  scouts,
  unitId,
  canEdit,
  isLoading = false,
  onBack,
  currentUserName = 'Leader',
  onDataChange,
}: UnitMeritBadgePanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Multi-select state (always enabled for better UX)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [scoutSelectionOpen, setScoutSelectionOpen] = useState(false)

  // Transform requirements to the format expected by HierarchicalRequirementsList
  // For unit-wide view, there's no scout-specific progress, so all start as 'not_started'
  const formattedRequirements = useMemo(() => {
    return requirements
      .sort((a, b) => a.display_order - b.display_order)
      .map(req => ({
        id: req.id,
        requirementProgressId: null, // No scout-specific progress in unit view
        requirementNumber: req.requirement_number,
        description: req.description,
        status: 'not_started' as const,
        completedAt: null,
        completedBy: null,
        notes: null,
        approvalStatus: null,
        parentRequirementId: req.parent_requirement_id,
        isAlternative: req.is_alternative,
        alternativesGroup: req.alternatives_group,
        nestingDepth: req.nesting_depth,
        requiredCount: req.required_count,
        isHeader: req.is_header,
        resources: req.bsa_requirement_resources || null,
      }))
  }, [requirements])

  // Build maps for scout completion status
  const { scoutsWithAllComplete, scoutCompletedRequirements } = useMemo(() => {
    const completedMap = new Map<string, Set<string>>()
    const allCompleteSet = new Set<string>()
    // Convert Set to Array once, outside the loop (O(n) instead of O(n²))
    const selectedReqArray = Array.from(selectedIds)

    scouts.forEach(scout => {
      const progress = scout.scout_merit_badge_progress.find(
        p => p.merit_badge_id === badge.id
      )
      const completedReqs = new Set<string>()

      if (progress) {
        progress.scout_merit_badge_requirement_progress.forEach(rp => {
          if (['completed', 'approved', 'awarded'].includes(rp.status)) {
            completedReqs.add(rp.requirement_id)
          }
        })
      }

      completedMap.set(scout.id, completedReqs)

      // Check if this scout has ALL selected requirements completed
      if (selectedReqArray.length > 0) {
        const hasAll = selectedReqArray.every(reqId => completedReqs.has(reqId))
        if (hasAll) {
          allCompleteSet.add(scout.id)
        }
      }
    })

    return {
      scoutsWithAllComplete: allCompleteSet,
      scoutCompletedRequirements: completedMap,
    }
  }, [scouts, badge.id, selectedIds])

  // Selection handlers
  const handleSelectionChange = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    // Select all requirements
    setSelectedIds(new Set(requirements.map(r => r.id)))
  }

  const handleClearSelection = () => {
    setSelectedIds(new Set())
  }

  const handleSignOff = () => {
    setScoutSelectionOpen(true)
  }

  const handleConfirmSignOff = async (scoutIds: string[], date: string) => {
    startTransition(async () => {
      const result = await bulkSignOffForScouts({
        type: 'merit-badge',
        requirementIds: Array.from(selectedIds),
        scoutIds,
        unitId,
        itemId: badge.id,
        date,
        completedBy: currentUserName,
      })

      if (result.success) {
        setScoutSelectionOpen(false)
        setSelectedIds(new Set())
        onDataChange?.() // Notify parent to refresh scout data
        router.refresh()
      }
    })
  }

  // Selected requirements for dialog
  const selectedRequirements = useMemo(() => {
    return requirements
      .filter(r => selectedIds.has(r.id))
      .map(r => ({
        id: r.id,
        requirementNumber: r.requirement_number,
        description: r.description,
      }))
  }, [requirements, selectedIds])

  const totalRequirements = requirements.length

  return (
    <div className="space-y-4">
      {/* Back navigation - prominent, above the card */}
      <button
        onClick={onBack}
        className="group flex items-center gap-2 text-sm font-semibold text-stone-700 hover:text-forest-700 transition-colors"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-100 group-hover:bg-forest-100 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </span>
        Back to All Badges
      </button>

      <Card className={cn(
        'overflow-hidden',
        badge.is_eagle_required && 'border-amber-200'
      )}>
        {/* Header */}
        <CardHeader className={cn(
          'pb-4',
          badge.is_eagle_required && 'bg-gradient-to-r from-amber-50/80 to-yellow-50/50'
        )}>
          <div className="flex items-start gap-4">
            <MeritBadgeIcon
              badge={badge}
              size="xl"
            />
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-stone-900">{badge.name}</h2>
                {badge.is_eagle_required && (
                  <Badge className="border-0 bg-amber-100 text-amber-700">
                    <Star className="mr-1 h-3 w-3 fill-amber-500" />
                    Eagle Required
                  </Badge>
                )}
                <VersionYearBadge year={badge.requirement_version_year} />
              </div>
              {badge.category && (
                <p className="mt-1 text-sm text-stone-500">{badge.category}</p>
              )}
              <p className="mt-2 text-sm text-stone-600">
                {totalRequirements} requirements • Select to sign off for scouts
              </p>
              <PamphletLink url={badge.pamphlet_url} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
              <span className="ml-2 text-stone-500">Loading requirements...</span>
            </div>
          ) : formattedRequirements.length > 0 ? (
            <HierarchicalRequirementsList
              requirements={formattedRequirements}
              unitId={unitId}
              canEdit={false} // Unit view doesn't edit individual requirements
              defaultCollapseCompleted={false}
              isMeritBadge={true}
              isMultiSelectMode={canEdit}
              selectedIds={selectedIds}
              onSelectionChange={handleSelectionChange}
            />
          ) : (
            <div className="py-12 text-center">
              <Award className="mx-auto h-12 w-12 text-stone-300" />
              <p className="mt-2 text-stone-500">No requirements found for this badge</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Multi-select action bar - shows when items are selected */}
      <MultiSelectActionBar
        selectedCount={selectedIds.size}
        totalSelectableCount={requirements.length}
        onSelectAll={handleSelectAll}
        onClear={handleClearSelection}
        onSignOff={handleSignOff}
        visible={selectedIds.size > 0}
      />

      {/* Scout selection dialog */}
      <ScoutSelectionDialog
        open={scoutSelectionOpen}
        onOpenChange={setScoutSelectionOpen}
        title={badge.name}
        type="merit-badge"
        scouts={scouts}
        selectedRequirements={selectedRequirements}
        scoutsWithAllComplete={scoutsWithAllComplete}
        scoutCompletedRequirements={scoutCompletedRequirements}
        onConfirm={handleConfirmSignOff}
        isLoading={isPending}
      />
    </div>
  )
}
