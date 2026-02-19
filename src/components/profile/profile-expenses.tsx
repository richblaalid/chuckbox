'use client'

import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EXPENSE_STATUSES } from '@/lib/expenses/constants'
import type { ExpenseStatus } from '@/lib/expenses/types'

interface ExpenseSummary {
  id: string
  description: string
  amount: number
  status: ExpenseStatus
  expense_date: string
  category: string
  submitted_at: string | null
  reviewed_at: string | null
  paid_at: string | null
}

interface ProfileExpensesProps {
  expenses: ExpenseSummary[]
}

const statusColorMap: Record<ExpenseStatus, string> = {
  draft: 'bg-stone-100 text-stone-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

export function ProfileExpenses({ expenses }: ProfileExpensesProps) {
  if (expenses.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
          <p className="text-stone-500">No expense submissions yet</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/expenses/new">Submit an Expense</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">
          {expenses.length} expense{expenses.length !== 1 ? 's' : ''}
        </p>
        <Button asChild size="sm">
          <Link href="/expenses/new">New Expense</Link>
        </Button>
      </div>

      <div className="space-y-3">
        {expenses.map((expense) => {
          const statusInfo = EXPENSE_STATUSES[expense.status]
          const statusColor = statusColorMap[expense.status]

          return (
            <Link
              key={expense.id}
              href={`/expenses/${expense.id}`}
              className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-4 transition-colors hover:bg-stone-50"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-stone-900 truncate">{expense.description}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                    {statusInfo.label}
                  </span>
                  <span className="text-xs text-stone-500">
                    {formatDate(expense.expense_date)}
                  </span>
                </div>
              </div>
              <span className="ml-3 font-semibold text-stone-900">
                {formatCurrency(Number(expense.amount))}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
