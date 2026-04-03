import { describe, it, expect } from 'vitest'
import { allocatePayment, type OutstandingCharge } from '@/lib/payment-allocation'

const makeCharge = (id: string, amount: number, date: string): OutstandingCharge => ({
  id,
  billingRecordId: `br-${id}`,
  description: `Charge ${id}`,
  amount,
  paidAmount: 0,
  billingDate: date,
  createdAt: date,
})

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
