'use client'

import { useState, useMemo, memo } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  Check,
  Clock,
  AlertCircle,
  MessageSquare,
  Loader2,
  Calendar,
  StickyNote,
  Undo2,
  User,
  History,
} from 'lucide-react'
import { markRequirementComplete, updateRequirementNotes, markRequirementCompleteWithInit, undoRequirementCompletion, undoMeritBadgeRequirementCompletion, markMeritBadgeRequirement, addRankRequirementNoteWithInit, updateMeritBadgeRequirementNotes, addMeritBadgeRequirementNoteWithInit, submitRequirementForApproval, submitMeritBadgeRequirementForApproval, retractRequirementSubmission, retractMeritBadgeRequirementSubmission } from '@/app/actions/advancement'
import { RequirementCompletionDialog } from './requirement-completion-dialog'
import { RequirementUndoDialog } from './requirement-undo-dialog'
import { parseNotes, formatNoteTimestamp, getNoteTypeLabel, type RequirementNote } from '@/lib/notes-utils'
import type { AdvancementStatus } from '@/types/advancement'

interface RequirementApprovalRowProps {
  id: string
  requirementProgressId: string | null // Can be null for unstarted ranks
  requirementNumber: string
  // Display label shows abbreviated version for nested items (e.g., "4 Option A (1)(a)" → "a")
  displayLabel?: string
  description: string
  status: AdvancementStatus
  completedAt: string | null
  completedBy: string | null
  notes: string | null
  approvalStatus: string | null
  unitId: string
  canEdit: boolean
  canSubmit?: boolean // Parents can submit requirements for approval
  scoutId?: string // Scout ID for parent submission
  // Multi-select mode props
  isMultiSelectMode?: boolean
  isSelected?: boolean
  onSelectionChange?: () => void
  // Current user info for dialogs
  currentUserName?: string
  // Optional props for initializing progress when marking complete on unstarted ranks
  initData?: {
    scoutId: string
    rankId: string
  }
  // Merit badge support
  isMeritBadge?: boolean
  meritBadgeInitData?: {
    scoutId: string
    meritBadgeId: string
    meritBadgeProgressId: string
  }
}

