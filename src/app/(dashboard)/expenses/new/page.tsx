import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ExpenseReimbursementForm } from '@/components/expenses/expense-form'

export default async function NewExpensePage() {
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
