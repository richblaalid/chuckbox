import type { Database } from '@/types/database'

// Database types
export type ExpenseReimbursement =
  Database['public']['Tables']['expense_reimbursements']['Row']
export type ExpenseReimbursementInsert =
  Database['public']['Tables']['expense_reimbursements']['Insert']
export type ExpenseReimbursementUpdate =
  Database['public']['Tables']['expense_reimbursements']['Update']

// Enum types from database
export type ExpenseCategory = Database['public']['Enums']['expense_category']
export type ExpenseStatus = Database['public']['Enums']['expense_status']

// Extended types with relations
export interface ExpenseReimbursementWithSubmitter extends ExpenseReimbursement {
  submitter: {
    id: string
    full_name: string | null
    email: string | null
  } | null
}

export interface ExpenseReimbursementWithReviewer extends ExpenseReimbursement {
  submitter: {
    id: string
    full_name: string | null
    email: string | null
  } | null
  reviewer: {
    id: string
    full_name: string | null
  } | null
}

// Form data types
export interface ExpenseFormData {
  description: string
  amount: number
  expense_date: string
  category: ExpenseCategory
  vendor?: string
  receipt_url?: string
  receipt_filename?: string
}

// AI extraction result
export interface ReceiptExtractionResult {
  amount?: number
  vendor?: string
  date?: string
  description?: string
  confidence: number
  raw_text?: string
}

// Filter options for expense list
export interface ExpenseFilters {
  status?: ExpenseStatus | 'all'
  category?: ExpenseCategory | 'all'
  submitter_id?: string
  date_from?: string
  date_to?: string
}

// Approval/rejection action data
export interface ExpenseApprovalData {
  expense_id: string
  review_notes?: string
}

export interface ExpenseRejectionData {
  expense_id: string
  rejection_reason: string
}

// Payment action data
export interface ExpensePaymentData {
  expense_id: string
  payment_method: string
  payment_reference?: string
}