export const RequirementApprovalRow = memo(function RequirementApprovalRow({
  id,
  requirementProgressId,
  requirementNumber,
  displayLabel,
  description,
  status,
  completedAt,
  completedBy,
  notes,
  approvalStatus,
  unitId,
  canEdit,
  canSubmit = false,
  scoutId,
  isMultiSelectMode = false,
  isSelected = false,
  onSelectionChange,
  currentUserName = 'Parent',
  initData,
  isMeritBadge = false,
  meritBadgeInitData,
}: RequirementApprovalRowProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteValue, setNoteValue] = useState('')
  const [isSavingNotes, setIsSavingNotes] = useState(false)

  // Dialog states
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false)
  const [undoDialogOpen, setUndoDialogOpen] = useState(false)
  const [submissionDialogOpen, setSubmissionDialogOpen] = useState(false)

  const isComplete = ['completed', 'approved', 'awarded'].includes(status)
  const isPending = approvalStatus === 'pending_approval'
  const isDenied = approvalStatus === 'denied'
  // Can approve if we have either a progress ID or init data to create one
  const canApprove = canEdit && !isComplete && !isPending && (requirementProgressId || initData || meritBadgeInitData)
  // Can undo completed or approved requirements (not awarded) - works for both ranks and merit badges
  const canUndo = canEdit && ['completed', 'approved'].includes(status) && requirementProgressId
  // Parents can submit incomplete requirements for approval
  const canSubmitReq = canSubmit && !canEdit && !isComplete && !isPending && requirementProgressId && scoutId
  // Parents can retract their pending submissions
  const canRetract = canSubmit && !canEdit && isPending && requirementProgressId && scoutId

  // Parse notes from JSON or legacy format
  const parsedNotes = useMemo(() => parseNotes(notes), [notes])
  const hasNotes = parsedNotes.length > 0

  // Parent submission handler
  const handleSubmitForApproval = async (completedAt: string, noteText: string) => {
    if (!requirementProgressId || !scoutId) return

    setIsLoading(true)
    try {
      const result = isMeritBadge
        ? await submitMeritBadgeRequirementForApproval(requirementProgressId, scoutId, completedAt, noteText)
        : await submitRequirementForApproval(requirementProgressId, scoutId, completedAt, noteText)
      if (result?.success) {
        setShowSuccess(true)
        setTimeout(() => setShowSuccess(false), 2000)
      }
    } catch (error) {
      console.error('Error submitting requirement for approval:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Parent retraction handler
  const handleRetractSubmission = async () => {
    if (!requirementProgressId || !scoutId) return

    setIsLoading(true)
    try {
      const result = isMeritBadge
        ? await retractMeritBadgeRequirementSubmission(requirementProgressId, scoutId)
        : await retractRequirementSubmission(requirementProgressId, scoutId)
      if (!result.success) {
        console.error('Error retracting submission:', result.error)
      }
    } catch (error) {
      console.error('Error retracting submission:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleComplete = async (completedAt: string, noteText: string) => {
    setIsLoading(true)
    try {
      let result
      if (isMeritBadge) {
        // Merit badge requirement
        if (requirementProgressId) {
          result = await markMeritBadgeRequirement(requirementProgressId, unitId, completedAt, noteText || undefined)
        }
        // TODO: Add init support for merit badge requirements if needed
      } else {
        // Rank requirement
        if (requirementProgressId) {
          // Normal case: progress record exists
          result = await markRequirementComplete(requirementProgressId, unitId, completedAt, noteText || undefined)
        } else if (initData) {
          // No progress record yet: initialize and mark complete
          result = await markRequirementCompleteWithInit({
            scoutId: initData.scoutId,
            rankId: initData.rankId,
            requirementId: id,
            unitId,
            completedAt,
            notes: noteText || undefined,
          })
        }
      }
      if (result?.success) {
        setShowSuccess(true)
        setTimeout(() => setShowSuccess(false), 2000)
      }
    } catch (error) {
      console.error('Error completing requirement:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUndo = async (reason: string) => {
    if (!requirementProgressId) return

    setIsLoading(true)
    try {
      const result = isMeritBadge
        ? await undoMeritBadgeRequirementCompletion(requirementProgressId, unitId, reason)
        : await undoRequirementCompletion(requirementProgressId, unitId, reason)
      if (!result.success) {
        throw new Error(result.error)
      }
    } catch (error) {
      console.error('Error undoing requirement:', error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveNotes = async () => {
    if (!canEdit || isSavingNotes) return
    if (!requirementProgressId && !initData && !meritBadgeInitData) return

    setIsSavingNotes(true)
    try {
      if (isMeritBadge) {
        // Merit badge requirement
        if (requirementProgressId) {
          await updateMeritBadgeRequirementNotes(requirementProgressId, unitId, noteValue)
        } else if (meritBadgeInitData) {
          await addMeritBadgeRequirementNoteWithInit({
            meritBadgeProgressId: meritBadgeInitData.meritBadgeProgressId,
            requirementId: id,
            unitId,
            noteText: noteValue,
          })
        }
      } else {
        // Rank requirement
        if (requirementProgressId) {
          await updateRequirementNotes(requirementProgressId, unitId, noteValue)
        } else if (initData) {
          await addRankRequirementNoteWithInit({
            scoutId: initData.scoutId,
            rankId: initData.rankId,
            requirementId: id,
            unitId,
            noteText: noteValue,
          })
        }
      }
      setNotesOpen(false)
      setNoteValue('')
    } catch (error) {
      console.error('Error saving notes:', error)
    } finally {
      setIsSavingNotes(false)
    }
  }

  const handleCheckboxChange = (checked: boolean) => {
    if (isComplete) return

    if (isMultiSelectMode && onSelectionChange) {
      // In multi-select mode, toggle selection
      onSelectionChange()
    } else if (canEdit && checked) {
      // Leader mode: open completion dialog
      setCompletionDialogOpen(true)
    } else if (canSubmitReq && checked) {
      // Parent mode: open submission dialog
      setSubmissionDialogOpen(true)
    }
  }

  // Handle row click - only for multi-select mode, not for opening dialogs
  const handleRowClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking on interactive elements
    const target = e.target as HTMLElement
    const isInteractiveElement =
      target.closest('button') ||
      target.closest('input') ||
      target.closest('[role="checkbox"]') ||
      target.closest('[data-radix-popper-content-wrapper]') ||
      target.tagName === 'A'

    if (isInteractiveElement) {
      return
    }

    // Don't trigger if already complete, pending, or loading
    if (isComplete || isPending || isLoading) return

    // Only handle multi-select mode - clicking row toggles selection
    // Dialogs are opened only via checkbox click, not row click
    if (isMultiSelectMode && onSelectionChange) {
      onSelectionChange()
    }
  }

  // Notes are available if there's a progress record OR init data to create one
  const canAddNotes = canEdit && (requirementProgressId || initData || meritBadgeInitData)

  return (
    <>
      <div
        onClick={handleRowClick}
        className={cn(
          'group relative flex items-start gap-2 rounded-lg border p-2 transition-all sm:gap-3 sm:p-3',
          showSuccess && 'border-success bg-success-light ring-1 ring-success',
          isComplete && !showSuccess && 'border-success bg-success-light',
          isPending && 'border-amber-200 bg-amber-50',
          isDenied && 'border-red-200 bg-red-50',
          // Default: white background with pine green border
          !isComplete && !isPending && !isDenied && !isSelected && 'border-forest-800 bg-white hover:bg-stone-50',
          isSelected && 'border-blue-400 bg-blue-50 ring-1 ring-blue-200',
          // Clickable cursor only in multi-select mode (for row selection)
          !isComplete && !isPending && !isLoading && isMultiSelectMode && 'cursor-pointer'
        )}
      >
        {/* Selection/Completion Checkbox */}
        <div className="flex h-6 items-center">
          {(canEdit || isMultiSelectMode || canSubmitReq) ? (
            <Checkbox
              checked={isComplete || showSuccess || isPending || (isMultiSelectMode && isSelected)}
              disabled={isLoading || isComplete || isPending}
              onCheckedChange={(checked) => handleCheckboxChange(checked as boolean)}
              className={cn(
                'transition-all',
                // Leader-approved completed requirements: amber-600
                (isComplete || showSuccess) && !isPending && 'border-amber-600 bg-amber-600 text-white data-[state=checked]:bg-amber-600',
                // Parent-submitted pending requirements: amber-500 with different styling
                isPending && 'border-amber-400 bg-amber-100 text-amber-600 data-[state=checked]:bg-amber-100 data-[state=checked]:border-amber-400',
                // Multi-select mode: blue selection styling for incomplete requirements
                isMultiSelectMode && isSelected && !isComplete && !isPending && 'border-blue-500 bg-blue-500 text-white data-[state=checked]:bg-blue-500'
              )}
            />
          ) : (
            <div className="flex h-5 w-5 items-center justify-center">
              {isComplete ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-600">
                  <Check className="h-3 w-3 text-white" />
                </div>
              ) : isPending ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 border border-amber-400">
                  <Clock className="h-3 w-3 text-amber-600" />
                </div>
              ) : isDenied ? (
                <AlertCircle className="h-5 w-5 text-red-500" />
              ) : (
                <div className="h-4 w-4 rounded border-2 border-stone-300" />
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              {/* Requirement Number & Description */}
              <p
                className={cn(
                  'text-sm leading-relaxed',
                  (isComplete || showSuccess) && 'text-emerald-700'
                )}
              >
                <span className={cn(
                  'mr-1.5 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded px-1.5 text-xs font-bold',
                  // Completable requirements use amber-600
                  'bg-amber-600 text-white'
                )}>
                  {displayLabel ?? requirementNumber}
                </span>
                {description}
              </p>

              {/* Metadata Row */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs sm:mt-2 sm:gap-2">
                {/* Completion Info */}
                {completedAt && (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <Calendar className="h-3 w-3" />
                    {new Date(completedAt).toLocaleDateString()}
                  </span>
                )}

                {/* Notes Indicator with Multi-note Display */}
                {hasNotes && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-1 text-stone-500 hover:text-stone-700">
                        <History className="h-3 w-3" />
                        {parsedNotes.length} note{parsedNotes.length !== 1 ? 's' : ''}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <div className="border-b bg-stone-50 px-3 py-2">
                        <h4 className="text-sm font-medium">Notes History</h4>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {parsedNotes.map((note) => (
                          <NoteEntry key={note.id} note={note} />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                {/* Status Badges */}
                {isPending && (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                    <Clock className="mr-1 h-3 w-3" />
                    Parent Submitted
                  </Badge>
                )}
                {isDenied && (
                  <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                    <AlertCircle className="mr-1 h-3 w-3" />
                    Denied
                  </Badge>
                )}
                {status === 'approved' && (
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                    <Check className="mr-1 h-3 w-3" />
                    Approved
                  </Badge>
                )}
              </div>
            </div>

            {/* Actions - stacked layout with completed label on top */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              {/* Completed indicator - right justified, matches parent header style */}
              {isComplete && !showSuccess && (
                <span className="flex items-center gap-1.5 rounded-full bg-amber-600/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                  <span className="text-sm">🎯</span>
                  <span className="hidden sm:inline">Completed!</span>
                </span>
              )}

              {/* Action buttons row - below the completed label */}
              <div className="flex items-center gap-0.5 sm:gap-1">
                {/* Add Notes Button */}
                {canAddNotes && (
                  <Popover open={notesOpen} onOpenChange={setNotesOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          'h-7 w-7 p-0 sm:h-8 sm:w-8',
                          'sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100',
                          hasNotes && 'sm:opacity-100'
                        )}
                      >
                        <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72" align="end">
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium">Add Note</h4>
                        <Textarea
                          placeholder="Add a note about this requirement..."
                          value={noteValue}
                          onChange={(e) => setNoteValue(e.target.value)}
                          rows={3}
                          className="text-sm"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setNotesOpen(false)
                              setNoteValue('')
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSaveNotes}
                            disabled={isSavingNotes || !noteValue.trim()}
                          >
                            {isSavingNotes ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : null}
                            Save
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                {/* Undo Button - for completed requirements (leaders) */}
                {canUndo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 w-7 p-0 sm:h-8 sm:w-8',
                      'sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100',
                      'text-amber-600 hover:bg-amber-50 hover:text-amber-700'
                    )}
                    onClick={() => setUndoDialogOpen(true)}
                    disabled={isLoading}
                  >
                    <Undo2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </Button>
                )}

                {/* Retract Button - for pending submissions (parents) */}
                {canRetract && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 w-7 p-0 sm:h-8 sm:w-auto sm:px-2',
                      'text-amber-600 hover:bg-amber-50 hover:text-amber-700'
                    )}
                    onClick={handleRetractSubmission}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
                    ) : (
                      <>
                        <Undo2 className="h-3.5 w-3.5 sm:mr-1 sm:h-4 sm:w-4" />
                        <span className="hidden sm:inline">Undo</span>
                      </>
                    )}
                  </Button>
                )}

                {/* Complete Button - icon only on mobile (for leaders) */}
                {canApprove && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 w-7 p-0 sm:h-8 sm:w-auto sm:px-2',
                      'sm:opacity-0 sm:transition-all sm:group-hover:opacity-100',
                      'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
                    )}
                    onClick={() => setCompletionDialogOpen(true)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5 sm:mr-1 sm:h-4 sm:w-4" />
                        <span className="hidden sm:inline">Complete</span>
                      </>
                    )}
                  </Button>
                )}

              </div>
            </div>
          </div>
        </div>

        {/* Success Animation Overlay */}
        {showSuccess && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-emerald-50/80">
            <div className="flex items-center gap-2 text-emerald-600">
              <Check className="h-5 w-5" />
              <span className="text-sm font-medium">Completed!</span>
            </div>
          </div>
        )}
      </div>

      {/* Completion Dialog */}
      <RequirementCompletionDialog
        open={completionDialogOpen}
        onOpenChange={setCompletionDialogOpen}
        requirementNumber={requirementNumber}
        requirementDescription={description}
        currentUserName={currentUserName}
        onComplete={handleComplete}
      />

      {/* Undo Dialog */}
      <RequirementUndoDialog
        open={undoDialogOpen}
        onOpenChange={setUndoDialogOpen}
        requirementNumber={requirementNumber}
        requirementDescription={description}
        onUndo={handleUndo}
      />

      {/* Parent Submission Dialog */}
      <RequirementCompletionDialog
        open={submissionDialogOpen}
        onOpenChange={setSubmissionDialogOpen}
        requirementNumber={requirementNumber}
        requirementDescription={description}
        currentUserName={currentUserName}
        onComplete={handleSubmitForApproval}
        isParentSubmission={true}
      />
    </>
  )
})

// Note entry component for the multi-note display
function NoteEntry({ note }: { note: RequirementNote }) {
  const typeColors = {
    completion: 'bg-emerald-100 text-emerald-700',
    undo: 'bg-amber-100 text-amber-700',
    general: 'bg-stone-100 text-stone-700',
  }

  return (
    <div className="border-b last:border-b-0 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-5', typeColors[note.type])}>
          {getNoteTypeLabel(note.type)}
        </Badge>
        <span className="text-[10px] text-stone-400">
          {formatNoteTimestamp(note.timestamp)}
        </span>
      </div>
      <p className="mt-1 text-sm text-stone-600">{note.text}</p>
      <div className="mt-1 flex items-center gap-1 text-[10px] text-stone-400">
        <User className="h-2.5 w-2.5" />
        {note.author}
      </div>
    </div>
  )
}
