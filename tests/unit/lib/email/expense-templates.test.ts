import { describe, it, expect } from 'vitest'
import {
  generateExpenseApprovedEmail,
  type ExpenseApprovedEmailData,
} from '@/lib/email/templates/expense-approved'
import {
  generateExpenseRejectedEmail,
  type ExpenseRejectedEmailData,
} from '@/lib/email/templates/expense-rejected'

describe('generateExpenseApprovedEmail', () => {
  const baseData: ExpenseApprovedEmailData = {
    submitterName: 'John Doe',
    unitName: 'Troop 42',
    description: 'Camping supplies from REI',
    amount: 125.5,
    expenseDate: '2026-02-15',
    reviewerName: 'Jane Smith',
    reviewNotes: null,
    expenseUrl: 'https://chuckbox.app/expenses/abc123',
  }

  it('renders HTML with expense details', () => {
    const { html } = generateExpenseApprovedEmail(baseData)

    expect(html).toContain('Expense Approved')
    expect(html).toContain('John Doe')
    expect(html).toContain('Troop 42')
    expect(html).toContain('Camping supplies from REI')
    expect(html).toContain('$125.50')
    expect(html).toContain('Jane Smith')
    expect(html).toContain('https://chuckbox.app/expenses/abc123')
  })

  it('renders plain text with expense details', () => {
    const { text } = generateExpenseApprovedEmail(baseData)

    expect(text).toContain('Expense Approved')
    expect(text).toContain('Camping supplies from REI')
    expect(text).toContain('$125.50')
    expect(text).toContain('Jane Smith')
    expect(text).toContain('https://chuckbox.app/expenses/abc123')
  })

  it('includes review notes when provided', () => {
    const data = { ...baseData, reviewNotes: 'Looks good, thanks for handling this!' }
    const { html, text } = generateExpenseApprovedEmail(data)

    expect(html).toContain('Looks good, thanks for handling this!')
    expect(text).toContain('Looks good, thanks for handling this!')
  })

  it('omits review notes section when null', () => {
    const { html } = generateExpenseApprovedEmail(baseData)

    expect(html).not.toContain('Review Notes')
  })

  it('formats the expense date', () => {
    const { html } = generateExpenseApprovedEmail(baseData)

    expect(html).toContain('Feb 15, 2026')
  })
})

describe('generateExpenseRejectedEmail', () => {
  const baseData: ExpenseRejectedEmailData = {
    submitterName: 'John Doe',
    unitName: 'Troop 42',
    description: 'Office supplies',
    amount: 45.99,
    expenseDate: '2026-02-10',
    reviewerName: 'Jane Smith',
    rejectionReason: 'Receipt is missing. Please resubmit with the original receipt.',
    editUrl: 'https://chuckbox.app/expenses/abc123/edit',
  }

  it('renders HTML with rejection details', () => {
    const { html } = generateExpenseRejectedEmail(baseData)

    expect(html).toContain('Expense Rejected')
    expect(html).toContain('John Doe')
    expect(html).toContain('Troop 42')
    expect(html).toContain('Office supplies')
    expect(html).toContain('$45.99')
    expect(html).toContain('Jane Smith')
    expect(html).toContain('Receipt is missing')
    expect(html).toContain('https://chuckbox.app/expenses/abc123/edit')
  })

  it('renders plain text with rejection details', () => {
    const { text } = generateExpenseRejectedEmail(baseData)

    expect(text).toContain('Expense Rejected')
    expect(text).toContain('Office supplies')
    expect(text).toContain('$45.99')
    expect(text).toContain('Receipt is missing')
    expect(text).toContain('https://chuckbox.app/expenses/abc123/edit')
  })

  it('includes edit/resubmit CTA', () => {
    const { html, text } = generateExpenseRejectedEmail(baseData)

    expect(html).toContain('Edit &amp; Resubmit')
    expect(text).toContain('Edit & Resubmit')
  })

  it('formats the expense date', () => {
    const { html } = generateExpenseRejectedEmail(baseData)

    expect(html).toContain('Feb 10, 2026')
  })
})
