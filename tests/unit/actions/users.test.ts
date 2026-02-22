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

const mockAdminSupabase = {
  auth: {
    admin: {
      inviteUserByEmail: vi.fn(),
    },
  },
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminSupabase),
}))

import {
  inviteUser,
  acceptPendingInvites,
  updateUserRole,
  removeUser,
  resendInvite,
  updateUserProfile,
  addScoutGuardian,
  removeScoutGuardian,
  inviteProfileToApp,
} from '@/app/actions/users'

function defaultChain() {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

function chainWith(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
}

describe('User Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── inviteUser ──────────────────────────────────────────────────

  describe('inviteUser', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await inviteUser({
        unitId: 'unit-1',
        email: 'test@test.com',
        role: 'parent',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return chainWith({ id: 'profile-123' })
        }
        if (table === 'unit_memberships') {
          return chainWith({ role: 'leader' })
        }
        return defaultChain()
      })

      const result = await inviteUser({
        unitId: 'unit-1',
        email: 'test@test.com',
        role: 'parent',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Only admins can invite users')
    })

    it('should return error when email already active', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return chainWith({ id: 'profile-123' })
        }
        if (table === 'unit_memberships') {
          membershipCalls++
          // 1st call: admin check
          if (membershipCalls === 1) return chainWith({ role: 'admin' })
          // 2nd call (Promise.all active check): found
          if (membershipCalls === 2) return chainWith({ id: 'existing-1' })
          // 3rd call (Promise.all invite check)
          return chainWith(null)
        }
        return defaultChain()
      })

      const result = await inviteUser({
        unitId: 'unit-1',
        email: 'existing@test.com',
        role: 'parent',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('This email is already a user of this unit')
    })

    it('should create invite and send email successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return chainWith({ id: 'profile-123' })
        }
        if (table === 'unit_memberships') {
          membershipCalls++
          if (membershipCalls === 1) return chainWith({ role: 'admin' })
          // active check: no existing
          if (membershipCalls === 2) return chainWith(null)
          // invite check: no existing
          if (membershipCalls === 3) return chainWith(null)
          // insert (returns void)
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return defaultChain()
      })

      mockAdminSupabase.auth.admin.inviteUserByEmail.mockResolvedValue({
        error: null,
      })

      const result = await inviteUser({
        unitId: 'unit-1',
        email: 'new@test.com',
        role: 'parent',
      })
      expect(result.success).toBe(true)
    })
  })

  // ─── acceptPendingInvites ────────────────────────────────────────

  describe('acceptPendingInvites', () => {
    it('should return 0 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await acceptPendingInvites()
      expect(result.accepted).toBe(0)
    })

    it('should return 0 when no pending invites', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@test.com' } },
      })

      mockAdminSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return chainWith({ id: 'profile-123' })
        }
        if (table === 'unit_memberships') {
          // .select().eq().eq() chain — needs chaining eq that resolves
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        return defaultChain()
      })

      const result = await acceptPendingInvites()
      expect(result.accepted).toBe(0)
    })
  })

  // ─── updateUserRole ──────────────────────────────────────────────

  describe('updateUserRole', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await updateUserRole('unit-1', 'member-1', 'leader')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          // admin check
          if (membershipCalls === 1) return chainWith({ role: 'leader' })
          // target user
          if (membershipCalls === 2)
            return chainWith({ profile_id: 'other', role: 'parent' })
          return defaultChain()
        }
        return defaultChain()
      })

      const result = await updateUserRole('unit-1', 'member-1', 'leader')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Only admins can change roles')
    })

    it('should prevent sole admin from demoting themselves', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          // admin check (from Promise.all)
          if (membershipCalls === 1) return chainWith({ role: 'admin' })
          // target user (from Promise.all) - it's the admin themselves
          if (membershipCalls === 2)
            return chainWith({ profile_id: 'user-123', role: 'admin' })
          // other admins query - none found
          if (membershipCalls === 3) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              neq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          return defaultChain()
        }
        return defaultChain()
      })

      const result = await updateUserRole('unit-1', 'member-1', 'leader')
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Cannot demote yourself - you are the only admin'
      )
    })

    it('should update role successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          if (membershipCalls === 1) return chainWith({ role: 'admin' })
          if (membershipCalls === 2)
            return chainWith({ profile_id: 'other', role: 'parent' })
          // update call
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return defaultChain()
      })

      const result = await updateUserRole('unit-1', 'member-1', 'leader')
      expect(result.success).toBe(true)
    })
  })

  // ─── removeUser ──────────────────────────────────────────────────

  describe('removeUser', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await removeUser('unit-1', 'member-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          if (membershipCalls === 1) return chainWith({ role: 'leader' })
          if (membershipCalls === 2)
            return chainWith({
              profile_id: 'other',
              role: 'parent',
              status: 'active',
            })
          return defaultChain()
        }
        return defaultChain()
      })

      const result = await removeUser('unit-1', 'member-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Only admins can remove users')
    })

    it('should delete invited users instead of deactivating', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          if (membershipCalls === 1) return chainWith({ role: 'admin' })
          if (membershipCalls === 2)
            return chainWith({
              profile_id: 'other',
              role: 'parent',
              status: 'invited',
            })
          // delete call
          return {
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return defaultChain()
      })

      const result = await removeUser('unit-1', 'member-1')
      expect(result.success).toBe(true)
    })

    it('should deactivate active users', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          if (membershipCalls === 1) return chainWith({ role: 'admin' })
          if (membershipCalls === 2)
            return chainWith({
              profile_id: 'other',
              role: 'leader',
              status: 'active',
            })
          // update call
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return defaultChain()
      })

      const result = await removeUser('unit-1', 'member-1')
      expect(result.success).toBe(true)
    })

    it('should prevent sole admin from removing themselves', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          if (membershipCalls === 1) return chainWith({ role: 'admin' })
          if (membershipCalls === 2)
            return chainWith({
              profile_id: 'user-123',
              role: 'admin',
              status: 'active',
            })
          // other admins check
          if (membershipCalls === 3) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              neq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          return defaultChain()
        }
        return defaultChain()
      })

      const result = await removeUser('unit-1', 'member-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Cannot remove yourself - you are the only admin'
      )
    })
  })

  // ─── resendInvite ────────────────────────────────────────────────

  describe('resendInvite', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await resendInvite('member-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when membership not invited', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          // get membership
          if (membershipCalls === 1)
            return chainWith({
              id: 'member-1',
              unit_id: 'unit-1',
              email: 'test@test.com',
              status: 'active',
            })
          return defaultChain()
        }
        return defaultChain()
      })

      const result = await resendInvite('member-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Can only resend invites for pending users'
      )
    })

    it('should resend invite successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          // get membership
          if (membershipCalls === 1)
            return chainWith({
              id: 'member-1',
              unit_id: 'unit-1',
              email: 'test@test.com',
              status: 'invited',
            })
          // admin check
          if (membershipCalls === 2)
            return chainWith({ role: 'admin' })
          // update invited_at
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return defaultChain()
      })

      mockAdminSupabase.auth.admin.inviteUserByEmail.mockResolvedValue({
        error: null,
      })

      const result = await resendInvite('member-1')
      expect(result.success).toBe(true)
    })
  })

  // ─── updateUserProfile ──────────────────────────────────────────

  describe('updateUserProfile', () => {
    const profileData = {
      first_name: 'John',
      last_name: 'Doe',
      phone_primary: '555-0100',
      phone_secondary: null,
      email_secondary: null,
      address_street: null,
      address_city: null,
      address_state: null,
      address_zip: null,
    }

    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await updateUserProfile(
        'unit-1',
        'target-profile',
        profileData
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not admin', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          if (membershipCalls === 1)
            return chainWith({ role: 'leader' })
          return defaultChain()
        }
        return defaultChain()
      })

      const result = await updateUserProfile(
        'unit-1',
        'target-profile',
        profileData
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Only admins can update user profiles')
    })

    it('should update profile successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      let membershipCalls = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships') {
          membershipCalls++
          if (membershipCalls === 1) return chainWith({ role: 'admin' })
          // target membership check
          if (membershipCalls === 2) return chainWith({ id: 'target-m' })
          return defaultChain()
        }
        return defaultChain()
      })

      mockAdminSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      })

      const result = await updateUserProfile(
        'unit-1',
        'target-profile',
        profileData
      )
      expect(result.success).toBe(true)
    })
  })

  // ─── addScoutGuardian ────────────────────────────────────────────

  describe('addScoutGuardian', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await addScoutGuardian(
        'unit-1',
        'profile-1',
        'scout-1',
        'parent'
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not admin or treasurer', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships')
          return chainWith({ role: 'leader' })
        return defaultChain()
      })

      const result = await addScoutGuardian(
        'unit-1',
        'profile-1',
        'scout-1',
        'parent'
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Only admins and treasurers can manage scout associations'
      )
    })

    it('should return error when association already exists', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships')
          return chainWith({ role: 'admin' })
        if (table === 'scouts') return chainWith({ id: 'scout-1' })
        if (table === 'scout_guardians')
          return chainWith({ id: 'existing-1' })
        return defaultChain()
      })

      const result = await addScoutGuardian(
        'unit-1',
        'profile-1',
        'scout-1',
        'parent'
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe('This association already exists')
    })

    it('should create guardian association successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships')
          return chainWith({ role: 'admin' })
        if (table === 'scouts') return chainWith({ id: 'scout-1' })
        if (table === 'scout_guardians') return chainWith(null) // no existing
        return defaultChain()
      })

      mockAdminSupabase.from.mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null }),
      })

      const result = await addScoutGuardian(
        'unit-1',
        'profile-1',
        'scout-1',
        'parent'
      )
      expect(result.success).toBe(true)
    })
  })

  // ─── removeScoutGuardian ─────────────────────────────────────────

  describe('removeScoutGuardian', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await removeScoutGuardian('unit-1', 'guardianship-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not admin or treasurer', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships')
          return chainWith({ role: 'parent' })
        return defaultChain()
      })

      const result = await removeScoutGuardian('unit-1', 'guardianship-1')
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Only admins and treasurers can manage scout associations'
      )
    })

    it('should remove guardian association successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships')
          return chainWith({ role: 'treasurer' })
        return defaultChain()
      })

      mockAdminSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      })

      const result = await removeScoutGuardian('unit-1', 'guardianship-1')
      expect(result.success).toBe(true)
    })
  })

  // ─── inviteProfileToApp ──────────────────────────────────────────

  describe('inviteProfileToApp', () => {
    it('should return error when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const result = await inviteProfileToApp({
        unitId: 'unit-1',
        profileId: 'profile-1',
        email: 'test@test.com',
        role: 'parent',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Not authenticated')
    })

    it('should return error when not admin or treasurer', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships')
          return chainWith({ role: 'leader' })
        return defaultChain()
      })

      const result = await inviteProfileToApp({
        unitId: 'unit-1',
        profileId: 'profile-1',
        email: 'test@test.com',
        role: 'parent',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe(
        'Only admins and treasurers can send invites'
      )
    })

    it('should return error when profile already has user_id', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships')
          return chainWith({ role: 'admin' })
        return defaultChain()
      })

      mockAdminSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'profile-1',
            user_id: 'existing-user',
            email: 'test@test.com',
          },
          error: null,
        }),
      })

      const result = await inviteProfileToApp({
        unitId: 'unit-1',
        profileId: 'profile-1',
        email: 'test@test.com',
        role: 'parent',
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('This person already has an app account')
    })

    it('should invite profile successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainWith({ id: 'profile-123' })
        if (table === 'unit_memberships')
          return chainWith({ role: 'admin' })
        return defaultChain()
      })

      let adminCalls = 0
      mockAdminSupabase.from.mockImplementation((table: string) => {
        adminCalls++
        if (table === 'profiles' && adminCalls === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'profile-1',
                user_id: null,
                email: null,
              },
              error: null,
            }),
          }
        }
        if (table === 'profiles') {
          // update profile email: .update().eq()
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'unit_memberships') {
          // update membership: .update().eq('unit_id').eq('profile_id')
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        return defaultChain()
      })

      mockAdminSupabase.auth.admin.inviteUserByEmail.mockResolvedValue({
        error: null,
      })

      const result = await inviteProfileToApp({
        unitId: 'unit-1',
        profileId: 'profile-1',
        email: 'new@test.com',
        role: 'parent',
      })
      expect(result.success).toBe(true)
    })
  })
})
