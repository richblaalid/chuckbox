import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return {
    ...actual,
    isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  }
})

const mockGetUser = vi.fn()
const mockServerSupabase = { auth: { getUser: mockGetUser }, from: vi.fn() }
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockServerSupabase),
}))

const mockAdminSupabase = { from: vi.fn() }
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminSupabase),
}))

import {
  stageTroopAdvancement,
  importStagedAdvancement,
  processImportJobInternal,
} from '@/app/actions/troop-advancement-import'
import type { StagedTroopAdvancement } from '@/lib/import/troop-advancement-types'

const FLAG_DISABLED_ERROR = 'Advancement tracking feature is not enabled'

const emptyStaged = {
  scouts: [],
  unmatchedScouts: [],
  totalRecords: 0,
} as unknown as StagedTroopAdvancement

describe('troop-advancement-import feature-flag gating (ADV-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: null } })
  })

  describe('when ADVANCEMENT_TRACKING is disabled', () => {
    beforeEach(() => mockIsFeatureEnabled.mockReturnValue(false))

    it('stageTroopAdvancement returns the flag error without touching the database', async () => {
      const result = await stageTroopAdvancement('unit-1', 'csv-content')
      expect(result).toEqual({ success: false, error: FLAG_DISABLED_ERROR })
      expect(mockServerSupabase.from).not.toHaveBeenCalled()
      expect(mockAdminSupabase.from).not.toHaveBeenCalled()
    })

    it('importStagedAdvancement returns the flag error without touching the database', async () => {
      const result = await importStagedAdvancement('unit-1', emptyStaged, [])
      expect(result).toEqual({ success: false, error: FLAG_DISABLED_ERROR })
      expect(mockServerSupabase.from).not.toHaveBeenCalled()
      expect(mockAdminSupabase.from).not.toHaveBeenCalled()
    })

    it('processImportJobInternal throws the flag error without touching the database', async () => {
      await expect(
        processImportJobInternal('unit-1', emptyStaged, [], 'profile-1')
      ).rejects.toThrow(FLAG_DISABLED_ERROR)
      expect(mockAdminSupabase.from).not.toHaveBeenCalled()
    })
  })

  describe('when ADVANCEMENT_TRACKING is enabled', () => {
    beforeEach(() => mockIsFeatureEnabled.mockReturnValue(true))

    it('stageTroopAdvancement proceeds past the flag check to auth', async () => {
      const result = await stageTroopAdvancement('unit-1', 'csv-content')
      expect(result).toEqual({ success: false, error: 'Not authenticated' })
    })

    it('importStagedAdvancement proceeds past the flag check to auth', async () => {
      const result = await importStagedAdvancement('unit-1', emptyStaged, [])
      expect(result).toEqual({ success: false, error: 'Not authenticated' })
    })
  })
})
