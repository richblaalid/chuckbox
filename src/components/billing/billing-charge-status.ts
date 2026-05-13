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
  // Defensive: paid_amount can reach/exceed amount before the reconcile trigger
  // flips is_paid (e.g., when allocations report full owed but cash collected
  // is less than the charge total, leaving billing_balance still negative).
  // Treating that state as 'paid' avoids the "$0 of $25 + Partial" display.
  if (c.amount > 0 && (c.paid_amount ?? 0) >= c.amount) return 'paid'
  if ((c.paid_amount ?? 0) > 0) return 'partial'
  return 'unpaid'
}

export function chargeRemaining(c: ChargeStatusInput): number {
  return Math.max(0, c.amount - (c.paid_amount ?? 0))
}

export interface RecordStatusInput {
  is_void: boolean | null
  charges: ChargeStatusInput[]
}

export function getRecordStatus(record: RecordStatusInput): ChargeStatus {
  if (record.is_void) return 'voided'
  const activeCharges = record.charges.filter(c => !c.is_void)
  if (activeCharges.length === 0) return 'paid'
  const statuses = activeCharges.map(chargeStatus)
  if (statuses.every(s => s === 'paid')) return 'paid'
  if (statuses.some(s => s === 'paid' || s === 'partial')) return 'partial'
  return 'unpaid'
}

export function hasCollectedPayments(record: RecordStatusInput): boolean {
  return record.charges.some(c => {
    if (c.is_void) return false
    const s = chargeStatus(c)
    return s === 'paid' || s === 'partial'
  })
}
