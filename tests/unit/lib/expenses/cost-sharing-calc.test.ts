import { describe, it, expect } from 'vitest'
import {
  calculateCostShares,
  type ScoutWithGuardians,
} from '@/lib/expenses/cost-sharing'

function makeScout(
  id: string,
  name: string,
  guardianId: string,
  guardianName: string,
  venmo: string | null = null
): ScoutWithGuardians {
  return {
    id,
    first_name: name.split(' ')[0],
    last_name: name.split(' ')[1] || '',
    guardians: [
      {
        profile_id: guardianId,
        full_name: guardianName,
        email: `${guardianName.toLowerCase().replace(' ', '.')}@example.com`,
        venmo_username: venmo,
      },
    ],
  }
}

describe('calculateCostShares', () => {
  it('splits evenly among selected scouts', () => {
    const scouts = [
      makeScout('s1', 'Alice Smith', 'p1', 'Parent A'),
      makeScout('s2', 'Bob Jones', 'p2', 'Parent B'),
      makeScout('s3', 'Charlie Brown', 'p3', 'Parent C'),
    ]

    const result = calculateCostShares({
      totalAmount: 90,
      selectedScoutIds: ['s1', 's2', 's3'],
      scouts,
      organizerProfileId: 'p1',
    })

    expect(result.perScoutAmount).toBe(30)
    expect(result.totalScouts).toBe(3)
    // p1 is the organizer, so only p2 and p3 should have shares
    expect(result.shares).toHaveLength(2)
  })

  it('excludes organizer from payment requests', () => {
    const scouts = [
      makeScout('s1', 'Alice Smith', 'p1', 'Parent A'),
      makeScout('s2', 'Bob Jones', 'p2', 'Parent B'),
    ]

    const result = calculateCostShares({
      totalAmount: 100,
      selectedScoutIds: ['s1', 's2'],
      scouts,
      organizerProfileId: 'p1',
    })

    expect(result.shares).toHaveLength(1)
    expect(result.shares[0].participantId).toBe('p2')
    expect(result.shares[0].shareAmount).toBe(50)
  })

  it('groups siblings under one parent', () => {
    const scouts = [
      makeScout('s1', 'Alice Smith', 'p1', 'Parent A'),
      makeScout('s2', 'Bob Jones', 'p2', 'Parent B'),
      makeScout('s3', 'Carol Jones', 'p2', 'Parent B'),
    ]

    const result = calculateCostShares({
      totalAmount: 90,
      selectedScoutIds: ['s1', 's2', 's3'],
      scouts,
      organizerProfileId: 'p1',
    })

    expect(result.perScoutAmount).toBe(30)
    expect(result.shares).toHaveLength(1) // Only parent B (organizer excluded)
    expect(result.shares[0].scoutCount).toBe(2) // 2 scouts for parent B
    expect(result.shares[0].shareAmount).toBe(60) // 2 × $30
  })

  it('handles organizer with multiple scouts', () => {
    const scouts = [
      makeScout('s1', 'Alice Smith', 'p1', 'Parent A'),
      makeScout('s2', 'Anna Smith', 'p1', 'Parent A'),
      makeScout('s3', 'Bob Jones', 'p2', 'Parent B'),
    ]

    const result = calculateCostShares({
      totalAmount: 60,
      selectedScoutIds: ['s1', 's2', 's3'],
      scouts,
      organizerProfileId: 'p1',
    })

    expect(result.perScoutAmount).toBe(20)
    expect(result.shares).toHaveLength(1)
    expect(result.shares[0].participantId).toBe('p2')
    expect(result.shares[0].scoutCount).toBe(1)
    expect(result.shares[0].shareAmount).toBe(20)
    expect(result.organizerScoutCount).toBe(2)
    expect(result.organizerAmount).toBe(40) // 2 × $20
  })

  it('rounds per-scout amount to 2 decimal places', () => {
    const scouts = [
      makeScout('s1', 'Alice Smith', 'p1', 'Parent A'),
      makeScout('s2', 'Bob Jones', 'p2', 'Parent B'),
      makeScout('s3', 'Charlie Brown', 'p3', 'Parent C'),
    ]

    const result = calculateCostShares({
      totalAmount: 100,
      selectedScoutIds: ['s1', 's2', 's3'],
      scouts,
      organizerProfileId: 'p1',
    })

    expect(result.perScoutAmount).toBe(33.33)
  })

  it('returns empty shares when only organizer scouts are selected', () => {
    const scouts = [
      makeScout('s1', 'Alice Smith', 'p1', 'Parent A'),
      makeScout('s2', 'Anna Smith', 'p1', 'Parent A'),
    ]

    const result = calculateCostShares({
      totalAmount: 50,
      selectedScoutIds: ['s1', 's2'],
      scouts,
      organizerProfileId: 'p1',
    })

    expect(result.shares).toHaveLength(0)
    expect(result.organizerScoutCount).toBe(2)
    expect(result.organizerAmount).toBe(50)
  })

  it('only considers selected scouts', () => {
    const scouts = [
      makeScout('s1', 'Alice Smith', 'p1', 'Parent A'),
      makeScout('s2', 'Bob Jones', 'p2', 'Parent B'),
      makeScout('s3', 'Charlie Brown', 'p3', 'Parent C'),
    ]

    // Only s1 and s2 are selected
    const result = calculateCostShares({
      totalAmount: 100,
      selectedScoutIds: ['s1', 's2'],
      scouts,
      organizerProfileId: 'p1',
    })

    expect(result.totalScouts).toBe(2)
    expect(result.perScoutAmount).toBe(50)
    expect(result.shares).toHaveLength(1)
    expect(result.shares[0].participantId).toBe('p2')
  })

  it('includes guardian details in shares', () => {
    const scouts = [
      makeScout('s1', 'Alice Smith', 'p1', 'Parent A'),
      makeScout('s2', 'Bob Jones', 'p2', 'Parent B', 'parent-b-venmo'),
    ]

    const result = calculateCostShares({
      totalAmount: 100,
      selectedScoutIds: ['s1', 's2'],
      scouts,
      organizerProfileId: 'p1',
    })

    expect(result.shares[0].participantName).toBe('Parent B')
    expect(result.shares[0].participantEmail).toBe('parent.b@example.com')
    expect(result.shares[0].participantVenmo).toBe('parent-b-venmo')
  })
})
