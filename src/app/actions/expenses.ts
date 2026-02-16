'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  expenseSubmissionSchema,
  type ExpenseSubmissionInput,
} from '@/lib/expenses/schemas'
import type {
  ExpenseCategory,
  ExpenseReimbursementWithSubmitter,
  ExpenseFilters,
} from '@/lib/expenses/types'

interface ActionResult {
  success: boolean
  error?: string
  data?: unknown
}

interface CreateExpenseResult extends ActionResult {
  data?: {
    id: string
    status: string
  }
}

interface GetExpensesResult extends ActionResult {
  data?: {
    expenses: ExpenseReimbursementWithSubmitter[]
    total: number
  }
}

/**
 * Get the current user's profile and verify unit access
 */
async function getUserContext(unitId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { error: 'Profile not found' }
  }

  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('profile_id', profile.id)
    .eq('unit_id', unitId)
    .eq('status', 'active')
    .single()

  if (!membership) {
    return { error: 'Not a member of this unit' }
  }

  return {
    supabase,
    user,
    profile,
    membership,
  }
}

/**
 * Create a new expense reimbursement request
 */
export async function createExpenseReimbursement(
  unitId: string,
  data: ExpenseSubmissionInput
): Promise<CreateExpenseResult> {
  // Validate input
  const validationResult = expenseSubmissionSchema.safeParse(data)
  if (!validationResult.success) {
    return {
      success: false,
      error: validationResult.error.issues[0]?.message || 'Invalid input',
    }
  }

  const validData = validationResult.data

  const context = await getUserContext(unitId)
  if ('error' in context) {
    return { success: false, error: context.error }
  }

  const { supabase, profile } = context
  const shouldSubmit = validData.submit ?? false

  // Create the expense record
  const { data: expense, error } = await supabase
    .from('expense_reimbursements')
    .insert({
      unit_id: unitId,
      submitter_id: profile.id,
      description: validData.description,
      amount: validData.amount,
      expense_date: validData.expense_date,
      category: validData.category as ExpenseCategory,
      vendor: validData.vendor || null,
      receipt_url: validData.receipt_url || null,
      receipt_filename: validData.receipt_filename || null,
      status: shouldSubmit ? 'submitted' : 'draft',
      submitted_at: shouldSubmit ? new Date().toISOString() : null,
    })
    .select('id, status')
    .single()

  if (error) {
    console.error('Create expense error:', error)
    return { success: false, error: 'Failed to create expense' }
  }

  revalidatePath('/expenses')
  return {
    success: true,
    data: {
      id: expense.id,
      status: expense.status,
    },
  }
}

/**
 * Update an existing expense (only draft or rejected)
 */
export async function updateExpenseReimbursement(
  expenseId: string,
  data: ExpenseSubmissionInput
): Promise<ActionResult> {
  // Validate input
  const validationResult = expenseSubmissionSchema.safeParse(data)
  if (!validationResult.success) {
    return {
      success: false,
      error: validationResult.error.issues[0]?.message || 'Invalid input',
    }
  }

  const validData = validationResult.data
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Fetch the expense to verify ownership and status
  const { data: expense, error: fetchError } = await supabase
    .from('expense_reimbursements')
    .select('id, submitter_id, status, unit_id')
    .eq('id', expenseId)
    .single()

  if (fetchError || !expense) {
    return { success: false, error: 'Expense not found' }
  }

  // Only the submitter can edit their own expense
  if (expense.submitter_id !== profile.id) {
    return { success: false, error: 'You can only edit your own expenses' }
  }

  // Can only edit draft or rejected expenses
  if (!['draft', 'rejected'].includes(expense.status)) {
    return {
      success: false,
      error: 'Can only edit draft or rejected expenses',
    }
  }

  const shouldSubmit = validData.submit ?? false

  // Update the expense
  const { error: updateError } = await supabase
    .from('expense_reimbursements')
    .update({
      description: validData.description,
      amount: validData.amount,
      expense_date: validData.expense_date,
      category: validData.category as ExpenseCategory,
      vendor: validData.vendor || null,
      receipt_url: validData.receipt_url || null,
      receipt_filename: validData.receipt_filename || null,
      status: shouldSubmit ? 'submitted' : expense.status === 'rejected' && shouldSubmit ? 'submitted' : 'draft',
      submitted_at: shouldSubmit ? new Date().toISOString() : null,
      // Clear rejection fields if resubmitting
      ...(shouldSubmit && expense.status === 'rejected'
        ? {
            rejection_reason: null,
            reviewed_by: null,
            reviewed_at: null,
            review_notes: null,
          }
        : {}),
    })
    .eq('id', expenseId)

  if (updateError) {
    console.error('Update expense error:', updateError)
    return { success: false, error: 'Failed to update expense' }
  }

  revalidatePath('/expenses')
  revalidatePath(`/expenses/${expenseId}`)
  return { success: true }
}

/**
 * Submit a draft expense for review
 */
