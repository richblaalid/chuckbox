'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ExpenseReimbursementCard, ExpenseReimbursementCardCompact } from './expense-card'
import { STATUS_OPTIONS, CATEGORY_OPTIONS } from '@/lib/expenses/constants'
import type {
  ExpenseReimbursementWithSubmitter,
  ExpenseStatus,
  ExpenseCategory,
} from '@/lib/expenses/types'

interface ExpenseListProps {
  expenses: ExpenseReimbursementWithSubmitter[]
  total: number
  showSubmitter?: boolean
  isFinancialRole?: boolean
  emptyMessage?: string
}

type StatusFilter = ExpenseStatus | 'all'
type CategoryFilter = ExpenseCategory | 'all'
type ViewMode = 'cards' | 'compact'

export function ExpenseReimbursementList({
  expenses,
  total,
  showSubmitter = false,
  isFinancialRole = false,
  emptyMessage = 'No expenses found',
}: ExpenseListProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')

  // Filter expenses client-side
  const filteredExpenses = expenses.filter((expense) => {
    if (statusFilter !== 'all' && expense.status !== statusFilter) {
      return false
    }
    if (categoryFilter !== 'all' && expense.category !== categoryFilter) {
      return false
    }
    return true
  })

  // Count by status for filter badges
  const statusCounts = expenses.reduce(
    (acc, expense) => {
      acc[expense.status] = (acc[expense.status] || 0) + 1
      return acc
    },
    {} as Record<ExpenseStatus, number>
  )

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm font-medium text-stone-600">
            Status:
          </label>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <SelectTrigger id="status-filter" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({expenses.length})</SelectItem>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label} ({statusCounts[opt.value] || 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="category-filter" className="text-sm font-medium text-stone-600">
            Category:
          </label>
          <Select
            value={categoryFilter}
            onValueChange={(value) => setCategoryFilter(value as CategoryFilter)}
          >
            <SelectTrigger id="category-filter" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* View Mode Toggle */}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-stone-200 p-1">
          <button
            onClick={() => setViewMode('cards')}
            className={`rounded px-2 py-1 text-sm ${
              viewMode === 'cards'
                ? 'bg-stone-100 font-medium text-stone-900'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            Cards
          </button>
          <button
            onClick={() => setViewMode('compact')}
            className={`rounded px-2 py-1 text-sm ${
              viewMode === 'compact'
                ? 'bg-stone-100 font-medium text-stone-900'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            Compact
          </button>
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-stone-500">
        Showing {filteredExpenses.length} of {total} expenses
      </div>

      {/* Expense List */}
      {filteredExpenses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
          <p className="text-stone-500">{emptyMessage}</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/expenses/new">Submit an Expense</Link>
          </Button>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="space-y-4">
          {filteredExpenses.map((expense) => (
            <ExpenseReimbursementCard
              key={expense.id}
              expense={expense}
              showSubmitter={showSubmitter}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredExpenses.map((expense) => (
            <ExpenseReimbursementCardCompact
              key={expense.id}
              expense={expense}
              showSubmitter={showSubmitter}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Pending expenses list for treasurer review
export function PendingExpensesList({
  expenses,
  total,
}: {
  expenses: ExpenseReimbursementWithSubmitter[]
  total: number
}) {
  const pendingExpenses = expenses.filter((e) => e.status === 'submitted')

  if (pendingExpenses.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 text-center">
        <p className="text-stone-500">No pending expenses to review</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-stone-900">
          Pending Review ({pendingExpenses.length})
        </h3>
      </div>
      <div className="space-y-4">
        {pendingExpenses.map((expense) => (
          <ExpenseReimbursementCard
            key={expense.id}
            expense={expense}
            showSubmitter={true}
          />
        ))}
      </div>
    </div>
  )
}
