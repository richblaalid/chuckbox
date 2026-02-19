import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock resend
const mockSendEmail = vi.fn()
vi.mock('@/lib/email/resend', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

// Import after mocking
import { sendExpenseApprovalEmail, sendExpenseRejectionEmail } from '@/lib/email/send-expense-notifications'

describe('sendExpenseApprovalEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendEmail.mockResolvedValue({ id: 'email-123' })
  })

  it('sends approval email to submitter', async () => {
    await sendExpenseApprovalEmail({
      submitterEmail: 'john@example.com',
      submitterName: 'John Doe',
      unitName: 'Troop 42',
      description: 'Camping supplies',
      amount: 125.50,
      expenseDate: '2026-02-15',
      reviewerName: 'Jane Smith',
      reviewNotes: null,
      expenseId: 'abc123',
    })

    expect(mockSendEmail).toHaveBeenCalledOnce()
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'john@example.com',
        subject: expect.stringContaining('Approved'),
        html: expect.stringContaining('Camping supplies'),
        text: expect.stringContaining('Camping supplies'),
      })
    )
  })

  it('includes review notes in email when provided', async () => {
    await sendExpenseApprovalEmail({
      submitterEmail: 'john@example.com',
      submitterName: 'John Doe',
      unitName: 'Troop 42',
      description: 'Food for campout',
      amount: 50,
      expenseDate: '2026-02-15',
      reviewerName: 'Jane Smith',
      reviewNotes: 'Great job keeping costs down',
      expenseId: 'abc123',
    })

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('Great job keeping costs down'),
      })
    )
  })

  it('does not throw if sendEmail fails', async () => {
    mockSendEmail.mockRejectedValue(new Error('Email service down'))

    await expect(
      sendExpenseApprovalEmail({
        submitterEmail: 'john@example.com',
        submitterName: 'John Doe',
        unitName: 'Troop 42',
        description: 'Supplies',
        amount: 30,
        expenseDate: '2026-02-15',
        reviewerName: 'Jane Smith',
        reviewNotes: null,
        expenseId: 'abc123',
      })
    ).resolves.not.toThrow()
  })
})

describe('sendExpenseRejectionEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendEmail.mockResolvedValue({ id: 'email-456' })
  })

  it('sends rejection email to submitter', async () => {
    await sendExpenseRejectionEmail({
      submitterEmail: 'john@example.com',
      submitterName: 'John Doe',
      unitName: 'Troop 42',
      description: 'Office supplies',
      amount: 45.99,
      expenseDate: '2026-02-10',
      reviewerName: 'Jane Smith',
      rejectionReason: 'Missing receipt',
      expenseId: 'abc123',
    })

    expect(mockSendEmail).toHaveBeenCalledOnce()
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'john@example.com',
        subject: expect.stringContaining('Rejected'),
        html: expect.stringContaining('Missing receipt'),
        text: expect.stringContaining('Missing receipt'),
      })
    )
  })

  it('includes edit URL in email', async () => {
    await sendExpenseRejectionEmail({
      submitterEmail: 'john@example.com',
      submitterName: 'John Doe',
      unitName: 'Troop 42',
      description: 'Office supplies',
      amount: 45.99,
      expenseDate: '2026-02-10',
      reviewerName: 'Jane Smith',
      rejectionReason: 'Missing receipt',
      expenseId: 'abc123',
    })

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('/expenses/abc123/edit'),
      })
    )
  })

  it('does not throw if sendEmail fails', async () => {
    mockSendEmail.mockRejectedValue(new Error('Email service down'))

    await expect(
      sendExpenseRejectionEmail({
        submitterEmail: 'john@example.com',
        submitterName: 'John Doe',
        unitName: 'Troop 42',
        description: 'Supplies',
        amount: 30,
        expenseDate: '2026-02-15',
        reviewerName: 'Jane Smith',
        rejectionReason: 'Not approved',
        expenseId: 'abc123',
      })
    ).resolves.not.toThrow()
  })
})
