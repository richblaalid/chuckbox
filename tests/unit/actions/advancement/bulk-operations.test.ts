import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockCheckFeatureEnabled = vi.fn()
const mockVerifyLeaderRole = vi.fn()
vi.mock('@/app/actions/advancement/utils', () => ({
  checkFeatureEnabled: (...args: unknown[]) => mockCheckFeatureEnabled(...args),
  verifyLeaderRole: (...args: unknown[]) => mockVerifyLeaderRole(...args),
}))

vi.mock('@/lib/notes-utils', () => ({
  appendNote: vi.fn(() => '["mocked-notes"]'),
}))

const mockAdminSupabase = { from: vi.fn() }
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminSupabase),
}))

import {
  bulkMarkRequirementsComplete,
  bulkApproveRequirements,
  bulkApproveMeritBadgeRequirements,
  bulkAwardMeritBadges,
  bulkLogActivities,
} from '@/app/actions/advancement/bulk-operations'

function setupAuth() {
  mockCheckFeatureEnabled.mockResolvedValue(null)
  mockVerifyLeaderRole.mockResolvedValue({ profileId: 'profile-1', role: 'leader', fullName: 'Test Leader' })
}

function makeSelectChain(status: string) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { notes: null, status }, error: null }),
  }
}

function makeUpdateChain(error: unknown = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error }),
  }
}

/** Returns a mock that alternates between select and update calls (1-indexed). */
function makeAlternatingSelectUpdate(status: string, updateError: unknown = null) {
  let callCount = 0
  return () => {
    callCount++
    return callCount % 2 === 1 ? makeSelectChain(status) : makeUpdateChain(updateError)
  }
}

describe('bulkMarkRequirementsComplete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const result = await bulkMarkRequirementsComplete([], 'unit-1', '2025-01-01')
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return error when not a leader', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockVerifyLeaderRole.mockResolvedValue({ error: 'Not authorized' })

    const result = await bulkMarkRequirementsComplete([], 'unit-1', '2025-01-01')
    expect(result).toEqual({ success: false, error: 'Not authorized' })
  })

  it('should process entries and track success/failure counts', async () => {
    setupAuth()

    let callCount = 0
    mockAdminSupabase.from.mockImplementation(() => {
      callCount++
      return makeUpdateChain(callCount === 2 ? { message: 'DB error' } : null)
    })

    const entries = [
      { scoutId: 'scout-1', requirementProgressId: 'rp-1' },
      { scoutId: 'scout-2', requirementProgressId: 'rp-2' },
      { scoutId: 'scout-3', requirementProgressId: 'rp-3' },
    ]

    const result = await bulkMarkRequirementsComplete(entries, 'unit-1', '2025-01-01')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ successCount: 2, failedCount: 1 })
  })

  it('should handle empty entries', async () => {
    setupAuth()

    const result = await bulkMarkRequirementsComplete([], 'unit-1', '2025-01-01')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ successCount: 0, failedCount: 0 })
  })
})

describe('bulkApproveRequirements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const result = await bulkApproveRequirements(['rp-1'], 'unit-1')
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return 0/0 for empty array', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)

    const result = await bulkApproveRequirements([], 'unit-1')
    expect(result).toEqual({ success: true, data: { successCount: 0, failedCount: 0 } })
  })

  it('should return error when not a leader', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockVerifyLeaderRole.mockResolvedValue({ error: 'Not authorized' })

    const result = await bulkApproveRequirements(['rp-1'], 'unit-1')
    expect(result).toEqual({ success: false, error: 'Not authorized' })
  })

  it('should skip already approved requirements', async () => {
    setupAuth()
    mockAdminSupabase.from.mockImplementation(() => makeSelectChain('approved'))

    const result = await bulkApproveRequirements(['rp-1'], 'unit-1')
    expect(result.success).toBe(true)
    expect(result.data?.successCount).toBe(0)
    expect(result.data?.failedCount).toBe(0)
  })

  it('should approve and count successes', async () => {
    setupAuth()
    mockAdminSupabase.from.mockImplementation(makeAlternatingSelectUpdate('not_started'))

    const result = await bulkApproveRequirements(['rp-1', 'rp-2'], 'unit-1', '2025-01-01', 'Approved in meeting')
    expect(result.success).toBe(true)
    expect(result.data?.successCount).toBe(2)
    expect(result.data?.failedCount).toBe(0)
  })

  it('should count DB errors as failures', async () => {
    setupAuth()
    mockAdminSupabase.from.mockImplementation(makeAlternatingSelectUpdate('not_started', { message: 'DB error' }))

    const result = await bulkApproveRequirements(['rp-1'], 'unit-1')
    expect(result.data?.failedCount).toBe(1)
  })
})

