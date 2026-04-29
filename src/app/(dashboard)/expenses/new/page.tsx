import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentMembership, getCurrentUnit } from '@/lib/data/cached-queries'
import { ExpenseReimbursementForm } from '@/components/expenses/expense-form'

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>
}) {
  const params = await searchParams

  const membership = await getCurrentMembership(params.unit)
  if (!membership) {
    redirect('/login')
  }

  const unit = await getCurrentUnit(params.unit)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/expenses"
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
          Back to Expenses
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">New Expense</h1>
        <p className="text-stone-600">
          Submit a reimbursement request for {unit?.name || 'your unit'}
        </p>
      </div>

      <ExpenseReimbursementForm unitId={membership.unit_id} mode="create" />
    </div>
  )
}
