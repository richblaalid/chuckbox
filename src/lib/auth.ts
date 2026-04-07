import { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { Database } from '@/types/database'

/**
 * Get the current user's profile from the database.
 * Since profiles.id is now separate from auth.users.id,
 * this helper looks up the profile by user_id.
 */
export async function getCurrentProfile(
  supabase: SupabaseClient<Database>
): Promise<{ id: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  return profile
}

/**
 * Get the current user's profile and unit membership.
 *
 * For multi-unit users, pass `requestedUnitId` (typically from the URL
 * `?unit=` query param) to select the active unit. If omitted or no
 * match is found, falls back to the first membership.
 *
 * Returns null if the user is not authenticated or has no active memberships.
 */
export async function getCurrentMembership(
  supabase: SupabaseClient<Database>,
  requestedUnitId?: string
): Promise<{ profile_id: string; unit_id: string; role: string } | null> {
  const profile = await getCurrentProfile(supabase)
  if (!profile) return null

  const { data: memberships } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')

  if (!memberships || memberships.length === 0) return null

  const matched = requestedUnitId
    ? memberships.find(m => m.unit_id === requestedUnitId)
    : null
  const membership = matched ?? memberships[0]

  return {
    profile_id: profile.id,
    unit_id: membership.unit_id,
    role: membership.role,
  }
}

/**
 * Read the requested unit ID from a Next.js request URL.
 *
 * Used by API routes to extract the active unit from the `?unit=` query
 * param. Returns undefined when the param is missing or empty.
 *
 * Example:
 *   const unitId = getRequestedUnitId(request)
 *   const membership = await getCurrentMembership(supabase, unitId)
 */
export function getRequestedUnitId(request: NextRequest): string | undefined {
  const value = request.nextUrl.searchParams.get('unit')
  return value && value.length > 0 ? value : undefined
}
