'use server'

/**
 * Rank progress functions for advancement module
 * - Initialize rank progress
 * - Mark requirements complete/incomplete
 * - Update requirement notes
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { appendNote } from '@/lib/notes-utils'
import type { ActionResult } from './types'
import { checkFeatureEnabled, verifyLeaderRole } from './utils'

/**
 * Initialize rank progress for a scout
 */
export async function initializeRankProgress(
  scoutId: string,
  rankId: string,
  unitId: string
): Promise<ActionResult<{ progressId: string }>> {
  const featureCheck = await checkFeatureEnabled<{ progressId: string }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Get the rank to find its requirement_version_year
  const { data: rank } = await adminSupabase
    .from('bsa_ranks')
    .select('id, requirement_version_year')
    .eq('id', rankId)
    .single()

  if (!rank) {
    return { success: false, error: 'Rank not found' }
  }

  if (!rank.requirement_version_year) {
    return { success: false, error: 'Rank does not have a version year set' }
  }

  // Create rank progress record (no version_id needed)
  const { data: progress, error: progressError } = await adminSupabase
    .from('scout_rank_progress')
    .insert({
      scout_id: scoutId,
      rank_id: rankId,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (progressError) {
    console.error('Error creating rank progress:', progressError)
    return { success: false, error: 'Failed to initialize rank progress' }
  }

  // Get all top-level requirements for this rank's current version
  const { data: requirements } = await adminSupabase
    .from('bsa_rank_requirements')
    .select('id')
    .eq('rank_id', rankId)
    .eq('version_year', rank.requirement_version_year)
    .is('parent_requirement_id', null)

  if (requirements && requirements.length > 0) {
    // Create requirement progress records
    const reqProgressRecords = requirements.map((req) => ({
      scout_rank_progress_id: progress.id,
      requirement_id: req.id,
      status: 'not_started' as const,
    }))

    await adminSupabase.from('scout_rank_requirement_progress').insert(reqProgressRecords)
  }

  revalidatePath(`/scouts/${scoutId}`)
  return { success: true, data: { progressId: progress.id } }
}

/**
 * Mark a single requirement as complete
 * @param noteText - Optional note text to add to the structured notes array
 */
export async function markRequirementComplete(
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
    .from('scout_rank_requirement_progress')
    .select('notes')
    .eq('id', requirementProgressId)
    .single()

  // Build the new notes value
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
    .from('scout_rank_requirement_progress')
    .update({
      status: 'completed',
      completed_at: completedAt || new Date().toISOString(),
      completed_by: auth.profileId,
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requirementProgressId)

  if (error) {
    console.error('Error marking requirement complete:', error)
    return { success: false, error: 'Failed to mark requirement complete' }
  }

  revalidatePath('/advancement')
  return { success: true }
}

/**
 * Mark a requirement complete, auto-initializing progress records if needed
 * This is used when a scout hasn't started a rank yet but we want to mark a requirement
 */
export async function markRequirementCompleteWithInit(params: {
  scoutId: string
  rankId: string
  requirementId: string
  unitId: string
  completedAt?: string
  notes?: string
}): Promise<ActionResult<{ requirementProgressId: string }>> {
  const featureCheck = await checkFeatureEnabled<{ requirementProgressId: string }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(params.unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Get the rank to find its requirement_version_year
  const { data: rank } = await adminSupabase
    .from('bsa_ranks')
    .select('id, requirement_version_year')
    .eq('id', params.rankId)
    .single()

  if (!rank) {
    return { success: false, error: 'Rank not found' }
  }

  if (!rank.requirement_version_year) {
    return { success: false, error: 'Rank does not have a version year set' }
  }

  // Check if scout has rank progress for this rank
  let { data: rankProgress } = await adminSupabase
    .from('scout_rank_progress')
    .select('id')
    .eq('scout_id', params.scoutId)
    .eq('rank_id', params.rankId)
    .maybeSingle()

  // Create rank progress if it doesn't exist
  if (!rankProgress) {
    const { data: newProgress, error: progressError } = await adminSupabase
      .from('scout_rank_progress')
      .insert({
        scout_id: params.scoutId,
        rank_id: params.rankId,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (progressError) {
      console.error('Error creating rank progress:', progressError)
      return { success: false, error: 'Failed to create rank progress' }
    }

    rankProgress = newProgress

    // Create all requirement progress records for this rank's current version
    const { data: requirements } = await adminSupabase
      .from('bsa_rank_requirements')
      .select('id')
      .eq('rank_id', params.rankId)
      .eq('version_year', rank.requirement_version_year)

    if (requirements && requirements.length > 0) {
      const reqProgressRecords = requirements.map((req) => ({
        scout_rank_progress_id: rankProgress!.id,
        requirement_id: req.id,
        status: 'not_started' as const,
      }))

      await adminSupabase.from('scout_rank_requirement_progress').insert(reqProgressRecords)
    }
  }

  // Get the requirement progress record (including notes for appending)
  const { data: reqProgress, error: reqFetchError } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .select('id, status, notes')
    .eq('scout_rank_progress_id', rankProgress.id)
    .eq('requirement_id', params.requirementId)
    .maybeSingle()

  if (reqFetchError || !reqProgress) {
    console.error('Error fetching requirement progress:', reqFetchError)
    return { success: false, error: 'Failed to find requirement progress' }
  }

  // Skip if already completed
  if (['completed', 'approved', 'awarded'].includes(reqProgress.status)) {
    return { success: true, data: { requirementProgressId: reqProgress.id } }
  }

  // Build the new notes value using appendNote (same as markRequirementComplete)
  let newNotes: string | null = reqProgress.notes || null
  if (params.notes) {
    newNotes = appendNote(reqProgress.notes || null, {
      text: params.notes,
      author: auth.fullName,
      authorId: auth.profileId,
      type: 'completion',
    })
  } else {
    // Even without explicit note text, record who completed it
    newNotes = appendNote(reqProgress.notes || null, {
      text: 'Requirement completed',
      author: auth.fullName,
      authorId: auth.profileId,
      type: 'completion',
    })
  }

  // Mark requirement as complete
  const { error: updateError } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .update({
      status: 'completed',
      completed_at: params.completedAt || new Date().toISOString(),
      completed_by: auth.profileId,
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reqProgress.id)

  if (updateError) {
    console.error('Error marking requirement complete:', updateError)
    return { success: false, error: 'Failed to mark requirement complete' }
  }

  revalidatePath(`/scouts/${params.scoutId}`)
  revalidatePath('/advancement')
  return { success: true, data: { requirementProgressId: reqProgress.id } }
}

/**
 * Undo a completed requirement - resets status and adds undo note
 * @param undoReason - Required reason for undoing the completion (for audit trail)
 */
export async function undoRequirementCompletion(
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
    .from('scout_rank_requirement_progress')
    .select('notes, status')
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
    .from('scout_rank_requirement_progress')
    .update({
      status: 'not_started',
      completed_at: null,
      completed_by: null,
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requirementProgressId)

  if (error) {
    console.error('Error undoing requirement completion:', error)
    return { success: false, error: 'Failed to undo requirement completion' }
  }

  revalidatePath('/advancement')
  return { success: true }
}

/**
 * Add a note to a requirement without changing its status
 * Appends to the structured notes array
 */
export async function updateRequirementNotes(
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
    .from('scout_rank_requirement_progress')
    .select('notes')
    .eq('id', requirementProgressId)
    .single()

  // Append the new note
  const newNotes = appendNote(existing?.notes || null, {
    text: noteText.trim(),
    author: auth.fullName,
    authorId: auth.profileId,
    type: 'general',
  })

  const { error } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .update({
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requirementProgressId)

  if (error) {
    console.error('Error updating requirement notes:', error)
    return { success: false, error: 'Failed to update notes' }
  }

  revalidatePath('/advancement')
  return { success: true }
}

/**
 * Add a note to a rank requirement, creating progress record if needed.
 */
export async function addRankRequirementNoteWithInit(params: {
  scoutId: string
  rankId: string
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

  // Get the rank to find its requirement_version_year
  const { data: rank } = await adminSupabase
    .from('bsa_ranks')
    .select('id, requirement_version_year')
    .eq('id', params.rankId)
    .single()

  if (!rank || !rank.requirement_version_year) {
    return { success: false, error: 'Rank not found or missing version year' }
  }

  // Check if scout has rank progress for this rank
  let { data: rankProgress } = await adminSupabase
    .from('scout_rank_progress')
    .select('id')
    .eq('scout_id', params.scoutId)
    .eq('rank_id', params.rankId)
    .maybeSingle()

  // Create rank progress if it doesn't exist
  if (!rankProgress) {
    const { data: newProgress, error: progressError } = await adminSupabase
      .from('scout_rank_progress')
      .insert({
        scout_id: params.scoutId,
        rank_id: params.rankId,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (progressError) {
      console.error('Error creating rank progress:', progressError)
      return { success: false, error: 'Failed to create rank progress' }
    }

    rankProgress = newProgress

    // Create all requirement progress records for this rank's current version
    const { data: requirements } = await adminSupabase
      .from('bsa_rank_requirements')
      .select('id')
      .eq('rank_id', params.rankId)
      .eq('version_year', rank.requirement_version_year)

    if (requirements && requirements.length > 0) {
      const reqProgressRecords = requirements.map((req) => ({
        scout_rank_progress_id: rankProgress!.id,
        requirement_id: req.id,
        status: 'not_started' as const,
      }))

      await adminSupabase.from('scout_rank_requirement_progress').insert(reqProgressRecords)
    }
  }

  // Find the requirement progress record
  const { data: reqProgress } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .select('id, notes')
    .eq('scout_rank_progress_id', rankProgress.id)
    .eq('requirement_id', params.requirementId)
    .maybeSingle()

  if (!reqProgress) {
    return { success: false, error: 'Requirement progress not found' }
  }

  // Append the new note
  const newNotes = appendNote(reqProgress.notes || null, {
    text: params.noteText.trim(),
    author: auth.fullName,
    authorId: auth.profileId,
    type: 'general',
  })

  const { error } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .update({
      notes: newNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reqProgress.id)

  if (error) {
    console.error('Error adding note:', error)
    return { success: false, error: 'Failed to add note' }
  }

  revalidatePath('/advancement')
  revalidatePath(`/scouts/${params.scoutId}`)
  return { success: true, data: { progressId: reqProgress.id } }
}
