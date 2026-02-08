import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Next.js cache functions
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock Supabase clients
const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
}

const mockAdminSupabase = {
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminSupabase),
}))

// Import after mocking
import { updateRosterAdult } from '@/app/actions/roster'

describe('Roster Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const validData = {
    first_name: 'John',
    last_name: 'Smith',
    email: 'john@example.com',
    email_secondary: null,
    phone_primary: '555-1234',
    phone_secondary: null,
    address_street: '123 Main St',
    address_city: 'Anytown',
    address_state: 'CA',
    address_zip: '12345',
    member_type: 'LEADER',
    position: 'Scoutmaster',
    position_2: null,
    bsa_member_id: '123456789',
    is_active: true,
  }

  describe('updateRosterAdult', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when profile not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      const mockProfileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      mockSupabase.from.mockReturnValue(mockProfileQuery)

      const result = await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Profile not found')
    })

    it('should return error when user is not an admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles' && callCount === 0) {
          callCount++
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'current-profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'parent' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Only admins can update roster adults')
    })

    it('should return error when membership check fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles' && callCount === 0) {
          callCount++
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'current-profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to verify permissions')
    })

    it('should return error when no membership found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles' && callCount === 0) {
          callCount++
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'current-profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      const result = await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Only admins can update roster adults')
    })

    it('should return error when target profile not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let profileCall = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          profileCall++
          if (profileCall === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'current-profile-123' },
                error: null,
              }),
            }
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'admin' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      // Admin client returns no target profile
      mockAdminSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

      const result = await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Adult not found')
    })

    it('should return error when target profile check fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let profileCall = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          profileCall++
          if (profileCall === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'current-profile-123' },
                error: null,
              }),
            }
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'admin' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      // Admin client returns error
      mockAdminSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      })

      const result = await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to verify member')
    })

    it('should successfully update profile when admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let profileCall = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          profileCall++
          if (profileCall === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'current-profile-123' },
                error: null,
              }),
            }
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'admin' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      let adminCalls = 0
      mockAdminSupabase.from.mockImplementation(() => {
        adminCalls++
        if (adminCalls === 1) {
          // First call: get target profile
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'profile-456',
                user_id: null, // No user account
              },
              error: null,
            }),
          }
        }
        if (adminCalls === 2) {
          // Second call: verify membership
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'membership-1' },
              error: null,
            }),
          }
        }
        // Third call: update profile
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      })

      const result = await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should update email only when profile has no user_id', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let profileCall = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          profileCall++
          if (profileCall === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'current-profile-123' },
                error: null,
              }),
            }
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'admin' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      let updateCalled = false
      let updateData: Record<string, unknown> | null = null

      let adminCalls = 0
      mockAdminSupabase.from.mockImplementation(() => {
        adminCalls++
        if (adminCalls === 1) {
          // First call: get target profile
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'profile-456',
                user_id: null, // No user account - email CAN be updated
              },
              error: null,
            }),
          }
        }
        if (adminCalls === 2) {
          // Second call: verify membership
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'membership-1' },
              error: null,
            }),
          }
        }
        // Third call: update profile
        return {
          update: vi.fn().mockImplementation((data) => {
            updateCalled = true
            updateData = data
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            }
          }),
        }
      })

      await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(updateCalled).toBe(true)
      expect(updateData).not.toBeNull()
      expect(updateData!.email).toBe('john@example.com')
    })

    it('should not update email when profile has user_id', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let profileCall = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          profileCall++
          if (profileCall === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'current-profile-123' },
                error: null,
              }),
            }
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'admin' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      let updateData: Record<string, unknown> | null = null

      let adminCalls = 0
      mockAdminSupabase.from.mockImplementation(() => {
        adminCalls++
        if (adminCalls === 1) {
          // First call: get target profile
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'profile-456',
                user_id: 'some-user-id', // Has user account - email should NOT be updated
              },
              error: null,
            }),
          }
        }
        if (adminCalls === 2) {
          // Second call: verify membership
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'membership-1' },
              error: null,
            }),
          }
        }
        // Third call: update profile
        return {
          update: vi.fn().mockImplementation((data) => {
            updateData = data
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            }
          }),
        }
      })

      await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(updateData).not.toBeNull()
      expect(updateData!.email).toBeUndefined()
    })

    it('should return error when update fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let profileCall = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          profileCall++
          if (profileCall === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'current-profile-123' },
                error: null,
              }),
            }
          }
        }
        if (table === 'unit_memberships') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { role: 'admin' },
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      })

      let adminCalls = 0
      mockAdminSupabase.from.mockImplementation(() => {
        adminCalls++
        if (adminCalls === 1) {
          // First call: get target profile
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'profile-456',
                user_id: null,
              },
              error: null,
            }),
          }
        }
        if (adminCalls === 2) {
          // Second call: verify membership
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'membership-1' },
              error: null,
            }),
          }
        }
        // Third call: update profile - fails
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } }),
        }
      })

      const result = await updateRosterAdult('unit-123', 'profile-456', validData)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to update profile')
    })
  })
})
