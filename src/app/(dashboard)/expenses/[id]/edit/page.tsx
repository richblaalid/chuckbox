import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/data/cached-queries'
import { ExpenseReimbursementForm } from '@/components/expenses/expense-form'
import type { ExpenseReimbursement } from '@/lib/expenses/types'

interface EditExpensePageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ unit?: string }>
}

export default async function EditExpensePage({ params, searchParams }: EditExpensePageProps) {
  const [{ id }, { unit: requestedUnitId }] = await Promise.all([params, searchParams])
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const membership = await getCurrentMembership(requestedUnitId)
  if (!membership) redirect('/login')

  const profile = { id: membership.profile_id }

  // Fetch the expense
  const { data: expense } = await supabase
    .from('expense_reimbursements')
    .select('*')
    .eq('id', id)
    .eq('unit_id', membership.unit_id)
    .single()

  if (!expense) notFound()

  // Only the submitter can edit, and only draft or rejected expenses
  if (expense.submitter_id !== profile.id) {
    redirect(`/expenses/${id}`)
  }

  if (!['draft', 'rejected'].includes(expense.status)) {
    redirect(`/expenses/${id}`)
  }

  const isRejected = expense.status === 'rejected'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={`/expenses/${id}`}
          className="inline-flex items-center text-sm text-stone-600 hover:text-stone-900"
        >
          <svg
            className="mr-1 h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Expense
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          {isRejected ? 'Edit & Resubmit Expense' : 'Edit Expense'}
        </h1>
        {isRejected && expense.rejection_reason && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-sm font-medium text-red-800">Rejection Reason</p>
            <p className="mt-1 text-sm text-red-700">{expense.rejection_reason}</p>
          </div>
        )}
      </div>

      <ExpenseReimbursementForm
        unitId={membership.unit_id}
        expense={expense as ExpenseReimbursement}
        mode="edit"
      />
    </div>
  )
}
