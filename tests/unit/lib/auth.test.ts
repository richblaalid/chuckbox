/**
 * Tests for getCurrentMembership() in lib/auth.ts
 *
 * Mirrors the cached-queries variant but takes the supabase client
 * as a parameter (used by API routes that aren't in a cached request
 * context).
 */

import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getCurrentMembership, getRequestedUnitId } from '@/lib/auth'

function buildSupabase(opts: {
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
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user } }) },
    from: fromMock,
  } as any
}

describe('getCurrentMembership (lib/auth)', () => {
  it('returns null when no user', async () => {
    const supabase = buildSupabase({ user: null, profile: null, memberships: [] })
    expect(await getCurrentMembership(supabase)).toBeNull()
  })

  it('returns null when user has no memberships', async () => {
    const supabase = buildSupabase({
      user: { id: 'u1' },
      profile: { id: 'p1' },
      memberships: [],
    })
    expect(await getCurrentMembership(supabase)).toBeNull()
  })

  it('returns first membership when no requestedUnitId provided', async () => {
    const supabase = buildSupabase({
      user: { id: 'u1' },
      profile: { id: 'p1' },
      memberships: [
        { unit_id: 'unit-A', role: 'admin' },
        { unit_id: 'unit-B', role: 'parent' },
      ],
    })
    expect(await getCurrentMembership(supabase)).toEqual({
      profile_id: 'p1',
      unit_id: 'unit-A',
      role: 'admin',
    })
  })

  it('returns matching membership when requestedUnitId provided', async () => {
    const supabase = buildSupabase({
      user: { id: 'u1' },
      profile: { id: 'p1' },
      memberships: [
        { unit_id: 'unit-A', role: 'admin' },
        { unit_id: 'unit-B', role: 'parent' },
      ],
    })
    expect(await getCurrentMembership(supabase, 'unit-B')).toEqual({
      profile_id: 'p1',
      unit_id: 'unit-B',
      role: 'parent',
    })
  })

  it('falls back to first when requestedUnitId does not match', async () => {
    const supabase = buildSupabase({
      user: { id: 'u1' },
      profile: { id: 'p1' },
      memberships: [
        { unit_id: 'unit-A', role: 'admin' },
        { unit_id: 'unit-B', role: 'parent' },
      ],
    })
    expect(await getCurrentMembership(supabase, 'nonexistent')).toEqual({
      profile_id: 'p1',
      unit_id: 'unit-A',
      role: 'admin',
    })
  })

  it('still works for single-unit users (regression check)', async () => {
    const supabase = buildSupabase({
      user: { id: 'u1' },
      profile: { id: 'p1' },
      memberships: [{ unit_id: 'unit-A', role: 'admin' }],
    })
    expect(await getCurrentMembership(supabase)).toEqual({
      profile_id: 'p1',
      unit_id: 'unit-A',
      role: 'admin',
    })
  })
})

describe('getRequestedUnitId', () => {
  it('returns the unit param from the request URL', () => {
    const request = new NextRequest('https://example.com/api/foo?unit=unit-abc')
    expect(getRequestedUnitId(request)).toBe('unit-abc')
  })

  it('returns undefined when no unit param is present', () => {
    const request = new NextRequest('https://example.com/api/foo')
    expect(getRequestedUnitId(request)).toBeUndefined()
  })

  it('returns undefined when unit param is empty string', () => {
    const request = new NextRequest('https://example.com/api/foo?unit=')
    expect(getRequestedUnitId(request)).toBeUndefined()
  })

  it('handles other query params alongside unit', () => {
    const request = new NextRequest('https://example.com/api/foo?bar=1&unit=unit-xyz&baz=2')
    expect(getRequestedUnitId(request)).toBe('unit-xyz')
  })
})
