export interface ChargeNotificationEmailData {
  guardianName: string
  scoutName: string
  unitName: string
  unitLogoUrl?: string | null
  chargeDescription: string
  chargeAmount: number // in dollars
  chargeDate: string
  currentBalance: number // total owed (negative) or credit (positive)
  availableCredit: number // positive balance that can be applied
  paymentUrl: string
  customMessage?: string
  lineItems?: Array<{ description: string; amount: number }> | null
  totalScoutsOnRecord?: number
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(amount))
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function renderBillIncludesSection(
  lineItems: Array<{ description: string; amount: number }> | null | undefined,
  totalScoutsOnRecord: number | undefined,
  chargeAmount: number
): { html: string; text: string } {
  if (!lineItems || lineItems.length === 0) {
    return { html: '', text: '' }
  }

  const total = lineItems.reduce((sum, item) => sum + item.amount, 0)
  const scoutCount = totalScoutsOnRecord ?? 0
  const showShareLine = scoutCount >= 2

  const itemRowsHtml = lineItems
    .map(
      (item) => `
                      <tr>
                        <td style="padding: 4px 0; color: #4b5563;">${item.description}</td>
                        <td style="padding: 4px 0; text-align: right; color: #4b5563;">${formatCurrency(item.amount)}</td>
                      </tr>`
    )
    .join('')

  const html = `
              <!-- Bill Includes Box -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #374151; font-weight: 600;">Bill Includes</p>
                    <table role="presentation" style="width: 100%;">
                      ${itemRowsHtml}
                      <tr style="border-top: 1px solid #e5e7eb;">
                        <td style="padding: 8px 0 4px; font-weight: 700; color: #111827;">Total</td>
                        <td style="padding: 8px 0 4px; text-align: right; font-weight: 700; color: #111827;">${formatCurrency(total)}</td>
                      </tr>
                    </table>
                    ${
                      showShareLine
                        ? `
                    <p style="margin: 16px 0 0; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #6b7280;">
                      Your scout's share: <strong>${formatCurrency(chargeAmount)}</strong><br>
                      (1/${scoutCount} of the total)
                    </p>`
                        : ''
                    }
                  </td>
                </tr>
              </table>
`

  const itemRowsText = lineItems
    .map((item) => `  ${item.description}: ${formatCurrency(item.amount)}`)
    .join('\n')

  const text = `
Bill Includes:
${itemRowsText}
  ----------------------
  Total: ${formatCurrency(total)}${
    showShareLine
      ? `

  Your scout's share: ${formatCurrency(chargeAmount)} (1/${scoutCount} of the total)`
      : ''
  }
`

  return { html, text }
}

export function generateChargeNotificationEmail(data: ChargeNotificationEmailData): {
  html: string
  text: string
} {
  const {
    guardianName,
    scoutName,
    unitName,
    unitLogoUrl,
    chargeDescription,
    chargeAmount,
    chargeDate,
    currentBalance,
    availableCredit,
    paymentUrl,
    customMessage,
    lineItems,
    totalScoutsOnRecord,
  } = data

  const owesAmount = currentBalance < 0 ? Math.abs(currentBalance) : 0
  const hasCredit = availableCredit > 0
  const billIncludes = renderBillIncludesSection(lineItems, totalScoutsOnRecord, chargeAmount)

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Charge Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #e5e7eb;">
              ${unitLogoUrl ? `<img src="${unitLogoUrl}" alt="${unitName}" style="max-height: 60px; max-width: 200px; margin-bottom: 16px;">` : ''}
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 600; color: #111827;">New Charge</h1>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">${unitName}</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px; color: #374151;">Hello ${guardianName},</p>

              ${customMessage ? `<p style="margin: 0 0 16px; color: #374151;">${customMessage}</p>` : ''}

              <p style="margin: 0 0 24px; color: #374151;">
                A new charge has been added to <strong>${scoutName}</strong>'s account:
              </p>

              <!-- Charge Details Box -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px; background-color: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #991b1b; font-weight: 600;">Charge Details</p>
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="padding: 4px 0; color: #7f1d1d;">Description:</td>
                        <td style="padding: 4px 0; text-align: right; color: #7f1d1d; font-weight: 500;">${chargeDescription}</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #7f1d1d;">Date:</td>
                        <td style="padding: 4px 0; text-align: right; color: #7f1d1d;">${formatDate(chargeDate)}</td>
                      </tr>
                      <tr style="border-top: 1px solid #fecaca;">
                        <td style="padding: 8px 0 4px; font-weight: 700; color: #991b1b;">Amount:</td>
                        <td style="padding: 8px 0 4px; text-align: right; font-weight: 700; font-size: 18px; color: #991b1b;">${formatCurrency(chargeAmount)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              ${billIncludes.html}
              <!-- Credit Balance Notice -->
              ${hasCredit ? `
              <table role="presentation" style="width: 100%; margin-bottom: 24px; background-color: #ecfdf5; border-radius: 8px; border: 1px solid #6ee7b7;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0; color: #065f46; font-size: 14px;">
                      <strong>Good news!</strong> ${scoutName} has ${formatCurrency(availableCredit)} in account credit that can be applied to this charge.
                    </p>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- Current Balance Box -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px; background-color: #f9fafb; border-radius: 8px;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="margin: 0 0 4px; font-size: 14px; color: #6b7280;">Current Account Balance</p>
                    <p style="margin: 0; font-size: 28px; font-weight: 700; color: ${owesAmount > 0 ? '#dc2626' : '#16a34a'};">
                      ${owesAmount > 0 ? formatCurrency(owesAmount) + ' owed' : formatCurrency(Math.abs(currentBalance)) + ' credit'}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              ${owesAmount > 0 ? `
              <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${paymentUrl}" style="display: inline-block; padding: 14px 32px; background-color: #166534; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      ${hasCredit ? 'View Payment Options' : 'Pay Now'}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; text-align: center; color: #6b7280; font-size: 12px;">
                Or copy this link: <a href="${paymentUrl}" style="color: #166534;">${paymentUrl}</a>
              </p>
              ` : `
              <p style="margin: 0; color: #16a34a; text-align: center; font-weight: 500;">
                This charge can be covered by ${scoutName}'s existing credit balance.
              </p>
              <table role="presentation" style="width: 100%; margin-top: 16px;">
                <tr>
                  <td align="center">
                    <a href="${paymentUrl}" style="display: inline-block; padding: 14px 32px; background-color: #166534; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      Apply Credit to Charge
                    </a>
                  </td>
                </tr>
              </table>
              `}
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

  // Plain text version
  const text = `
New Charge Notification from ${unitName}

Hello ${guardianName},

${customMessage ? customMessage + '\n\n' : ''}A new charge has been added to ${scoutName}'s account:

Charge Details:
  Description: ${chargeDescription}
  Date: ${formatDate(chargeDate)}
  Amount: ${formatCurrency(chargeAmount)}
${billIncludes.text}
${hasCredit ? `Good news! ${scoutName} has ${formatCurrency(availableCredit)} in account credit that can be applied to this charge.\n\n` : ''}Current Account Balance: ${owesAmount > 0 ? formatCurrency(owesAmount) + ' owed' : formatCurrency(Math.abs(currentBalance)) + ' credit'}

${owesAmount > 0 ? `Pay now: ${paymentUrl}` : `Apply credit to charge: ${paymentUrl}`}

---
This email was sent by ${unitName} via ChuckBox.
If you have questions, please contact your unit leader directly.
`.trim()

  return { html, text }
}
