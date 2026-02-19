import { sendEmail } from '@/lib/email/resend'
import { generateExpenseApprovedEmail } from '@/lib/email/templates/expense-approved'
import { generateExpenseRejectedEmail } from '@/lib/email/templates/expense-rejected'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://chuckbox.app'

interface ExpenseApprovalEmailParams {
  submitterEmail: string
  submitterName: string
  unitName: string
  description: string
  amount: number
  expenseDate: string
  reviewerName: string
  reviewNotes: string | null
  expenseId: string
}

interface ExpenseRejectionEmailParams {
  submitterEmail: string
  submitterName: string
  unitName: string
  description: string
  amount: number
  expenseDate: string
  reviewerName: string
  rejectionReason: string
  expenseId: string
}

export async function sendExpenseApprovalEmail(params: ExpenseApprovalEmailParams): Promise<void> {
  try {
    const { html, text } = generateExpenseApprovedEmail({
      submitterName: params.submitterName,
      unitName: params.unitName,
      description: params.description,
      amount: params.amount,
      expenseDate: params.expenseDate,
      reviewerName: params.reviewerName,
      reviewNotes: params.reviewNotes,
      expenseUrl: `${APP_URL}/expenses/${params.expenseId}`,
    })

    await sendEmail({
      to: params.submitterEmail,
      subject: `Expense Approved: ${params.description}`,
      html,
      text,
    })
  } catch (error) {
    console.error('Failed to send expense approval email:', error)
  }
}

export async function sendExpenseRejectionEmail(params: ExpenseRejectionEmailParams): Promise<void> {
  try {
    const { html, text } = generateExpenseRejectedEmail({
      submitterName: params.submitterName,
      unitName: params.unitName,
      description: params.description,
      amount: params.amount,
      expenseDate: params.expenseDate,
      reviewerName: params.reviewerName,
      rejectionReason: params.rejectionReason,
      editUrl: `${APP_URL}/expenses/${params.expenseId}/edit`,
    })

    await sendEmail({
      to: params.submitterEmail,
      subject: `Expense Rejected: ${params.description}`,
      html,
      text,
    })
  } catch (error) {
    console.error('Failed to send expense rejection email:', error)
  }
}
