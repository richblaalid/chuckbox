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
 * Compute per-row payment allocations and validation issues from form state.
 *
 * Order of operations:
 *   1. Determine effective check set (user-checked + auto-extended for spillover).
 *   2. Fill per-row amounts: manual rows first (sticky), then user-checked non-manual
 *      (FIFO by date), then auto-extended non-manual (FIFO by date).
 *   3. Validate invariants.
 *   4. Split per-row amounts into funds vs cash slices (drain funds first, then cash).
 */
export function computeAllocations(input: AllocationInput): AllocationResult {
  const { charges, rows, cash, funds, outstandingBalance, cardFeeNet } = input

  const total = cash + funds
  const issues: ValidationIssue[] = []
  const rowAmounts: Record<string, number> = {}
  const autoExtendedIds = new Set<string>()

  // No money → no work
  if (total <= 0) {
    issues.push({ kind: 'no_money' })
    return {
      rowAmounts,
      autoExtendedIds,
      fundsAllocations: [],
      cashAllocations: [],
      issues,
      isValid: false,
    }
  }

  // Build a chargeId → owed lookup (amount − already-paid)
  const chargeById = new Map<string, OutstandingCharge>(charges.map((c) => [c.id, c]))
  const owedOf = (id: string) => {
    const c = chargeById.get(id)
    return c ? Math.max(0, c.amount - (c.paidAmount || 0)) : 0
  }

  // Date-sort helper (oldest first, then createdAt for stable ties)
  const byDate = (a: OutstandingCharge, b: OutstandingCharge) => {
    const d = a.billingDate.localeCompare(b.billingDate)
    return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt)
  }
  const sortedCharges = [...charges].sort(byDate)

  // Separate manual vs non-manual rows
  const manualRows = rows.filter((r) => r.manualAmount !== null)
  for (const r of manualRows) {
    rowAmounts[r.chargeId] = r.manualAmount as number
  }
  const manualSum = manualRows.reduce((s, r) => s + (r.manualAmount as number), 0)

  // Effective check set: explicitly-checked rows (user intent)
  const userCheckedIds = new Set(rows.filter((r) => r.checked).map((r) => r.chargeId))
  // Sum of user-checked owed (used for auto-extend decision)
  const userCheckedOwedSum = [...userCheckedIds].reduce((s, id) => s + owedOf(id), 0)

  // Auto-extend: if total cash+funds exceeds user-checked owed, walk unchecked FIFO to absorb
  if (total > userCheckedOwedSum) {
    let toAbsorb = total - userCheckedOwedSum
    for (const c of sortedCharges) {
      if (toAbsorb <= 0) break
      if (userCheckedIds.has(c.id)) continue
      const o = owedOf(c.id)
      if (o <= 0) continue
      autoExtendedIds.add(c.id)
      toAbsorb -= Math.min(o, toAbsorb)
    }
  }

  // Fill order: user-checked non-manual rows (FIFO by date) then auto-extended non-manual (FIFO by date)
  let remaining = Math.max(0, total - manualSum)

  const fillPool = (poolIds: Set<string>) => {
    if (remaining <= 0) return
    const poolCharges = sortedCharges.filter((c) => poolIds.has(c.id) && !(c.id in rowAmounts))
    for (const c of poolCharges) {
      if (remaining <= 0) break
      const o = owedOf(c.id)
      if (o <= 0) continue
      const alloc = Math.min(o, remaining)
      rowAmounts[c.id] = alloc
      remaining -= alloc
    }
  }

  fillPool(userCheckedIds)
  fillPool(autoExtendedIds)

  // Validation
  const rowSum = Object.values(rowAmounts).reduce((s, n) => s + n, 0)
  if (Math.abs(rowSum - total) > ALLOCATION_TOLERANCE) {
    issues.push({ kind: 'sum_mismatch', expected: total, actual: rowSum })
  }

  const billingApplied = cardFeeNet !== undefined ? cardFeeNet : total
  if (billingApplied > outstandingBalance + ALLOCATION_TOLERANCE) {
    issues.push({ kind: 'exceeds_outstanding', total: billingApplied, outstanding: outstandingBalance })
  }

  const positiveRows = Object.values(rowAmounts).filter((n) => n > 0).length
  if (positiveRows === 0) {
    issues.push({ kind: 'no_charges_checked' })
  }

  // Funds vs cash split: drain funds first across rowAmounts in date order
  const fundsAllocations: Allocation[] = []
  const cashAllocations: Allocation[] = []
  let fundsRemaining = funds
  let cashRemaining = cash

  for (const c of sortedCharges) {
    let rowRemaining = rowAmounts[c.id] || 0
    if (rowRemaining <= 0) continue
    if (fundsRemaining > 0) {
      const take = Math.min(fundsRemaining, rowRemaining)
      fundsAllocations.push({ chargeId: c.id, amount: take })
      fundsRemaining -= take
      rowRemaining -= take
    }
    if (rowRemaining > 0 && cashRemaining > 0) {
      const take = Math.min(cashRemaining, rowRemaining)
      cashAllocations.push({ chargeId: c.id, amount: take })
      cashRemaining -= take
    }
  }

  return {
    rowAmounts,
    autoExtendedIds,
    fundsAllocations,
    cashAllocations,
    issues,
    isValid: issues.length === 0,
  }
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
