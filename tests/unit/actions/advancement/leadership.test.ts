import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockCheckFeatureEnabled = vi.fn()
const mockVerifyLeaderRole = vi.fn()
vi.mock('@/app/actions/advancement/utils', () => ({
  checkFeatureEnabled: (...args: unknown[]) => mockCheckFeatureEnabled(...args),
  verifyLeaderRole: (...args: unknown[]) => mockVerifyLeaderRole(...args),
}))

const mockAdminSupabase = { from: vi.fn() }
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminSupabase),
}))

import { addLeadershipPosition, endLeadershipPosition, logActivity } from '@/app/actions/advancement/leadership'

function setupAuth() {
  mockCheckFeatureEnabled.mockResolvedValue(null)
  mockVerifyLeaderRole.mockResolvedValue({ profileId: 'profile-1', role: 'leader', fullName: 'Test Leader' })
}

describe('addLeadershipPosition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const result = await addLeadershipPosition('scout-1', 'pos-1', 'unit-1', '2025-01-01')
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return error when not a leader', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockVerifyLeaderRole.mockResolvedValue({ error: 'Only leaders can modify advancement records' })

    const result = await addLeadershipPosition('scout-1', 'pos-1', 'unit-1', '2025-01-01')
    expect(result).toEqual({ success: false, error: 'Only leaders can modify advancement records' })
  })

  it('should successfully add a leadership position', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'history-1' }, error: null }),
    })

    const result = await addLeadershipPosition('scout-1', 'pos-1', 'unit-1', '2025-01-01', 'Some notes')
    expect(result).toEqual({ success: true, data: { historyId: 'history-1' } })
  })

  it('should return error on DB failure', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    const result = await addLeadershipPosition('scout-1', 'pos-1', 'unit-1', '2025-01-01')
    expect(result).toEqual({ success: false, error: 'Failed to add leadership position' })
  })
})

describe('endLeadershipPosition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const result = await endLeadershipPosition('history-1', 'unit-1', '2025-06-01')
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return error when not a leader', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockVerifyLeaderRole.mockResolvedValue({ error: 'Not a leader' })

    const result = await endLeadershipPosition('history-1', 'unit-1', '2025-06-01')
    expect(result).toEqual({ success: false, error: 'Not a leader' })
  })

  it('should successfully end a leadership position', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    const result = await endLeadershipPosition('history-1', 'unit-1', '2025-06-01')
    expect(result).toEqual({ success: true })
  })

  it('should return error on DB failure', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })

    const result = await endLeadershipPosition('history-1', 'unit-1', '2025-06-01')
    expect(result).toEqual({ success: false, error: 'Failed to end leadership position' })
  })
})

describe('logActivity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when feature is disabled', async () => {
    mockCheckFeatureEnabled.mockResolvedValue({ success: false, error: 'Feature disabled' })

    const result = await logActivity('scout-1', 'unit-1', 'camping', '2025-03-15', 2)
    expect(result).toEqual({ success: false, error: 'Feature disabled' })
  })

  it('should return error when not a leader', async () => {
    mockCheckFeatureEnabled.mockResolvedValue(null)
    mockVerifyLeaderRole.mockResolvedValue({ error: 'Not authorized' })

    const result = await logActivity('scout-1', 'unit-1', 'hiking', '2025-03-15', 5)
    expect(result).toEqual({ success: false, error: 'Not authorized' })
  })

  it('should log a camping activity', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'entry-1' }, error: null }),
    })

    const result = await logActivity('scout-1', 'unit-1', 'camping', '2025-03-15', 2)
    expect(result).toEqual({ success: true, data: { entryId: 'entry-1' } })
  })

  it('should log a service activity with optional fields', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'entry-2' }, error: null }),
    })

    const result = await logActivity('scout-1', 'unit-1', 'service', '2025-04-20', 4, 'Food bank help', 'Food Bank', 'event-1')
    expect(result).toEqual({ success: true, data: { entryId: 'entry-2' } })
  })

  it('should log a conservation activity', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'entry-3' }, error: null }),
    })

    const result = await logActivity('scout-1', 'unit-1', 'conservation', '2025-05-01', 3)
    expect(result).toEqual({ success: true, data: { entryId: 'entry-3' } })
  })

  it('should return error on DB failure', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    })

    const result = await logActivity('scout-1', 'unit-1', 'hiking', '2025-03-15', 5)
    expect(result).toEqual({ success: false, error: 'Failed to log activity' })
  })
})
