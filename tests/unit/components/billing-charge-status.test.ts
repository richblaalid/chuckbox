import { describe, it, expect } from 'vitest'
import {
  chargeStatus,
  chargeRemaining,
  getRecordStatus,
  hasCollectedPayments,
  type ChargeStatusInput,
} from '@/components/billing/billing-charge-status'

const base = (over: Partial<ChargeStatusInput> = {}): ChargeStatusInput => ({
  amount: 50,
  paid_amount: 0,
  is_paid: false,
  is_void: false,
  ...over,
})

describe('chargeStatus', () => {
  it('returns voided when is_void is true (regardless of other fields)', () => {
    expect(chargeStatus(base({ is_void: true }))).toBe('voided')
    expect(chargeStatus(base({ is_void: true, is_paid: true, paid_amount: 50 }))).toBe('voided')
  })

  it('returns paid when is_paid is true (paid_amount = amount)', () => {
    expect(chargeStatus(base({ is_paid: true, paid_amount: 50 }))).toBe('paid')
  })

  it('returns paid when is_paid is true and overpaid (paid_amount > amount)', () => {
    expect(chargeStatus(base({ is_paid: true, paid_amount: 60 }))).toBe('paid')
  })

  it('returns paid when paid_amount >= amount even if is_paid is false (defensive guard for inconsistent data)', () => {
    expect(chargeStatus(base({ is_paid: false, paid_amount: 50, amount: 50 }))).toBe('paid')
  })

  it('returns paid when paid_amount > amount and is_paid is false (overpayment with reconcile trigger not yet fired)', () => {
    expect(chargeStatus(base({ is_paid: false, paid_amount: 60, amount: 50 }))).toBe('paid')
  })

  it('returns partial when paid_amount > 0 and is_paid is false', () => {
    expect(chargeStatus(base({ paid_amount: 20 }))).toBe('partial')
  })

  it('returns unpaid when paid_amount = 0 and is_paid is false', () => {
    expect(chargeStatus(base())).toBe('unpaid')
  })

  it('returns unpaid when paid_amount is null', () => {
    expect(chargeStatus(base({ paid_amount: null }))).toBe('unpaid')
  })
})

describe('chargeRemaining', () => {
  it('subtracts paid_amount from amount', () => {
    expect(chargeRemaining(base({ amount: 50, paid_amount: 20 }))).toBe(30)
  })

  it('treats null paid_amount as zero', () => {
    expect(chargeRemaining(base({ amount: 50, paid_amount: null }))).toBe(50)
  })

  it('clamps to zero on overpayment (never negative)', () => {
    expect(chargeRemaining(base({ amount: 50, paid_amount: 60 }))).toBe(0)
  })

  it('returns 0 when is_paid = true even if paid_amount = 0 (Bug 5 historical)', () => {
    expect(chargeRemaining({ amount: 25, paid_amount: 0, is_paid: true, is_void: null })).toBe(0)
  })

  it('returns 0 when is_paid = true and paid_amount < amount', () => {
    expect(chargeRemaining({ amount: 25, paid_amount: 10, is_paid: true, is_void: null })).toBe(0)
  })

  it('returns amount - paid_amount when is_paid = false and partial paid', () => {
    expect(chargeRemaining({ amount: 25, paid_amount: 10, is_paid: false, is_void: null })).toBe(15)
  })

  it('returns full amount when is_paid = false and paid_amount = 0', () => {
    expect(chargeRemaining({ amount: 25, paid_amount: 0, is_paid: false, is_void: null })).toBe(25)
  })

  it('returns 0 when is_paid = false but paid_amount >= amount (Bug 4 historical)', () => {
    expect(chargeRemaining({ amount: 25, paid_amount: 50, is_paid: false, is_void: null })).toBe(0)
  })
})

const charge = (over: Partial<ChargeStatusInput> = {}) => base(over)

describe('getRecordStatus', () => {
  it('returns voided when the record itself is voided', () => {
    expect(getRecordStatus({ is_void: true, charges: [charge()] })).toBe('voided')
  })

  it('returns paid when all active charges are paid', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ is_paid: true, paid_amount: 50 }), charge({ is_paid: true, paid_amount: 50 })],
    })).toBe('paid')
  })

  it('returns paid when the only non-voided charges are paid (voided charges ignored)', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ is_paid: true, paid_amount: 50 }), charge({ is_void: true })],
    })).toBe('paid')
  })

  it('returns paid when there are no active charges (all voided)', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ is_void: true }), charge({ is_void: true })],
    })).toBe('paid')
  })

  it('returns partial when at least one charge is fully paid and another is unpaid', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ is_paid: true, paid_amount: 50 }), charge()],
    })).toBe('partial')
  })

  it('returns partial when at least one charge is partially paid (new behavior)', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ paid_amount: 20 }), charge(), charge()],
    })).toBe('partial')
  })

  it('returns unpaid when no charges have any collected payment', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge(), charge(), charge()],
    })).toBe('unpaid')
  })

  it('returns paid when there are no charges at all (empty array)', () => {
    expect(getRecordStatus({ is_void: false, charges: [] })).toBe('paid')
  })

  it('treats a voided charge with non-zero paid_amount as excluded from active classification', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ is_void: true, paid_amount: 25 })],
    })).toBe('paid')
  })
})

describe('hasCollectedPayments', () => {
  it('returns false when all active charges are unpaid', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge(), charge(), charge()],
    })).toBe(false)
  })

  it('returns false when the only non-voided charges are unpaid', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge(), charge({ is_void: true })],
    })).toBe(false)
  })

  it('returns true when at least one charge is fully paid', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge({ is_paid: true, paid_amount: 50 }), charge()],
    })).toBe(true)
  })

  it('returns true when at least one charge is partially paid', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge({ paid_amount: 20 }), charge()],
    })).toBe(true)
  })

  it('ignores voided charges even if their paid_amount is non-zero (historical edge case)', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge({ is_void: true, paid_amount: 25 }), charge()],
    })).toBe(false)
  })
})
