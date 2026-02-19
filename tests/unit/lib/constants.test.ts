import { describe, it, expect } from 'vitest'
import {
  SCOUT_RANKS,
  getRankIndex,
  isRankProgression,
  getHigherRank,
} from '@/lib/constants'

describe('getRankIndex', () => {
  it('returns correct index for each rank', () => {
    expect(getRankIndex('New Scout')).toBe(0)
    expect(getRankIndex('Scout')).toBe(1)
    expect(getRankIndex('Tenderfoot')).toBe(2)
    expect(getRankIndex('Second Class')).toBe(3)
    expect(getRankIndex('First Class')).toBe(4)
    expect(getRankIndex('Star')).toBe(5)
    expect(getRankIndex('Life')).toBe(6)
    expect(getRankIndex('Eagle')).toBe(7)
  })

  it('is case insensitive', () => {
    expect(getRankIndex('scout')).toBe(1)
    expect(getRankIndex('EAGLE')).toBe(7)
    expect(getRankIndex('First class')).toBe(4)
  })

  it('returns -1 for unknown ranks', () => {
    expect(getRankIndex('Unknown')).toBe(-1)
    expect(getRankIndex('')).toBe(-1)
    expect(getRankIndex(null)).toBe(-1)
    expect(getRankIndex(undefined)).toBe(-1)
  })
})

describe('isRankProgression', () => {
  it('returns true for valid progression', () => {
    expect(isRankProgression('Scout', 'Tenderfoot')).toBe(true)
    expect(isRankProgression('Tenderfoot', 'Eagle')).toBe(true)
    expect(isRankProgression('New Scout', 'Scout')).toBe(true)
    expect(isRankProgression('Life', 'Eagle')).toBe(true)
  })

  it('returns false for same rank', () => {
    expect(isRankProgression('Scout', 'Scout')).toBe(false)
    expect(isRankProgression('Eagle', 'Eagle')).toBe(false)
  })

  it('returns false for downgrade', () => {
    expect(isRankProgression('Tenderfoot', 'Scout')).toBe(false)
    expect(isRankProgression('Eagle', 'Life')).toBe(false)
    expect(isRankProgression('First Class', 'New Scout')).toBe(false)
  })

  it('returns true when old rank is null/unknown and new rank is valid', () => {
    expect(isRankProgression(null, 'Scout')).toBe(true)
    expect(isRankProgression(undefined, 'Eagle')).toBe(true)
    expect(isRankProgression('Unknown', 'Tenderfoot')).toBe(true)
  })

  it('returns false when new rank is null/unknown', () => {
    expect(isRankProgression('Scout', null)).toBe(false)
    expect(isRankProgression('Scout', undefined)).toBe(false)
    expect(isRankProgression('Scout', 'Unknown')).toBe(false)
  })
})

describe('getHigherRank', () => {
  it('returns the higher rank', () => {
    expect(getHigherRank('Scout', 'Tenderfoot')).toBe('Tenderfoot')
    expect(getHigherRank('Eagle', 'Scout')).toBe('Eagle')
    expect(getHigherRank('First Class', 'Star')).toBe('Star')
  })

  it('returns the same rank when both are equal', () => {
    expect(getHigherRank('Scout', 'Scout')).toBe('Scout')
    expect(getHigherRank('Eagle', 'Eagle')).toBe('Eagle')
  })

  it('returns the valid rank when one is null/unknown', () => {
    expect(getHigherRank(null, 'Scout')).toBe('Scout')
    expect(getHigherRank('Scout', null)).toBe('Scout')
    expect(getHigherRank('Eagle', undefined)).toBe('Eagle')
  })

  it('returns null when both are null/unknown', () => {
    expect(getHigherRank(null, null)).toBe(null)
    expect(getHigherRank(undefined, undefined)).toBe(null)
    expect(getHigherRank('Unknown', 'Invalid')).toBe(null)
  })
})
