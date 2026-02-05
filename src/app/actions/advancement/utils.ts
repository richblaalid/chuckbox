'use server'

/**
 * Utility functions for advancement module
 * - Authentication helpers
 * - Authorization verification
 * - Feature flag checks
 */

import { createClient } from '@/lib/supabase/server'
import { isFeatureEnabled, FeatureFlag } from '@/lib/feature-flags'
import type { ActionResult, LeaderAuthResult, ParentAuthResult, AuthError } from './types'

/**
 * Check if advancement tracking feature is enabled
 * Returns an error ActionResult if disabled, null if enabled
 */
export async function checkFeatureEnabled<T>(): Promise<ActionResult<T> | null> {
  if (!isFeatureEnabled(FeatureFlag.ADVANCEMENT_TRACKING)) {
    return { success: false, error: 'Advancement tracking feature is not enabled' }
  }
  return null
}

/**
 * Verify current user has leader role in a unit
 * Returns profile info on success, error object on failure
 */
export async function verifyLeaderRole(unitId: string): Promise<LeaderAuthResult | AuthError> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return { error: 'Profile not found' }
  }

  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('unit_id', unitId)
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership || !['admin', 'treasurer', 'leader'].includes(membership.role)) {
    return { error: 'Only leaders can modify advancement records' }
  }

  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Unknown'
  return { profileId: profile.id, role: membership.role, fullName }
}

/**
 * Verify current user is a guardian of a scout
 * Returns profile info on success, error object on failure
 */
export async function verifyParentAccess(scoutId: string): Promise<ParentAuthResult | AuthError> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return { error: 'Profile not found' }
  }

  // Check if user is a guardian of the scout
  const { data: guardian } = await supabase
    .from('scout_guardians')
    .select('id')
    .eq('scout_id', scoutId)
    .eq('profile_id', profile.id)
    .maybeSingle()

  if (!guardian) {
    return { error: 'You are not a guardian of this scout' }
  }

  return { profileId: profile.id }
}