describe('bulkApproveMeritBadgeRequirements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const result = await bulkApproveMeritBadgeRequirements(['rp-1'], 'unit-1')
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return 0/0 for empty array', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)

    const result = await bulkApproveMeritBadgeRequirements([], 'unit-1')
    expect(result).toEqual({ success: true, data: { successCount: 0, failedCount: 0 } })
  })

  it('should skip already approved MB requirements', async () => {
    setupAuth()
    mockAdminSupabase.from.mockImplementation(() => makeSelectChain('approved'))

    const result = await bulkApproveMeritBadgeRequirements(['rp-1'], 'unit-1')
    expect(result.data?.successCount).toBe(0)
  })

  it('should approve MB requirements', async () => {
    setupAuth()
    mockAdminSupabase.from.mockImplementation(makeAlternatingSelectUpdate('not_started'))

    const result = await bulkApproveMeritBadgeRequirements(['rp-1'], 'unit-1', '2025-01-01')
    expect(result.success).toBe(true)
    expect(result.data?.successCount).toBe(1)
  })
})

describe('bulkAwardMeritBadges', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const result = await bulkAwardMeritBadges(['prog-1'], 'unit-1')
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return error when not a leader', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockVerifyLeaderRole.mockResolvedValue({ error: 'Not authorized' })

    const result = await bulkAwardMeritBadges(['prog-1'], 'unit-1')
    expect(result).toEqual({ success: false, error: 'Not authorized' })
  })

  it('should award merit badges and count results', async () => {
    setupAuth()
    mockAdminSupabase.from.mockImplementation(() => ({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }))

    const result = await bulkAwardMeritBadges(['prog-1', 'prog-2'], 'unit-1')
    expect(result.success).toBe(true)
    expect(result.data?.successCount).toBe(2)
    expect(result.data?.failedCount).toBe(0)
  })

  it('should handle DB errors during awarding', async () => {
    setupAuth()

    let callCount = 0
    mockAdminSupabase.from.mockImplementation(() => {
      callCount++
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            error: callCount === 1 ? { message: 'DB error' } : null,
          }),
        }),
      }
    })

    const result = await bulkAwardMeritBadges(['prog-1', 'prog-2'], 'unit-1')
    expect(result.data?.successCount).toBe(1)
    expect(result.data?.failedCount).toBe(1)
  })
})

describe('bulkLogActivities', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const entries = [{ scoutId: 'scout-1', value: 2 }]
    const result = await bulkLogActivities(entries, 'unit-1', 'camping', '2025-03-15')
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return error when not a leader', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockVerifyLeaderRole.mockResolvedValue({ error: 'Not authorized' })

    const entries = [{ scoutId: 'scout-1', value: 2 }]
    const result = await bulkLogActivities(entries, 'unit-1', 'camping', '2025-03-15')
    expect(result).toEqual({ success: false, error: 'Not authorized' })
  })

  it('should batch insert activities and return counts', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
        error: null,
      }),
    })

    const entries = [
      { scoutId: 'scout-1', value: 2 },
      { scoutId: 'scout-2', value: 3 },
      { scoutId: 'scout-3', value: 1 },
    ]

    const result = await bulkLogActivities(entries, 'unit-1', 'hiking', '2025-04-01', 'Spring hike', 'Mt Trail')
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ successCount: 3, failedCount: 0 })
  })

  it('should return error on batch insert failure', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'DB error' },
      }),
    })

    const entries = [{ scoutId: 'scout-1', value: 2 }]
    const result = await bulkLogActivities(entries, 'unit-1', 'service', '2025-04-01')
    expect(result).toEqual({ success: false, error: 'Failed to log activities' })
  })
})
