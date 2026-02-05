'use server'

/**
 * Merit badge functions for advancement module
 * - Start merit badge tracking
 * - Mark requirements complete/incomplete
 * - Update requirement notes
 * - Version management
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { appendNote } from '@/lib/notes-utils'
import type { ActionResult } from './types'
import { checkFeatureEnabled, verifyLeaderRole } from './utils'

/**
 * Start tracking a merit badge for a scout
 */
export async function startMeritBadge(
  scoutId: string,
  meritBadgeId: string,
  unitId: string,
  counselorName?: string,
  counselorProfileId?: string
): Promise<ActionResult<{ progressId: string }>> {
  const featureCheck = await checkFeatureEnabled<{ progressId: string }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Get the current active version for this badge
  let effectiveVersionYear: number | null = null

  const { data: currentVersion } = await adminSupabase
    .from('bsa_merit_badge_versions')
    .select('version_year')
    .eq('merit_badge_id', meritBadgeId)
    .eq('is_current', true)
    .maybeSingle()

  if (currentVersion) {
    effectiveVersionYear = currentVersion.version_year
  } else {
    // Fallback: get the badge's requirement_version_year
    const { data: badge } = await adminSupabase
      .from('bsa_merit_badges')
      .select('requirement_version_year')
      .eq('id', meritBadgeId)
      .single()

    if (!badge?.requirement_version_year) {
      return { success: false, error: 'Merit badge does not have a version year set' }
    }
    effectiveVersionYear = badge.requirement_version_year
  }

  // Create merit badge progress record with version tracking
  const { data: progress, error: progressError } = await adminSupabase
    .from('scout_merit_badge_progress')
    .insert({
      scout_id: scoutId,
      merit_badge_id: meritBadgeId,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      counselor_name: counselorName,
      counselor_profile_id: counselorProfileId,
      requirement_version_year: effectiveVersionYear,
    })
    .select('id')
    .single()

  if (progressError) {
    console.error('Error creating merit badge progress:', progressError)
    return { success: false, error: 'Failed to start merit badge tracking' }
  }

  // Get all completable requirements for this badge's active version
  // (exclude headers which are just grouping containers)
  const { data: requirements } = await adminSupabase
    .from('bsa_merit_badge_requirements')
    .select('id')
    .eq('merit_badge_id', meritBadgeId)
    .eq('version_year', effectiveVersionYear)
    .neq('is_header', true)

  if (requirements && requirements.length > 0) {
    // Create requirement progress records
    const reqProgressRecords = requirements.map((req) => ({
      scout_merit_badge_progress_id: progress.id,
      requirement_id: req.id,
      status: 'not_started' as const,
    }))

    await adminSupabase.from('scout_merit_badge_requirement_progress').insert(reqProgressRecords)
  }

  revalidatePath(`/scouts/${scoutId}`)
  revalidatePath('/advancement/merit-badges')
  return { success: true, data: { progressId: progress.id } }
}

/**
 * Get available versions for a merit badge
 */
export async function getMeritBadgeVersions(meritBadgeId: string): Promise<ActionResult<{
  versions: Array<{
    version_year: number
    is_current: boolean | null
    source: string | null
  }>
  currentYear: number | null
}>> {
  // Use admin client to bypass RLS for this read-only BSA reference query
  const supabase = createAdminClient()

  const { data: versions, error } = await supabase
    .from('bsa_merit_badge_versions')
    .select('version_year, is_current, source')
    .eq('merit_badge_id', meritBadgeId)
    .order('version_year', { ascending: false })

  if (error) {
    console.error('Error fetching merit badge versions:', error)
    return { success: false, error: 'Failed to fetch versions' }
  }

  const currentVersion = versions?.find(v => v.is_current)

  return {
    success: true,
    data: {
      versions: versions || [],
      currentYear: currentVersion?.version_year || null,
    },
  }
}

/**
 * Mark a merit badge requirement complete
 * @param noteText - Optional note text to add to the structured notes array
 */
