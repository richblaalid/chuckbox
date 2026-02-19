import { describe, it, expect } from 'vitest'
import type { CostShareResult, CostShare } from '@/lib/expenses/cost-sharing'

/**
 * Tests the data transformation logic used in createCostShares server action.
 * Verifies that CostShareResult is correctly mapped to database insert rows.
 */

interface CostShareInsertRow {
  unit_id: string
  organizer_id: string
  description: string
  total_amount: number
  total_scouts: number
  per_scout_amount: number
  share_amount: number
  scout_count: number
  participant_id: string
  organizer_venmo: string | null
}

function buildInsertRows(params: {
  unitId: string
  organizerId: string
  description: string
  totalAmount: number
  organizerVenmo: string | null
  result: CostShareResult
}): CostShareInsertRow[] {
  return params.result.shares.map((share) => ({
    unit_id: params.unitId,
    organizer_id: params.organizerId,
    description: params.description,
    total_amount: params.totalAmount,
    total_scouts: params.result.totalScouts,
    per_scout_amount: params.result.perScoutAmount,
    share_amount: share.shareAmount,
    scout_count: share.scoutCount,
    participant_id: share.participantId,
    organizer_venmo: params.organizerVenmo,
  }))
}

describe('cost sharing insert row builder', () => {
  const baseResult: CostShareResult = {
    totalScouts: 4,
    perScoutAmount: 25,
    organizerScoutCount: 1,
    organizerAmount: 25,
    shares: [
      {
        participantId: 'p2',
        participantName: 'Parent B',
        participantEmail: 'b@test.com',
        participantVenmo: 'parent-b',
        scoutCount: 2,
        shareAmount: 50,
      },
      {
        participantId: 'p3',
        participantName: 'Parent C',
        participantEmail: 'c@test.com',
        participantVenmo: null,
        scoutCount: 1,
        shareAmount: 25,
      },
    ],
  }

  it('creates one row per share', () => {
    const rows = buildInsertRows({
      unitId: 'unit-1',
      organizerId: 'p1',
      description: 'Campsite fee',
      totalAmount: 100,
      organizerVenmo: 'parent-a',
      result: baseResult,
    })

    expect(rows).toHaveLength(2)
  })

  it('maps share fields correctly', () => {
    const rows = buildInsertRows({
      unitId: 'unit-1',
      organizerId: 'p1',
      description: 'Campsite fee',
      totalAmount: 100,
      organizerVenmo: 'parent-a',
      result: baseResult,
    })

    expect(rows[0]).toEqual({
      unit_id: 'unit-1',
      organizer_id: 'p1',
      description: 'Campsite fee',
      total_amount: 100,
      total_scouts: 4,
      per_scout_amount: 25,
      share_amount: 50,
      scout_count: 2,
      participant_id: 'p2',
      organizer_venmo: 'parent-a',
    })
  })

  it('includes organizer venmo in each row', () => {
    const rows = buildInsertRows({
      unitId: 'unit-1',
      organizerId: 'p1',
      description: 'Test',
      totalAmount: 100,
      organizerVenmo: 'my-venmo',
      result: baseResult,
    })

    for (const row of rows) {
      expect(row.organizer_venmo).toBe('my-venmo')
    }
  })

  it('handles null venmo', () => {
    const rows = buildInsertRows({
      unitId: 'unit-1',
      organizerId: 'p1',
      description: 'Test',
      totalAmount: 100,
      organizerVenmo: null,
      result: baseResult,
    })

    for (const row of rows) {
      expect(row.organizer_venmo).toBeNull()
    }
  })

  it('returns empty array when no shares', () => {
    const emptyResult: CostShareResult = {
      totalScouts: 1,
      perScoutAmount: 100,
      organizerScoutCount: 1,
      organizerAmount: 100,
      shares: [],
    }

    const rows = buildInsertRows({
      unitId: 'unit-1',
      organizerId: 'p1',
      description: 'Test',
      totalAmount: 100,
      organizerVenmo: null,
      result: emptyResult,
    })

    expect(rows).toHaveLength(0)
  })
})
