export interface LineItem {
  description: string
  amount: number
}

export function validateLineItems(lineItems: LineItem[], totalAmount: number): string | null {
  if (lineItems.length === 0) return null
  const sum = lineItems.reduce((acc, item) => acc + item.amount, 0)
  if (Math.abs(sum - totalAmount) > 0.01) {
    return `Line items sum to $${sum.toFixed(2)} but total is $${totalAmount.toFixed(2)}`
  }
  if (lineItems.some((item) => !item.description.trim())) {
    return 'All line items must have a description'
  }
  if (lineItems.some((item) => item.amount <= 0)) {
    return 'All line item amounts must be positive'
  }
  return null
}

export function parseLineItems(
  raw: unknown
): Array<{ description: string; amount: number }> | null {
  if (!Array.isArray(raw)) return null
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const obj = item as Record<string, unknown>
    if (typeof obj.description !== 'string') return null
    if (typeof obj.amount !== 'number') return null
  }
  return raw as Array<{ description: string; amount: number }>
}

export function validateDeposit(
  depositAmount: string,
  depositDueDate: string,
  totalAmount: number
): string | null {
  const parsed = parseFloat(depositAmount)
  if (depositAmount && parsed <= 0) {
    return 'Deposit amount must be positive'
  }
  if (depositAmount && parsed > totalAmount) {
    return 'Deposit amount cannot exceed the total billing amount'
  }
  if (depositDueDate && !depositAmount) {
    return 'Deposit amount is required when a due date is set'
  }
  return null
}
