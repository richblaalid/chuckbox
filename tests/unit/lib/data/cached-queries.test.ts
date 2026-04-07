/**
 * Tests for getCurrentMembership() multi-unit support.
 *
 * The helper accepts an optional requestedUnitId. When provided, it
 * returns the matching membership. When omitted (or no match), it
 * falls back to the first membership.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCurrentMembership } from '@/lib/data/cached-queries'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

describe('getCurrentMembership (cached, multi-unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupSupabaseMock(opts: {
    user: { id: string } | null
    profile: { id: string } | null
    memberships: Array<{ unit_id: string; role: string }>
  }) {
    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: opts.profile, error: null }),
        }
      }
      if (table === 'unit_memberships') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: opts.memberships, error: null }),
          }),
        }
      }
      return {}
    })

    return {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user }, error: null }) },
      from: fromMock,
    }
  }

  it('returns null when no user is authenticated', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValue(
      setupSupabaseMock({ user: null, profile: null, memberships: [] }) as never
    )

    const result = await getCurrentMembership()
    expect(result).toBeNull()
  })

  it('returns null when user has no memberships', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValue(
      setupSupabaseMock({
        user: { id: 'user-1' },
        profile: { id: 'profile-1' },
        memberships: [],
      }) as never
    )

    const result = await getCurrentMembership()
    expect(result).toBeNull()
  })

  it('returns the first membership when no requestedUnitId is provided', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValue(
      setupSupabaseMock({
        user: { id: 'user-1' },
        profile: { id: 'profile-1' },
        memberships: [
          { unit_id: 'unit-A', role: 'admin' },
          { unit_id: 'unit-B', role: 'parent' },
        ],
      }) as never
    )

    const result = await getCurrentMembership()
    expect(result).toEqual({
      profile_id: 'profile-1',
      unit_id: 'unit-A',
      role: 'admin',
    })
  })

  it('returns the matching membership when requestedUnitId is provided', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValue(
      setupSupabaseMock({
        user: { id: 'user-1' },
        profile: { id: 'profile-1' },
        memberships: [
          { unit_id: 'unit-A', role: 'admin' },
          { unit_id: 'unit-B', role: 'parent' },
        ],
      }) as never
    )

    const result = await getCurrentMembership('unit-B')
    expect(result).toEqual({
      profile_id: 'profile-1',
      unit_id: 'unit-B',
      role: 'parent',
    })
  })

  it('falls back to first membership when requestedUnitId does not match', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValue(
      setupSupabaseMock({
        user: { id: 'user-1' },
        profile: { id: 'profile-1' },
        memberships: [
          { unit_id: 'unit-A', role: 'admin' },
          { unit_id: 'unit-B', role: 'parent' },
        ],
      }) as never
    )

    const result = await getCurrentMembership('unit-nonexistent')
    expect(result).toEqual({
      profile_id: 'profile-1',
      unit_id: 'unit-A',
      role: 'admin',
    })
  })

  it('still works for single-unit users (regression check)', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    vi.mocked(createClient).mockResolvedValue(
      setupSupabaseMock({
        user: { id: 'user-1' },
        profile: { id: 'profile-1' },
        memberships: [{ unit_id: 'unit-A', role: 'admin' }],
      }) as never
    )

    const result = await getCurrentMembership()
    expect(result).toEqual({
      profile_id: 'profile-1',
      unit_id: 'unit-A',
      role: 'admin',
    })
  })
})
