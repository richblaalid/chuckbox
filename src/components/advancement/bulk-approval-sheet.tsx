'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  CheckSquare,
  Check,
  Calendar,
  Loader2,
  AlertCircle,
  Sparkles,
  ListChecks,
  ChevronRight,
} from 'lucide-react'
import {
  bulkApproveRequirements,
  bulkApproveRequirementsWithInit,
  bulkApproveMeritBadgeRequirements,
  bulkApproveMeritBadgeRequirementsWithInit,
} from '@/app/actions/advancement'
import type { AdvancementStatus } from '@/types/advancement'

interface Requirement {
  id: string
  requirementProgressId: string | null
  requirementNumber: string
  description: string
  status: AdvancementStatus
}

interface RankInitData {
  rankId: string
}

interface MeritBadgeInitData {
  meritBadgeId: string
  meritBadgeProgressId: string
}

interface BulkApprovalSheetProps {
  /** Type of requirements being approved */
  type: 'rank' | 'merit-badge'
  /** Requirements to display and select from */
  requirements: Requirement[]
  /** Display name (rank name or badge name) */
  itemName: string
  /** Unit ID for authorization */
  unitId: string
  /** Scout ID */
  scoutId: string
  /** Optional custom trigger element */
  trigger?: React.ReactNode
  /** Callback when approval completes successfully */
  onComplete?: () => void
  /** Init data for ranks without progress records (rank type only) */
  initData?: RankInitData
  /** Init data for merit badges (always needed for sub-requirements) */
  meritBadgeInitData?: MeritBadgeInitData
  /** Optional controlled open state */
  open?: boolean
  /** Optional callback for controlled open state */
  onOpenChange?: (open: boolean) => void
  /** Optional pre-selected requirement IDs */
  preSelectedIds?: Set<string>
}

