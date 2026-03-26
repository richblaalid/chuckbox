import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Next.js cache functions
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock Supabase client
const mockSupabase = {
  auth: {
    getUser: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

// Import after mocking
import {
  getProfile,
  updateProfile,
  changeEmail,
  deactivateAccount,
} from '@/app/actions/profile'

describe('Profile Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getProfile', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await getProfile()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
      expect(result.profile).toBeNull()
    })

    it('should return error when profile fetch fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      })

      const result = await getProfile()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to load profile')
      expect(result.profile).toBeNull()
    })

    it('should return profile when authenticated', async () => {
      const mockProfile = {
        id: 'profile-123',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
      }

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: mockProfile,
          error: null,
        }),
      })

      const result = await getProfile()

      expect(result.success).toBe(true)
      expect(result.profile).toEqual(mockProfile)
    })
  })

  describe('updateProfile', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await updateProfile({ first_name: 'John' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should update only provided fields', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let updateData: Record<string, unknown> = {}
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockImplementation((data) => {
          updateData = data
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }),
      })

      await updateProfile({ first_name: 'Jane' })

      expect(updateData.first_name).toBe('Jane')
      expect(updateData.last_name).toBeUndefined()
      expect(updateData.phone_home).toBeUndefined()
    })

    it('should update full_name when name fields are provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let updateData: Record<string, unknown> = {}
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockImplementation((data) => {
          updateData = data
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }),
      })

      await updateProfile({ first_name: 'Jane', last_name: 'Smith' })

      expect(updateData.full_name).toBe('Jane Smith')
    })

    it('should handle only first_name for full_name', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let updateData: Record<string, unknown> = {}
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockImplementation((data) => {
          updateData = data
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }),
      })

      await updateProfile({ first_name: 'Jane', last_name: null })

      expect(updateData.full_name).toBe('Jane')
    })

    it('should return error when update fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          error: { message: 'Update failed' },
        }),
      })

      const result = await updateProfile({ first_name: 'Jane' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to update profile')
    })

    it('should successfully update profile', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      })

      const result = await updateProfile({
        first_name: 'Jane',
        last_name: 'Smith',
        phone_home: '555-1234',
        address_street: '123 Main St',
      })

      expect(result.success).toBe(true)
    })

    it('should update address fields correctly', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let updateData: Record<string, unknown> = {}
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockImplementation((data) => {
          updateData = data
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }),
      })

      await updateProfile({
        address_street: '456 Oak Ave',
        address_city: 'Portland',
        address_state: 'OR',
        address_zip: '97201',
      })

      expect(updateData.address_street).toBe('456 Oak Ave')
      expect(updateData.address_city).toBe('Portland')
      expect(updateData.address_state).toBe('OR')
      expect(updateData.address_zip).toBe('97201')
    })

    it('should update gender field', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let updateData: Record<string, unknown> = {}
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockImplementation((data) => {
          updateData = data
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }),
      })

      await updateProfile({ gender: 'female' })

      expect(updateData.gender).toBe('female')
    })
  })

  describe('changeEmail', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await changeEmail('new@example.com')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error for invalid email format', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'old@example.com' } },
      })

      const result = await changeEmail('invalidemail')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid email format')
    })

    it('should return error for missing @ symbol', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'old@example.com' } },
      })

      const result = await changeEmail('invalid.email.com')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid email format')
    })

    it('should return error when new email same as current', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'current@example.com' } },
      })

      const result = await changeEmail('current@example.com')

      expect(result.success).toBe(false)
      expect(result.error).toBe('New email is same as current email')
    })

    it('should handle case insensitive email comparison', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'Current@Example.COM' } },
      })

      const result = await changeEmail('current@example.com')

      expect(result.success).toBe(false)
      expect(result.error).toBe('New email is same as current email')
    })

    it('should return error when auth update fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'old@example.com' } },
      })

      mockSupabase.auth.updateUser.mockResolvedValue({
        error: { message: 'Email already exists' },
      })

      const result = await changeEmail('new@example.com')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Email already exists')
    })

    it('should successfully initiate email change', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'old@example.com' } },
      })

      mockSupabase.auth.updateUser.mockResolvedValue({ error: null })

      const result = await changeEmail('new@example.com')

      expect(result.success).toBe(true)
      expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({
        email: 'new@example.com',
      })
    })
  })

  describe('deactivateAccount', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await deactivateAccount()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when profile not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })

      const result = await deactivateAccount()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Profile not found')
    })

    it('should return error when profile update fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'profiles' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'profiles' && callCount === 2) {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              error: { message: 'Update failed' },
            }),
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      })

      const result = await deactivateAccount()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Failed to deactivate account')
    })

    it('should successfully deactivate account and memberships', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let profileUpdateCalled = false
      let membershipUpdateCalled = false

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
            update: vi.fn().mockImplementation(() => {
              profileUpdateCalled = true
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            update: vi.fn().mockImplementation(() => {
              membershipUpdateCalled = true
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      })

      mockSupabase.auth.signOut.mockResolvedValue({ error: null })

      const result = await deactivateAccount()

      expect(result.success).toBe(true)
      expect(profileUpdateCalled).toBe(true)
      expect(membershipUpdateCalled).toBe(true)
      expect(mockSupabase.auth.signOut).toHaveBeenCalled()
    })

    it('should still succeed if membership deactivation fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          }
        }
        if (table === 'unit_memberships') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              error: { message: 'Membership update failed' },
            }),
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      })

      mockSupabase.auth.signOut.mockResolvedValue({ error: null })

      // Need to restructure the mock to handle the nested calls better
      let profileSelectCalled = false
      let profileUpdateCalled = false

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles' && !profileSelectCalled) {
          profileSelectCalled = true
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'profile-123' },
              error: null,
            }),
          }
        }
        if (table === 'profiles' && profileSelectCalled) {
          profileUpdateCalled = true
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'unit_memberships') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              error: { message: 'Membership update failed' },
            }),
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      })

      const result = await deactivateAccount()

      // Should still succeed since membership error doesn't fail the operation
      expect(result.success).toBe(true)
    })
  })
})
