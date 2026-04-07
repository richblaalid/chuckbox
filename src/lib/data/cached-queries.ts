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
import { createClient } from '@/lib/supabase/server'

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
 * For multi-unit users, pass `requestedUnitId` (typically from the URL
 * `?unit=` query param) to select the active unit. If omitted or no
 * match is found, falls back to the first membership.
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

  const matched = requestedUnitId
    ? memberships.find(m => m.unit_id === requestedUnitId)
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
