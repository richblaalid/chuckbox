import { z } from 'zod'

// Expense category enum values
const expenseCategories = ['supplies', 'food', 'travel', 'other'] as const

// Expense status enum values
const expenseStatuses = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'paid',
] as const

// Schema for creating/updating expense form data
export const expenseFormSchema = z.object({
  description: z
    .string()
    .min(3, 'Description must be at least 3 characters')
    .max(500, 'Description must be under 500 characters'),
  amount: z
    .number()
    .positive('Amount must be positive')
    .max(100000, 'Amount cannot exceed $100,000'),
  expense_date: z.string().refine((date) => {
    const parsed = new Date(date)
    return !isNaN(parsed.getTime())
  }, 'Invalid date'),
  category: z.enum(expenseCategories, 'Please select a category'),
  vendor: z.string().max(200, 'Vendor name must be under 200 characters').optional(),
})

// Schema for expense submission (form data + optional receipt)
export const expenseSubmissionSchema = expenseFormSchema.extend({
  receipt_url: z.string().url('Invalid receipt URL').optional(),
  receipt_filename: z.string().max(255).optional(),
  submit: z.boolean().optional(), // true to submit immediately, false for draft
})

// Schema for expense approval
export const expenseApprovalSchema = z.object({
  expense_id: z.string().uuid('Invalid expense ID'),
  review_notes: z.string().max(1000, 'Notes must be under 1000 characters').optional(),
})

// Schema for expense rejection
export const expenseRejectionSchema = z.object({
  expense_id: z.string().uuid('Invalid expense ID'),
  rejection_reason: z
    .string()
    .min(5, 'Please provide a reason for rejection')
    .max(1000, 'Rejection reason must be under 1000 characters'),
})

// Schema for marking expense as paid
export const expensePaymentSchema = z.object({
  expense_id: z.string().uuid('Invalid expense ID'),
  payment_method: z.string().min(1, 'Please select a payment method'),
  payment_reference: z
    .string()
    .max(200, 'Reference must be under 200 characters')
    .optional(),
})

// Schema for expense list filters
export const expenseFiltersSchema = z.object({
  status: z.enum([...expenseStatuses, 'all']).optional(),
  category: z.enum([...expenseCategories, 'all']).optional(),
  submitter_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
})

// Schema for AI receipt extraction result
export const receiptExtractionSchema = z.object({
  amount: z.number().positive().optional(),
  vendor: z.string().optional(),
  date: z.string().optional(),
  description: z.string().optional(),
  confidence: z.number().min(0).max(1),
  raw_text: z.string().optional(),
})

// Type exports from schemas
export type ExpenseFormInput = z.infer<typeof expenseFormSchema>
export type ExpenseSubmissionInput = z.infer<typeof expenseSubmissionSchema>
export type ExpenseApprovalInput = z.infer<typeof expenseApprovalSchema>
export type ExpenseRejectionInput = z.infer<typeof expenseRejectionSchema>
export type ExpensePaymentInput = z.infer<typeof expensePaymentSchema>
export type ExpenseFiltersInput = z.infer<typeof expenseFiltersSchema>
export type ReceiptExtractionOutput = z.infer<typeof receiptExtractionSchema>