export async function submitExpenseReimbursement(
  expenseId: string
): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Fetch the expense
  const { data: expense, error: fetchError } = await supabase
    .from('expense_reimbursements')
    .select('id, submitter_id, status')
    .eq('id', expenseId)
    .single()

  if (fetchError || !expense) {
    return { success: false, error: 'Expense not found' }
  }

  // Only the submitter can submit
  if (expense.submitter_id !== profile.id) {
    return { success: false, error: 'You can only submit your own expenses' }
  }

  // Can only submit draft expenses
  if (expense.status !== 'draft') {
    return { success: false, error: 'Only draft expenses can be submitted' }
  }

  // Update status
  const { error: updateError } = await supabase
    .from('expense_reimbursements')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', expenseId)

  if (updateError) {
    console.error('Submit expense error:', updateError)
    return { success: false, error: 'Failed to submit expense' }
  }

  revalidatePath('/expenses')
  return { success: true }
}

/**
 * Delete a draft expense
 */
export async function deleteExpenseReimbursement(
  expenseId: string
): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Fetch the expense
  const { data: expense, error: fetchError } = await supabase
    .from('expense_reimbursements')
    .select('id, submitter_id, status, receipt_url, unit_id')
    .eq('id', expenseId)
    .single()

  if (fetchError || !expense) {
    return { success: false, error: 'Expense not found' }
  }

  // Check if user is the submitter or an admin
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('profile_id', profile.id)
    .eq('unit_id', expense.unit_id)
    .eq('status', 'active')
    .single()

  const isAdmin = membership?.role === 'admin'
  const isSubmitter = expense.submitter_id === profile.id

  if (!isSubmitter && !isAdmin) {
    return { success: false, error: 'Cannot delete this expense' }
  }

  // Can only delete draft expenses (unless admin)
  if (expense.status !== 'draft' && !isAdmin) {
    return { success: false, error: 'Only draft expenses can be deleted' }
  }

  // Delete the expense
  const { error: deleteError } = await supabase
    .from('expense_reimbursements')
    .delete()
    .eq('id', expenseId)

  if (deleteError) {
    console.error('Delete expense error:', deleteError)
    return { success: false, error: 'Failed to delete expense' }
  }

  revalidatePath('/expenses')
  return { success: true }
}

/**
 * Get expenses for a unit with optional filters
 */
export async function getExpenseReimbursements(
  unitId: string,
  filters?: ExpenseFilters,
  options?: { page?: number; limit?: number }
): Promise<GetExpensesResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Check membership
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('profile_id', profile.id)
    .eq('unit_id', unitId)
    .eq('status', 'active')
    .single()

  if (!membership) {
    return { success: false, error: 'Not a member of this unit' }
  }

  const isFinancialRole = ['admin', 'treasurer'].includes(membership.role)
  const page = options?.page ?? 1
  const limit = options?.limit ?? 20
  const offset = (page - 1) * limit

  // Build query
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
    .eq('unit_id', unitId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  // Non-financial users can only see their own expenses
  if (!isFinancialRole) {
    query = query.eq('submitter_id', profile.id)
  }

  // Apply filters
  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }

  if (filters?.category && filters.category !== 'all') {
    query = query.eq('category', filters.category)
  }

  if (filters?.submitter_id && isFinancialRole) {
    query = query.eq('submitter_id', filters.submitter_id)
  }

  if (filters?.date_from) {
    query = query.gte('expense_date', filters.date_from)
  }

  if (filters?.date_to) {
    query = query.lte('expense_date', filters.date_to)
  }

  const { data: expenses, error, count } = await query

  if (error) {
    console.error('Get expenses error:', error)
    return { success: false, error: 'Failed to fetch expenses' }
  }

  return {
    success: true,
    data: {
      expenses: (expenses as ExpenseReimbursementWithSubmitter[]) || [],
      total: count || 0,
    },
  }
}

/**
 * Get a single expense by ID
 */
export async function getExpenseReimbursement(
  expenseId: string
): Promise<ActionResult & { data?: ExpenseReimbursementWithSubmitter }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  // Fetch the expense with submitter
  const { data: expense, error } = await supabase
    .from('expense_reimbursements')
    .select(
      `
      *,
      submitter:profiles!expense_reimbursements_submitter_id_fkey(
        id,
        full_name,
        email
      )
    `
    )
    .eq('id', expenseId)
    .single()

  if (error || !expense) {
    return { success: false, error: 'Expense not found' }
  }

  // Check access
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('profile_id', profile.id)
    .eq('unit_id', expense.unit_id)
    .eq('status', 'active')
    .single()

  if (!membership) {
    return { success: false, error: 'Not authorized to view this expense' }
  }

  const isFinancialRole = ['admin', 'treasurer'].includes(membership.role)
  const isSubmitter = expense.submitter_id === profile.id

  if (!isFinancialRole && !isSubmitter) {
    return { success: false, error: 'Not authorized to view this expense' }
  }

  return {
    success: true,
    data: expense as ExpenseReimbursementWithSubmitter,
  }
}
