'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { RankIcon } from './rank-icon'
import { HierarchicalRequirementsList } from './hierarchical-requirements-list'
import { BulkApprovalSheet } from './bulk-approval-sheet'
import { RankActionDialog } from './rank-action-dialog'
import { MultiSelectActionBar } from './multi-select-action-bar'
import { Award, Calendar, Check, PartyPopper, ShieldCheck, Loader2, AlertCircle } from 'lucide-react'
import { VersionYearBadge } from '@/components/ui/version-year-badge'
import { approveRank, awardRank } from '@/app/actions/advancement'
import { cn } from '@/lib/utils'
import type { AdvancementStatus } from '@/types/advancement'

interface RankProgress {
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
    requirement_version_year?: number | null
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
      parent_requirement_id: string | null
      is_alternative: boolean | null
      alternatives_group: string | null
    }
  }>
}

// Data for a rank that has no progress yet (from getRankRequirements)
interface RankRequirementsData {
  rank: {
    id: string
    code: string
    name: string
    display_order: number
    image_url: string | null
    requirement_version_year?: number | null
  }
  requirements: Array<{
    id: string
    requirement_number: string
    description: string
    parent_requirement_id: string | null
    is_alternative: boolean | null
    alternatives_group: string | null
    version_year: number | null
  }>
}

interface ScoutRankPanelProps {
  rank: RankProgress | null
  scoutId: string
  unitId: string
  canEdit: boolean
  canSubmit?: boolean // Parents can submit requirements for approval
  rankName?: string // Fallback if no rank data
  // Current user name for completion dialogs
  currentUserName?: string
  // Optional: requirements data for ranks with no progress
  rankRequirementsData?: RankRequirementsData | null
  // Loading state when fetching requirements
  isLoading?: boolean
}

/**
 * ScoutRankPanel - Individual scout's rank progress view.
 * Shows requirements with completion status for a single scout.
 * Used in the /scout profile page to track individual progress.
 */
