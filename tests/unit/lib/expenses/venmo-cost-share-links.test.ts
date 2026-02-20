import { describe, it, expect } from 'vitest'
import { generateCostShareVenmoLinks } from '@/lib/expenses/venmo'
import type { CostShare } from '@/lib/expenses/cost-sharing'

describe('generateCostShareVenmoLinks', () => {
  const baseShares: CostShare[] = [
    {
      participantId: 'p2',
      participantName: 'Parent B',
      participantEmail: 'b@test.com',
      participantVenmo: null,
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
  ]

  it('generates payment links for each share when organizer has venmo', () => {
    const links = generateCostShareVenmoLinks({
      shares: baseShares,
      organizerVenmo: 'parent-a',
      description: 'Campsite fee',
    })

    expect(links).toHaveLength(2)
    expect(links[0].participantId).toBe('p2')
    expect(links[0].venmoUrl).toContain('venmo.com/parent-a')
    expect(links[0].venmoUrl).toContain('txn=pay')
    expect(links[0].venmoUrl).toContain('amount=50.00')
    expect(links[0].venmoUrl).toContain('Campsite%20fee')
  })

  it('includes scout count in note', () => {
    const links = generateCostShareVenmoLinks({
      shares: baseShares,
      organizerVenmo: 'parent-a',
      description: 'Campsite fee',
    })

    // 2 scouts for Parent B
    expect(links[0].venmoUrl).toContain('2%20scouts')
    // 1 scout for Parent C
    expect(links[1].venmoUrl).toContain('1%20scout')
  })

  it('returns empty array when organizer has no venmo', () => {
    const links = generateCostShareVenmoLinks({
      shares: baseShares,
      organizerVenmo: null,
      description: 'Campsite fee',
    })

    expect(links).toHaveLength(0)
  })

  it('returns empty array for empty shares', () => {
    const links = generateCostShareVenmoLinks({
      shares: [],
      organizerVenmo: 'parent-a',
      description: 'Test',
    })

    expect(links).toHaveLength(0)
  })

  it('generates links using pay txn type (participant pays organizer)', () => {
    const links = generateCostShareVenmoLinks({
      shares: [baseShares[0]],
      organizerVenmo: 'parent-a',
      description: 'Test',
    })

    expect(links[0].venmoUrl).toContain('txn=pay')
  })
})
