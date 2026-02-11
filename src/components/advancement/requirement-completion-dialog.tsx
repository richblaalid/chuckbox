'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Calendar, User, Loader2, Check } from 'lucide-react'

interface RequirementCompletionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  requirementNumber: string
  requirementDescription: string
  currentUserName: string
  onComplete: (completedAt: string, notes: string) => Promise<void>
  isParentSubmission?: boolean // True when parent is submitting for leader approval
}

export function RequirementCompletionDialog({
  open,
  onOpenChange,
  requirementNumber,
  requirementDescription,
  currentUserName,
  onComplete,
  isParentSubmission = false,
}: RequirementCompletionDialogProps) {
  const [completedDate, setCompletedDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      // Convert date to ISO string with noon time to avoid timezone issues
      const completedAt = `${completedDate}T12:00:00.000Z`
      await onComplete(completedAt, notes)
      // Reset form on success
      setNotes('')
      setCompletedDate(new Date().toISOString().split('T')[0])
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset form when closing
      setNotes('')
      setCompletedDate(new Date().toISOString().split('T')[0])
    }
    onOpenChange(isOpen)
  }

  // Truncate description for display
  const truncatedDescription =
    requirementDescription.length > 150
      ? `${requirementDescription.slice(0, 150)}...`
      : requirementDescription

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className={isParentSubmission ? "h-5 w-5 text-amber-600" : "h-5 w-5 text-emerald-600"} />
            {isParentSubmission
              ? `Submit Requirement ${requirementNumber} for Approval`
              : `Complete Requirement ${requirementNumber}`}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {isParentSubmission && (
              <span className="block mb-2 text-amber-600">
                This will be sent to a leader for approval.
              </span>
            )}
            {truncatedDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Completion Date */}
          <div className="space-y-2">
            <Label htmlFor="completion-date" className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-stone-500" />
              {isParentSubmission ? 'Date Completed' : 'Completion Date'}
            </Label>
            <Input
              id="completion-date"
              type="date"
              value={completedDate}
              onChange={(e) => setCompletedDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full"
            />
            <p className="text-xs text-stone-500">
              {isParentSubmission
                ? 'When was this requirement completed?'
                : 'Defaults to today. You can backdate if needed.'}
            </p>
          </div>

          {/* Signed by (read-only) */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <User className="h-4 w-4 text-stone-500" />
              {isParentSubmission ? 'Submitted By' : 'Signed By'}
            </Label>
            <div className="flex h-10 items-center rounded-md border border-stone-200 bg-stone-50 px-3 text-sm text-stone-600">
              {currentUserName}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="completion-notes">
              {isParentSubmission ? 'Notes for Leader' : 'Notes (optional)'}
            </Label>
            <Textarea
              id="completion-notes"
              placeholder={isParentSubmission
                ? "How was this requirement completed? (e.g., at summer camp, troop meeting...)"
                : "Add any notes about this completion..."}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="resize-none"
            />
            {isParentSubmission && (
              <p className="text-xs text-stone-500">
                Help the leader understand how this was accomplished.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={isParentSubmission
              ? "gap-2 bg-amber-600 hover:bg-amber-700"
              : "gap-2 bg-emerald-600 hover:bg-emerald-700"}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isParentSubmission ? 'Submitting...' : 'Completing...'}
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                {isParentSubmission ? 'Submit for Approval' : 'Complete'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
