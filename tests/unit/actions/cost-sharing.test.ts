import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

vi.mock('@/lib/data/cached-queries', () => ({
  getCurrentMembership: vi.fn(),
  getCurrentProfile: vi.fn(),
}))

import {
  getScoutsWithGuardians,
  createCostShares,
  getOrganizedCostShares,
  getParticipantCostShares,
  markCostSharePaid,
  deleteCostShare,
} from '@/app/actions/cost-sharing'
import {
  getCurrentMembership,
  getCurrentProfile,
} from '@/lib/data/cached-queries'
import type { MemberRole } from '@/lib/roles'

const mockedGetCurrentMembership = vi.mocked(getCurrentMembership)
const mockedGetCurrentProfile = vi.mocked(getCurrentProfile)

function chainWith(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
}

function defaultChain() {
  return chainWith(null)
}

/**
 * Set up the unit-context auth path used by getScoutsWithGuardians,
 * createCostShares, getOrganizedCostShares, getParticipantCostShares.
 *
 * The action calls getCurrentMembership(unitId), then queries profiles for
 * venmo_username via the supabase client. Tests can still override
 * mockSupabase.from for the profiles lookup if they want a different shape.
 */
function setupUnitContext(role: MemberRole = 'leader', unitId = 'unit-1') {
  mockedGetCurrentMembership.mockResolvedValue({
    profile_id: 'profile-123',
    unit_id: unitId,
    role,
  })

  // Default profiles lookup returns a profile with a venmo username; tests that
  // need different `from` behavior can override after calling this.
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'profiles')
      return chainWith({ id: 'profile-123', venmo_username: '@test' })
    return defaultChain()
  })
}

/**
 * Set up the profile-only auth path used by markCostSharePaid and
 * deleteCostShare (via getAuthenticatedProfile → getCurrentProfile).
 */
function setupAuthProfile() {
  mockedGetCurrentProfile.mockResolvedValue({
    id: 'profile-123',
    first_name: 'Test',
    last_name: 'User',
    email: 'test@example.com',
  })
}