export function ScoutRankPanel({
  rank,
  scoutId,
  unitId,
  canEdit,
  canSubmit = false,
  rankName,
  currentUserName,
  rankRequirementsData,
  isLoading = false,
}: ScoutRankPanelProps) {
  const router = useRouter()
  const [approveDialogOpen, setApproveDialogOpen] = useState(false)
  const [awardDialogOpen, setAwardDialogOpen] = useState(false)

  // Multi-select state (always enabled for better UX)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkApprovalOpen, setBulkApprovalOpen] = useState(false)

  // Helper to compare alphanumeric requirement numbers (e.g., "2a" < "2b" < "3" < "10a")
  const compareRequirementNumbers = (a: string, b: string): number => {
    // Extract numeric prefix and letter suffix
    const parseReq = (s: string) => {
      const match = s.match(/^(\d+)([a-z]*)$/i)
      if (!match) return { num: 0, suffix: s }
      return { num: parseInt(match[1], 10), suffix: match[2].toLowerCase() }
    }
    const parsedA = parseReq(a)
    const parsedB = parseReq(b)

    // Compare numeric part first
    if (parsedA.num !== parsedB.num) {
      return parsedA.num - parsedB.num
    }
    // Then compare suffix alphabetically
    return parsedA.suffix.localeCompare(parsedB.suffix)
  }

  // Sort requirements by number - handle both progress data and raw requirements
  const sortedRequirements = useMemo(() => {
    if (rank) {
      // Has progress data
      return [...rank.scout_rank_requirement_progress].sort((a, b) => {
        const numA = a.bsa_rank_requirements?.requirement_number || '0'
        const numB = b.bsa_rank_requirements?.requirement_number || '0'
        return compareRequirementNumbers(numA, numB)
      })
    }
    return []
  }, [rank])

  // Sort raw requirements for unstarted ranks
  const sortedRawRequirements = useMemo(() => {
    if (!rank && rankRequirementsData) {
      return [...rankRequirementsData.requirements].sort((a, b) => {
        return compareRequirementNumbers(a.requirement_number || '0', b.requirement_number || '0')
      })
    }
    return []
  }, [rank, rankRequirementsData])

  // Determine which data source we're using
  const hasProgressData = rank !== null
  const hasRawRequirements = !hasProgressData && rankRequirementsData !== null

  // Calculate completion stats - ranks don't have headers so all requirements are completable
  const completedCount = sortedRequirements.filter(
    (r) => r.status === 'completed' || r.status === 'approved' || r.status === 'awarded'
  ).length
  const totalCount = hasProgressData ? sortedRequirements.length : sortedRawRequirements.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const incompleteCount = totalCount - completedCount

  const statusConfig: Record<string, { bg: string; text: string; label: string; icon?: boolean }> = {
    not_started: { bg: 'bg-stone-100', text: 'text-stone-600', label: 'Not Started' },
    in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Progress' },
    completed: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Completed' },
    approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Approved' },
    awarded: { bg: 'bg-gradient-to-r from-amber-100 to-yellow-100', text: 'text-amber-800', label: 'Awarded', icon: true },
  }

  const config = rank ? (statusConfig[rank.status] || statusConfig.not_started) : statusConfig.not_started
  const isAwarded = rank?.status === 'awarded'
  const isInProgress = rank?.status === 'in_progress'

  // Requirements formatted for bulk approval (only for progress data)
  const bulkRequirements = sortedRequirements.map(req => ({
    id: req.bsa_rank_requirements.id,
    requirementProgressId: req.id,
    requirementNumber: req.bsa_rank_requirements.requirement_number,
    description: req.bsa_rank_requirements.description,
    status: req.status as AdvancementStatus,
  }))

  // Multi-select helpers - compute from source data (not formattedRequirements which is defined later)
  const incompleteRequirementIds = useMemo(() => {
    if (hasProgressData) {
      return new Set(
        sortedRequirements
          .filter(r => !['completed', 'approved', 'awarded'].includes(r.status))
          .map(r => r.bsa_rank_requirements.id)
      )
    } else {
      // All raw requirements are not started (incomplete)
      return new Set(sortedRawRequirements.map(r => r.id))
    }
  }, [sortedRequirements, sortedRawRequirements, hasProgressData])

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
    setSelectedIds(new Set(incompleteRequirementIds))
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

  // Init data for creating progress when marking requirements complete on unstarted ranks
  const initData = hasRawRequirements && rankRequirementsData ? {
    scoutId,
    rankId: rankRequirementsData.rank.id,
  } : undefined

  // Show loading state while fetching requirements
  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-forest-500" />
          <p className="mt-4 text-stone-500">
            Loading requirements for {rankName || 'rank'}...
          </p>
        </CardContent>
      </Card>
    )
  }

  // If no data at all (fetch failed or no rank selected), show appropriate state
  if (!hasProgressData && !hasRawRequirements) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
            <AlertCircle className="h-8 w-8 text-amber-500" />
          </div>
          <p className="font-medium text-stone-700">
            {rankName ? `Unable to load requirements for ${rankName}` : 'Select a rank to view requirements'}
          </p>
          <p className="mt-1 text-sm text-stone-500">
            {rankName ? 'Please try refreshing the page or contact support if the issue persists.' : ''}
          </p>
        </CardContent>
      </Card>
    )
  }

  // Get rank display data
  const rankData = hasProgressData && rank ? {
    code: rank.bsa_ranks.code,
    name: rank.bsa_ranks.name,
    image_url: rank.bsa_ranks.image_url,
    requirement_version_year: rank.bsa_ranks.requirement_version_year,
  } : hasRawRequirements && rankRequirementsData ? {
    code: rankRequirementsData.rank.code,
    name: rankRequirementsData.rank.name,
    image_url: rankRequirementsData.rank.image_url,
    requirement_version_year: rankRequirementsData.rank.requirement_version_year,
  } : null

  if (!rankData) return null

  // Format requirements for HierarchicalRequirementsList
  const formattedRequirements = hasProgressData
    ? sortedRequirements.map(req => ({
        id: req.bsa_rank_requirements.id,
        requirementProgressId: req.id,
        requirementNumber: req.bsa_rank_requirements.requirement_number,
        description: req.bsa_rank_requirements.description,
        status: req.status as AdvancementStatus,
        completedAt: req.completed_at,
        completedBy: req.completed_by,
        notes: req.notes,
        approvalStatus: req.approval_status,
        // Hierarchy fields for proper nesting
        parentRequirementId: req.bsa_rank_requirements.parent_requirement_id,
        isAlternative: req.bsa_rank_requirements.is_alternative,
        alternativesGroup: req.bsa_rank_requirements.alternatives_group,
      }))
    : sortedRawRequirements.map(req => ({
        id: req.id,
        requirementProgressId: null, // No progress yet
        requirementNumber: req.requirement_number,
        description: req.description,
        status: 'not_started' as AdvancementStatus,
        completedAt: null,
        completedBy: null,
        notes: null,
        approvalStatus: null,
        // Hierarchy fields for proper nesting
        parentRequirementId: req.parent_requirement_id,
        isAlternative: req.is_alternative,
        alternativesGroup: req.alternatives_group,
      }))

  return (
    <Card className={cn(
      'overflow-hidden',
      isAwarded && 'border-amber-200',
      isInProgress && 'border-blue-200'
    )}>
      {/* Header with rank info */}
      <CardHeader className={cn(
        'pb-4',
        isAwarded && 'bg-gradient-to-r from-amber-50/80 to-yellow-50/50',
        isInProgress && 'bg-gradient-to-r from-blue-50/80 to-indigo-50/50'
      )}>
        <div className="flex items-start gap-4">
          {/* Rank Badge */}
          <div className="relative shrink-0">
            <RankIcon
              rank={{
                code: rankData.code,
                name: rankData.name,
                image_url: rankData.image_url,
              }}
              size="xl"
            />
            {isAwarded && (
              <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-amber-500 shadow-sm">
                <Check className="h-4 w-4 text-white" strokeWidth={3} />
              </div>
            )}
          </div>

          {/* Rank Info */}
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-stone-900">{rankData.name}</h2>
              <Badge className={cn(config.bg, config.text, 'border-0')}>
                {config.icon && <Award className="mr-1 h-3 w-3" />}
                {config.label}
              </Badge>
              <VersionYearBadge year={rankData.requirement_version_year} />
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
                    isInProgress ? 'text-blue-600' : 'text-stone-600'
                  )}>
                    {progressPercent}%
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-stone-200">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      isInProgress
                        ? 'bg-gradient-to-r from-blue-500 to-blue-400'
                        : 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                    )}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Award Date */}
            {isAwarded && rank?.awarded_at && (
              <div className="mt-2 flex items-center gap-1.5 text-sm text-amber-700">
                <Calendar className="h-4 w-4" />
                Awarded {new Date(rank.awarded_at).toLocaleDateString('en-US', {
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
        {/* Approve/Award Actions - show prominently when requirements complete */}
        {canEdit && hasProgressData && rank && completedCount === totalCount && totalCount > 0 && (
          <div className="mb-4">
            {/* All requirements complete but not approved yet */}
            {rank.status === 'in_progress' && (
              <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-medium text-emerald-900">All requirements complete!</p>
                    <p className="text-sm text-emerald-700">Ready for leader approval</p>
                  </div>
                </div>
                <Button
                  onClick={() => setApproveDialogOpen(true)}
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Approve Rank
                </Button>
              </div>
            )}

            {/* Rank is approved but not awarded yet */}
            {rank.status === 'approved' && (
              <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                    <PartyPopper className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-amber-900">Rank approved!</p>
                    <p className="text-sm text-amber-700">Ready to award at Court of Honor</p>
                  </div>
                </div>
                <Button
                  onClick={() => setAwardDialogOpen(true)}
                  className="gap-2 bg-amber-600 hover:bg-amber-700"
                >
                  <Award className="h-4 w-4" />
                  Award Rank
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Requirements List */}
        <HierarchicalRequirementsList
          requirements={formattedRequirements}
          unitId={unitId}
          canEdit={canEdit}
          canSubmit={canSubmit}
          scoutId={scoutId}
          defaultCollapseCompleted={hasProgressData}
          currentUserName={currentUserName}
          initData={initData}
          isMultiSelectMode={canEdit && !isAwarded}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
        />

      </CardContent>

      {/* Approve Rank Dialog */}
      {hasProgressData && rank && (
        <RankActionDialog
          open={approveDialogOpen}
          onOpenChange={setApproveDialogOpen}
          actionType="approve"
          rankName={rankData.name}
          currentUserName={currentUserName || 'Unknown'}
          onConfirm={async (date) => {
            await approveRank(rank.id, unitId, date)
          }}
        />
      )}

      {/* Award Rank Dialog */}
      {hasProgressData && rank && (
        <RankActionDialog
          open={awardDialogOpen}
          onOpenChange={setAwardDialogOpen}
          actionType="award"
          rankName={rankData.name}
          currentUserName={currentUserName || 'Unknown'}
          onConfirm={async (date) => {
            await awardRank(rank.id, scoutId, unitId, date)
          }}
        />
      )}

      {/* Multi-select action bar - shows when items are selected */}
      <MultiSelectActionBar
        selectedCount={selectedIds.size}
        totalSelectableCount={incompleteRequirementIds.size}
        onSelectAll={handleSelectAll}
        onClear={handleClearSelection}
        onSignOff={handleSignOff}
        visible={selectedIds.size > 0}
      />

      {/* Bulk Approval Sheet - controlled mode for multi-select */}
      <BulkApprovalSheet
        type="rank"
        requirements={formattedRequirements}
        itemName={rankData.name}
        unitId={unitId}
        scoutId={scoutId}
        open={bulkApprovalOpen}
        onOpenChange={setBulkApprovalOpen}
        preSelectedIds={selectedIds}
        onComplete={handleBulkApprovalComplete}
        initData={hasRawRequirements && rankRequirementsData ? {
          rankId: rankRequirementsData.rank.id,
        } : undefined}
      />
    </Card>
  )
}
