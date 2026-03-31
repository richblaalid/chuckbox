'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ReceiptViewerInline } from './receipt-viewer'
import { ExpenseApprovalDialog } from './expense-approval-dialog'
import { ExpensePaymentDialog } from './expense-payment-dialog'
import { EXPENSE_STATUSES, EXPENSE_CATEGORIES } from '@/lib/expenses/constants'
import type { ExpenseReimbursementWithSubmitter, ExpenseStatus } from '@/lib/expenses/types'

interface ExpenseCardProps {
  expense: ExpenseReimbursementWithSubmitter
  showSubmitter?: boolean
  isFinancialRole?: boolean
  actions?: React.ReactNode
}

const statusColorMap: Record<ExpenseStatus, string> = {
  draft: 'bg-stone-100 text-stone-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

export function ExpenseReimbursementCard({
  expense,
  showSubmitter = false,
  isFinancialRole = false,
  actions,
}: ExpenseCardProps) {
  const [approvalMode, setApprovalMode] = useState<'approve' | 'reject' | null>(null)
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const statusInfo = EXPENSE_STATUSES[expense.status]
  const categoryInfo = EXPENSE_CATEGORIES[expense.category]
  const statusColor = statusColorMap[expense.status]

  const canReview = isFinancialRole && expense.status === 'submitted'
  const canMarkPaid = isFinancialRole && expense.status === 'approved'

  return (
    <>
      {/* Approval Dialog */}
      {approvalMode && (
        <ExpenseApprovalDialog
          expense={expense}
          mode={approvalMode}
          open={!!approvalMode}
          onOpenChange={(open) => !open && setApprovalMode(null)}
        />
      )}

      {/* Payment Dialog */}
      {showPaymentDialog && (
        <ExpensePaymentDialog
          expense={expense}
          open={showPaymentDialog}
          onOpenChange={setShowPaymentDialog}
        />
      )}
    <div className="rounded-lg border border-stone-200 bg-white shadow-sm hover:border-stone-300 hover:shadow-md transition-all duration-200">
      <div className="p-4">
        {/* Header: Status, Category, Amount */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Status and Category badges */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
              >
                {statusInfo.label}
              </span>
              <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
                {categoryInfo.label}
              </span>
            </div>

            {/* Description */}
            <h3 className="font-semibold text-stone-900 line-clamp-2">
              {expense.description}
            </h3>

            {/* Meta info */}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-500">
              <span>{formatDate(expense.expense_date)}</span>
              {expense.vendor && (
                <>
                  <span className="text-stone-300">·</span>
                  <span className="truncate max-w-[150px]">{expense.vendor}</span>
                </>
              )}
              {showSubmitter && expense.submitter && (
                <>
                  <span className="text-stone-300">·</span>
                  <span className="truncate max-w-[150px]">
                    {expense.submitter.full_name || expense.submitter.email}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Amount */}
          <div className="text-right flex-shrink-0">
            <span className="text-xl font-bold text-stone-900">
              {formatCurrency(Number(expense.amount))}
            </span>
          </div>
        </div>

        {/* Receipt link and rejection reason */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            {expense.receipt_url && (
              <ReceiptViewerInline
                receiptUrl={expense.receipt_url}
                receiptFilename={expense.receipt_filename}
              />
            )}
          </div>

          {/* Actions */}
          {actions || (
            <div className="flex items-center gap-2">
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
              {expense.status === 'draft' && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/expenses/${expense.id}/edit`}>Edit</Link>
                </Button>
              )}
              {expense.status === 'rejected' && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/expenses/${expense.id}/edit`}>Edit & Resubmit</Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/expenses/${expense.id}`}>View</Link>
              </Button>
            </div>
          )}
        </div>

        {/* Rejection reason */}
        {expense.status === 'rejected' && expense.rejection_reason && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-100 p-3">
            <p className="text-sm font-medium text-red-800">Rejection Reason:</p>
            <p className="mt-1 text-sm text-red-700">{expense.rejection_reason}</p>
          </div>
        )}

        {/* Review notes (for approved) */}
        {expense.status === 'approved' && expense.review_notes && (
          <div className="mt-3 rounded-lg bg-green-50 border border-green-100 p-3">
            <p className="text-sm font-medium text-green-800">Review Notes:</p>
            <p className="mt-1 text-sm text-green-700">{expense.review_notes}</p>
          </div>
        )}
      </div>

      {/* Footer with timestamps */}
      <div className="border-t border-stone-100 px-4 py-2 bg-stone-50 rounded-b-lg">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
          <span>Created {formatDate(expense.created_at)}</span>
          {expense.submitted_at && (
            <span>Submitted {formatDate(expense.submitted_at)}</span>
          )}
          {expense.reviewed_at && (
            <span>Reviewed {formatDate(expense.reviewed_at)}</span>
          )}
          {expense.paid_at && <span>Paid {formatDate(expense.paid_at)}</span>}
        </div>
      </div>
    </div>
    </>
  )
}

// Compact version for lists
export function ExpenseReimbursementCardCompact({
  expense,
  showSubmitter = false,
}: Omit<ExpenseCardProps, 'actions'>) {
  const statusInfo = EXPENSE_STATUSES[expense.status]
  const statusColor = statusColorMap[expense.status]

  return (
    <Link
      href={`/expenses/${expense.id}`}
      className="block rounded-lg border border-stone-200 bg-white p-3 hover:border-stone-300 hover:shadow-sm transition-all duration-200"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
            >
              {statusInfo.label}
            </span>
            <span className="font-medium text-stone-900 truncate">
              {expense.description}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
            <span>{formatDate(expense.expense_date)}</span>
            {showSubmitter && expense.submitter && (
              <>
                <span className="text-stone-300">·</span>
                <span className="truncate">
                  {expense.submitter.full_name || expense.submitter.email}
                </span>
              </>
            )}
          </div>
        </div>
        <span className="font-semibold text-stone-900 flex-shrink-0">
          {formatCurrency(Number(expense.amount))}
        </span>
      </div>
    </Link>
  )
}
