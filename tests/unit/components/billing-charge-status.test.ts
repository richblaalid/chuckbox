import { describe, it, expect } from 'vitest'
import {
  chargeStatus,
  chargeRemaining,
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
})
