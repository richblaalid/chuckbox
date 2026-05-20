import { describe, it, expect } from 'vitest'
import { allocatePayment, computeAllocations, type OutstandingCharge, type RowState, type AllocationInput } from '@/lib/payment-allocation'

const makeCharge = (id: string, amount: number, date: string): OutstandingCharge => ({
  id,
  billingRecordId: `br-${id}`,
  description: `Charge ${id}`,
  amount,
  paidAmount: 0,
  billingDate: date,
  createdAt: date,
})

/**
 * Build an AllocationInput from a charges array and partial overrides.
 * rows default to all unchecked / non-manual unless `rowOverrides` flips them.
 */
function makeInput(
  charges: OutstandingCharge[],
  overrides: Partial<Omit<AllocationInput, 'charges' | 'rows'>> & {
    rowOverrides?: Array<Partial<RowState> & { chargeId: string }>
  } = {}
): AllocationInput {
  const rows: RowState[] = charges.map((c) => {
    const override = overrides.rowOverrides?.find((r) => r.chargeId === c.id)
    return {
      chargeId: c.id,
      checked: override?.checked ?? false,
      manualAmount: override?.manualAmount ?? null,
    }
  })
  return {
    charges,
    rows,
    cash: overrides.cash ?? 0,
    funds: overrides.funds ?? 0,
    outstandingBalance: overrides.outstandingBalance ?? charges.reduce((s, c) => s + (c.amount - c.paidAmount), 0),
    cardFeeNet: overrides.cardFeeNet,
  }
}

describe('allocatePayment', () => {
  const charges = [
    makeCharge('1', 50, '2026-06-01'),
    makeCharge('2', 20, '2026-06-15'),
    makeCharge('3', 435, '2026-07-15'),
  ]

  it('allocates nothing for zero payment', () => {
    expect(allocatePayment(charges, 0)).toEqual([])
  })

  it('fully covers first charge only', () => {
    expect(allocatePayment(charges, 50)).toEqual([{ chargeId: '1', amount: 50 }])
  })

  it('fully covers first two charges', () => {
    expect(allocatePayment(charges, 70)).toEqual([
      { chargeId: '1', amount: 50 },
      { chargeId: '2', amount: 20 },
    ])
  })

  it('partially covers a charge', () => {
    expect(allocatePayment(charges, 60)).toEqual([
      { chargeId: '1', amount: 50 },
      { chargeId: '2', amount: 10 },
    ])
  })

  it('covers all charges exactly', () => {
    expect(allocatePayment(charges, 505)).toEqual([
      { chargeId: '1', amount: 50 },
      { chargeId: '2', amount: 20 },
      { chargeId: '3', amount: 435 },
    ])
  })

  it('handles charges with existing partial payments', () => {
    const partiallyPaid = [
      { ...charges[0], paidAmount: 30 },
      charges[1],
      charges[2],
    ]
    expect(allocatePayment(partiallyPaid, 40)).toEqual([
      { chargeId: '1', amount: 20 },
      { chargeId: '2', amount: 20 },
    ])
  })

  it('returns empty for negative payment', () => {
    expect(allocatePayment(charges, -10)).toEqual([])
  })
})

describe('computeAllocations — baseline', () => {
  it('returns no_money issue when cash and funds are both zero', () => {
    const charges = [makeCharge('1', 50, '2026-06-01')]
    const result = computeAllocations(makeInput(charges))
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({ kind: 'no_money' })
    expect(result.rowAmounts).toEqual({})
  })

  it('honors a pre-checked charge with cash equal to its owed', () => {
    const charges = [makeCharge('B', 25, '2026-06-15')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 25,
        rowOverrides: [{ chargeId: 'B', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.rowAmounts).toEqual({ B: 25 })
    expect(result.autoExtendedIds.size).toBe(0)
    expect(result.cashAllocations).toEqual([{ chargeId: 'B', amount: 25 }])
    expect(result.fundsAllocations).toEqual([])
  })

  it('dashboard flow with no pre-check: auto-extends FIFO by date as cash grows', () => {
    const charges = [
      makeCharge('older', 30, '2026-06-01'),
      makeCharge('newer', 25, '2026-06-15'),
    ]
    const result = computeAllocations(makeInput(charges, { cash: 50 }))
    expect(result.isValid).toBe(true)
    // Auto-extended both rows; FIFO by date — older fills first ($30), newer gets $20
    expect(result.rowAmounts).toEqual({ older: 30, newer: 20 })
    expect(result.autoExtendedIds).toEqual(new Set(['older', 'newer']))
  })

  it('user-checked rows fill before auto-extended rows (Bug 3 fix)', () => {
    const charges = [
      makeCharge('older', 30, '2026-06-01'),
      makeCharge('newer', 25, '2026-06-15'),
    ]
    // Treasurer clicked "Record Payment" on the newer charge → pre-checked = 'newer'
    const result = computeAllocations(
      makeInput(charges, {
        cash: 40,
        rowOverrides: [{ chargeId: 'newer', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    // 'newer' fills first ($25 — user intent), then auto-extended 'older' gets $15
    expect(result.rowAmounts).toEqual({ newer: 25, older: 15 })
    expect(result.autoExtendedIds).toEqual(new Set(['older']))
  })
})
