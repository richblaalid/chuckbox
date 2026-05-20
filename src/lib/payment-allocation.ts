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

/** Per-row state owned by the parent component. */
export interface RowState {
  chargeId: string
  checked: boolean
  /** null = auto-fill from the engine; number = user-typed override (sticky across cash changes). */
  manualAmount: number | null
}

/** Input to the allocation engine. */
export interface AllocationInput {
  /** All outstanding charges for the scout (after filtering out paid/voided). */
  charges: OutstandingCharge[]
  /** One entry per charge, same length as `charges`. */
  rows: RowState[]
  /** External cash/check/card amount the treasurer is collecting. */
  cash: number
  /** Funds transfer amount (from scout's funds_balance). */
  funds: number
  /** Math.abs(scout.billing_balance). Used for the non-card outstanding cap. */
  outstandingBalance: number
  /**
   * For card-payment path only: the net-of-fee amount that will reduce billing_balance.
   * If provided, replaces `cash` in the exceeds-outstanding validation rule.
   * The actual `rowAmounts` distribution still uses `cash + funds`.
   */
  cardFeeNet?: number
}

/** Validation issues surfaced by the engine. */
export type ValidationIssue =
  | { kind: 'sum_mismatch'; expected: number; actual: number }
  | { kind: 'exceeds_outstanding'; total: number; outstanding: number }
  | { kind: 'funds_exceeds_available'; requested: number; available: number }
  | { kind: 'no_money' }
  | { kind: 'no_charges_checked' }

/** Output of the allocation engine — UI and server both consume this. */
export interface AllocationResult {
  /** Per-row resolved amount (what each row's $-input should display). chargeId → dollars. */
  rowAmounts: Record<string, number>
  /** Charge IDs the engine auto-checked to absorb spillover (UI badge hint). */
  autoExtendedIds: Set<string>
  /** Slice of per-row amounts to send via the funds RPC (drained first, FIFO across rows). */
  fundsAllocations: Allocation[]
  /** Slice of per-row amounts to send via recordQuickPayment (cash/check) or the card route. */
  cashAllocations: Allocation[]
  /** Collected validation problems; empty when isValid is true. */
  issues: ValidationIssue[]
  /** True when issues is empty. */
  isValid: boolean
}

/** Penny tolerance for sum-equality and floating-point comparisons. */
export const ALLOCATION_TOLERANCE = 0.01

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