export async function markMeritBadgeRequirement(
  requirementProgressId: string,
  unitId: string,
  completedAt?: string,
  noteText?: string
): Promise<ActionResult> {
  const featureCheck = await checkFeatureEnabled<void>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Fetch existing notes to append to
  const { data: existing } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .select('notes')
    .eq('id', requirementProgressId)
    .single()

  // Build the new notes value using appendNote
  let newNotes: string | null = existing?.notes || null
  if (noteText) {
    newNotes = appendNote(existing?.notes || null, {
      text: noteText,
      author: auth.fullName,
      authorId: auth.profileId,
      type: 'completion',
    })
  } else {
    // Even without explicit note text, record who completed it
    newNotes = appendNote(existing?.notes || null, {
      text: 'Requirement completed',
      author: auth.fullName,
      authorId: auth.profileId,
      type: 'completion',
    })
  }

  const { error } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .update({
      status: 'completed',
      completed_at: completedAt || new Date().toISOString(),
      completed_by: auth.profileId,
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requirementProgressId)

  if (error) {
    console.error('Error marking MB requirement complete:', error)
    return { success: false, error: 'Failed to mark requirement complete' }
  }

  revalidatePath('/advancement')
  return { success: true }
}

/**
 * Undo a completed merit badge requirement - resets status and adds undo note
 * @param undoReason - Required reason for undoing the completion (for audit trail)
 */
export async function undoMeritBadgeRequirementCompletion(
  requirementProgressId: string,
  unitId: string,
  undoReason: string
): Promise<ActionResult> {
  const featureCheck = await checkFeatureEnabled<void>()
  if (featureCheck) return featureCheck

  if (!undoReason || undoReason.trim().length === 0) {
    return { success: false, error: 'A reason is required to undo a completed requirement' }
  }

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Fetch existing requirement progress
  const { data: existing } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .select('notes, status, scout_merit_badge_progress_id')
    .eq('id', requirementProgressId)
    .single()

  if (!existing) {
    return { success: false, error: 'Requirement progress not found' }
  }

  // Only allow undo on completed or approved requirements (not awarded)
  if (!['completed', 'approved'].includes(existing.status)) {
    return { success: false, error: 'Only completed or approved requirements can be undone' }
  }

  // Append the undo note with reason
  const newNotes = appendNote(existing.notes || null, {
    text: `Undo: ${undoReason.trim()}`,
    author: auth.fullName,
    authorId: auth.profileId,
    type: 'undo',
  })

  const { error } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .update({
      status: 'not_started',
      completed_at: null,
      completed_by: null,
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requirementProgressId)

  if (error) {
    console.error('Error undoing MB requirement completion:', error)
    return { success: false, error: 'Failed to undo requirement completion' }
  }

  // Get scout ID for path revalidation
  const { data: progress } = await adminSupabase
    .from('scout_merit_badge_progress')
    .select('scout_id')
    .eq('id', existing.scout_merit_badge_progress_id)
    .single()

  revalidatePath('/advancement')
  if (progress?.scout_id) {
    revalidatePath(`/scouts/${progress.scout_id}`)
  }
  return { success: true }
}

/**
 * Add a note to a merit badge requirement without changing its status
 * Appends to the structured notes array
 */
export async function updateMeritBadgeRequirementNotes(
  requirementProgressId: string,
  unitId: string,
  noteText: string
): Promise<ActionResult> {
  const featureCheck = await checkFeatureEnabled<void>()
  if (featureCheck) return featureCheck

  if (!noteText || noteText.trim().length === 0) {
    return { success: false, error: 'Note text is required' }
  }

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Fetch existing notes to append to
  const { data: existing } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .select('notes, scout_merit_badge_progress_id')
    .eq('id', requirementProgressId)
    .single()

  if (!existing) {
    return { success: false, error: 'Requirement progress not found' }
  }

  // Append the new note
  const newNotes = appendNote(existing.notes || null, {
    text: noteText.trim(),
    author: auth.fullName,
    authorId: auth.profileId,
    type: 'general',
  })

  const { error } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .update({
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requirementProgressId)

  if (error) {
    console.error('Error updating MB requirement notes:', error)
    return { success: false, error: 'Failed to update notes' }
  }

  // Get scout ID for path revalidation
  const { data: progress } = await adminSupabase
    .from('scout_merit_badge_progress')
    .select('scout_id')
    .eq('id', existing.scout_merit_badge_progress_id)
    .single()

  revalidatePath('/advancement')
  if (progress?.scout_id) {
    revalidatePath(`/scouts/${progress.scout_id}`)
  }
  return { success: true }
}

/**
 * Add a note to a merit badge requirement, creating progress record if needed.
 */
export async function addMeritBadgeRequirementNoteWithInit(params: {
  meritBadgeProgressId: string
  requirementId: string
  unitId: string
  noteText: string
}): Promise<ActionResult<{ progressId: string }>> {
  const featureCheck = await checkFeatureEnabled<{ progressId: string }>()
  if (featureCheck) return featureCheck

  if (!params.noteText || params.noteText.trim().length === 0) {
    return { success: false, error: 'Note text is required' }
  }

  const auth = await verifyLeaderRole(params.unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Check if requirement progress already exists
  let { data: reqProgress } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .select('id, notes')
    .eq('scout_merit_badge_progress_id', params.meritBadgeProgressId)
    .eq('requirement_id', params.requirementId)
    .maybeSingle()

  // Create requirement progress if it doesn't exist
  if (!reqProgress) {
    const { data: newProgress, error: createError } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .insert({
        scout_merit_badge_progress_id: params.meritBadgeProgressId,
        requirement_id: params.requirementId,
        status: 'not_started',
      })
      .select('id, notes')
      .single()

    if (createError) {
      console.error('Error creating MB requirement progress:', createError)
      return { success: false, error: 'Failed to create requirement progress' }
    }

    reqProgress = newProgress
  }

  // Append the new note
  const newNotes = appendNote(reqProgress.notes || null, {
    text: params.noteText.trim(),
    author: auth.fullName,
    authorId: auth.profileId,
    type: 'general',
  })

  const { error } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .update({
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reqProgress.id)

  if (error) {
    console.error('Error adding MB note:', error)
    return { success: false, error: 'Failed to add note' }
  }

  // Get scout ID for path revalidation
  const { data: progress } = await adminSupabase
    .from('scout_merit_badge_progress')
    .select('scout_id')
    .eq('id', params.meritBadgeProgressId)
    .single()

  revalidatePath('/advancement')
  if (progress?.scout_id) {
    revalidatePath(`/scouts/${progress.scout_id}`)
  }
  return { success: true, data: { progressId: reqProgress.id } }
}

/**
 * Requirement mapping for version switching
 */
interface RequirementMapping {
  sourceReqNumber: string
  targetReqId: string | null
  targetReqNumber: string | null
  confidence: 'exact' | 'likely' | 'manual' | 'none'
}

/**
 * Switch a scout's merit badge to a different requirement version.
 * This will:
 * 1. Update the progress record with the new version year
 * 2. Map completed requirements to the new version based on provided mappings
 * 3. Create new requirement progress records for mapped requirements
 * 4. Preserve unmapped requirements as historical notes
 */
export async function switchMeritBadgeVersion(params: {
  unitId: string
  scoutId: string
  meritBadgeId: string
  progressId: string
  currentVersionYear: number
  targetVersionYear: number
  mappings: RequirementMapping[]
}): Promise<ActionResult<{
  mappedCount: number
  unmappedCount: number
}>> {
  const featureCheck = await checkFeatureEnabled<{ mappedCount: number; unmappedCount: number }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(params.unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()
  const timestamp = new Date().toISOString()

  try {
    // 1. Get existing requirement progress for this badge (with requirement_number for matching)
    const { data: existingProgress } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .select(`
        id,
        requirement_id,
        status,
        completed_at,
        completed_by,
        notes,
        bsa_merit_badge_requirements!inner(requirement_number)
      `)
      .eq('scout_merit_badge_progress_id', params.progressId)
      .eq('status', 'completed')

    // 2. Update the main progress record with new version year
    const { error: updateError } = await adminSupabase
      .from('scout_merit_badge_progress')
      .update({
        requirement_version_year: params.targetVersionYear,
        updated_at: timestamp,
      })
      .eq('id', params.progressId)

    if (updateError) {
      console.error('Error updating progress version:', updateError)
      return { success: false, error: 'Failed to update version' }
    }

    // 3. Delete old requirement progress records
    if (existingProgress && existingProgress.length > 0) {
      const { error: deleteError } = await adminSupabase
        .from('scout_merit_badge_requirement_progress')
        .delete()
        .eq('scout_merit_badge_progress_id', params.progressId)

      if (deleteError) {
        console.error('Error deleting old progress:', deleteError)
        // Don't fail completely, try to continue
      }
    }

    // 4. Create new requirement progress records for mapped requirements
    let mappedCount = 0
    let unmappedCount = 0

    for (const mapping of params.mappings) {
      if (mapping.targetReqId && mapping.confidence !== 'none') {
        // Find the original progress for this requirement by matching requirement_number
        const originalProgress = existingProgress?.find(p => {
          const reqNumber = (p.bsa_merit_badge_requirements as { requirement_number: string })?.requirement_number
          return reqNumber === mapping.sourceReqNumber
        })

        const { error: insertError } = await adminSupabase
          .from('scout_merit_badge_requirement_progress')
          .insert({
            scout_merit_badge_progress_id: params.progressId,
            requirement_id: mapping.targetReqId,
            status: 'completed',
            completed_at: originalProgress?.completed_at || timestamp,
            completed_by: originalProgress?.completed_by || auth.profileId,
            notes: appendNote(originalProgress?.notes || null, {
              text: `Mapped from ${params.currentVersionYear} requirement ${mapping.sourceReqNumber} (${mapping.confidence} match)`,
              author: auth.fullName,
              authorId: auth.profileId,
              type: 'general',
            }),
          })

        if (insertError) {
          console.error('Error inserting mapped progress:', insertError)
          unmappedCount++
        } else {
          mappedCount++
        }
      } else {
        unmappedCount++
      }
    }

    revalidatePath(`/scouts/${params.scoutId}`)
    revalidatePath('/advancement')

    return {
      success: true,
      data: { mappedCount, unmappedCount },
    }
  } catch (error) {
    console.error('Error switching version:', error)
    return { success: false, error: 'Failed to switch version' }
  }
}
