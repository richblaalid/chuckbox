'use client'

import { useState, useOptimistic, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { approveRequirement, denyRequirement } from '@/app/actions/advancement'
import type { PendingSignoff, PendingSignoffType } from '@/types/advancement'
import { Check, X, Award, Medal, PartyPopper, Loader2, User, Calendar, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface PendingSignoffsListProps {
  items: PendingSignoff[]
}

export function PendingSignoffsList({ items }: PendingSignoffsListProps) {
  const [isPending, startTransition] = useTransition()
  const [optimisticItems, updateOptimistic] = useOptimistic(
    items,
    (state, removedId: string) => state.filter((item) => item.id !== removedId)
  )
  const [denyingId, setDenyingId] = useState<string | null>(null)
  const [denyReason, setDenyReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [approvingItem, setApprovingItem] = useState<PendingSignoff | null>(null)
  const [isApproving, setIsApproving] = useState(false)

  const handleApproveStart = (item: PendingSignoff) => {
    setApprovingItem(item)
    setError(null)
  }

  const handleApproveCancel = () => {
    setApprovingItem(null)
  }

  const handleApproveConfirm = async () => {
    if (!approvingItem) return

    setIsApproving(true)
    setError(null)

    startTransition(async () => {
      updateOptimistic(approvingItem.id)
      const result = await approveRequirement(approvingItem.id, approvingItem.type)
      if (!result.success) {
        setError(result.error || 'Failed to approve')
      } else {
        setApprovingItem(null)
      }
      setIsApproving(false)
    })
  }

  const handleDenyStart = (id: string) => {
    setDenyingId(id)
    setDenyReason('')
    setError(null)
  }

  const handleDenyCancel = () => {
    setDenyingId(null)
    setDenyReason('')
  }

  const handleDenyConfirm = async (id: string, type: PendingSignoffType) => {
    if (!denyReason.trim()) {
      setError('Please provide a reason for denial')
      return
    }
    setError(null)
    startTransition(async () => {
      updateOptimistic(id)
      const result = await denyRequirement(id, type, denyReason.trim())
      if (!result.success) {
        setError(result.error || 'Failed to deny')
      } else {
        setDenyingId(null)
        setDenyReason('')
      }
    })
  }

  // Empty state
  if (optimisticItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <PartyPopper className="h-10 w-10 text-forest-500 mb-3" />
        <p className="text-lg font-medium text-stone-700">All caught up!</p>
        <p className="text-sm text-stone-500">No pending requirements to review</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {optimisticItems.map((item) => (
        <div
          key={item.id}
          className={cn(
            'rounded-lg border bg-white p-3 transition-all dark:bg-stone-900',
            isPending && 'opacity-70'
          )}
        >
          {/* Top row: Icon, Scout/Requirement, Actions */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              {/* Type icon */}
              <div
                className={cn(
                  'mt-0.5 flex h-8 w-8 items-center justify-center rounded-full',
                  item.type === 'rank'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                )}
              >
                {item.type === 'rank' ? (
                  <Medal className="h-4 w-4" />
                ) : (
                  <Award className="h-4 w-4" />
                )}
              </div>

              {/* Scout and requirement info */}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-stone-900 dark:text-stone-100">
                  {item.scoutName}
                </p>
                <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
                  {item.advancementName} &bull; Req {item.requirementNumber}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            {denyingId !== item.id && (
              <div className="flex items-center gap-1">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-forest-600 hover:bg-forest-50 hover:text-forest-700 dark:text-forest-400 dark:hover:bg-forest-900/30"
                        onClick={() => handleApproveStart(item)}
                        disabled={isPending}
                      >
                        <Check className="h-4 w-4" />
                        <span className="sr-only">Approve</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Approve</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                        onClick={() => handleDenyStart(item.id)}
                        disabled={isPending}
                      >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Deny</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Deny</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </div>

          {/* Compact submission info */}
          <p className="mt-1 pl-11 text-xs text-stone-500 dark:text-stone-400">
            {item.submittedByName} &bull; {item.submittedAgo}
          </p>

          {/* Deny reason input */}
          {denyingId === item.id && (
            <div className="mt-3 flex items-center gap-2 pl-11">
              <Input
                type="text"
                placeholder="Reason for denial..."
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleDenyConfirm(item.id, item.type)
                  } else if (e.key === 'Escape') {
                    handleDenyCancel()
                  }
                }}
              />
              <Button
                size="sm"
                variant="destructive"
                className="h-8 px-3"
                onClick={() => handleDenyConfirm(item.id, item.type)}
                disabled={isPending || !denyReason.trim()}
              >
                Deny
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={handleDenyCancel}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      ))}

      {/* Approval Confirmation Dialog */}
      <Dialog open={!!approvingItem} onOpenChange={(open) => !open && handleApproveCancel()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full',
                approvingItem?.type === 'rank'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-blue-100 text-blue-700'
              )}>
                {approvingItem?.type === 'rank' ? (
                  <Medal className="h-4 w-4" />
                ) : (
                  <Award className="h-4 w-4" />
                )}
              </div>
              Approve Requirement
            </DialogTitle>
            <DialogDescription>
              Review the details below before approving this requirement.
            </DialogDescription>
          </DialogHeader>

          {approvingItem && (
            <div className="space-y-4 py-2">
              {/* Scout Info */}
              <div className="rounded-lg border bg-stone-50 p-3 dark:bg-stone-800">
                <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Scout</p>
                <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  {approvingItem.scoutName}
                </p>
              </div>

              {/* Requirement Info */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-stone-500 dark:text-stone-400">Requirement</p>
                <p className="font-medium text-stone-900 dark:text-stone-100">
                  {approvingItem.advancementName} &bull; Req {approvingItem.requirementNumber}
                </p>
                <p className="text-sm text-stone-700 dark:text-stone-300">
                  {approvingItem.requirementDescription}
                </p>
              </div>

              {/* Submission Details */}
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
                  <User className="h-4 w-4" />
                  <span>Submitted by <span className="font-medium">{approvingItem.submittedByName}</span></span>
                </div>
                <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
                  <Calendar className="h-4 w-4" />
                  <span>{approvingItem.submittedAgo}</span>
                </div>
                {approvingItem.submissionNotes && (
                  <div className="flex items-start gap-2 text-sm text-stone-600 dark:text-stone-400">
                    <MessageSquare className="h-4 w-4 mt-0.5" />
                    <p className="italic">&ldquo;{approvingItem.submissionNotes}&rdquo;</p>
                  </div>
                )}
              </div>

              {/* Approval notice */}
              <p className="text-sm text-stone-600 dark:text-stone-400 bg-forest-50 dark:bg-forest-900/20 rounded-md p-3">
                By approving, you confirm that <span className="font-medium">{approvingItem.scoutName}</span> has
                successfully completed this requirement.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleApproveCancel}
              disabled={isApproving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApproveConfirm}
              disabled={isApproving}
              className="gap-2 bg-forest-600 hover:bg-forest-700"
            >
              {isApproving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Approving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Approve Requirement
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
