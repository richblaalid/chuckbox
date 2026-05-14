import { describe, it, expect } from 'vitest'
import { validateLineItems, validateDeposit } from '@/lib/billing-validation'

describe('validateLineItems', () => {
  it('returns null when no line items', () => {
    expect(validateLineItems([])).toBeNull()
  })

  it('returns null for a single row with empty description (description is optional in single-row mode)', () => {
    expect(validateLineItems([{ description: '', amount: 100 }])).toBeNull()
  })

  it('returns null for a single row with whitespace-only description', () => {
    expect(validateLineItems([{ description: '   ', amount: 100 }])).toBeNull()
  })

  it('returns null for multiple rows that all have descriptions and positive amounts', () => {
    expect(
      validateLineItems([
        { description: 'Base fee', amount: 390 },
        { description: 'MB fee', amount: 65 },
      ])
    ).toBeNull()
  })

  it('returns error when 2+ rows and the first row has an empty description', () => {
    const result = validateLineItems([
      { description: '', amount: 50 },
      { description: 'Food', amount: 30 },
    ])
    expect(result?.rowIndex).toBe(0)
    expect(result?.message).toContain('Line item 1 needs a description')
  })

  it('returns error when 2+ rows and a later row has an empty description', () => {
    const result = validateLineItems([
      { description: 'Tent', amount: 50 },
      { description: '', amount: 30 },
    ])
    expect(result?.rowIndex).toBe(1)
    expect(result?.message).toContain('Line item 2 needs a description')
  })

  it('returns error when 2+ rows and a row has a whitespace-only description', () => {
    const result = validateLineItems([
      { description: 'Tent', amount: 50 },
      { description: '   ', amount: 30 },
    ])
    expect(result?.rowIndex).toBe(1)
    expect(result?.message).toContain('Line item 2 needs a description')
  })

  it('returns error when any row has amount of zero', () => {
    const result = validateLineItems([{ description: 'Fee', amount: 0 }])
    expect(result?.rowIndex).toBe(0)
    expect(result?.message).toContain('greater than $0')
  })

  it('returns error when any row has a negative amount', () => {
    const result = validateLineItems([{ description: 'Fee', amount: -5 }])
    expect(result?.rowIndex).toBe(0)
    expect(result?.message).toContain('greater than $0')
  })

  it('returns error when 2+ rows and one has a zero amount (amount rule fires before description rule)', () => {
    const result = validateLineItems([
      { description: 'Tent', amount: 50 },
      { description: 'Food', amount: 0 },
    ])
    expect(result?.rowIndex).toBe(1)
    expect(result?.message).toContain('greater than $0')
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
