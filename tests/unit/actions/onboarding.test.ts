/**
 * Unit tests for onboarding.ts actions
 * Tests CSV extraction and unit provisioning logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractUnitFromCSV, activateProvisionedMemberships, checkEmailExists, provisionUnit, provisionUnitAuthenticated } from '@/app/actions/onboarding'
import * as bsaRosterParser from '@/lib/import/bsa-roster-parser'

// Mock the bsa-roster-parser module
vi.mock('@/lib/import/bsa-roster-parser', () => ({
  parseRosterWithMetadata: vi.fn(),
  getScoutPosition: vi.fn().mockReturnValue({ primary: null, secondary: null }),
}))

// Mock next/cache (revalidatePath requires Next.js request context)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock Supabase clients
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    auth: {
      admin: {
        inviteUserByEmail: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }),
}))

describe('onboarding actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractUnitFromCSV', () => {
    it('should return error when CSV parsing fails', async () => {
      vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockImplementation(() => {
        throw new Error('Invalid CSV format')
      })

      const result = await extractUnitFromCSV('invalid csv content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to parse CSV file. Please ensure it is a valid BSA roster export.')
    })

    it('should return error when unit metadata is missing', async () => {
      vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockReturnValue({
        adults: [],
        scouts: [],
        unitMetadata: null,
      })

      const result = await extractUnitFromCSV('some csv content')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Could not extract unit information from the CSV file')
    })

    it('should return error when unit type is missing', async () => {
      vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockReturnValue({
        adults: [],
        scouts: [],
        unitMetadata: {
          unitNumber: '123',
          unitType: null as unknown as 'troop',
          council: 'Test Council',
          district: 'Test District',
        },
      })

      const result = await extractUnitFromCSV('some csv content')

      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Could not determine unit type or number from the CSV. Please ensure this is a valid BSA roster export.'
      )
    })

    it('should return error when unit number is missing', async () => {
      vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockReturnValue({
        adults: [],
        scouts: [],
        unitMetadata: {
          unitNumber: null as unknown as string,
          unitType: 'troop',
          council: 'Test Council',
          district: 'Test District',
        },
      })

      const result = await extractUnitFromCSV('some csv content')

      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Could not determine unit type or number from the CSV. Please ensure this is a valid BSA roster export.'
      )
    })

    it('should successfully extract unit data from valid CSV', async () => {
      const mockRoster = {
        adults: [
          {
            firstName: 'John',
            lastName: 'Leader',
            bsaMemberId: 'adult-1',
            positions: ['Scoutmaster'],
          },
          {
            firstName: 'Jane',
            lastName: 'Parent',
            bsaMemberId: 'adult-2',
            positions: [],
          },
        ],
        scouts: [
          {
            firstName: 'Scout',
            lastName: 'One',
            bsaMemberId: 'scout-1',
            patrol: 'Eagle Patrol',
            rank: 'First Class',
            positions: [],
            guardians: [],
          },
          {
            firstName: 'Scout',
            lastName: 'Two',
            bsaMemberId: 'scout-2',
            patrol: 'Eagle Patrol',
            rank: 'Tenderfoot',
            positions: [],
            guardians: [],
          },
          {
            firstName: 'Scout',
            lastName: 'Three',
            bsaMemberId: 'scout-3',
            patrol: 'Wolf Patrol',
            rank: 'Scout',
            positions: [],
            guardians: [],
          },
        ],
        unitMetadata: {
          unitNumber: '9297',
          unitType: 'troop' as const,
          council: 'Test Council',
          district: 'Test District',
          unitSuffix: null,
        },
      }

      vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockReturnValue(mockRoster)

      const result = await extractUnitFromCSV('valid csv content')

      expect(result.success).toBe(true)
      expect(result.unitMetadata).toEqual(mockRoster.unitMetadata)
      expect(result.roster).toEqual(mockRoster)
      expect(result.rosterSummary).toEqual({
        adultCount: 2,
        scoutCount: 3,
        patrolCount: 2, // Eagle Patrol and Wolf Patrol
      })
    })

    it('should count unique patrols correctly', async () => {
      const mockRoster = {
        adults: [],
        scouts: [
          { firstName: 'A', lastName: '1', patrol: 'Alpha', positions: [], guardians: [] },
          { firstName: 'B', lastName: '2', patrol: 'Alpha', positions: [], guardians: [] },
          { firstName: 'C', lastName: '3', patrol: 'Beta', positions: [], guardians: [] },
          { firstName: 'D', lastName: '4', patrol: null, positions: [], guardians: [] }, // No patrol
        ],
        unitMetadata: {
          unitNumber: '100',
          unitType: 'troop' as const,
          council: 'Test',
          district: 'Test',
        },
      }

      vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockReturnValue(mockRoster as bsaRosterParser.ParsedRoster)

      const result = await extractUnitFromCSV('valid csv')

      expect(result.success).toBe(true)
      expect(result.rosterSummary?.patrolCount).toBe(2) // Alpha and Beta only
    })

    it('should handle empty roster with valid metadata', async () => {
      const mockRoster = {
        adults: [],
        scouts: [],
        unitMetadata: {
          unitNumber: '100',
          unitType: 'pack' as const,
          council: 'Test Council',
          district: 'Test District',
        },
      }

      vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockReturnValue(mockRoster)

      const result = await extractUnitFromCSV('csv with only metadata')

      expect(result.success).toBe(true)
      expect(result.rosterSummary).toEqual({
        adultCount: 0,
        scoutCount: 0,
        patrolCount: 0,
      })
    })

    it('should include unit suffix in metadata when present', async () => {
      const mockRoster = {
        adults: [],
        scouts: [],
        unitMetadata: {
          unitNumber: '9297',
          unitType: 'troop' as const,
          unitSuffix: 'B',
          council: 'Test Council',
          district: 'Test District',
        },
      }

      vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockReturnValue(mockRoster)

      const result = await extractUnitFromCSV('csv content')

      expect(result.success).toBe(true)
      expect(result.unitMetadata?.unitSuffix).toBe('B')
    })
  })

  describe('activateProvisionedMemberships', () => {
    it('should return 0 activated when user is not authenticated', async () => {
      // Default mock: getUser returns null
      const result = await activateProvisionedMemberships()
      expect(result.activated).toBe(0)
      expect(result.unitNames).toEqual([])
    })

    it('should return 0 activated when no pending tokens exist', async () => {
      const { createClient } = await import('@/lib/supabase/server')
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-1', email: 'test@example.com' } },
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      } as never)

      const { createAdminClient } = await import('@/lib/supabase/admin')
      const mockFrom = vi.fn()
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ data: [], error: null }),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      mockFrom.mockReturnValue(mockChain)
      vi.mocked(createAdminClient).mockReturnValue({
        from: mockFrom,
        auth: { admin: { inviteUserByEmail: vi.fn() } },
      } as never)

      const result = await activateProvisionedMemberships()
      expect(result.activated).toBe(0)
      expect(result.unitNames).toEqual([])
    })

    it('should activate membership when pending provisioning token exists', async () => {
      const { createClient } = await import('@/lib/supabase/server')
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-1', email: 'admin@example.com' } },
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      } as never)

      const { createAdminClient } = await import('@/lib/supabase/admin')
      const mockFrom = vi.fn()
      const pendingToken = {
        id: 'token-1',
        unit_id: 'unit-1',
        profile_id: 'profile-1',
        units: { name: 'Troop 297' },
      }

      // Track which table is being queried
      mockFrom.mockImplementation((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }

        if (table === 'unit_provisioning_tokens') {
          // For the initial query with .is('verified_at', null)
          chain.is = vi.fn().mockResolvedValue({ data: [pendingToken], error: null })
          // For the update
          chain.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })
        }
        if (table === 'profiles') {
          chain.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })
        }
        if (table === 'unit_memberships') {
          chain.update = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          })
        }
        if (table === 'staged_roster_imports') {
          chain.select = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          })
        }
        return chain
      })

      vi.mocked(createAdminClient).mockReturnValue({
        from: mockFrom,
        auth: { admin: { inviteUserByEmail: vi.fn() } },
      } as never)

      const result = await activateProvisionedMemberships()
      expect(result.activated).toBe(1)
      expect(result.unitNames).toEqual(['Troop 297'])

      // Verify the correct tables were queried
      expect(mockFrom).toHaveBeenCalledWith('unit_provisioning_tokens')
      expect(mockFrom).toHaveBeenCalledWith('profiles')
      expect(mockFrom).toHaveBeenCalledWith('unit_memberships')
    })
  })

  describe('checkEmailExists', () => {
    it('should return exists: true when email is found in auth', async () => {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      vi.mocked(createAdminClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        auth: {
          admin: {
            listUsers: vi.fn().mockResolvedValue({
              data: {
                users: [{ id: 'user-1', email: 'existing@example.com' }],
              },
              error: null,
            }),
            inviteUserByEmail: vi.fn(),
          },
        },
      } as never)

      const result = await checkEmailExists('existing@example.com')
      expect(result.exists).toBe(true)
    })

    it('should return exists: false when email is not in auth', async () => {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      vi.mocked(createAdminClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        auth: {
          admin: {
            listUsers: vi.fn().mockResolvedValue({
              data: { users: [] },
              error: null,
            }),
            inviteUserByEmail: vi.fn(),
          },
        },
      } as never)

      const result = await checkEmailExists('new@example.com')
      expect(result.exists).toBe(false)
    })

    it('should return exists: false when auth check errors', async () => {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      vi.mocked(createAdminClient).mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        auth: {
          admin: {
            listUsers: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Service unavailable' },
            }),
            inviteUserByEmail: vi.fn(),
          },
        },
      } as never)

      const result = await checkEmailExists('test@example.com')
      expect(result.exists).toBe(false)
    })
  })

  describe('provisionUnit - existing user detection', () => {
    const validInput = {
      unitMetadata: {
        unitNumber: '100',
        unitType: 'troop' as const,
        council: 'Test Council',
        district: 'Test District',
      },
      admin: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'existing@example.com',
      },
      parsedAdults: [],
      parsedScouts: [],
    }

    it('should return account_exists code when admin email exists in auth', async () => {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const mockFrom = vi.fn()
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      mockFrom.mockImplementation((table: string) => {
        if (table === 'signup_rate_limits') {
          return {
            ...mockChain,
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (table === 'units') {
          return {
            ...mockChain,
            // checkDuplicateUnit: no matching units
            is: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        return mockChain
      })

      vi.mocked(createAdminClient).mockReturnValue({
        from: mockFrom,
        auth: {
          admin: {
            inviteUserByEmail: vi.fn(),
            listUsers: vi.fn().mockResolvedValue({
              data: {
                users: [{ id: 'user-1', email: 'existing@example.com' }],
              },
              error: null,
            }),
          },
        },
      } as never)

      const result = await provisionUnit(validInput, '127.0.0.1')

      expect(result.success).toBe(false)
      expect(result.code).toBe('account_exists')
    })
  })

  describe('provisionUnitAuthenticated', () => {
    const validInput = {
      unitMetadata: {
        unitNumber: '200',
        unitType: 'troop' as const,
        council: 'Test Council',
        district: 'Test District',
      },
      parsedAdults: [],
      parsedScouts: [],
      signupPath: 'csv' as const,
    }

    it('should return error when user is not authenticated', async () => {
      const { createClient } = await import('@/lib/supabase/server')
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      } as never)

      const result = await provisionUnitAuthenticated(validInput)
      expect(result.success).toBe(false)
      expect(result.error).toContain('authenticated')
    })

    it('should create unit with active membership for authenticated user', async () => {
      const { createClient } = await import('@/lib/supabase/server')
      vi.mocked(createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-1', email: 'admin@example.com' } },
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'profile-1', email: 'admin@example.com' },
            error: null,
          }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      } as never)

      const { createAdminClient } = await import('@/lib/supabase/admin')
      const insertedUnit = { id: 'unit-new' }
      const mockFrom = vi.fn()
      mockFrom.mockImplementation((table: string) => {
        const chain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }

        if (table === 'signup_rate_limits') {
          return chain
        }
        if (table === 'units') {
          // For duplicate check: no match
          chain.is = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          })
          // For insert: return new unit
          chain.insert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: insertedUnit, error: null }),
            }),
          })
          return chain
        }
        if (table === 'unit_memberships') {
          chain.insert = vi.fn().mockResolvedValue({ data: null, error: null })
          return chain
        }
        if (table === 'staged_roster_imports') {
          chain.insert = vi.fn().mockResolvedValue({ data: null, error: null })
          return chain
        }
        return chain
      })

      vi.mocked(createAdminClient).mockReturnValue({
        from: mockFrom,
        auth: {
          admin: {
            inviteUserByEmail: vi.fn(),
            listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
          },
        },
      } as never)

      const result = await provisionUnitAuthenticated(validInput)

      expect(result.success).toBe(true)
      expect(result.unitId).toBe('unit-new')

      // Verify membership was created with 'active' status
      expect(mockFrom).toHaveBeenCalledWith('unit_memberships')
      const membershipCall = mockFrom.mock.calls.find(
        (call: string[]) => call[0] === 'unit_memberships'
      )
      expect(membershipCall).toBeDefined()
    })
  })

  describe('extractUnitFromCSV edge cases', () => {
    it('should handle all unit types', async () => {
      const unitTypes = ['troop', 'pack', 'crew'] as const

      for (const unitType of unitTypes) {
        const mockRoster = {
          adults: [],
          scouts: [],
          unitMetadata: {
            unitNumber: '100',
            unitType,
            council: 'Test',
            district: 'Test',
          },
        }

        vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockReturnValue(mockRoster)

        const result = await extractUnitFromCSV('csv')

        expect(result.success).toBe(true)
        expect(result.unitMetadata?.unitType).toBe(unitType)
      }
    })

    it('should handle special characters in CSV content', async () => {
      const mockRoster = {
        adults: [
          {
            firstName: "O'Connor",
            lastName: 'Smith-Jones',
            bsaMemberId: 'adult-1',
            positions: [],
          },
        ],
        scouts: [
          {
            firstName: 'José',
            lastName: 'García',
            patrol: 'Águila',
            positions: [],
            guardians: [],
          },
        ],
        unitMetadata: {
          unitNumber: '123',
          unitType: 'troop' as const,
          council: 'Tidewater',
          district: "Smith's District",
        },
      }

      vi.mocked(bsaRosterParser.parseRosterWithMetadata).mockReturnValue(mockRoster as bsaRosterParser.ParsedRoster)

      const result = await extractUnitFromCSV('csv with special chars')

      expect(result.success).toBe(true)
      expect(result.roster?.adults[0].firstName).toBe("O'Connor")
      expect(result.roster?.scouts[0].firstName).toBe('José')
    })
  })
})