describe('Cost Sharing Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── getScoutsWithGuardians ──────────────────────────────────────

  describe('getScoutsWithGuardians', () => {
    it('should return error when not a unit member', async () => {
      mockedGetCurrentMembership.mockResolvedValue(null)

      const result = await getScoutsWithGuardians('unit-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a member of this unit')
    })

    it('should return error when profile lookup fails', async () => {
      setupUnitContext()
      // Override profiles to return null so getUserContext fails on profile
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith(null)
        return defaultChain()
      })

      const result = await getScoutsWithGuardians('unit-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Profile not found')
    })

    it('should return scouts with guardian data', async () => {
      setupUnitContext()

      const mockScouts = [
        {
          id: 's1',
          first_name: 'John',
          last_name: 'Scout',
          scout_guardians: [
            {
              profile_id: 'p1',
              profiles: {
                id: 'p1',
                full_name: 'Parent One',
                email: 'parent@test.com',
                venmo_username: '@parent',
              },
            },
          ],
        },
      ]

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles')
          return chainWith({ id: 'profile-123', venmo_username: '@test' })
        if (table === 'scouts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: mockScouts,
              error: null,
            }),
          }
        }
        return defaultChain()
      })

      const result = await getScoutsWithGuardians('unit-1')
      expect(result.success).toBe(true)
      const data = result.data as Array<{
        guardians: Array<{ full_name: string }>
      }>
      expect(data).toHaveLength(1)
      expect(data[0].guardians).toHaveLength(1)
      expect(data[0].guardians[0].full_name).toBe('Parent One')
    })
  })

  // ─── createCostShares ────────────────────────────────────────────

  describe('createCostShares', () => {
    it('should return error when not a unit member', async () => {
      mockedGetCurrentMembership.mockResolvedValue(null)

      const result = await createCostShares({
        unitId: 'unit-1',
        description: 'Campout food',
        totalAmount: 100,
        result: { shares: [], totalScouts: 0, perScoutAmount: 0, organizerScoutCount: 0, organizerAmount: 0 },
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a member of this unit')
    })

    it('should return error when no shares provided', async () => {
      setupUnitContext()

      const result = await createCostShares({
        unitId: 'unit-1',
        description: 'Campout food',
        totalAmount: 100,
        result: { shares: [], totalScouts: 0, perScoutAmount: 0, organizerScoutCount: 0, organizerAmount: 0 },
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('No shares to create')
    })

    it('should create cost share records', async () => {
      setupUnitContext()

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles')
          return chainWith({ id: 'profile-123', venmo_username: '@test' })
        if (table === 'expense_cost_shares') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return defaultChain()
      })

      const result = await createCostShares({
        unitId: 'unit-1',
        description: 'Campout food',
        totalAmount: 100,
        result: {
          totalScouts: 5,
          perScoutAmount: 20,
          organizerScoutCount: 1,
          organizerAmount: 20,
          shares: [
            {
              participantId: 'parent-1',
              participantName: 'Parent One',
              participantEmail: 'parent@test.com',
              participantVenmo: '@parent',
              scoutCount: 2,
              shareAmount: 40,
            },
          ],
        },
      })
      expect(result.success).toBe(true)
    })
  })

  // ─── getOrganizedCostShares ──────────────────────────────────────

  describe('getOrganizedCostShares', () => {
    it('should return error when not a unit member', async () => {
      mockedGetCurrentMembership.mockResolvedValue(null)

      const result = await getOrganizedCostShares('unit-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a member of this unit')
    })

    it('should return organized cost shares', async () => {
      setupUnitContext()

      const mockShares = [{ id: 'cs1', description: 'Food' }]

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles')
          return chainWith({ id: 'profile-123', venmo_username: '@test' })
        if (table === 'expense_cost_shares') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: mockShares,
              error: null,
            }),
          }
        }
        return defaultChain()
      })

      const result = await getOrganizedCostShares('unit-1')
      expect(result.success).toBe(true)
      expect(result.data).toEqual(mockShares)
    })
  })

  // ─── getParticipantCostShares ────────────────────────────────────

  describe('getParticipantCostShares', () => {
    it('should return error when not a unit member', async () => {
      mockedGetCurrentMembership.mockResolvedValue(null)

      const result = await getParticipantCostShares('unit-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not a member of this unit')
    })

    it('should return participant cost shares', async () => {
      setupUnitContext('parent')

      const mockShares = [{ id: 'cs2', description: 'Gas' }]

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles')
          return chainWith({ id: 'profile-123', venmo_username: '@test' })
        if (table === 'expense_cost_shares') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: mockShares,
              error: null,
            }),
          }
        }
        return defaultChain()
      })

      const result = await getParticipantCostShares('unit-1')
      expect(result.success).toBe(true)
      expect(result.data).toEqual(mockShares)
    })
  })

  // ─── markCostSharePaid ───────────────────────────────────────────

  describe('markCostSharePaid', () => {
    it('should return error when not authenticated', async () => {
      mockedGetCurrentProfile.mockResolvedValue(null)

      const result = await markCostSharePaid('share-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not the organizer', async () => {
      setupAuthProfile()

      let costShareCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'expense_cost_shares') {
          costShareCalls++
          if (costShareCalls === 1) {
            return chainWith({
              id: 'share-1',
              organizer_id: 'other-profile',
            })
          }
          return defaultChain()
        }
        return defaultChain()
      })

      const result = await markCostSharePaid('share-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Only the organizer can mark shares as paid'
      )
    })

    it('should mark share as paid when organizer', async () => {
      setupAuthProfile()

      let costShareCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'expense_cost_shares') {
          costShareCalls++
          if (costShareCalls === 1) {
            return chainWith({
              id: 'share-1',
              organizer_id: 'profile-123',
            })
          }
          // update call
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return defaultChain()
      })

      const result = await markCostSharePaid('share-1')
      expect(result.success).toBe(true)
    })
  })

  // ─── deleteCostShare ─────────────────────────────────────────────

  describe('deleteCostShare', () => {
    it('should return error when not authenticated', async () => {
      mockedGetCurrentProfile.mockResolvedValue(null)

      const result = await deleteCostShare('share-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not the organizer', async () => {
      setupAuthProfile()

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'expense_cost_shares') {
          return chainWith({
            id: 'share-1',
            organizer_id: 'other-profile',
            status: 'pending',
          })
        }
        return defaultChain()
      })

      const result = await deleteCostShare('share-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Only the organizer can delete shares')
    })

    it('should return error when share is not pending', async () => {
      setupAuthProfile()

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'expense_cost_shares') {
          return chainWith({
            id: 'share-1',
            organizer_id: 'profile-123',
            status: 'paid',
          })
        }
        return defaultChain()
      })

      const result = await deleteCostShare('share-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Can only delete pending shares')
    })

    it('should delete pending share when organizer', async () => {
      setupAuthProfile()

      let costShareCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'expense_cost_shares') {
          costShareCalls++
          if (costShareCalls === 1) {
            return chainWith({
              id: 'share-1',
              organizer_id: 'profile-123',
              status: 'pending',
            })
          }
          // delete call
          return {
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return defaultChain()
      })

      const result = await deleteCostShare('share-1')
      expect(result.success).toBe(true)
    })
  })
})
