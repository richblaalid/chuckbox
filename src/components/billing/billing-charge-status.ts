export interface ChargeStatusInput {
  amount: number
  paid_amount: number | null
  is_paid: boolean | null
  is_void: boolean | null
}

export type ChargeStatus = 'voided' | 'paid' | 'partial' | 'unpaid'

export function chargeStatus(c: ChargeStatusInput): ChargeStatus {
  if (c.is_void) return 'voided'
  if (c.is_paid) return 'paid'
  if ((c.paid_amount ?? 0) > 0) return 'partial'
  return 'unpaid'
}

export function chargeRemaining(c: ChargeStatusInput): number {
  return Math.max(0, c.amount - (c.paid_amount ?? 0))
}
