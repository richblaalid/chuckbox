/**
 * React.cache() wrappers for server-side data fetching.
 *
 * These wrappers provide per-request memoization, ensuring that
 * the same query is only executed once per request even if called
 * from multiple components or server actions.
 *
 * IMPORTANT: These are for Server Components and Server Actions only.
 * For Client Components, use React Query or SWR instead.
 */
import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

/**
 * Cookie name used to persist the user's selected unit across navigation.
 * Set client-side by UnitContext when the user picks a unit in the switcher.
 */
const CURRENT_UNIT_COOKIE = 'chuckbox_current_unit'

/**
 * Get the current authenticated user.
 * Cached per-request to avoid multiple auth checks.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) return null
  return user
})

/**
 * Get the current user's profile.
 * Returns the profile linked to the authenticated user.
 */
export const getCurrentProfile = cache(async () => {
  const user = await getCurrentUser()
  if (!user) return null

  const supabase = await createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, email')
    .eq('user_id', user.id)
    .single()

  return profile
})

/**
 * Get the current user's active unit membership.
 *
 * Selection priority for multi-unit users:
 *   1. `requestedUnitId` argument (typically from URL `?unit=` query param)
 *   2. `chuckbox_current_unit` cookie (set client-side when user picks a unit
 *      in the unit switcher — preserves selection across navigation)
 *   3. First membership (fallback)
 *
 * Returns null when the user is not authenticated or has no memberships.
 */
export const getCurrentMembership = cache(async (requestedUnitId?: string) => {
  const profile = await getCurrentProfile()
  if (!profile) return null

  const supabase = await createClient()
  const { data: memberships } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')

  if (!memberships || memberships.length === 0) return null

  // Resolve effective unit ID: explicit arg > cookie > first membership
  let effectiveUnitId = requestedUnitId
  if (!effectiveUnitId) {
    const cookieStore = await cookies()
    effectiveUnitId = cookieStore.get(CURRENT_UNIT_COOKIE)?.value
  }

  const matched = effectiveUnitId
    ? memberships.find(m => m.unit_id === effectiveUnitId)
    : null
  const membership = matched ?? memberships[0]

  return {
    profile_id: profile.id,
    unit_id: membership.unit_id,
    role: membership.role,
  }
})

/**
 * Get the current user's unit with basic info.
 * Builds on getCurrentMembership for efficiency.
 *
 * For multi-unit users, pass `requestedUnitId` to select the active unit.
 */
export const getCurrentUnit = cache(async (requestedUnitId?: string) => {
  const membership = await getCurrentMembership(requestedUnitId)
  if (!membership) return null

  const supabase = await createClient()
  const { data: unit } = await supabase
    .from('units')
    .select('id, name, unit_number, unit_type')
    .eq('id', membership.unit_id)
    .single()

  return unit
})

/**
 * Get scouts for the current user's unit.
 * Optionally filter by active status.
 */
export const getUnitScouts = cache(async (activeOnly: boolean = true) => {
  const membership = await getCurrentMembership()
  if (!membership) return []

  const supabase = await createClient()
  let query = supabase
    .from('scouts')
    .select('id, first_name, last_name, rank, is_active')
    .eq('unit_id', membership.unit_id)
    .order('last_name')

  if (activeOnly) {
    query = query.eq('is_active', true)
  }

  const { data: scouts } = await query
  return scouts || []
})
