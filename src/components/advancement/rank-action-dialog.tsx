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
import { Calendar, User, Loader2, ShieldCheck, Award } from 'lucide-react'

type ActionType = 'approve' | 'award'

interface RankActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionType: ActionType
  rankName: string
  scoutName?: string
  currentUserName: string
  onConfirm: (date: string) => Promise<void>
}

const actionConfig = {
  approve: {
    title: 'Approve Rank',
    description: 'Confirm that all requirements have been verified and the rank is ready for approval.',
    dateLabel: 'Approval Date',
    buttonText: 'Approve Rank',
    buttonLoadingText: 'Approving...',
    icon: ShieldCheck,
    buttonVariant: 'success' as const,
  },
  award: {
    title: 'Award Rank',
    description: 'Record when this rank was presented at a Court of Honor ceremony.',
    dateLabel: 'Award Date',
    buttonText: 'Award Rank',
    buttonLoadingText: 'Awarding...',
    icon: Award,
    buttonVariant: 'warning' as const,
  },
}

export function RankActionDialog({
  open,
  onOpenChange,
  actionType,
  rankName,
  scoutName,
  currentUserName,
  onConfirm,
}: RankActionDialogProps) {
  const [actionDate, setActionDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const config = actionConfig[actionType]
  const Icon = config.icon

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      // Convert date to ISO string with noon time to avoid timezone issues
      const dateAt = `${actionDate}T12:00:00.000Z`
      await onConfirm(dateAt)
      // Reset form on success
      setActionDate(new Date().toISOString().split('T')[0])
      onOpenChange(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset form when closing
      setActionDate(new Date().toISOString().split('T')[0])
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${actionType === 'approve' ? 'text-success' : 'text-warning'}`} />
            {config.title}
          </DialogTitle>
          <DialogDescription>
            {config.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Rank Info */}
          <div className="rounded-lg border bg-stone-50 p-3">
            <p className="text-sm text-stone-500">Rank</p>
            <p className="text-lg font-semibold text-stone-900">{rankName}</p>
            {scoutName && (
              <>
                <p className="mt-2 text-sm text-stone-500">Scout</p>
                <p className="font-medium text-stone-700">{scoutName}</p>
              </>
            )}
          </div>

          {/* Action Date */}
          <div className="space-y-2">
            <Label htmlFor="action-date" className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-stone-500" />
              {config.dateLabel}
            </Label>
            <Input
              id="action-date"
              type="date"
              value={actionDate}
              onChange={(e) => setActionDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full"
            />
            <p className="text-xs text-stone-500">
              Defaults to today. You can backdate if the {actionType === 'approve' ? 'approval' : 'ceremony'} occurred earlier.
            </p>
          </div>

          {/* Recorded by (read-only) */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <User className="h-4 w-4 text-stone-500" />
              Recorded By
            </Label>
            <div className="flex h-10 items-center rounded-md border border-stone-200 bg-stone-50 px-3 text-sm text-stone-600">
              {currentUserName}
            </div>
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
            variant={config.buttonVariant}
            className="gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {config.buttonLoadingText}
              </>
            ) : (
              <>
                <Icon className="h-4 w-4" />
                {config.buttonText}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
