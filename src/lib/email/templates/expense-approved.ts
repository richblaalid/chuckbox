export interface ExpenseApprovedEmailData {
  submitterName: string
  unitName: string
  description: string
  amount: number
  expenseDate: string
  reviewerName: string
  reviewNotes: string | null
  expenseUrl: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

function formatDate(dateString: string): string {
  // Append noon time to date-only strings to avoid timezone-related date shifts
  const dateValue = dateString.includes('T') ? dateString : `${dateString}T12:00:00`
  return new Date(dateValue).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function generateExpenseApprovedEmail(data: ExpenseApprovedEmailData): {
  html: string
  text: string
} {
  const {
    submitterName,
    unitName,
    description,
    amount,
    expenseDate,
    reviewerName,
    reviewNotes,
    expenseUrl,
  } = data

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Expense Approved</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #e5e7eb;">
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 600; color: #16a34a;">Expense Approved</h1>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">${unitName}</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #374151;">Hello ${submitterName},</p>

              <p style="margin: 0 0 24px; color: #374151;">
                Your expense reimbursement request has been <strong style="color: #16a34a;">approved</strong> by ${reviewerName}.
              </p>

              <!-- Expense Details Box -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px; background-color: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #166534; font-weight: 600;">Expense Details</p>
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="padding: 4px 0; color: #15803d;">Description:</td>
                        <td style="padding: 4px 0; text-align: right; color: #15803d; font-weight: 500;">${description}</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #15803d;">Date:</td>
                        <td style="padding: 4px 0; text-align: right; color: #15803d;">${formatDate(expenseDate)}</td>
                      </tr>
                      <tr style="border-top: 1px solid #bbf7d0;">
                        <td style="padding: 8px 0 4px; font-weight: 700; color: #166534;">Amount:</td>
                        <td style="padding: 8px 0 4px; text-align: right; font-weight: 700; font-size: 18px; color: #166534;">${formatCurrency(amount)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${reviewNotes ? `
              <!-- Review Notes -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0 0 4px; font-size: 14px; font-weight: 600; color: #374151;">Review Notes</p>
                    <p style="margin: 0; color: #6b7280; font-size: 14px;">${reviewNotes}</p>
                  </td>
                </tr>
              </table>
              ` : ''}

              <p style="margin: 0 0 24px; color: #374151;">
                Payment will be processed separately. You'll be notified when the reimbursement is paid.
              </p>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${expenseUrl}" style="display: inline-block; padding: 14px 32px; background-color: #166534; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      View Expense
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center;">
                This email was sent by ${unitName} via ChuckBox.<br>
                If you have questions, please contact your unit leader directly.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

  const text = `
Expense Approved - ${unitName}

Hello ${submitterName},

Your expense reimbursement request has been approved by ${reviewerName}.

Expense Details:
  Description: ${description}
  Date: ${formatDate(expenseDate)}
  Amount: ${formatCurrency(amount)}

${reviewNotes ? `Review Notes: ${reviewNotes}\n\n` : ''}Payment will be processed separately. You'll be notified when the reimbursement is paid.

View expense: ${expenseUrl}

---
This email was sent by ${unitName} via ChuckBox.
If you have questions, please contact your unit leader directly.
`.trim()

  return { html, text }
}
