import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatDate } from '@/lib/utils'
import { isFinancialRole } from '@/lib/roles'
import { EXPENSE_STATUSES, EXPENSE_CATEGORIES } from '@/lib/expenses/constants'
import { ReceiptViewer } from '@/components/expenses/receipt-viewer'
import { ExpenseDetailActions } from '@/components/expenses/expense-detail-actions'
import type { ExpenseStatus, ExpenseCategory, ExpenseReimbursementWithSubmitter } from '@/lib/expenses/types'

const statusColorMap: Record<ExpenseStatus, string> = {
  draft: 'bg-stone-100 text-stone-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

interface ExpenseDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function ExpenseDetailPage({ params }: ExpenseDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) redirect('/login')

  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership) redirect('/login')

  // Fetch the expense with submitter and reviewer info
  const { data: expense } = await supabase
    .from('expense_reimbursements')
    .select(`
      *,
      submitter:profiles!expense_reimbursements_submitter_id_fkey(
        id, full_name, email, venmo_username
      ),
      reviewer:profiles!expense_reimbursements_reviewed_by_fkey(
        id, full_name
      ),
      payer:profiles!expense_reimbursements_paid_by_fkey(
        id, full_name
      )
    `)
    .eq('id', id)
    .eq('unit_id', membership.unit_id)
    .single()

  if (!expense) notFound()

  const status = expense.status as ExpenseStatus
  const category = expense.category as ExpenseCategory
  const statusInfo = EXPENSE_STATUSES[status]
  const categoryInfo = EXPENSE_CATEGORIES[category]
  const statusColor = statusColorMap[status]
  const hasFinancialAccess = isFinancialRole(membership.role)
  const isOwner = expense.submitter_id === profile.id
  const submitter = expense.submitter as { id: string; full_name: string | null; email: string | null; venmo_username: string | null } | null
  const reviewer = expense.reviewer as { id: string; full_name: string | null } | null
  const payer = expense.payer as { id: string; full_name: string | null } | null

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/expenses"
        className="inline-flex items-center text-sm text-stone-600 hover:text-stone-900"
      >
        <svg className="mr-1 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Expenses
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}>
              {statusInfo.label}
            </span>
            <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">
              {categoryInfo.label}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-stone-900">{expense.description}</h1>
          {hasFinancialAccess && submitter && (
            <p className="mt-1 text-stone-600">
              Submitted by {submitter.full_name || submitter.email}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-stone-900">
            {formatCurrency(Number(expense.amount))}
          </p>
        </div>
      </div>

      {/* Actions */}
      <ExpenseDetailActions
        expense={expense as unknown as ExpenseReimbursementWithSubmitter}
        isFinancialRole={hasFinancialAccess}
        isOwner={isOwner}
      />

      {/* Rejection reason */}
      {status === 'rejected' && expense.rejection_reason && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <p className="text-sm font-medium text-red-800">Rejection Reason</p>
          <p className="mt-1 text-sm text-red-700">{expense.rejection_reason}</p>
        </div>
      )}

      {/* Review notes */}
      {expense.review_notes && status !== 'rejected' && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4">
          <p className="text-sm font-medium text-green-800">Review Notes</p>
          <p className="mt-1 text-sm text-green-700">{expense.review_notes}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Details */}
        <div className="rounded-lg border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-stone-900 mb-4">Details</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-stone-500">Date</dt>
              <dd className="text-sm font-medium text-stone-900">{formatDate(expense.expense_date)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-stone-500">Category</dt>
              <dd className="text-sm font-medium text-stone-900">{categoryInfo.label}</dd>
            </div>
            {expense.vendor && (
              <div className="flex justify-between">
                <dt className="text-sm text-stone-500">Vendor</dt>
                <dd className="text-sm font-medium text-stone-900">{expense.vendor}</dd>
              </div>
            )}
            {expense.payment_method && (
              <div className="flex justify-between">
                <dt className="text-sm text-stone-500">Payment Method</dt>
                <dd className="text-sm font-medium text-stone-900 capitalize">{expense.payment_method.replace('_', ' ')}</dd>
              </div>
            )}
            {expense.payment_reference && (
              <div className="flex justify-between">
                <dt className="text-sm text-stone-500">Payment Reference</dt>
                <dd className="text-sm font-medium text-stone-900">{expense.payment_reference}</dd>
              </div>
            )}
            {hasFinancialAccess && submitter?.venmo_username && (
              <div className="flex justify-between">
                <dt className="text-sm text-stone-500">Venmo</dt>
                <dd className="text-sm font-medium text-stone-900">@{submitter.venmo_username}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Receipt */}
        <div className="rounded-lg border border-stone-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-stone-900 mb-4">Receipt</h2>
          {expense.receipt_url ? (
            <ReceiptViewer
              receiptUrl={expense.receipt_url}
              receiptFilename={expense.receipt_filename}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
              <p className="text-sm text-stone-500">No receipt attached</p>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-lg border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">Timeline</h2>
        <div className="space-y-4">
          <TimelineEntry label="Created" date={expense.created_at} />
          {expense.submitted_at && (
            <TimelineEntry label="Submitted" date={expense.submitted_at} />
          )}
          {expense.reviewed_at && (
            <TimelineEntry
              label={status === 'rejected' ? 'Rejected' : 'Approved'}
              date={expense.reviewed_at}
              by={reviewer?.full_name}
            />
          )}
          {expense.paid_at && (
            <TimelineEntry
              label="Paid"
              date={expense.paid_at}
              by={payer?.full_name}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function TimelineEntry({ label, date, by }: { label: string; date: string; by?: string | null }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-2 rounded-full bg-stone-400 flex-shrink-0" />
      <div className="flex flex-1 items-center justify-between">
        <span className="text-sm text-stone-700">
          {label}
          {by && <span className="text-stone-500"> by {by}</span>}
        </span>
        <span className="text-sm text-stone-500">{formatDate(date)}</span>
      </div>
    </div>
  )
}
