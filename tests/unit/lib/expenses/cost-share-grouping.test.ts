import { describe, it, expect } from 'vitest'
import { groupCostSharesByEvent, type CostShareRow } from '@/lib/expenses/cost-sharing'

function makeRow(overrides: Partial<CostShareRow> = {}): CostShareRow {
  return {
    id: 'share-1',
    description: 'Campsite fee',
    total_amount: 100,
    total_scouts: 4,
    per_scout_amount: 25,
    share_amount: 50,
    scout_count: 2,
    status: 'pending',
    organizer_venmo: 'organizer-v',
    created_at: '2026-02-20T00:00:00Z',
    participant: {
      id: 'p2',
      full_name: 'Parent B',
      email: 'b@test.com',
      venmo_username: null,
    },
    ...overrides,
  }
}

describe('groupCostSharesByEvent', () => {
  it('groups rows by description + created_at date', () => {
    const rows = [
      makeRow({ id: 's1', description: 'Campsite fee', participant: { id: 'p2', full_name: 'B', email: null, venmo_username: null } }),
      makeRow({ id: 's2', description: 'Campsite fee', participant: { id: 'p3', full_name: 'C', email: null, venmo_username: null } }),
      makeRow({ id: 's3', description: 'Food', participant: { id: 'p2', full_name: 'B', email: null, venmo_username: null } }),
    ]

    const groups = groupCostSharesByEvent(rows)
    expect(groups).toHaveLength(2)
    expect(groups[0].description).toBe('Campsite fee')
    expect(groups[0].shares).toHaveLength(2)
    expect(groups[1].description).toBe('Food')
    expect(groups[1].shares).toHaveLength(1)
  })

  it('includes total and paid counts per group', () => {
    const rows = [
      makeRow({ id: 's1', description: 'Campsite fee', status: 'pending' }),
      makeRow({ id: 's2', description: 'Campsite fee', status: 'paid' }),
      makeRow({ id: 's3', description: 'Campsite fee', status: 'paid' }),
    ]

    const groups = groupCostSharesByEvent(rows)
    expect(groups[0].totalShares).toBe(3)
    expect(groups[0].paidCount).toBe(2)
    expect(groups[0].pendingCount).toBe(1)
  })

  it('calculates total collected and total pending', () => {
    const rows = [
      makeRow({ id: 's1', share_amount: 50, status: 'paid' }),
      makeRow({ id: 's2', share_amount: 25, status: 'pending' }),
    ]

    const groups = groupCostSharesByEvent(rows)
    expect(groups[0].totalCollected).toBe(50)
    expect(groups[0].totalPending).toBe(25)
  })

  it('returns empty array for empty input', () => {
    expect(groupCostSharesByEvent([])).toHaveLength(0)
  })
})
