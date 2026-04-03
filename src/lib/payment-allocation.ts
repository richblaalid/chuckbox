export interface OutstandingCharge {
  id: string
  billingRecordId: string
  description: string
  amount: number
  paidAmount: number
  billingDate: string
  createdAt: string
}

export interface Allocation {
  chargeId: string
  amount: number
}

/**
 * Allocate a payment amount across outstanding charges using FIFO (oldest first).
 * Respects existing partial payments on each charge.
 */
export function allocatePayment(
  charges: OutstandingCharge[],
  paymentAmount: number
): Allocation[] {
  if (paymentAmount <= 0) return []

  const sorted = [...charges].sort((a, b) => {
    const dateComp = a.billingDate.localeCompare(b.billingDate)
    if (dateComp !== 0) return dateComp
    return a.createdAt.localeCompare(b.createdAt)
  })

  const allocations: Allocation[] = []
  let remaining = paymentAmount

  for (const charge of sorted) {
    if (remaining <= 0) break
    const owed = charge.amount - charge.paidAmount
    if (owed <= 0) continue
    const alloc = Math.min(remaining, owed)
    allocations.push({ chargeId: charge.id, amount: alloc })
    remaining -= alloc
  }

  return allocations
}
