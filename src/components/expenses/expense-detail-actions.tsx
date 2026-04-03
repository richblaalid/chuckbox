'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ExpenseApprovalDialog } from './expense-approval-dialog'
import { ExpensePaymentDialog } from './expense-payment-dialog'
import type { ExpenseReimbursementWithSubmitter, ExpenseStatus } from '@/lib/expenses/types'

interface ExpenseDetailActionsProps {
  expense: ExpenseReimbursementWithSubmitter
  isFinancialRole: boolean
  isOwner: boolean
}

export function ExpenseDetailActions({
  expense,
  isFinancialRole,
  isOwner,
}: ExpenseDetailActionsProps) {
  const [approvalMode, setApprovalMode] = useState<'approve' | 'reject' | null>(null)
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)

  const canReview = isFinancialRole && expense.status === 'submitted'
  const canMarkPaid = isFinancialRole && expense.status === 'approved'
  const canEdit = isOwner && (expense.status === 'draft' || expense.status === 'rejected')

  if (!canReview && !canMarkPaid && !canEdit) return null

  return (
    <>
      {approvalMode && (
        <ExpenseApprovalDialog
          expense={expense}
          mode={approvalMode}
          open={!!approvalMode}
          onOpenChange={(open) => !open && setApprovalMode(null)}
        />
      )}

      {showPaymentDialog && (
        <ExpensePaymentDialog
          expense={expense}
          open={showPaymentDialog}
          onOpenChange={setShowPaymentDialog}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canReview && (
          <>
            <Button
              variant="default"
              size="sm"
              onClick={() => setApprovalMode('approve')}
            >
              Approve
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setApprovalMode('reject')}
            >
              Reject
            </Button>
          </>
        )}
        {canMarkPaid && (
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowPaymentDialog(true)}
          >
            Mark Paid
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" asChild>
            <Link href={`/expenses/${expense.id}/edit`}>
              {expense.status === 'rejected' ? 'Edit & Resubmit' : 'Edit'}
            </Link>
          </Button>
        )}
      </div>
    </>
  )
}
