'use server'

/**
 * Sign-off actions for advancement module (Dashboard pending approvals)
 *
 * These actions handle approving/denying parent-submitted requirements
 * for both rank requirements and merit badge requirements.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { ActionResult } from './types'
import { checkFeatureEnabled } from './utils'
import type { PendingSignoffType } from '@/types/advancement'

/**
 * Get unitId from a requirement progress record
 */
async function getUnitIdFromRequirement(
  id: string,
  type: PendingSignoffType
): Promise<string | null> {
  const supabase = await createClient()

  if (type === 'rank') {
    const { data } = await supabase
      .from('scout_rank_requirement_progress')
      .select(`
        scout_rank_progress!inner (
          scouts!inner (
            unit_id
          )
        )
      `)
      .eq('id', id)
      .single()

    return (data?.scout_rank_progress as { scouts: { unit_id: string } } | null)?.scouts?.unit_id || null
  } else {
    const { data } = await supabase
      .from('scout_merit_badge_requirement_progress')
      .select(`
        scout_merit_badge_progress!inner (
          scouts!inner (
            unit_id
          )
        )
      `)
      .eq('id', id)
      .single()

    return (data?.scout_merit_badge_progress as { scouts: { unit_id: string } } | null)?.scouts?.unit_id || null
  }
}

/**
 * Verify user has leader role for the unit
 */
async function verifyLeaderForUnit(unitId: string): Promise<{
  profileId: string
  fullName: string
} | { error: string }> {
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
    return { error: 'Only leaders can approve requirements' }
  }

  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Unknown'
  return { profileId: profile.id, fullName }
}

/**
 * Approve a parent-submitted requirement (rank or merit badge)
 *
 * @param id - The requirement progress ID
 * @param type - 'rank' or 'merit_badge'
 */
export async function approveRequirement(
  id: string,
  type: PendingSignoffType
): Promise<ActionResult> {
  const featureCheck = await checkFeatureEnabled<void>()
  if (featureCheck) return featureCheck

  const unitId = await getUnitIdFromRequirement(id, type)
  if (!unitId) {
    return { success: false, error: 'Requirement not found' }
  }

  const auth = await verifyLeaderForUnit(unitId)
  if ('error' in auth) {
    return { success: false, error: auth.error }
  }

  const adminSupabase = createAdminClient()
  const now = new Date().toISOString()

  if (type === 'rank') {
    // Get the submission to preserve the completion date from the parent
    const { data: submission } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .select('submitted_at')
      .eq('id', id)
      .single()

    const { error } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .update({
        status: 'completed',
        completed_at: submission?.submitted_at || now,
        completed_by: auth.profileId,
        approval_status: 'approved',
        reviewed_by: auth.profileId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)

    if (error) {
      console.error('Error approving rank requirement:', error)
      return { success: false, error: 'Failed to approve requirement' }
    }
  } else {
    // Merit badge requirement
    const { data: submission } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .select('submitted_at')
      .eq('id', id)
      .single()

    const { error } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .update({
        status: 'completed',
        completed_at: submission?.submitted_at || now,
        completed_by: auth.profileId,
        approval_status: 'approved',
        reviewed_by: auth.profileId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)

    if (error) {
      console.error('Error approving merit badge requirement:', error)
      return { success: false, error: 'Failed to approve requirement' }
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/advancement')
  return { success: true }
}

/**
 * Deny a parent-submitted requirement with reason (rank or merit badge)
 *
 * @param id - The requirement progress ID
 * @param type - 'rank' or 'merit_badge'
 * @param reason - The reason for denial
 */
export async function denyRequirement(
  id: string,
  type: PendingSignoffType,
  reason: string
): Promise<ActionResult> {
  const featureCheck = await checkFeatureEnabled<void>()
  if (featureCheck) return featureCheck

  if (!reason || reason.trim().length === 0) {
    return { success: false, error: 'A reason is required when denying a requirement' }
  }

  const unitId = await getUnitIdFromRequirement(id, type)
  if (!unitId) {
    return { success: false, error: 'Requirement not found' }
  }

  const auth = await verifyLeaderForUnit(unitId)
  if ('error' in auth) {
    return { success: false, error: auth.error }
  }

  const adminSupabase = createAdminClient()
  const now = new Date().toISOString()

  const table = type === 'rank'
    ? 'scout_rank_requirement_progress'
    : 'scout_merit_badge_requirement_progress'

  const { error } = await adminSupabase
    .from(table)
    .update({
      approval_status: 'denied',
      denial_reason: reason.trim(),
      reviewed_by: auth.profileId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', id)

  if (error) {
    console.error(`Error denying ${type} requirement:`, error)
    return { success: false, error: 'Failed to deny requirement' }
  }

  revalidatePath('/dashboard')
  revalidatePath('/advancement')
  return { success: true }
}
