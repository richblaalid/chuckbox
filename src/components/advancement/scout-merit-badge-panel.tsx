'use client'

import { useMemo, useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MeritBadgeIcon } from './merit-badge-icon'
import { HierarchicalRequirementsList } from './hierarchical-requirements-list'
import { MultiSelectActionBar } from './multi-select-action-bar'
import { BulkApprovalSheet } from './bulk-approval-sheet'
import { VersionSwitchDialog } from './version-switch-dialog'
import { cn } from '@/lib/utils'
import { ArrowLeft, Award, Calendar, Check, Star, User, Loader2, ChevronDown, History } from 'lucide-react'
import { VersionYearBadge } from '@/components/ui/version-year-badge'
import { getMeritBadgeRequirements, getMeritBadgeVersions } from '@/app/actions/advancement'
import type { AdvancementStatus, BsaMeritBadgeRequirement } from '@/types/advancement'

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

interface ScoutMeritBadgePanelProps {
  badge: MeritBadgeProgress
  scoutId: string
  unitId: string
  canEdit: boolean
  canSubmit?: boolean // Parents can submit requirements for approval
  onBack: () => void
  currentUserName?: string
}

/**
 * ScoutMeritBadgePanel - Individual scout's merit badge progress view.
 * Shows requirements with completion status for a single scout.
 * Used in the /scout profile page to track individual progress.
 */
