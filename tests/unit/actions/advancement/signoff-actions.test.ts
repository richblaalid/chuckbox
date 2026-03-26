import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockCheckFeatureEnabled = vi.fn()
vi.mock('@/app/actions/advancement/utils', () => ({
  checkFeatureEnabled: (...args: unknown[]) => mockCheckFeatureEnabled(...args),
}))

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

const mockAdminSupabase = { from: vi.fn() }
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminSupabase),
}))

import { approveRequirement, denyRequirement } from '@/app/actions/advancement/signoff-actions'

function chainWithSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
}

function chainWithMaybeSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
}

function makeUpdateChain(error: unknown = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error }),
  }
}

/** Sets up auth mocks so getUnitIdFromRequirement and verifyLeaderForUnit both pass. */
function setupFullAuth(type: 'rank' | 'merit_badge' = 'rank') {
  mockCheckFeatureEnabled.mockResolvedValue(null)
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

  const progressKey = type === 'rank' ? 'scout_rank_progress' : 'scout_merit_badge_progress'
  const progressTable = type === 'rank' ? 'scout_rank_requirement_progress' : 'scout_merit_badge_requirement_progress'

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === progressTable) return chainWithSingle({ [progressKey]: { scouts: { unit_id: 'unit-1' } } })
    if (table === 'profiles') return chainWithMaybeSingle({ id: 'profile-1', first_name: 'Test', last_name: 'Leader' })
    if (table === 'unit_memberships') return chainWithMaybeSingle({ role: 'leader' })
    return chainWithSingle(null)
  })
}

/** Builds an admin client mock that returns fetchData on the first call, then updateError on all subsequent calls. */
function setupAdminFetchThenUpdate(fetchData: unknown, updateError: unknown = null) {
  let callCount = 0
  mockAdminSupabase.from.mockImplementation(() => {
    callCount++
    if (callCount === 1) return chainWithSingle(fetchData)
    return makeUpdateChain(updateError)
  })
}

describe('approveRequirement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const result = await approveRequirement('req-1', 'rank')
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return error when requirement not found', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockSupabase.from.mockReturnValue(chainWithSingle(null))

    const result = await approveRequirement('req-1', 'rank')
    expect(result).toEqual({ success: false, error: 'Requirement not found' })
  })

  it('should return error when user is not a leader', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'scout_rank_requirement_progress') {
        return chainWithSingle({ scout_rank_progress: { scouts: { unit_id: 'unit-1' } } })
      }
      return chainWithMaybeSingle(null)
    })
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const result = await approveRequirement('req-1', 'rank')
    expect(result).toEqual({ success: false, error: 'Not authenticated' })
  })

  it('should approve a rank requirement', async () => {
    setupFullAuth('rank')
    setupAdminFetchThenUpdate({ submitted_at: '2025-01-15T00:00:00Z' })

    const result = await approveRequirement('req-1', 'rank')
    expect(result).toEqual({ success: true })
  })

  it('should approve a merit badge requirement', async () => {
    setupFullAuth('merit_badge')
    setupAdminFetchThenUpdate({ submitted_at: '2025-02-01T00:00:00Z' })

    const result = await approveRequirement('req-1', 'merit_badge')
    expect(result).toEqual({ success: true })
  })

  it('should return error on DB failure for rank', async () => {
    setupFullAuth('rank')
    setupAdminFetchThenUpdate({ submitted_at: '2025-01-15T00:00:00Z' }, { message: 'DB error' })

    const result = await approveRequirement('req-1', 'rank')
    expect(result).toEqual({ success: false, error: 'Failed to approve requirement' })
  })

  it('should return error on DB failure for merit badge', async () => {
    setupFullAuth('merit_badge')
    setupAdminFetchThenUpdate({ submitted_at: null }, { message: 'DB error' })

    const result = await approveRequirement('req-1', 'merit_badge')
    expect(result).toEqual({ success: false, error: 'Failed to approve requirement' })
  })
})

describe('denyRequirement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const result = await denyRequirement('req-1', 'rank', 'some reason')
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return error when reason is empty', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)

    const result = await denyRequirement('req-1', 'rank', '')
    expect(result).toEqual({ success: false, error: 'A reason is required when denying a requirement' })
  })

  it('should return error when reason is whitespace only', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)

    const result = await denyRequirement('req-1', 'rank', '   ')
    expect(result).toEqual({ success: false, error: 'A reason is required when denying a requirement' })
  })

  it('should return error when requirement not found', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockSupabase.from.mockReturnValue(chainWithSingle(null))

    const result = await denyRequirement('req-1', 'rank', 'Not ready')
    expect(result).toEqual({ success: false, error: 'Requirement not found' })
  })

  it('should deny a rank requirement with reason', async () => {
    setupFullAuth('rank')
    mockAdminSupabase.from.mockReturnValue(makeUpdateChain())

    const result = await denyRequirement('req-1', 'rank', 'Needs more work')
    expect(result).toEqual({ success: true })
  })

  it('should deny a merit badge requirement', async () => {
    setupFullAuth('merit_badge')
    mockAdminSupabase.from.mockReturnValue(makeUpdateChain())

    const result = await denyRequirement('req-1', 'merit_badge', 'Incomplete evidence')
    expect(result).toEqual({ success: true })
  })

  it('should return error on DB failure', async () => {
    setupFullAuth('rank')
    mockAdminSupabase.from.mockReturnValue(makeUpdateChain({ message: 'DB error' }))

    const result = await denyRequirement('req-1', 'rank', 'Reason')
    expect(result).toEqual({ success: false, error: 'Failed to deny requirement' })
  })
})
