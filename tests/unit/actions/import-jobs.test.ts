import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { createImportJob, getImportJobStatus, processImportJob } from '@/app/actions/import-jobs'

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

function setupAuth() {
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'profiles') return chainWithMaybeSingle({ id: 'profile-1' })
    if (table === 'unit_memberships') return chainWithMaybeSingle({ role: 'leader' })
    return chainWithSingle(null)
  })
}

const stagedData = {
  scouts: [
    {
      bsaMemberId: 'bsa-1',
      ranks: [{ id: 'r1' }],
      rankRequirements: [{ id: 'rr1' }],
      meritBadges: [{ id: 'mb1' }, { id: 'mb2' }],
      meritBadgeRequirements: [{ id: 'mbr1' }],
    },
    {
      bsaMemberId: 'bsa-2',
      ranks: [],
      rankRequirements: [],
      meritBadges: [{ id: 'mb3' }],
      meritBadgeRequirements: [],
    },
  ],
}

describe('createImportJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    const result = await createImportJob('unit-1', 'troop_advancement', stagedData as never, ['bsa-1'])
    expect(result.success).toBe(false)
    expect(result.error).toBe('Not authenticated')
  })

  it('should return error when not a leader', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainWithMaybeSingle({ id: 'profile-1' })
      if (table === 'unit_memberships') return chainWithMaybeSingle({ role: 'parent' })
      return chainWithSingle(null)
    })

    const result = await createImportJob('unit-1', 'troop_advancement', stagedData as never, ['bsa-1'])
    expect(result.success).toBe(false)
    expect(result.error).toBe('Only leaders can manage import jobs')
  })

  it('should create import job with correct totals', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null }),
    })

    // Selecting only bsa-1 (1 rank + 1 rankReq + 2 MB + 1 MBR = 5 items)
    const result = await createImportJob('unit-1', 'troop_advancement', stagedData as never, ['bsa-1'])
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ jobId: 'job-1' })
  })

  it('should return error on DB failure', async () => {
    setupAuth()
    mockAdminSupabase.from.mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } }),
    })

    const result = await createImportJob('unit-1', 'troop_advancement', stagedData as never, ['bsa-1'])
    expect(result.success).toBe(false)
    expect(result.error).toBe('Insert failed')
  })
})

describe('getImportJobStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return job data', async () => {
    const mockJob = { id: 'job-1', unit_id: 'unit-1', status: 'completed', result: { imported: 5 } }
    mockSupabase.from.mockReturnValue(chainWithSingle(mockJob))

    const result = await getImportJobStatus('job-1')
    expect(result.success).toBe(true)
    expect(result.data?.id).toBe('job-1')
    expect(result.data?.status).toBe('completed')
  })

  it('should return error on DB failure', async () => {
    mockSupabase.from.mockReturnValue(chainWithSingle(null, { message: 'Not found' }))

    const result = await getImportJobStatus('job-999')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Not found')
  })

  it('should return error when job not found', async () => {
    mockSupabase.from.mockReturnValue(chainWithSingle(null))

    const result = await getImportJobStatus('job-999')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Job not found')
  })
})

describe('processImportJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should return error when job not found', async () => {
    mockAdminSupabase.from.mockReturnValue(chainWithSingle(null, { message: 'Not found' }))

    const result = await processImportJob('job-999')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Not found')
  })

  it('should return error when job is not pending', async () => {
    mockAdminSupabase.from.mockReturnValue(
      chainWithSingle({ id: 'job-1', status: 'completed', unit_id: 'unit-1' })
    )

    const result = await processImportJob('job-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Job is already completed')
  })

  it('should process a pending job successfully', async () => {
    const mockResult = { importedScouts: 3, importedItems: 50 }
    vi.doMock('@/app/actions/troop-advancement-import', () => ({
      processImportJobInternal: vi.fn().mockResolvedValue(mockResult),
    }))

    let adminCallCount = 0
    mockAdminSupabase.from.mockImplementation(() => {
      adminCallCount++
      if (adminCallCount === 1) {
        return chainWithSingle({
          id: 'job-1',
          status: 'pending',
          unit_id: 'unit-1',
          created_by: 'profile-1',
          total_items: 50,
          total_scouts: 3,
          staged_data: {},
          selected_scout_ids: ['bsa-1'],
        })
      }
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    const result = await processImportJob('job-1')
    expect(result.success).toBe(true)
    expect(result.data).toEqual(mockResult)
  })

  it('should mark job as failed when processing throws', async () => {
    vi.doMock('@/app/actions/troop-advancement-import', () => ({
      processImportJobInternal: vi.fn().mockRejectedValue(new Error('Processing crashed')),
    }))

    let adminCallCount = 0
    mockAdminSupabase.from.mockImplementation(() => {
      adminCallCount++
      if (adminCallCount === 1) {
        return chainWithSingle({
          id: 'job-1',
          status: 'pending',
          unit_id: 'unit-1',
          created_by: 'profile-1',
          total_items: 10,
          total_scouts: 1,
          staged_data: {},
          selected_scout_ids: [],
        })
      }
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    const result = await processImportJob('job-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Processing crashed')
  })
})
