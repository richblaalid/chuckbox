import { describe, it, expect } from 'vitest'
import { parseLineItems } from '@/lib/billing-validation'

describe('parseLineItems', () => {
  it('returns the array when every entry has description (string) and amount (number)', () => {
    const input = [
      { description: 'Tent rental', amount: 80 },
      { description: 'Food', amount: 100 },
    ]
    expect(parseLineItems(input)).toEqual(input)
  })

  it('accepts entries with extra fields beyond description and amount', () => {
    const input = [{ description: 'Tent rental', amount: 80, foo: 'bar' }]
    expect(parseLineItems(input)).toEqual(input)
  })

  it('returns null for null input', () => {
    expect(parseLineItems(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseLineItems(undefined)).toBeNull()
  })

  it('returns null for non-array inputs (string, number, plain object)', () => {
    expect(parseLineItems('not an array')).toBeNull()
    expect(parseLineItems(42)).toBeNull()
    expect(parseLineItems({ description: 'X', amount: 10 })).toBeNull()
  })

  it('returns null when at least one entry is not a plain object', () => {
    expect(parseLineItems([{ description: 'OK', amount: 10 }, 'bad'])).toBeNull()
    expect(parseLineItems([null])).toBeNull()
  })

  it('returns null when at least one entry has a missing or wrong-typed field', () => {
    expect(parseLineItems([{ description: 'no amount' }])).toBeNull()
    expect(parseLineItems([{ amount: 10 }])).toBeNull()
    expect(parseLineItems([{ description: 'X', amount: 'ten' }])).toBeNull()
    expect(parseLineItems([{ description: 42, amount: 10 }])).toBeNull()
  })

  it('returns an empty array unchanged (no entries to validate)', () => {
    expect(parseLineItems([])).toEqual([])
  })
})
