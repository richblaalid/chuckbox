import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { ExpenseReimbursementList } from '@/components/expenses/expense-list'
import { isFinancialRole } from '@/lib/roles'
import type { ExpenseReimbursementWithSubmitter } from '@/lib/expenses/types'

export default async function ExpensesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }

  // Get user's active unit membership
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, role, units!unit_memberships_unit_id_fkey(name)')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership) {
    redirect('/login')
  }

  const unit = membership.units as { name: string } | null
  const hasFinancialRole = isFinancialRole(membership.role)

  // Build expense query
  let query = supabase
    .from('expense_reimbursements')
    .select(
      `
      *,
      submitter:profiles!expense_reimbursements_submitter_id_fkey(
        id,
        full_name,
        email
      )
    `,
      { count: 'exact' }
    )
    .eq('unit_id', membership.unit_id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Non-financial users can only see their own expenses
  if (!hasFinancialRole) {
    query = query.eq('submitter_id', profile.id)
  }

  const { data: expenses, count } = await query

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expense Reimbursements</h1>
          <p className="text-stone-600">
            {hasFinancialRole
              ? `Manage expense reimbursement requests for ${unit?.name || 'your unit'}`
              : 'Submit and track your expense reimbursement requests'}
          </p>
        </div>
        <Button asChild>
          <Link href="/expenses/new">
            <svg
              className="mr-2 h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Expense
          </Link>
        </Button>
      </div>

      {/* Summary Cards for Financial Roles */}
      {hasFinancialRole && expenses && expenses.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Pending Review"
            count={expenses.filter((e) => e.status === 'submitted').length}
            color="blue"
          />
          <SummaryCard
            label="Approved"
            count={expenses.filter((e) => e.status === 'approved').length}
            color="green"
          />
          <SummaryCard
            label="Paid"
            count={expenses.filter((e) => e.status === 'paid').length}
            color="emerald"
          />
          <SummaryCard
            label="Rejected"
            count={expenses.filter((e) => e.status === 'rejected').length}
            color="red"
          />
        </div>
      )}

      {/* Expense List */}
      <ExpenseReimbursementList
        expenses={(expenses as ExpenseReimbursementWithSubmitter[]) || []}
        total={count || 0}
        showSubmitter={hasFinancialRole}
        isFinancialRole={hasFinancialRole}
        emptyMessage={
          hasFinancialRole
            ? 'No expense reimbursement requests yet'
            : "You haven't submitted any expenses yet"
        }
      />
    </div>
  )
}

function SummaryCard({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: 'blue' | 'green' | 'emerald' | 'red'
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  }

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-2xl font-bold">{count}</p>
    </div>
  )
}