export function ScoutMeritBadgePanel({
  badge,
  scoutId,
  unitId,
  canEdit,
  canSubmit = false,
  onBack,
  currentUserName = 'Leader',
}: ScoutMeritBadgePanelProps) {
  const router = useRouter()
  const [requirements, setRequirements] = useState<BsaMeritBadgeRequirement[]>([])
  const [isLoadingRequirements, setIsLoadingRequirements] = useState(true)
  const [isPending, startTransition] = useTransition()

  // Multi-select state (always enabled for better UX)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkApprovalOpen, setBulkApprovalOpen] = useState(false)

  // Version switching state
  const [availableVersions, setAvailableVersions] = useState<Array<{
    version_year: number
    is_current: boolean | null
    source: string | null
  }>>([])
  const [versionSwitchOpen, setVersionSwitchOpen] = useState(false)
  const [targetVersionYear, setTargetVersionYear] = useState<number | null>(null)

  // Fetch requirements on mount - use the scout's progress version year if available
  useEffect(() => {
    setIsLoadingRequirements(true)
    startTransition(async () => {
      try {
        // Pass the scout's progress version year to get the correct requirements
        const reqs = await getMeritBadgeRequirements(
          badge.bsa_merit_badges.id,
          badge.requirement_version_year ?? undefined
        )
        setRequirements(reqs as BsaMeritBadgeRequirement[])
      } catch (error) {
        console.error('Error fetching requirements:', error)
      } finally {
        setIsLoadingRequirements(false)
      }
    })
  }, [badge.bsa_merit_badges.id, badge.requirement_version_year])

  // Fetch available versions
  useEffect(() => {
    startTransition(async () => {
      try {
        const result = await getMeritBadgeVersions(badge.bsa_merit_badges.id)
        if (result.success && result.data) {
          setAvailableVersions(result.data.versions)
        }
      } catch (error) {
        console.error('Error fetching versions:', error)
      }
    })
  }, [badge.bsa_merit_badges.id])

  // Check if scout is on an older (non-current) version
  const isOnOlderVersion = useMemo(() => {
    if (!badge.requirement_version_year || availableVersions.length === 0) return false
    const currentVersion = availableVersions.find(v => v.is_current)
    return currentVersion && currentVersion.version_year !== badge.requirement_version_year
  }, [badge.requirement_version_year, availableVersions])

  // Build progress map for quick lookup - keyed by requirement_number for cross-version matching
  const progressMap = useMemo(() => {
    const map = new Map<string, {
      id: string
      status: string
      completed_at: string | null
      completed_by: string | null
      notes: string | null
      approval_status: string | null
    }>()

    badge.scout_merit_badge_requirement_progress.forEach(p => {
      // Key by requirement_number (stable across versions) rather than requirement_id (version-specific UUIDs)
      const reqNumber = p.bsa_merit_badge_requirements?.requirement_number
      if (reqNumber) {
        map.set(reqNumber, {
          id: p.id,
          status: p.status,
          completed_at: p.completed_at,
          completed_by: p.completed_by || null,
          notes: p.notes || null,
          approval_status: p.approval_status || null,
        })
      }
    })
    return map
  }, [badge.scout_merit_badge_requirement_progress])

  // Helper to compare alphanumeric requirement numbers (e.g., "2a" < "2b" < "3" < "10a")
  const compareRequirementNumbers = (a: string, b: string): number => {
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

  // Format requirements for HierarchicalRequirementsList
  // Pass ALL requirements (including sub-requirements) - the component handles hierarchy via requirement number parsing
  const formattedRequirements = useMemo(() => {
    return requirements
      .sort((a, b) => {
        const numA = a.requirement_number || '0'
        const numB = b.requirement_number || '0'
        return compareRequirementNumbers(numA, numB)
      })
      .map(req => {
        // Look up progress by requirement_number (stable across versions)
        const progress = progressMap.get(req.requirement_number)
        return {
          id: req.id,
          requirementProgressId: progress?.id || null,
          requirementNumber: req.requirement_number,
          description: req.description,
          status: (progress?.status || 'not_started') as AdvancementStatus,
          completedAt: progress?.completed_at || null,
          completedBy: progress?.completed_by || null,
          notes: progress?.notes || null,
          approvalStatus: progress?.approval_status || null,
          parentRequirementId: req.parent_requirement_id,
          isAlternative: req.is_alternative,
          alternativesGroup: req.alternatives_group,
          nestingDepth: req.nesting_depth,
          requiredCount: req.required_count,
          isHeader: req.is_header,
          resources: req.bsa_requirement_resources || null,
        }
      })
  }, [requirements, progressMap])

  // Calculate progress stats and multi-select helpers in single pass (memoized)
  // Only count completable requirements (exclude headers which are just grouping containers)
  const { completedCount, totalCount, progressPercent, incompleteRequirements, incompleteIds } = useMemo(() => {
    const completable = formattedRequirements.filter(r => !r.isHeader)
    const completed = completable.filter(
      r => ['completed', 'approved'].includes(r.status)
    ).length
    const total = completable.length
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0
    const incomplete = completable.filter(
      r => !['completed', 'approved', 'awarded'].includes(r.status)
    )
    const incompleteSet = new Set(incomplete.map(r => r.id))

    return {
      completedCount: completed,
      totalCount: total,
      progressPercent: percent,
      incompleteRequirements: incomplete,
      incompleteIds: incompleteSet,
    }
  }, [formattedRequirements])

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
    setSelectedIds(new Set(incompleteIds))
  }

  const handleClearSelection = () => {
    setSelectedIds(new Set())
  }

  const handleSignOff = () => {
    setBulkApprovalOpen(true)
  }

  const handleBulkApprovalComplete = () => {
    setBulkApprovalOpen(false)
    setSelectedIds(new Set())
    router.refresh()
  }

  const isAwarded = badge.status === 'awarded' || badge.status === 'approved'
  const isInProgress = badge.status === 'in_progress' || badge.status === 'completed'

  const statusConfig: Record<string, { bg: string; text: string; label: string; icon?: boolean }> = {
    not_started: { bg: 'bg-stone-100', text: 'text-stone-600', label: 'Not Started' },
    in_progress: { bg: 'bg-forest-100', text: 'text-forest-700', label: 'In Progress' },
    completed: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Completed' },
    approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Approved' },
    awarded: { bg: 'bg-gradient-to-r from-amber-100 to-yellow-100', text: 'text-amber-800', label: 'Awarded', icon: true },
  }

  const config = statusConfig[badge.status] || statusConfig.not_started

  // Init data for marking requirements on not-yet-started progress
  const initData = {
    scoutId,
    meritBadgeId: badge.bsa_merit_badges.id,
    meritBadgeProgressId: badge.id,
  }

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
        isAwarded && 'border-amber-200',
        isInProgress && 'border-forest-200'
      )}>
        {/* Header with badge info */}
        <CardHeader className={cn(
          'pb-4',
          isAwarded && 'bg-gradient-to-r from-amber-50/80 to-yellow-50/50',
          isInProgress && 'bg-gradient-to-r from-forest-50/80 to-emerald-50/50'
        )}>
          <div className="flex items-start gap-4">
          {/* Badge Icon */}
          <div className="relative shrink-0">
            <MeritBadgeIcon
              badge={{
                id: badge.bsa_merit_badges.id,
                code: badge.bsa_merit_badges.code,
                name: badge.bsa_merit_badges.name,
                category: badge.bsa_merit_badges.category,
                description: null,
                is_eagle_required: badge.bsa_merit_badges.is_eagle_required,
                is_active: true,
                image_url: badge.bsa_merit_badges.image_url ?? null,
                pamphlet_url: null,
              }}
              size="xl"
            />
            {isAwarded && (
              <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-amber-500 shadow-sm">
                <Check className="h-4 w-4 text-white" strokeWidth={3} />
              </div>
            )}
          </div>

          {/* Badge Info */}
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-stone-900">{badge.bsa_merit_badges.name}</h2>
              <Badge className={cn(config.bg, config.text, 'border-0')}>
                {config.icon && <Award className="mr-1 h-3 w-3" />}
                {config.label}
              </Badge>
              {/* Version badge with switch dropdown */}
              {canEdit && availableVersions.length > 1 && !isAwarded ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 py-0">
                      <VersionYearBadge year={badge.requirement_version_year} />
                      <ChevronDown className="h-3 w-3 text-stone-400" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel className="text-xs">
                      Switch Requirement Version
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {availableVersions.map((v) => (
                      <DropdownMenuItem
                        key={v.version_year}
                        disabled={v.version_year === badge.requirement_version_year}
                        onClick={() => {
                          setTargetVersionYear(v.version_year)
                          setVersionSwitchOpen(true)
                        }}
                      >
                        <History className="mr-2 h-4 w-4" />
                        {v.version_year}
                        {v.is_current && (
                          <span className="ml-2 text-xs text-forest-600">(Current)</span>
                        )}
                        {v.version_year === badge.requirement_version_year && (
                          <Check className="ml-auto h-4 w-4 text-forest-600" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <VersionYearBadge year={badge.requirement_version_year} />
              )}
            </div>

            {/* Older version warning */}
            {isOnOlderVersion && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm">
                <History className="h-4 w-4 text-amber-500" />
                <span className="text-amber-700">
                  Working on older requirements version. Consider updating to the current version.
                </span>
              </div>
            )}

            {/* Badge metadata */}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
              {badge.bsa_merit_badges.is_eagle_required && (
                <span className="flex items-center gap-1 text-amber-600">
                  <Star className="h-3 w-3 fill-amber-500" />
                  Eagle Required
                </span>
              )}
              {badge.bsa_merit_badges.category && (
                <span className="flex items-center gap-1">
                  <span className="text-stone-300">|</span>
                  {badge.bsa_merit_badges.category}
                </span>
              )}
              {badge.counselor_name && (
                <span className="flex items-center gap-1">
                  <span className="text-stone-300">|</span>
                  <User className="h-3 w-3" />
                  {badge.counselor_name}
                </span>
              )}
            </div>

            {/* Progress Bar */}
            {!isAwarded && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-stone-600">
                    {completedCount} of {totalCount} requirements completed
                  </span>
                  <span className={cn(
                    'font-semibold',
                    isInProgress ? 'text-forest-600' : 'text-stone-600'
                  )}>
                    {progressPercent}%
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-stone-200">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      isInProgress
                        ? 'bg-gradient-to-r from-forest-500 to-forest-400'
                        : 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                    )}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Award Date */}
            {isAwarded && badge.awarded_at && (
              <div className="mt-2 flex items-center gap-1.5 text-sm text-amber-700">
                <Calendar className="h-4 w-4" />
                Awarded {new Date(badge.awarded_at).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Loading state */}
        {isLoadingRequirements ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
            <span className="ml-2 text-stone-500">Loading requirements...</span>
          </div>
        ) : formattedRequirements.length > 0 ? (
          <HierarchicalRequirementsList
            requirements={formattedRequirements}
            unitId={unitId}
            canEdit={canEdit}
            canSubmit={canSubmit}
            scoutId={scoutId}
            defaultCollapseCompleted={true}
            currentUserName={currentUserName}
            isMeritBadge={true}
            meritBadgeInitData={initData}
            isMultiSelectMode={canEdit && !isAwarded}
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

      {/* Multi-select action bar - shows when items are selected */}
      <MultiSelectActionBar
        selectedCount={selectedIds.size}
        totalSelectableCount={incompleteRequirements.length}
        onSelectAll={handleSelectAll}
        onClear={handleClearSelection}
        onSignOff={handleSignOff}
        visible={selectedIds.size > 0}
      />

      {/* Bulk Approval Sheet */}
      <BulkApprovalSheet
        type="merit-badge"
        requirements={formattedRequirements}
        itemName={badge.bsa_merit_badges.name}
        unitId={unitId}
        scoutId={scoutId}
        open={bulkApprovalOpen}
        onOpenChange={setBulkApprovalOpen}
        preSelectedIds={selectedIds}
        onComplete={handleBulkApprovalComplete}
        meritBadgeInitData={{
          meritBadgeId: badge.bsa_merit_badges.id,
          meritBadgeProgressId: badge.id,
        }}
      />

      {/* Version Switch Dialog */}
      {targetVersionYear && (
        <VersionSwitchDialog
          open={versionSwitchOpen}
          onOpenChange={setVersionSwitchOpen}
          meritBadgeId={badge.bsa_merit_badges.id}
          meritBadgeName={badge.bsa_merit_badges.name}
          progressId={badge.id}
          scoutId={scoutId}
          unitId={unitId}
          currentVersionYear={badge.requirement_version_year || 0}
          targetVersionYear={targetVersionYear}
          currentProgress={badge.scout_merit_badge_requirement_progress}
          onComplete={() => {
            setVersionSwitchOpen(false)
            setTargetVersionYear(null)
            router.refresh()
          }}
        />
      )}
    </Card>
    </div>
  )
}
