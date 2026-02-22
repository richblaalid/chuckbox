import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  FeatureFlag: { ADVANCEMENT_TRACKING: 'ADVANCEMENT_TRACKING' },
}))

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

import { checkFeatureEnabled, verifyLeaderRole, verifyParentAccess } from '@/app/actions/advancement/utils'

function chainWithMaybeSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
}

const mockProfile = { id: 'profile-1', first_name: 'Test', last_name: 'User' }

describe('checkFeatureEnabled', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(false)

    const result = await checkFeatureEnabled()
    expect(result).toEqual({ success: false, error: 'Advancement tracking feature is not enabled' })
  })

  it('should return null when feature is enabled', async () => {
    mockIsFeatureEnabled.mockReturnValue(true)

    const result = await checkFeatureEnabled()
    expect(result).toBeNull()
  })
})

describe('verifyLeaderRole', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const result = await verifyLeaderRole('unit-1')
    expect(result).toEqual({ error: 'Not authenticated' })
  })

  it('should return error when profile not found', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSupabase.from.mockReturnValue(chainWithMaybeSingle(null))

    const result = await verifyLeaderRole('unit-1')
    expect(result).toEqual({ error: 'Profile not found' })
  })

  it('should return error when not a unit member', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainWithMaybeSingle(mockProfile)
      if (table === 'unit_memberships') return chainWithMaybeSingle(null)
      return chainWithMaybeSingle(null)
    })

    const result = await verifyLeaderRole('unit-1')
    expect(result).toEqual({ error: 'Only leaders can modify advancement records' })
  })

  it.each(['parent', 'scout'])('should reject %s role', async (role) => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainWithMaybeSingle(mockProfile)
      if (table === 'unit_memberships') return chainWithMaybeSingle({ role })
      return chainWithMaybeSingle(null)
    })

    const result = await verifyLeaderRole('unit-1')
    expect(result).toEqual({ error: 'Only leaders can modify advancement records' })
  })

  it.each([
    ['leader', 'Test', 'User', 'Test User'],
    ['admin', 'Admin', 'User', 'Admin User'],
    ['treasurer', 'Treasury', null, 'Treasury'],
  ])('should accept %s role and build fullName', async (role, firstName, lastName, fullName) => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainWithMaybeSingle({ id: 'profile-1', first_name: firstName, last_name: lastName })
      if (table === 'unit_memberships') return chainWithMaybeSingle({ role })
      return chainWithMaybeSingle(null)
    })

    const result = await verifyLeaderRole('unit-1')
    expect(result).toEqual({ profileId: 'profile-1', role, fullName })
  })

  it('should use "Unknown" when name fields are empty', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainWithMaybeSingle({ id: 'profile-1', first_name: null, last_name: null })
      if (table === 'unit_memberships') return chainWithMaybeSingle({ role: 'leader' })
      return chainWithMaybeSingle(null)
    })

    const result = await verifyLeaderRole('unit-1')
    expect(result).toEqual({ profileId: 'profile-1', role: 'leader', fullName: 'Unknown' })
  })
})

describe('verifyParentAccess', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const result = await verifyParentAccess('scout-1')
    expect(result).toEqual({ error: 'Not authenticated' })
  })

  it('should return error when profile not found', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSupabase.from.mockReturnValue(chainWithMaybeSingle(null))

    const result = await verifyParentAccess('scout-1')
    expect(result).toEqual({ error: 'Profile not found' })
  })

  it('should return error when not a guardian', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainWithMaybeSingle({ id: 'profile-1' })
      if (table === 'scout_guardians') return chainWithMaybeSingle(null)
      return chainWithMaybeSingle(null)
    })

    const result = await verifyParentAccess('scout-1')
    expect(result).toEqual({ error: 'You are not a guardian of this scout' })
  })

  it('should return profileId when guardian access verified', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainWithMaybeSingle({ id: 'profile-1' })
      if (table === 'scout_guardians') return chainWithMaybeSingle({ id: 'guardian-1' })
      return chainWithMaybeSingle(null)
    })

    const result = await verifyParentAccess('scout-1')
    expect(result).toEqual({ profileId: 'profile-1' })
  })
})