export function BulkApprovalSheet({
  type,
  requirements,
  itemName,
  unitId,
  scoutId,
  trigger,
  onComplete,
  initData,
  meritBadgeInitData,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  preSelectedIds,
}: BulkApprovalSheetProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? (value: boolean) => controlledOnOpenChange?.(value) : setInternalOpen

  // Initialize with pre-selected IDs if provided
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    preSelectedIds ? new Set(preSelectedIds) : new Set()
  )
  const [completedDate, setCompletedDate] = useState(new Date().toISOString().split('T')[0])

  // Sync preSelectedIds to selectedIds when dialog opens (controlled mode)
  useEffect(() => {
    if (open && preSelectedIds && preSelectedIds.size > 0) {
      setSelectedIds(new Set(preSelectedIds))
    }
  }, [open, preSelectedIds])
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null)

  // Sort all requirements by number
  const sortedRequirements = useMemo(() => {
    return [...requirements].sort((a, b) => {
      const numA = parseFloat(a.requirementNumber || '0')
      const numB = parseFloat(b.requirementNumber || '0')
      return numA - numB
    })
  }, [requirements])

  // Filter to incomplete requirements only
  const incompleteRequirements = useMemo(() => {
    return sortedRequirements.filter(
      req => !['completed', 'approved', 'awarded'].includes(req.status)
    )
  }, [sortedRequirements])

  const completedCount = sortedRequirements.length - incompleteRequirements.length
  const progressPercent = sortedRequirements.length > 0
    ? Math.round((completedCount / sortedRequirements.length) * 100)
    : 0

  // Confirmation mode: when pre-selected IDs are provided, show read-only confirmation
  const isConfirmationMode = preSelectedIds && preSelectedIds.size > 0

  const allSelected = selectedIds.size === incompleteRequirements.length && incompleteRequirements.length > 0
  const someSelected = selectedIds.size > 0
  // Only ranks can have uninitialized progress records; merit badges always have them
  const needsInit = type === 'rank' && initData && incompleteRequirements.some(r => r.requirementProgressId === null)

  // Get the requirements that are selected (for confirmation mode display)
  const selectedRequirements = useMemo(() => {
    return incompleteRequirements
      .filter(req => selectedIds.has(req.id))
      .sort((a, b) => {
        const numA = parseFloat(a.requirementNumber || '0')
        const numB = parseFloat(b.requirementNumber || '0')
        return numA - numB
      })
  }, [incompleteRequirements, selectedIds])

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(incompleteRequirements.map(r => r.id)))
    }
  }

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return

    setIsSubmitting(true)
    setError(null)
    setResult(null)

    try {
      let response

      if (type === 'rank') {
        // Rank requirements
        if (needsInit && initData) {
          response = await bulkApproveRequirementsWithInit({
            scoutId,
            rankId: initData.rankId,
            requirementIds: Array.from(selectedIds),
            unitId,
            completedAt: `${completedDate}T12:00:00.000Z`,
            noteText: notes || undefined,
          })
        } else {
          const progressIds = incompleteRequirements
            .filter(r => selectedIds.has(r.id) && r.requirementProgressId)
            .map(r => r.requirementProgressId!)

          response = await bulkApproveRequirements(
            progressIds,
            unitId,
            `${completedDate}T12:00:00.000Z`,
            notes || undefined
          )
        }
      } else {
        // Merit badge requirements
        if (meritBadgeInitData) {
          // Use init function to create progress records for sub-requirements
          response = await bulkApproveMeritBadgeRequirementsWithInit({
            scoutId,
            meritBadgeId: meritBadgeInitData.meritBadgeId,
            meritBadgeProgressId: meritBadgeInitData.meritBadgeProgressId,
            requirementIds: Array.from(selectedIds),
            unitId,
            completedAt: `${completedDate}T12:00:00.000Z`,
            noteText: notes || undefined,
          })
        } else {
          // Fallback: only approve requirements that have progress records
          const progressIds = incompleteRequirements
            .filter(r => selectedIds.has(r.id) && r.requirementProgressId)
            .map(r => r.requirementProgressId!)

          response = await bulkApproveMeritBadgeRequirements(
            progressIds,
            unitId,
            `${completedDate}T12:00:00.000Z`,
            notes || undefined
          )
        }
      }

      if (response.success && response.data) {
        setResult({
          success: response.data.successCount,
          failed: response.data.failedCount,
        })

        if (response.data.failedCount === 0) {
          setTimeout(() => {
            setOpen(false)
            onComplete?.()
            setSelectedIds(new Set())
            setNotes('')
            setResult(null)
          }, 1500)
        }
      } else {
        setError(response.error || 'Failed to approve requirements')
      }
    } catch (err) {
      console.error('Error in bulk approval:', err)
      setError('An unexpected error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen && preSelectedIds) {
      // Re-apply pre-selected IDs when opening
      setSelectedIds(new Set(preSelectedIds))
    } else if (!isOpen) {
      setSelectedIds(new Set())
      setNotes('')
      setError(null)
      setResult(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Only render trigger when not in controlled mode or when trigger is explicitly provided */}
      {(!isControlled || trigger) && (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm" className="gap-2">
              <CheckSquare className="h-4 w-4" />
              Bulk Approve
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gradient-to-b from-forest-50/50 to-transparent">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-forest-100 text-forest-700">
              <ListChecks className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl font-semibold text-stone-900">
                {isConfirmationMode ? 'Confirm Approval' : 'Bulk Approve Requirements'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-stone-600">
                {isConfirmationMode ? (
                  <>
                    Approve {selectedIds.size} requirement{selectedIds.size !== 1 ? 's' : ''} for{' '}
                    <span className="font-medium text-forest-700">{itemName}</span>
                  </>
                ) : (
                  <>
                    Select and approve multiple requirements at once for{' '}
                    <span className="font-medium text-forest-700">{itemName}</span>
                  </>
                )}
              </DialogDescription>
            </div>
          </div>

          {/* Progress Overview - only shown in selection mode */}
          {!isConfirmationMode && (
            <div className="mt-4 rounded-lg border border-stone-200 bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-stone-700">Overall Progress</span>
                <span className="text-sm font-semibold text-forest-700">
                  {completedCount} / {sortedRequirements.length} complete
                </span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <p className="mt-2 text-xs text-stone-500">
                {incompleteRequirements.length} requirement{incompleteRequirements.length !== 1 ? 's' : ''} remaining
              </p>
            </div>
          )}
        </DialogHeader>

        {/* Success State */}
        {result && result.failed === 0 && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-forest-100 to-emerald-100 ring-4 ring-forest-50">
                <Sparkles className="h-8 w-8 text-forest-600" />
              </div>
              <h3 className="mt-4 text-xl font-semibold text-stone-900">
                Requirements Approved!
              </h3>
              <p className="mt-2 text-stone-600">
                Successfully approved {result.success} requirement{result.success !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Main Content */}
        {!result && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {/* Date & Notes Section */}
            <div className="px-6 py-4 border-b bg-stone-50/50">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="completion-date" className="flex items-center gap-2 text-sm font-medium text-stone-700">
                    <Calendar className="h-4 w-4 text-stone-500" />
                    Completion Date
                  </Label>
                  <Input
                    id="completion-date"
                    type="date"
                    value={completedDate}
                    onChange={(e) => setCompletedDate(e.target.value)}
                    className="bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes" className="text-sm font-medium text-stone-700">
                    Notes <span className="font-normal text-stone-400">(optional)</span>
                  </Label>
                  <Textarea
                    id="notes"
                    placeholder="Add notes for these requirements..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={1}
                    className="resize-none bg-white min-h-[38px]"
                  />
                </div>
              </div>
            </div>

            {/* Requirements List */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0 px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-stone-700">
                  {isConfirmationMode ? 'Requirements to Approve' : 'Requirements'}
                </span>
                {!isConfirmationMode && incompleteRequirements.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAll}
                    className="h-8 text-xs text-forest-700 hover:text-forest-800 hover:bg-forest-50"
                  >
                    {allSelected ? 'Deselect All' : 'Select All Incomplete'}
                  </Button>
                )}
              </div>

              {isConfirmationMode ? (
                /* Confirmation Mode: Read-only list of selected requirements */
                <div className="flex-1 overflow-y-auto min-h-0 rounded-xl border border-forest-200 bg-forest-50/30">
                  <div className="divide-y divide-forest-100">
                    {selectedRequirements.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-start gap-3 p-3"
                      >
                        {/* Check indicator */}
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-forest-600 text-white mt-0.5">
                          <Check className="h-3 w-3" strokeWidth={2.5} />
                        </div>

                        {/* Requirement number badge */}
                        <div className="shrink-0 flex h-6 min-w-[1.75rem] items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums bg-forest-200 text-forest-800">
                          {req.requirementNumber}
                        </div>

                        {/* Description */}
                        <p className="flex-1 text-sm leading-relaxed text-stone-700">
                          {req.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : incompleteRequirements.length === 0 ? (
                <div className="flex-1 flex items-center justify-center rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/50">
                  <div className="text-center py-8">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                      <Check className="h-6 w-6 text-emerald-600" />
                    </div>
                    <p className="mt-3 text-sm font-medium text-stone-700">
                      All requirements complete!
                    </p>
                    <p className="mt-1 text-xs text-stone-500">
                      Nothing left to approve
                    </p>
                  </div>
                </div>
              ) : (
                /* Selection Mode: Selectable list */
                <div className="flex-1 overflow-y-auto min-h-0 rounded-xl border border-stone-200 bg-white">
                  <div className="divide-y divide-stone-100">
                    {incompleteRequirements.map((req) => {
                      const isSelected = selectedIds.has(req.id)

                      return (
                        <div
                          key={req.id}
                          className={cn(
                            'group flex items-start gap-4 p-4 transition-all duration-150',
                            isSelected
                              ? 'bg-forest-50/70 hover:bg-forest-50'
                              : 'hover:bg-stone-50 cursor-pointer'
                          )}
                          onClick={() => handleSelectOne(req.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              handleSelectOne(req.id)
                            }
                          }}
                        >
                          {/* Checkbox */}
                          <div className="pt-0.5">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleSelectOne(req.id)}
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                'h-5 w-5 rounded-md border-2 transition-colors',
                                isSelected
                                  ? 'border-forest-600 bg-forest-600 text-white'
                                  : 'border-stone-300 group-hover:border-stone-400'
                              )}
                            />
                          </div>

                          {/* Requirement number badge */}
                          <div className={cn(
                            'shrink-0 flex h-7 min-w-[2rem] items-center justify-center rounded-lg px-2 text-sm font-bold tabular-nums transition-colors',
                            isSelected
                              ? 'bg-forest-200 text-forest-800'
                              : 'bg-stone-100 text-stone-600 group-hover:bg-stone-200'
                          )}>
                            {req.requirementNumber}
                          </div>

                          {/* Description */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm leading-relaxed text-stone-700">
                              {req.description}
                            </p>
                          </div>

                          {/* Selection indicator */}
                          {isSelected && (
                            <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-forest-600 text-white">
                              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-stone-50/80">
          {!result ? (
            <div className="flex w-full items-center justify-between gap-4">
              {/* Selection summary */}
              <div className="flex items-center gap-2">
                {isConfirmationMode ? (
                  <span className="text-sm text-stone-600">
                    Ready to approve {selectedIds.size} requirement{selectedIds.size !== 1 ? 's' : ''}
                  </span>
                ) : someSelected ? (
                  <Badge
                    variant="secondary"
                    className="bg-forest-100 text-forest-700 border-0 text-sm font-medium px-3 py-1"
                  >
                    {selectedIds.size} selected
                  </Badge>
                ) : (
                  <span className="text-sm text-stone-500">
                    Select requirements to approve
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  className="border-stone-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={selectedIds.size === 0 || isSubmitting}
                  className={cn(
                    'gap-2 min-w-[140px]',
                    selectedIds.size > 0
                      ? 'bg-forest-700 hover:bg-forest-800 text-white'
                      : ''
                  )}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Approve{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : result.failed > 0 ? (
            <Button onClick={() => setOpen(false)} className="ml-auto">
              Close
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
