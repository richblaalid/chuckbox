export interface LineItem {
  description: string
  amount: number
}

export interface LineItemValidationError {
  rowIndex: number
  message: string
}

export function validateLineItems(lineItems: LineItem[]): LineItemValidationError | null {
  if (lineItems.length === 0) return null

  for (let i = 0; i < lineItems.length; i++) {
    if (lineItems[i].amount <= 0) {
      return { rowIndex: i, message: 'Each line item must have an amount greater than $0' }
    }
  }

  if (lineItems.length >= 2) {
    for (let i = 0; i < lineItems.length; i++) {
      if (!lineItems[i].description.trim()) {
        return { rowIndex: i, message: `Line item ${i + 1} needs a description` }
      }
    }
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
