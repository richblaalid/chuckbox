import type { ExpenseCategory, ExpenseStatus } from './types'

// Expense categories with display labels
export const EXPENSE_CATEGORIES: Record<
  ExpenseCategory,
  { label: string; description: string }
> = {
  supplies: {
    label: 'Supplies',
    description: 'Camping gear, equipment, materials',
  },
  food: {
    label: 'Food',
    description: 'Groceries, meals, snacks for events',
  },
  travel: {
    label: 'Travel',
    description: 'Gas, mileage, transportation costs',
  },
  other: {
    label: 'Other',
    description: 'Miscellaneous expenses',
  },
}

// Expense status with display info
export const EXPENSE_STATUSES: Record<
  ExpenseStatus,
  { label: string; color: string; description: string }
> = {
  draft: {
    label: 'Draft',
    color: 'gray',
    description: 'Not yet submitted for review',
  },
  submitted: {
    label: 'Submitted',
    color: 'blue',
    description: 'Awaiting treasurer review',
  },
  approved: {
    label: 'Approved',
    color: 'green',
    description: 'Approved, awaiting payment',
  },
  rejected: {
    label: 'Rejected',
    color: 'red',
    description: 'Rejected by treasurer',
  },
  paid: {
    label: 'Paid',
    color: 'emerald',
    description: 'Reimbursement completed',
  },
}

// Category options for select dropdowns
export const CATEGORY_OPTIONS = Object.entries(EXPENSE_CATEGORIES).map(
  ([value, { label }]) => ({
    value: value as ExpenseCategory,
    label,
  })
)

// Status options for filter dropdowns
export const STATUS_OPTIONS = Object.entries(EXPENSE_STATUSES).map(
  ([value, { label }]) => ({
    value: value as ExpenseStatus,
    label,
  })
)

// File upload constraints
export const RECEIPT_UPLOAD = {
  maxSize: 10 * 1024 * 1024, // 10MB
  maxSizeLabel: '10MB',
  acceptedTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf',
  ],
  acceptedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.pdf'],
  acceptString: 'image/jpeg,image/png,image/webp,image/heic,application/pdf',
}

// Payment methods for marking expenses as paid
export const PAYMENT_METHODS = [
  { value: 'check', label: 'Check' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'other', label: 'Other' },
]
