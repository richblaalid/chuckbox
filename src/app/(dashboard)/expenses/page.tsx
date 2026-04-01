import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ExpenseReimbursementList } from '@/components/expenses/expense-list'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { isFinancialRole } from '@/lib/roles'
import { Clock, CheckCircle, Banknote, XCircle, Plus } from 'lucide-react'
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

  // Check if unit has an active payment processor connection (for subnav)
  const { data: squareCredentials } = await supabase
    .from('unit_square_credentials')
    .select('id')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .single()

  const hasPaymentProcessor = !!squareCredentials

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

  const pendingCount = expenses?.filter((e) => e.status === 'submitted').length || 0
  const approvedCount = expenses?.filter((e) => e.status === 'approved').length || 0
  const paidCount = expenses?.filter((e) => e.status === 'paid').length || 0
  const rejectedCount = expenses?.filter((e) => e.status === 'rejected').length || 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-stone-900">Expenses</h1>
          <p className="mt-1 text-stone-600">
            {hasFinancialRole
              ? `Manage expense reimbursement requests for ${unit?.name || 'your unit'}`
              : 'Submit and track your expense reimbursement requests'}
          </p>
        </div>
        <Button asChild>
          <Link href="/expenses/new">
            <Plus className="mr-2 h-4 w-4" />
            New Expense
          </Link>
        </Button>
      </div>

      <FinanceSubnav />

      {/* Summary Cards for Financial Roles */}
      {hasFinancialRole && expenses && expenses.length > 0 && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Pending Review
              </CardDescription>
              <CardTitle className="text-2xl">{pendingCount}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Awaiting approval
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Approved
              </CardDescription>
              <CardTitle className="text-2xl">{approvedCount}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Ready for payment
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Banknote className="h-4 w-4" />
                Paid
              </CardDescription>
              <CardTitle className="text-2xl">{paidCount}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Reimbursement complete
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                Rejected
              </CardDescription>
              <CardTitle className="text-2xl text-error">{rejectedCount}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Needs revision
              </p>
            </CardContent>
          </Card>
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
