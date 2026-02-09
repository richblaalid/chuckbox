export interface PaymentReminderEmailData {
  guardianName: string
  scoutName: string
  unitName: string
  amountDue: number
  daysOverdue: number
  paymentUrl: string
  unitContactEmail?: string
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(amount))
}

export function generatePaymentReminderEmail(data: PaymentReminderEmailData): {
  subject: string
  html: string
  text: string
} {
  const {
    guardianName,
    scoutName,
    unitName,
    amountDue,
    daysOverdue,
    paymentUrl,
    unitContactEmail,
  } = data

  // Determine urgency level for styling
  const isUrgent = daysOverdue >= 60
  const isOverdue = daysOverdue >= 30
  const urgencyColor = isUrgent ? '#dc2626' : isOverdue ? '#d97706' : '#2563eb'
  const urgencyLabel = isUrgent ? 'Past Due' : isOverdue ? 'Overdue' : 'Payment Due'

  const subject = `Payment Reminder: ${formatCurrency(amountDue)} due for ${scoutName} - ${unitName}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Reminder</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #e5e7eb;">
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 600; color: #111827;">Payment Reminder</h1>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">${unitName}</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #374151;">Hello ${guardianName},</p>

              <p style="margin: 0 0 24px; color: #374151;">
                This is a friendly reminder that there is an outstanding balance on <strong>${scoutName}</strong>'s account.
              </p>

              <!-- Balance Box -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px; background-color: #f9fafb; border-radius: 8px; border: 2px solid ${urgencyColor}20;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: ${urgencyColor}; text-transform: uppercase; letter-spacing: 0.5px;">${urgencyLabel}</p>
                    <p style="margin: 0 0 8px; font-size: 36px; font-weight: 700; color: ${urgencyColor};">${formatCurrency(amountDue)}</p>
                    ${daysOverdue > 0 ? `<p style="margin: 0; font-size: 14px; color: #6b7280;">${daysOverdue} days overdue</p>` : ''}
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${paymentUrl}" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      Pay Now
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px; text-align: center; color: #6b7280; font-size: 12px;">
                Or copy this link: <a href="${paymentUrl}" style="color: #2563eb;">${paymentUrl}</a>
              </p>

              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                If you have already made a payment, please disregard this reminder.
                ${unitContactEmail ? `If you have questions about this balance, please contact us at <a href="mailto:${unitContactEmail}" style="color: #2563eb;">${unitContactEmail}</a>.` : 'If you have questions, please contact your unit leader.'}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center;">
                This email was sent by ${unitName} via ChuckBox.<br>
                <a href="${paymentUrl}" style="color: #2563eb;">View account details</a>
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

  // Plain text version
  const text = `
Payment Reminder from ${unitName}

Hello ${guardianName},

This is a friendly reminder that there is an outstanding balance on ${scoutName}'s account.

${urgencyLabel}: ${formatCurrency(amountDue)}
${daysOverdue > 0 ? `${daysOverdue} days overdue` : ''}

Pay now: ${paymentUrl}

If you have already made a payment, please disregard this reminder.
${unitContactEmail ? `Questions? Contact us at ${unitContactEmail}` : 'Questions? Contact your unit leader.'}

---
This email was sent by ${unitName} via ChuckBox.
`.trim()

  return { subject, html, text }
}
