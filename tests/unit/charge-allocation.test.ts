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

describe('computeAllocations — manual override', () => {
  it('respects a manual row amount and distributes remainder FIFO to other checked rows', () => {
    const charges = [
      makeCharge('A', 30, '2026-06-01'),
      makeCharge('B', 50, '2026-06-15'),
    ]
    // Treasurer types $10 on B; total cash $40; A and B both checked.
    const result = computeAllocations(
      makeInput(charges, {
        cash: 40,
        rowOverrides: [
          { chargeId: 'A', checked: true },
          { chargeId: 'B', checked: true, manualAmount: 10 },
        ],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.rowAmounts).toEqual({ B: 10, A: 30 })
  })

  it('manual rows stay sticky when cash decreases (does not auto-clear)', () => {
    const charges = [makeCharge('A', 30, '2026-06-01'), makeCharge('B', 50, '2026-06-15')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 30, // decreased from a previous higher value
        rowOverrides: [
          { chargeId: 'A', checked: true, manualAmount: 20 },
          { chargeId: 'B', checked: true },
        ],
      })
    )
    // A holds $20 (manual); remaining $10 fills B
    expect(result.rowAmounts).toEqual({ A: 20, B: 10 })
    expect(result.isValid).toBe(true)
  })

  it('manual rows summing more than cash produce sum_mismatch', () => {
    const charges = [makeCharge('A', 50, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 20,
        rowOverrides: [{ chargeId: 'A', checked: true, manualAmount: 50 }],
      })
    )
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({ kind: 'sum_mismatch', expected: 20, actual: 50 })
  })
})

describe('computeAllocations — funds/cash drain split', () => {
  it('drains funds across rows in date order before cash', () => {
    // Scout owes A($30, older) and B($25, newer, pre-checked). Treasurer enters $5 funds + $30 cash.
    const charges = [
      makeCharge('A', 30, '2026-06-01'),
      makeCharge('B', 25, '2026-06-15'),
    ]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 30,
        funds: 5,
        rowOverrides: [{ chargeId: 'B', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    // User-checked B fills first ($25). Auto-extended A gets $10. Total = $35.
    expect(result.rowAmounts).toEqual({ B: 25, A: 10 })
    expect(result.autoExtendedIds).toEqual(new Set(['A']))

    // Split: walking rowAmounts in date order: A ($10) then B ($25).
    // Funds=$5 takes from front (A): fundsAllocations=[{A:5}], A.remaining=$5.
    // Cash=$30 takes rest: cashAllocations=[{A:5},{B:25}].
    expect(result.fundsAllocations).toEqual([{ chargeId: 'A', amount: 5 }])
    expect(result.cashAllocations).toEqual([
      { chargeId: 'A', amount: 5 },
      { chargeId: 'B', amount: 25 },
    ])
  })

  it('funds-only payment (no cash) puts everything in fundsAllocations', () => {
    const charges = [makeCharge('A', 25, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        funds: 25,
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.fundsAllocations).toEqual([{ chargeId: 'A', amount: 25 }])
    expect(result.cashAllocations).toEqual([])
  })

  it('partial funds-only payment ($5 against $25 charge — Bug 5 scenario)', () => {
    const charges = [makeCharge('A', 25, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        funds: 5,
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.rowAmounts).toEqual({ A: 5 })
    expect(result.fundsAllocations).toEqual([{ chargeId: 'A', amount: 5 }])
    expect(result.cashAllocations).toEqual([])
  })

  it('cash-only payment puts everything in cashAllocations', () => {
    const charges = [makeCharge('A', 25, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 25,
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.fundsAllocations).toEqual([])
    expect(result.cashAllocations).toEqual([{ chargeId: 'A', amount: 25 }])
  })
})

describe('computeAllocations — validation', () => {
  it('cash + funds exceeds outstanding (non-card) → exceeds_outstanding', () => {
    const charges = [makeCharge('A', 25, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 50, // outstandingBalance defaults to sum of owed = 25
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({
      kind: 'exceeds_outstanding',
      total: 50,
      outstanding: 25,
    })
  })

  it('card path: gross > outstanding but net <= outstanding → valid', () => {
    const charges = [makeCharge('A', 100, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 103.20, // gross
        cardFeeNet: 100, // net = gross - fee
        outstandingBalance: 100,
        rowOverrides: [{ chargeId: 'A', checked: true, manualAmount: 103.20 }],
      })
    )
    expect(result.isValid).toBe(true)
  })

  it('card path: net > outstanding → exceeds_outstanding', () => {
    const charges = [makeCharge('A', 50, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 100,
        cardFeeNet: 96.80,
        outstandingBalance: 50,
        rowOverrides: [{ chargeId: 'A', checked: true, manualAmount: 100 }],
      })
    )
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({
      kind: 'exceeds_outstanding',
      total: 96.80,
      outstanding: 50,
    })
  })

  it('all rows unchecked + no manual amounts → no_charges_checked is not raised when auto-extend covers', () => {
    // Dashboard flow: treasurer hasn't manually picked anything, but types cash.
    // Engine auto-extends FIFO; row gets a positive amount; no no_charges_checked issue.
    const charges = [makeCharge('A', 30, '2026-06-01')]
    const result = computeAllocations(makeInput(charges, { cash: 30 }))
    expect(result.isValid).toBe(true)
    expect(result.issues).not.toContainEqual({ kind: 'no_charges_checked' })
  })

  it('floating-point penny tolerance: sum equals cash within $0.01', () => {
    const charges = [
      makeCharge('A', 10, '2026-06-01'),
      makeCharge('B', 20, '2026-06-15'),
    ]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 30.005, // off by half a penny
        rowOverrides: [
          { chargeId: 'A', checked: true },
          { chargeId: 'B', checked: true },
        ],
      })
    )
    // Tolerance allows it; isValid = true
    expect(result.isValid).toBe(true)
  })

  it('partial-paid charge respects existing paid_amount in owed calculation', () => {
    const charges: OutstandingCharge[] = [
      {
        id: 'A',
        billingRecordId: 'br-A',
        description: 'Charge A',
        amount: 50,
        paidAmount: 30, // already paid $30, owes $20
        billingDate: '2026-06-01',
        createdAt: '2026-06-01',
      },
    ]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 20,
        outstandingBalance: 20,
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.rowAmounts).toEqual({ A: 20 })
  })

  it('empty charges list with positive cash → no_charges_checked', () => {
    const result = computeAllocations(makeInput([], { cash: 30 }))
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({ kind: 'no_charges_checked' })
  })
})
