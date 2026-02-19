'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'
import { approveExpenseReimbursement, rejectExpenseReimbursement } from '@/app/actions/expenses'
import type { ExpenseReimbursementWithSubmitter } from '@/lib/expenses/types'

interface ExpenseApprovalDialogProps {
  expense: ExpenseReimbursementWithSubmitter
  mode: 'approve' | 'reject'
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ExpenseApprovalDialog({
  expense,
  mode,
  open,
  onOpenChange,
}: ExpenseApprovalDialogProps) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isApprove = mode === 'approve'
  const title = isApprove ? 'Approve Expense' : 'Reject Expense'
  const description = isApprove
    ? 'Approve this expense reimbursement request. You can optionally add notes.'
    : 'Reject this expense reimbursement request. Please provide a reason.'

  const handleSubmit = async () => {
    setError(null)
    setIsSubmitting(true)

    try {
      if (isApprove) {
        const result = await approveExpenseReimbursement({
          expense_id: expense.id,
          review_notes: notes || undefined,
        })

        if (!result.success) {
          setError(result.error || 'Failed to approve expense')
          return
        }
      } else {
        if (!rejectionReason.trim()) {
          setError('Please provide a reason for rejection')
          return
        }

        const result = await rejectExpenseReimbursement({
          expense_id: expense.id,
          rejection_reason: rejectionReason,
        })

        if (!result.success) {
          setError(result.error || 'Failed to reject expense')
          return
        }
      }

      // Success - close dialog and refresh
      onOpenChange(false)
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset state when closing
      setNotes('')
      setRejectionReason('')
      setError(null)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Expense Summary */}
        <div className="rounded-lg bg-stone-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-stone-900">{expense.description}</p>
              <p className="mt-1 text-sm text-stone-500">
                {formatDate(expense.expense_date)}
                {expense.vendor && ` · ${expense.vendor}`}
              </p>
              {expense.submitter && (
                <p className="mt-1 text-sm text-stone-500">
                  Submitted by {expense.submitter.full_name || expense.submitter.email}
                </p>
              )}
            </div>
            <span className="text-xl font-bold text-stone-900">
              {formatCurrency(Number(expense.amount))}
            </span>
          </div>
        </div>

        {/* Input Field */}
        <div className="space-y-2">
          {isApprove ? (
            <>
              <Label htmlFor="notes">Review Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any notes about this approval..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </>
          ) : (
            <>
              <Label htmlFor="rejection-reason">
                Rejection Reason <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="rejection-reason"
                placeholder="Explain why this expense is being rejected..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
                className={!rejectionReason.trim() && error ? 'border-red-500' : ''}
              />
            </>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

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
            disabled={isSubmitting || (!isApprove && !rejectionReason.trim())}
            variant={isApprove ? 'default' : 'destructive'}
          >
            {isSubmitting
              ? isApprove
                ? 'Approving...'
                : 'Rejecting...'
              : isApprove
                ? 'Approve'
                : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
