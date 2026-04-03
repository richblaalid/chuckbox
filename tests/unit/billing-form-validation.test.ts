import { describe, it, expect } from 'vitest'
import { validateLineItems, validateDeposit } from '@/lib/billing-validation'

describe('validateLineItems', () => {
  it('returns null when no line items', () => {
    expect(validateLineItems([], 100)).toBeNull()
  })

  it('returns null when sum matches total', () => {
    expect(
      validateLineItems(
        [
          { description: 'Base fee', amount: 390 },
          { description: 'MB fee', amount: 65 },
        ],
        455
      )
    ).toBeNull()
  })

  it('returns null when sum is within tolerance', () => {
    expect(
      validateLineItems(
        [
          { description: 'Fee A', amount: 33.33 },
          { description: 'Fee B', amount: 33.33 },
          { description: 'Fee C', amount: 33.34 },
        ],
        100
      )
    ).toBeNull()
  })

  it('returns error when sum does not match', () => {
    expect(
      validateLineItems(
        [
          { description: 'Base', amount: 390 },
          { description: 'Extra', amount: 10 },
        ],
        455
      )
    ).toContain('sum to')
  })

  it('returns error for empty description', () => {
    expect(validateLineItems([{ description: '', amount: 100 }], 100)).toContain('description')
  })

  it('returns error for whitespace-only description', () => {
    expect(validateLineItems([{ description: '   ', amount: 100 }], 100)).toContain('description')
  })

  it('returns error for zero amount', () => {
    expect(validateLineItems([{ description: 'Fee', amount: 0 }], 0)).toContain('positive')
  })

  it('returns error for negative amount', () => {
    expect(validateLineItems([{ description: 'Fee', amount: -5 }], -5)).toContain('positive')
  })
})

describe('validateDeposit', () => {
  it('returns null when no deposit info provided', () => {
    expect(validateDeposit('', '', 100)).toBeNull()
  })

  it('returns null for valid deposit', () => {
    expect(validateDeposit('50', '2026-06-01', 100)).toBeNull()
  })

  it('returns error for zero deposit', () => {
    expect(validateDeposit('0', '', 100)).toContain('positive')
  })

  it('returns error for negative deposit', () => {
    expect(validateDeposit('-10', '', 100)).toContain('positive')
  })

  it('returns error when deposit exceeds total', () => {
    expect(validateDeposit('150', '', 100)).toContain('exceed')
  })

  it('returns error when due date set without amount', () => {
    expect(validateDeposit('', '2026-06-01', 100)).toContain('required')
  })
})
