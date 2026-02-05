'use server'

/**
 * Bulk Operations - server actions for bulk sign-off and approval
 *
 * These functions handle bulk operations across multiple scouts/requirements.
 * Extracted from the original advancement.ts for better organization.
 *
 * Note: These functions are targets for N+1 query optimization in Phase 2.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { appendNote } from '@/lib/notes-utils'
import { ActionResult } from './types'
import { checkFeatureEnabled, verifyLeaderRole } from './utils'

// ==========================================
// BULK REQUIREMENT COMPLETION
// ==========================================

/**
 * Bulk mark requirements complete (for meeting entries)
 */
export async function bulkMarkRequirementsComplete(
  entries: Array<{
    scoutId: string
    requirementProgressId: string
  }>,
  unitId: string,
  completedAt: string
): Promise<ActionResult<{ successCount: number; failedCount: number }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  let successCount = 0
  let failedCount = 0

  for (const entry of entries) {
    const { error } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .update({
        status: 'completed',
        completed_at: completedAt,
        completed_by: auth.profileId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entry.requirementProgressId)

    if (error) {
      console.error('Error marking requirement complete:', error)
      failedCount++
    } else {
      successCount++
    }
  }

  revalidatePath('/advancement')
  return { success: true, data: { successCount, failedCount } }
}

// ==========================================
// BULK RANK APPROVAL
// ==========================================

/**
 * Bulk approve requirements for a single scout (for quick bulk approval on scout profile)
 * Takes an array of requirement progress IDs and approves them all with the same date/notes
 * Appends notes to existing notes to preserve history
 */
