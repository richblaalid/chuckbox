'use server'

/**
 * Leadership and Activity tracking - server actions for:
 * - Leadership position management
 * - Activity logging (camping, hiking, service, conservation)
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { ActionResult } from './types'
import { checkFeatureEnabled, verifyLeaderRole } from './utils'

// ==========================================
// LEADERSHIP POSITIONS
// ==========================================

/**
 * Add a leadership position for a scout
 */
export async function addLeadershipPosition(
  scoutId: string,
  positionId: string,
  unitId: string,
  startDate: string,
  notes?: string
): Promise<ActionResult<{ historyId: string }>> {
  const featureCheck = await checkFeatureEnabled<{ historyId: string }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  const { data: history, error } = await adminSupabase
    .from('scout_leadership_history')
    .insert({
      scout_id: scoutId,
      position_id: positionId,
      unit_id: unitId,
      start_date: startDate,
      notes,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error adding leadership position:', error)
    return { success: false, error: 'Failed to add leadership position' }
  }

  revalidatePath(`/scouts/${scoutId}`)
  revalidatePath('/advancement')
  return { success: true, data: { historyId: history.id } }
}

/**
 * End a leadership position
 */
export async function endLeadershipPosition(
  historyId: string,
  unitId: string,
  endDate: string
): Promise<ActionResult> {
  const featureCheck = await checkFeatureEnabled<void>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  const { error } = await adminSupabase
    .from('scout_leadership_history')
    .update({
      end_date: endDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', historyId)

  if (error) {
    console.error('Error ending leadership position:', error)
    return { success: false, error: 'Failed to end leadership position' }
  }

  revalidatePath('/advancement')
  return { success: true }
}

// ==========================================
// ACTIVITY LOGGING
// ==========================================

/**
 * Log an activity entry (camping, hiking, service, conservation)
 */
export async function logActivity(
  scoutId: string,
  unitId: string,
  activityType: 'camping' | 'hiking' | 'service' | 'conservation',
  activityDate: string,
  value: number,
  description?: string,
  location?: string,
  eventId?: string
): Promise<ActionResult<{ entryId: string }>> {
  const featureCheck = await checkFeatureEnabled<{ entryId: string }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  const { data: entry, error } = await adminSupabase
    .from('scout_activity_entries')
    .insert({
      scout_id: scoutId,
      activity_type: activityType,
      activity_date: activityDate,
      value,
      description,
      location,
      event_id: eventId,
      verified_by: auth.profileId,
      verified_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error logging activity:', error)
    return { success: false, error: 'Failed to log activity' }
  }

  revalidatePath(`/scouts/${scoutId}`)
  revalidatePath('/advancement')
  return { success: true, data: { entryId: entry.id } }
}