export async function bulkApproveRequirements(
  requirementProgressIds: string[],
  unitId: string,
  completedAt?: string,
  noteText?: string
): Promise<ActionResult<{ successCount: number; failedCount: number }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number }>()
  if (featureCheck) return featureCheck

  if (requirementProgressIds.length === 0) {
    return { success: true, data: { successCount: 0, failedCount: 0 } }
  }

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()
  const timestamp = completedAt || new Date().toISOString()

  // Process each requirement individually to preserve existing notes
  let successCount = 0
  let failedCount = 0

  for (const progressId of requirementProgressIds) {
    // Fetch existing notes and status
    const { data: existing } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .select('notes, status')
      .eq('id', progressId)
      .single()

    // Skip if already approved or awarded
    if (existing && ['approved', 'awarded'].includes(existing.status)) {
      continue
    }

    // Build new notes by appending
    const newNotes = appendNote(existing?.notes || null, {
      text: noteText ? noteText : 'Requirement approved',
      author: auth.fullName,
      authorId: auth.profileId,
      type: 'completion',
    })

    const { error } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .update({
        status: 'completed',
        completed_at: timestamp,
        completed_by: auth.profileId,
        notes: newNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', progressId)

    if (error) {
      console.error('Error approving requirement:', error)
      failedCount++
    } else {
      successCount++
    }
  }

  revalidatePath('/advancement')
  return { success: true, data: { successCount, failedCount } }
}

/**
 * Bulk approve requirements with auto-initialization for unstarted ranks
 * This handles the case where a scout hasn't started a rank yet
 * Appends notes to existing notes to preserve history
 */
export async function bulkApproveRequirementsWithInit(params: {
  scoutId: string
  rankId: string
  requirementIds: string[]
  unitId: string
  completedAt?: string
  noteText?: string
}): Promise<ActionResult<{ successCount: number; failedCount: number; rankProgressId?: string }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number; rankProgressId?: string }>()
  if (featureCheck) return featureCheck

  if (params.requirementIds.length === 0) {
    return { success: true, data: { successCount: 0, failedCount: 0 } }
  }

  const auth = await verifyLeaderRole(params.unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()
  const timestamp = params.completedAt || new Date().toISOString()

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

  // Get existing requirement progress records with their notes
  const { data: existingProgress } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .select('id, requirement_id, notes, status')
    .eq('scout_rank_progress_id', rankProgress.id)
    .in('requirement_id', params.requirementIds)

  const progressByReqId = new Map(
    existingProgress?.map(p => [p.requirement_id, p]) || []
  )

  let successCount = 0
  let failedCount = 0

  // Process each requirement individually to preserve existing notes
  for (const reqId of params.requirementIds) {
    const progress = progressByReqId.get(reqId)

    // Skip if already approved or awarded
    if (progress && ['approved', 'awarded'].includes(progress.status)) {
      continue
    }

    // Append to existing notes
    const newNotes = appendNote(progress?.notes || null, {
      text: params.noteText ? params.noteText : 'Requirement approved',
      author: auth.fullName,
      authorId: auth.profileId,
      type: 'completion',
    })

    const { error } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .update({
        status: 'completed',
        completed_at: timestamp,
        completed_by: auth.profileId,
        notes: newNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('scout_rank_progress_id', rankProgress.id)
      .eq('requirement_id', reqId)

    if (error) {
      console.error('Error approving requirement:', error)
      failedCount++
    } else {
      successCount++
    }
  }

  revalidatePath(`/scouts/${params.scoutId}`)
  revalidatePath('/advancement')
  return { success: true, data: { successCount, failedCount, rankProgressId: rankProgress.id } }
}

// ==========================================
// BULK MERIT BADGE APPROVAL
// ==========================================

/**
 * Bulk approve merit badge requirements for a single scout
 * Takes an array of requirement progress IDs and approves them all with the same date/notes
 * Appends notes to existing notes to preserve history
 */
export async function bulkApproveMeritBadgeRequirements(
  requirementProgressIds: string[],
  unitId: string,
  completedAt?: string,
  noteText?: string
): Promise<ActionResult<{ successCount: number; failedCount: number }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number }>()
  if (featureCheck) return featureCheck

  if (requirementProgressIds.length === 0) {
    return { success: true, data: { successCount: 0, failedCount: 0 } }
  }

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()
  const timestamp = completedAt || new Date().toISOString()

  // Process each requirement individually to preserve existing notes
  let successCount = 0
  let failedCount = 0

  for (const progressId of requirementProgressIds) {
    // Fetch existing notes and status
    const { data: existing } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .select('notes, status')
      .eq('id', progressId)
      .single()

    // Skip if already approved
    if (existing && existing.status === 'approved') {
      continue
    }

    // Build new notes by appending
    const newNotes = appendNote(existing?.notes || null, {
      text: noteText ? noteText : 'Requirement approved',
      author: auth.fullName,
      authorId: auth.profileId,
      type: 'completion',
    })

    const { error } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .update({
        status: 'completed',
        completed_at: timestamp,
        completed_by: auth.profileId,
        notes: newNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', progressId)

    if (error) {
      console.error('Error approving MB requirement:', error)
      failedCount++
    } else {
      successCount++
    }
  }

  revalidatePath('/advancement')
  return { success: true, data: { successCount, failedCount } }
}

/**
 * Bulk approve merit badge requirements, creating progress records for sub-requirements if needed.
 * This handles the case where sub-requirements (e.g., 1a, 1b) don't have progress records yet.
 * Appends notes to existing notes to preserve history.
 */
export async function bulkApproveMeritBadgeRequirementsWithInit(params: {
  scoutId: string
  meritBadgeId: string
  meritBadgeProgressId: string
  requirementIds: string[]
  unitId: string
  completedAt?: string
  noteText?: string
}): Promise<ActionResult<{ successCount: number; failedCount: number }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number }>()
  if (featureCheck) return featureCheck

  if (params.requirementIds.length === 0) {
    return { success: true, data: { successCount: 0, failedCount: 0 } }
  }

  const auth = await verifyLeaderRole(params.unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()
  const timestamp = params.completedAt || new Date().toISOString()

  // Get existing requirement progress records for this merit badge progress
  const { data: existingProgress } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .select('id, requirement_id, notes, status')
    .eq('scout_merit_badge_progress_id', params.meritBadgeProgressId)

  const existingProgressByReqId = new Map(
    existingProgress?.map(p => [p.requirement_id, p]) || []
  )

  // Separate requirements into those with existing progress and those needing creation
  const requirementsNeedingProgress = params.requirementIds.filter(
    reqId => !existingProgressByReqId.has(reqId)
  )
  const existingProgressRecords = params.requirementIds
    .filter(reqId => existingProgressByReqId.has(reqId))
    .map(reqId => existingProgressByReqId.get(reqId)!)

  let successCount = 0
  let failedCount = 0

  // Create progress records for sub-requirements that don't have them
  if (requirementsNeedingProgress.length > 0) {
    // For new records, create initial note
    const initialNotes = appendNote(null, {
      text: params.noteText ? params.noteText : 'Requirement approved',
      author: auth.fullName,
      authorId: auth.profileId,
      type: 'completion',
    })

    const newProgressRecords = requirementsNeedingProgress.map(reqId => ({
      scout_merit_badge_progress_id: params.meritBadgeProgressId,
      requirement_id: reqId,
      status: 'completed' as const,
      completed_at: timestamp,
      completed_by: auth.profileId,
      notes: initialNotes,
    }))

    const { data: inserted, error: insertError } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .insert(newProgressRecords)
      .select('id')

    if (insertError) {
      console.error('Error creating MB requirement progress:', insertError)
      failedCount += requirementsNeedingProgress.length
    } else {
      successCount += inserted?.length || 0
    }
  }

  // Update existing progress records individually to preserve notes
  for (const progress of existingProgressRecords) {
    // Skip if already approved
    if (progress.status === 'approved') {
      continue
    }

    // Append to existing notes
    const newNotes = appendNote(progress.notes || null, {
      text: params.noteText ? params.noteText : 'Requirement approved',
      author: auth.fullName,
      authorId: auth.profileId,
      type: 'completion',
    })

    const { error } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .update({
        status: 'completed',
        completed_at: timestamp,
        completed_by: auth.profileId,
        notes: newNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', progress.id)

    if (error) {
      console.error('Error updating MB requirement:', error)
      failedCount++
    } else {
      successCount++
    }
  }

  revalidatePath('/advancement')
  revalidatePath(`/scouts/${params.scoutId}`)
  return { success: true, data: { successCount, failedCount } }
}

// ==========================================
// BULK ENTRY ACTIONS
// ==========================================

/**
 * Bulk record requirement progress from the bulk entry interface
 * Handles both rank and merit badge requirements
 */
export async function bulkRecordProgress(params: {
  entries: Array<{
    scoutId: string
    requirementId: string
    type: 'rank' | 'merit_badge'
    parentId: string // rank_id or merit_badge_id
  }>
  unitId: string
  completedAt: string
  notes?: string
}): Promise<ActionResult<{ successCount: number; failedCount: number; errors: string[] }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number; errors: string[] }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(params.unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  let successCount = 0
  let failedCount = 0
  const errors: string[] = []

  for (const entry of params.entries) {
    try {
      if (entry.type === 'rank') {
        // Handle rank requirement
        const result = await processRankRequirementEntry(
          adminSupabase,
          entry.scoutId,
          entry.requirementId,
          entry.parentId,
          params.completedAt,
          auth.profileId,
          params.notes
        )

        if (result.success) {
          successCount++
        } else {
          errors.push(result.error || `Failed for scout ${entry.scoutId}`)
          failedCount++
        }
      } else {
        // Handle merit badge requirement
        const result = await processMeritBadgeRequirementEntry(
          adminSupabase,
          entry.scoutId,
          entry.requirementId,
          entry.parentId,
          params.completedAt,
          auth.profileId,
          params.notes
        )

        if (result.success) {
          successCount++
        } else {
          errors.push(result.error || `Failed for scout ${entry.scoutId}`)
          failedCount++
        }
      }
    } catch (err) {
      console.error('Unexpected error in bulk entry:', err)
      errors.push(`Unexpected error for scout ${entry.scoutId}`)
      failedCount++
    }
  }

  revalidatePath('/advancement')
  revalidatePath('/advancement/bulk-entry')

  return {
    success: failedCount === 0,
    data: { successCount, failedCount, errors },
    error: failedCount > 0 ? `Failed to record ${failedCount} entry/entries` : undefined,
  }
}

// Helper function to process a rank requirement entry
async function processRankRequirementEntry(
  adminSupabase: ReturnType<typeof createAdminClient>,
  scoutId: string,
  requirementId: string,
  rankId: string,
  completedAt: string,
  profileId: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
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

  // Check if scout has rank progress for this rank
  let { data: rankProgress } = await adminSupabase
    .from('scout_rank_progress')
    .select('id')
    .eq('scout_id', scoutId)
    .eq('rank_id', rankId)
    .maybeSingle()

  // Create rank progress if it doesn't exist
  if (!rankProgress) {
    const { data: newProgress, error: progressError } = await adminSupabase
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
      return { success: false, error: 'Failed to create rank progress' }
    }

    rankProgress = newProgress

    // Create all requirement progress records for this rank's current version
    const { data: requirements } = await adminSupabase
      .from('bsa_rank_requirements')
      .select('id')
      .eq('rank_id', rankId)
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

  // Check if requirement progress exists
  let { data: reqProgress } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .select('id, status')
    .eq('scout_rank_progress_id', rankProgress.id)
    .eq('requirement_id', requirementId)
    .maybeSingle()

  // Create requirement progress if it doesn't exist
  if (!reqProgress) {
    const { data: newReqProgress, error: newReqError } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .insert({
        scout_rank_progress_id: rankProgress.id,
        requirement_id: requirementId,
        status: 'not_started',
      })
      .select('id, status')
      .single()

    if (newReqError) {
      return { success: false, error: 'Failed to create requirement progress' }
    }

    reqProgress = newReqProgress
  }

  // Skip if already completed
  if (['completed', 'approved', 'awarded'].includes(reqProgress.status)) {
    return { success: true }
  }

  // Mark requirement as complete
  const { error: updateError } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .update({
      status: 'completed',
      completed_at: completedAt,
      completed_by: profileId,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reqProgress.id)

  if (updateError) {
    return { success: false, error: 'Failed to mark requirement complete' }
  }

  return { success: true }
}

// Helper function to process a merit badge requirement entry
async function processMeritBadgeRequirementEntry(
  adminSupabase: ReturnType<typeof createAdminClient>,
  scoutId: string,
  requirementId: string,
  meritBadgeId: string,
  completedAt: string,
  profileId: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
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

  // Check if scout has badge progress for this merit badge
  let { data: badgeProgress } = await adminSupabase
    .from('scout_merit_badge_progress')
    .select('id')
    .eq('scout_id', scoutId)
    .eq('merit_badge_id', meritBadgeId)
    .maybeSingle()

  // Create badge progress if it doesn't exist
  if (!badgeProgress) {
    const { data: newProgress, error: progressError } = await adminSupabase
      .from('scout_merit_badge_progress')
      .insert({
        scout_id: scoutId,
        merit_badge_id: meritBadgeId,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        requirement_version_year: effectiveVersionYear,
      })
      .select('id')
      .single()

    if (progressError) {
      return { success: false, error: 'Failed to create badge progress' }
    }

    badgeProgress = newProgress

    // Create all requirement progress records for this badge's active version
    const { data: requirements } = await adminSupabase
      .from('bsa_merit_badge_requirements')
      .select('id')
      .eq('merit_badge_id', meritBadgeId)
      .eq('version_year', effectiveVersionYear)

    if (requirements && requirements.length > 0) {
      const reqProgressRecords = requirements.map((req) => ({
        scout_merit_badge_progress_id: badgeProgress!.id,
        requirement_id: req.id,
        status: 'not_started' as const,
      }))

      await adminSupabase.from('scout_merit_badge_requirement_progress').insert(reqProgressRecords)
    }
  }

  // Check if requirement progress exists
  let { data: reqProgress } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .select('id, status')
    .eq('scout_merit_badge_progress_id', badgeProgress.id)
    .eq('requirement_id', requirementId)
    .maybeSingle()

  // Create requirement progress if it doesn't exist
  if (!reqProgress) {
    const { data: newReqProgress, error: newReqError } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .insert({
        scout_merit_badge_progress_id: badgeProgress.id,
        requirement_id: requirementId,
        status: 'not_started',
      })
      .select('id, status')
      .single()

    if (newReqError) {
      return { success: false, error: 'Failed to create requirement progress' }
    }

    reqProgress = newReqProgress
  }

  // Skip if already completed
  if (['completed', 'approved'].includes(reqProgress.status)) {
    return { success: true }
  }

  // Mark requirement as complete
  const { error: updateError } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .update({
      status: 'completed',
      completed_at: completedAt,
      completed_by: profileId,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reqProgress.id)

  if (updateError) {
    return { success: false, error: 'Failed to mark requirement complete' }
  }

  return { success: true }
}

/**
 * Bulk sign off requirements for multiple scouts
 * Used by the unit-level advancement view (/advancement)
 * Creates progress records for each scout × requirement combination
 */
export async function bulkSignOffForScouts(params: {
  type: 'rank' | 'merit-badge'
  requirementIds: string[]
  scoutIds: string[]
  unitId: string
  itemId: string // rank_id or merit_badge_id
  date: string
  completedBy: string
}): Promise<ActionResult<{ successCount: number; failedCount: number; errors: string[] }>> {
  // Convert to the format expected by bulkRecordProgress
  const entries: Array<{
    scoutId: string
    requirementId: string
    type: 'rank' | 'merit_badge'
    parentId: string
  }> = []

  for (const scoutId of params.scoutIds) {
    for (const requirementId of params.requirementIds) {
      entries.push({
        scoutId,
        requirementId,
        type: params.type === 'rank' ? 'rank' : 'merit_badge',
        parentId: params.itemId,
      })
    }
  }

  return bulkRecordProgress({
    entries,
    unitId: params.unitId,
    completedAt: params.date,
    notes: `Signed off by ${params.completedBy}`,
  })
}

// ==========================================
// BULK MERIT BADGE AWARDING
// ==========================================

/**
 * Bulk award merit badges (mark as awarded by scoutmaster)
 * Used when badges are "completed" (all requirements done) and need final approval
 */
export async function bulkAwardMeritBadges(
  meritBadgeProgressIds: string[],
  unitId: string
): Promise<ActionResult<{ successCount: number; failedCount: number }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()
  const now = new Date().toISOString()

  let successCount = 0
  let failedCount = 0

  // Process each badge
  for (const progressId of meritBadgeProgressIds) {
    const { error } = await adminSupabase
      .from('scout_merit_badge_progress')
      .update({
        status: 'awarded',
        awarded_at: now,
        approved_by: auth.profileId,
        updated_at: now,
      })
      .eq('id', progressId)
      .eq('status', 'completed') // Only update badges that are in 'completed' status

    if (error) {
      console.error('Error awarding merit badge:', error)
      failedCount++
    } else {
      successCount++
    }
  }

  revalidatePath('/advancement')
  return { success: true, data: { successCount, failedCount } }
}

// ==========================================
// BULK ACTIVITY LOGGING
// ==========================================

/**
 * Bulk log activities for multiple scouts
 */
export async function bulkLogActivities(
  entries: Array<{
    scoutId: string
    value: number
  }>,
  unitId: string,
  activityType: 'camping' | 'hiking' | 'service' | 'conservation',
  activityDate: string,
  description?: string,
  location?: string,
  eventId?: string
): Promise<ActionResult<{ successCount: number; failedCount: number }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  const records = entries.map((entry) => ({
    scout_id: entry.scoutId,
    activity_type: activityType,
    activity_date: activityDate,
    value: entry.value,
    description,
    location,
    event_id: eventId,
    verified_by: auth.profileId,
    verified_at: new Date().toISOString(),
  }))

  const { data, error } = await adminSupabase
    .from('scout_activity_entries')
    .insert(records)
    .select('id')

  if (error) {
    console.error('Error bulk logging activities:', error)
    return { success: false, error: 'Failed to log activities' }
  }

  revalidatePath('/advancement')
  return {
    success: true,
    data: {
      successCount: data?.length || 0,
      failedCount: entries.length - (data?.length || 0),
    },
  }
}

// ==========================================
// BULK REQUIREMENT ASSIGNMENT
// ==========================================

/**
 * Assign a requirement completion to multiple scouts
 * Creates rank progress if not exists, then marks requirement complete
 */
export async function assignRequirementToScouts(params: {
  requirementId: string
  rankId: string
  unitId: string
  scoutIds: string[]
  completedAt: string
  notes?: string
}): Promise<ActionResult<{ successCount: number; failedCount: number; errors: string[] }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number; errors: string[] }>()
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

  let successCount = 0
  let failedCount = 0
  const errors: string[] = []

  for (const scoutId of params.scoutIds) {
    try {
      // Check if scout has rank progress for this rank
      let { data: rankProgress } = await adminSupabase
        .from('scout_rank_progress')
        .select('id')
        .eq('scout_id', scoutId)
        .eq('rank_id', params.rankId)
        .maybeSingle()

      // Create rank progress if it doesn't exist
      if (!rankProgress) {
        const { data: newProgress, error: progressError } = await adminSupabase
          .from('scout_rank_progress')
          .insert({
            scout_id: scoutId,
            rank_id: params.rankId,
            status: 'in_progress',
            started_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (progressError) {
          console.error('Error creating rank progress:', progressError)
          errors.push(`Failed to create rank progress for scout ${scoutId}`)
          failedCount++
          continue
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

      // Check if requirement progress exists
      let { data: reqProgress } = await adminSupabase
        .from('scout_rank_requirement_progress')
        .select('id, status, notes')
        .eq('scout_rank_progress_id', rankProgress.id)
        .eq('requirement_id', params.requirementId)
        .maybeSingle()

      // Create requirement progress if it doesn't exist
      if (!reqProgress) {
        const { data: newReqProgress, error: newReqError } = await adminSupabase
          .from('scout_rank_requirement_progress')
          .insert({
            scout_rank_progress_id: rankProgress.id,
            requirement_id: params.requirementId,
            status: 'not_started',
          })
          .select('id, status, notes')
          .single()

        if (newReqError) {
          console.error('Error creating requirement progress:', newReqError)
          errors.push(`Failed to create requirement progress for scout ${scoutId}`)
          failedCount++
          continue
        }

        reqProgress = newReqProgress
      }

      // Skip if already completed
      if (['completed', 'approved', 'awarded'].includes(reqProgress.status)) {
        // Already done, count as success
        successCount++
        continue
      }

      // Build notes by appending to existing
      const newNotes = params.notes
        ? appendNote(reqProgress.notes || null, {
            text: params.notes,
            author: auth.fullName,
            authorId: auth.profileId,
            type: 'completion',
          })
        : reqProgress.notes

      // Mark requirement as complete
      const { error: updateError } = await adminSupabase
        .from('scout_rank_requirement_progress')
        .update({
          status: 'completed',
          completed_at: params.completedAt,
          completed_by: auth.profileId,
          notes: newNotes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reqProgress.id)

      if (updateError) {
        console.error('Error marking requirement complete:', updateError)
        errors.push(`Failed to mark requirement complete for scout ${scoutId}`)
        failedCount++
        continue
      }

      successCount++
    } catch (err) {
      console.error('Unexpected error:', err)
      errors.push(`Unexpected error for scout ${scoutId}`)
      failedCount++
    }
  }

  revalidatePath('/advancement')
  revalidatePath('/advancement/ranks')

  return {
    success: failedCount === 0,
    data: { successCount, failedCount, errors },
    error: failedCount > 0 ? `Failed to assign to ${failedCount} scout(s)` : undefined,
  }
}

/**
 * Assign a merit badge requirement completion to multiple scouts
 */
export async function assignMeritBadgeRequirementToScouts(params: {
  requirementId: string
  meritBadgeId: string
  unitId: string
  assignments: Array<{
    scoutId: string
    badgeProgressId: string | null // null if scout is not yet tracking this badge
    requirementProgressId: string | null
  }>
  completedAt: string
  notes?: string
}): Promise<ActionResult<{ successCount: number; failedCount: number; errors: string[] }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number; errors: string[] }>()
  if (featureCheck) return featureCheck

  const auth = await verifyLeaderRole(params.unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Get the merit badge to find its requirement_version_year
  const { data: badge } = await adminSupabase
    .from('bsa_merit_badges')
    .select('id, requirement_version_year')
    .eq('id', params.meritBadgeId)
    .single()

  if (!badge) {
    return { success: false, error: 'Merit badge not found' }
  }

  let successCount = 0
  let failedCount = 0
  const errors: string[] = []

  for (const assignment of params.assignments) {
    try {
      let badgeProgressId = assignment.badgeProgressId
      let requirementProgressId = assignment.requirementProgressId

      // If scout is not tracking this badge yet, create badge progress first
      if (!badgeProgressId) {
        // Create merit badge progress record
        const { data: newBadgeProgress, error: badgeError } = await adminSupabase
          .from('scout_merit_badge_progress')
          .insert({
            scout_id: assignment.scoutId,
            merit_badge_id: params.meritBadgeId,
            status: 'in_progress',
            started_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (badgeError) {
          console.error('Error creating badge progress:', badgeError)
          errors.push(`Failed to start badge tracking for scout ${assignment.scoutId}`)
          failedCount++
          continue
        }

        badgeProgressId = newBadgeProgress.id
      }

      // Create requirement progress if it doesn't exist
      if (!requirementProgressId) {
        const { data: newReqProgress, error: createError } = await adminSupabase
          .from('scout_merit_badge_requirement_progress')
          .insert({
            scout_merit_badge_progress_id: badgeProgressId,
            requirement_id: params.requirementId,
            status: 'not_started',
          })
          .select('id')
          .single()

        if (createError) {
          console.error('Error creating MB requirement progress:', createError)
          errors.push(`Failed to create requirement progress for scout ${assignment.scoutId}`)
          failedCount++
          continue
        }

        requirementProgressId = newReqProgress.id
      }

      // Check current status and get existing notes
      const { data: currentProgress } = await adminSupabase
        .from('scout_merit_badge_requirement_progress')
        .select('status, notes')
        .eq('id', requirementProgressId)
        .single()

      // Skip if already completed
      if (currentProgress && ['completed', 'approved'].includes(currentProgress.status)) {
        successCount++
        continue
      }

      // Build notes by appending to existing
      const newNotes = params.notes
        ? appendNote(currentProgress?.notes || null, {
            text: params.notes,
            author: auth.fullName,
            authorId: auth.profileId,
            type: 'completion',
          })
        : currentProgress?.notes

      // Mark requirement as complete
      const { error: updateError } = await adminSupabase
        .from('scout_merit_badge_requirement_progress')
        .update({
          status: 'completed',
          completed_at: params.completedAt,
          completed_by: auth.profileId,
          notes: newNotes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', requirementProgressId)

      if (updateError) {
        console.error('Error marking MB requirement complete:', updateError)
        errors.push(`Failed to mark requirement complete for scout ${assignment.scoutId}`)
        failedCount++
        continue
      }

      successCount++
    } catch (err) {
      console.error('Unexpected error:', err)
      errors.push(`Unexpected error for scout ${assignment.scoutId}`)
      failedCount++
    }
  }

  revalidatePath('/advancement')
  revalidatePath('/advancement/merit-badges')

  return {
    success: failedCount === 0,
    data: { successCount, failedCount, errors },
    error: failedCount > 0 ? `Failed to assign to ${failedCount} scout(s)` : undefined,
  }
}

// ==========================================
// BULK PARENT SUBMISSION APPROVAL
// ==========================================

/**
 * Bulk approve parent submissions (pending_approval items) across multiple scouts
 * Used by the unit-level Pending Approvals modal
 */
export async function bulkApproveParentSubmissions(
  requirementProgressIds: string[],
  unitId: string
): Promise<ActionResult<{ successCount: number; failedCount: number }>> {
  const featureCheck = await checkFeatureEnabled<{ successCount: number; failedCount: number }>()
  if (featureCheck) return featureCheck

  if (requirementProgressIds.length === 0) {
    return { success: true, data: { successCount: 0, failedCount: 0 } }
  }

  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()
  const timestamp = new Date().toISOString()

  // Update all selected pending submissions
  const { data, error } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .update({
      status: 'completed',
      completed_at: timestamp,
      completed_by: auth.profileId,
      approval_status: 'approved',
      reviewed_by: auth.profileId,
      reviewed_at: timestamp,
      updated_at: timestamp,
    })
    .in('id', requirementProgressIds)
    .eq('approval_status', 'pending_approval')
    .select('id')

  if (error) {
    console.error('Error bulk approving parent submissions:', error)
    return { success: false, error: 'Failed to approve submissions' }
  }

  const successCount = data?.length || 0
  const failedCount = requirementProgressIds.length - successCount

  revalidatePath('/advancement')
  return { success: true, data: { successCount, failedCount } }
}
