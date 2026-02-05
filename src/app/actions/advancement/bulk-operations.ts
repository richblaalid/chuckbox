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
// BULK ENTRY ACTIONS (Optimized for batch operations)
// ==========================================

/**
 * Bulk record requirement progress from the bulk entry interface
 * Handles both rank and merit badge requirements
 *
 * OPTIMIZED: Uses batch queries instead of per-entry loops
 * Previous: O(n) queries where n = entries
 * Now: O(1) queries regardless of entry count
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

  // Separate entries by type
  const rankEntries = params.entries.filter(e => e.type === 'rank')
  const mbEntries = params.entries.filter(e => e.type === 'merit_badge')

  let successCount = 0
  let failedCount = 0
  const errors: string[] = []

  // Process rank entries using batched operations
  if (rankEntries.length > 0) {
    const result = await batchProcessRankRequirements(
      adminSupabase,
      rankEntries,
      params.completedAt,
      auth.profileId,
      params.notes
    )
    successCount += result.successCount
    failedCount += result.failedCount
    errors.push(...result.errors)
  }

  // Process merit badge entries using batched operations
  if (mbEntries.length > 0) {
    const result = await batchProcessMeritBadgeRequirements(
      adminSupabase,
      mbEntries,
      params.completedAt,
      auth.profileId,
      params.notes
    )
    successCount += result.successCount
    failedCount += result.failedCount
    errors.push(...result.errors)
  }

  revalidatePath('/advancement')
  revalidatePath('/advancement/bulk-entry')

  return {
    success: failedCount === 0,
    data: { successCount, failedCount, errors },
    error: failedCount > 0 ? `Failed to record ${failedCount} entry/entries` : undefined,
  }
}

/**
 * Batch process rank requirements using O(1) queries
 * Instead of querying per-entry, we batch all operations
 */
async function batchProcessRankRequirements(
  adminSupabase: ReturnType<typeof createAdminClient>,
  entries: Array<{ scoutId: string; requirementId: string; parentId: string }>,
  completedAt: string,
  profileId: string,
  notes?: string
): Promise<{ successCount: number; failedCount: number; errors: string[] }> {
  const errors: string[] = []

  // Extract unique IDs for batch queries
  const uniqueRankIds = [...new Set(entries.map(e => e.parentId))]
  const uniqueScoutIds = [...new Set(entries.map(e => e.scoutId))]

  // 1. Batch fetch all rank info (for version years)
  const { data: ranks } = await adminSupabase
    .from('bsa_ranks')
    .select('id, requirement_version_year')
    .in('id', uniqueRankIds)

  if (!ranks || ranks.length === 0) {
    return { successCount: 0, failedCount: entries.length, errors: ['Ranks not found'] }
  }

  const rankMap = new Map(ranks.map(r => [r.id, r]))

  // Validate all ranks have version years
  for (const rankId of uniqueRankIds) {
    const rank = rankMap.get(rankId)
    if (!rank?.requirement_version_year) {
      return {
        successCount: 0,
        failedCount: entries.length,
        errors: [`Rank ${rankId} does not have a version year set`],
      }
    }
  }

  // 2. Batch fetch all existing rank progress records
  const { data: existingRankProgress } = await adminSupabase
    .from('scout_rank_progress')
    .select('id, scout_id, rank_id')
    .in('scout_id', uniqueScoutIds)
    .in('rank_id', uniqueRankIds)

  // Map: "scoutId:rankId" -> progressId
  const rankProgressMap = new Map(
    (existingRankProgress || []).map(p => [`${p.scout_id}:${p.rank_id}`, p.id])
  )

  // 3. Find which scout×rank combinations need new progress records
  const scoutRankPairs = [...new Set(entries.map(e => `${e.scoutId}:${e.parentId}`))]
  const missingRankProgress = scoutRankPairs.filter(key => !rankProgressMap.has(key))

  // 4. Batch insert missing rank progress records
  if (missingRankProgress.length > 0) {
    const newRankProgressRecords = missingRankProgress.map(key => {
      const [scoutId, rankId] = key.split(':')
      return {
        scout_id: scoutId,
        rank_id: rankId,
        status: 'in_progress' as const,
        started_at: new Date().toISOString(),
      }
    })

    const { data: insertedProgress, error: insertError } = await adminSupabase
      .from('scout_rank_progress')
      .insert(newRankProgressRecords)
      .select('id, scout_id, rank_id')

    if (insertError) {
      console.error('Error batch inserting rank progress:', insertError)
      return {
        successCount: 0,
        failedCount: entries.length,
        errors: ['Failed to create rank progress records'],
      }
    }

    // Add new progress to map
    for (const p of insertedProgress || []) {
      rankProgressMap.set(`${p.scout_id}:${p.rank_id}`, p.id)
    }

    // 5. For each newly created rank progress, batch insert all requirement progress records
    if (insertedProgress && insertedProgress.length > 0) {
      // Get all requirements for all ranks (one query)
      const { data: allRequirements } = await adminSupabase
        .from('bsa_rank_requirements')
        .select('id, rank_id, version_year')
        .in('rank_id', uniqueRankIds)

      // Filter to only requirements matching each rank's version year
      const reqProgressRecords: Array<{
        scout_rank_progress_id: string
        requirement_id: string
        status: 'not_started'
      }> = []

      for (const progress of insertedProgress) {
        const rank = rankMap.get(progress.rank_id)
        if (!rank) continue

        const rankReqs = (allRequirements || []).filter(
          r => r.rank_id === progress.rank_id && r.version_year === rank.requirement_version_year
        )

        for (const req of rankReqs) {
          reqProgressRecords.push({
            scout_rank_progress_id: progress.id,
            requirement_id: req.id,
            status: 'not_started',
          })
        }
      }

      if (reqProgressRecords.length > 0) {
        await adminSupabase.from('scout_rank_requirement_progress').insert(reqProgressRecords)
      }
    }
  }

  // 6. Now get all requirement progress IDs we need to update
  // Build list of (rank_progress_id, requirement_id) pairs
  const progressReqPairs = entries.map(e => ({
    rankProgressId: rankProgressMap.get(`${e.scoutId}:${e.parentId}`)!,
    requirementId: e.requirementId,
    scoutId: e.scoutId,
  }))

  // Get all rank progress IDs
  const allRankProgressIds = [...new Set(progressReqPairs.map(p => p.rankProgressId))]

  // 7. Batch fetch existing requirement progress
  const { data: existingReqProgress } = await adminSupabase
    .from('scout_rank_requirement_progress')
    .select('id, scout_rank_progress_id, requirement_id, status')
    .in('scout_rank_progress_id', allRankProgressIds)

  // Map: "progressId:reqId" -> { id, status }
  const reqProgressMap = new Map(
    (existingReqProgress || []).map(p => [
      `${p.scout_rank_progress_id}:${p.requirement_id}`,
      { id: p.id, status: p.status },
    ])
  )

  // 8. Find which requirements need progress records created
  const missingReqProgress = progressReqPairs.filter(
    p => !reqProgressMap.has(`${p.rankProgressId}:${p.requirementId}`)
  )

  // 9. Batch insert missing requirement progress
  if (missingReqProgress.length > 0) {
    const newReqProgressRecords = missingReqProgress.map(p => ({
      scout_rank_progress_id: p.rankProgressId,
      requirement_id: p.requirementId,
      status: 'not_started' as const,
    }))

    const { data: insertedReqProgress } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .insert(newReqProgressRecords)
      .select('id, scout_rank_progress_id, requirement_id, status')

    // Add to map
    for (const p of insertedReqProgress || []) {
      reqProgressMap.set(`${p.scout_rank_progress_id}:${p.requirement_id}`, {
        id: p.id,
        status: p.status,
      })
    }
  }

  // 10. Batch update: mark all requirements complete (skip already completed ones)
  const idsToUpdate: string[] = []
  let skippedCount = 0

  for (const pair of progressReqPairs) {
    const reqProgress = reqProgressMap.get(`${pair.rankProgressId}:${pair.requirementId}`)
    if (!reqProgress) {
      errors.push(`Requirement progress not found for scout ${pair.scoutId}`)
      continue
    }

    // Skip already completed
    if (['completed', 'approved', 'awarded'].includes(reqProgress.status)) {
      skippedCount++
      continue
    }

    idsToUpdate.push(reqProgress.id)
  }

  // Batch update all at once
  let updatedCount = 0
  if (idsToUpdate.length > 0) {
    const { data: updated, error: updateError } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .update({
        status: 'completed',
        completed_at: completedAt,
        completed_by: profileId,
        notes,
        updated_at: new Date().toISOString(),
      })
      .in('id', idsToUpdate)
      .select('id')

    if (updateError) {
      console.error('Error batch updating requirements:', updateError)
      return {
        successCount: skippedCount,
        failedCount: idsToUpdate.length + errors.length,
        errors: [...errors, 'Failed to mark requirements complete'],
      }
    }

    updatedCount = updated?.length || 0
  }

  return {
    successCount: updatedCount + skippedCount,
    failedCount: errors.length,
    errors,
  }
}

/**
 * Batch process merit badge requirements using O(1) queries
 * Parallel implementation to batchProcessRankRequirements
 */
async function batchProcessMeritBadgeRequirements(
  adminSupabase: ReturnType<typeof createAdminClient>,
  entries: Array<{ scoutId: string; requirementId: string; parentId: string }>,
  completedAt: string,
  profileId: string,
  notes?: string
): Promise<{ successCount: number; failedCount: number; errors: string[] }> {
  const errors: string[] = []

  // Extract unique IDs
  const uniqueBadgeIds = [...new Set(entries.map(e => e.parentId))]
  const uniqueScoutIds = [...new Set(entries.map(e => e.scoutId))]

  // 1. Batch fetch badge version info
  const { data: versions } = await adminSupabase
    .from('bsa_merit_badge_versions')
    .select('merit_badge_id, version_year')
    .in('merit_badge_id', uniqueBadgeIds)
    .eq('is_current', true)

  // Also get fallback from badges table
  const { data: badges } = await adminSupabase
    .from('bsa_merit_badges')
    .select('id, requirement_version_year')
    .in('id', uniqueBadgeIds)

  // Build version map (prefer versions table, fall back to badges)
  const versionMap = new Map<string, number>()
  for (const badge of badges || []) {
    if (badge.requirement_version_year) {
      versionMap.set(badge.id, badge.requirement_version_year)
    }
  }
  for (const v of versions || []) {
    versionMap.set(v.merit_badge_id, v.version_year)
  }

  // Validate all badges have versions
  for (const badgeId of uniqueBadgeIds) {
    if (!versionMap.has(badgeId)) {
      return {
        successCount: 0,
        failedCount: entries.length,
        errors: [`Merit badge ${badgeId} does not have a version year set`],
      }
    }
  }

  // 2. Batch fetch existing badge progress
  const { data: existingBadgeProgress } = await adminSupabase
    .from('scout_merit_badge_progress')
    .select('id, scout_id, merit_badge_id')
    .in('scout_id', uniqueScoutIds)
    .in('merit_badge_id', uniqueBadgeIds)

  const badgeProgressMap = new Map(
    (existingBadgeProgress || []).map(p => [`${p.scout_id}:${p.merit_badge_id}`, p.id])
  )

  // 3. Find missing badge progress
  const scoutBadgePairs = [...new Set(entries.map(e => `${e.scoutId}:${e.parentId}`))]
  const missingBadgeProgress = scoutBadgePairs.filter(key => !badgeProgressMap.has(key))

  // 4. Batch insert missing badge progress
  if (missingBadgeProgress.length > 0) {
    const newBadgeProgressRecords = missingBadgeProgress.map(key => {
      const [scoutId, badgeId] = key.split(':')
      return {
        scout_id: scoutId,
        merit_badge_id: badgeId,
        status: 'in_progress' as const,
        started_at: new Date().toISOString(),
        requirement_version_year: versionMap.get(badgeId)!,
      }
    })

    const { data: insertedProgress, error: insertError } = await adminSupabase
      .from('scout_merit_badge_progress')
      .insert(newBadgeProgressRecords)
      .select('id, scout_id, merit_badge_id')

    if (insertError) {
      console.error('Error batch inserting badge progress:', insertError)
      return {
        successCount: 0,
        failedCount: entries.length,
        errors: ['Failed to create badge progress records'],
      }
    }

    for (const p of insertedProgress || []) {
      badgeProgressMap.set(`${p.scout_id}:${p.merit_badge_id}`, p.id)
    }

    // 5. Create requirement progress for new badges
    if (insertedProgress && insertedProgress.length > 0) {
      const { data: allRequirements } = await adminSupabase
        .from('bsa_merit_badge_requirements')
        .select('id, merit_badge_id, version_year')
        .in('merit_badge_id', uniqueBadgeIds)

      const reqProgressRecords: Array<{
        scout_merit_badge_progress_id: string
        requirement_id: string
        status: 'not_started'
      }> = []

      for (const progress of insertedProgress) {
        const versionYear = versionMap.get(progress.merit_badge_id)
        const badgeReqs = (allRequirements || []).filter(
          r => r.merit_badge_id === progress.merit_badge_id && r.version_year === versionYear
        )

        for (const req of badgeReqs) {
          reqProgressRecords.push({
            scout_merit_badge_progress_id: progress.id,
            requirement_id: req.id,
            status: 'not_started',
          })
        }
      }

      if (reqProgressRecords.length > 0) {
        await adminSupabase.from('scout_merit_badge_requirement_progress').insert(reqProgressRecords)
      }
    }
  }

  // 6. Build list of requirement progress to update
  const progressReqPairs = entries.map(e => ({
    badgeProgressId: badgeProgressMap.get(`${e.scoutId}:${e.parentId}`)!,
    requirementId: e.requirementId,
    scoutId: e.scoutId,
  }))

  const allBadgeProgressIds = [...new Set(progressReqPairs.map(p => p.badgeProgressId))]

  // 7. Batch fetch existing requirement progress
  const { data: existingReqProgress } = await adminSupabase
    .from('scout_merit_badge_requirement_progress')
    .select('id, scout_merit_badge_progress_id, requirement_id, status')
    .in('scout_merit_badge_progress_id', allBadgeProgressIds)

  const reqProgressMap = new Map(
    (existingReqProgress || []).map(p => [
      `${p.scout_merit_badge_progress_id}:${p.requirement_id}`,
      { id: p.id, status: p.status },
    ])
  )

  // 8. Find missing requirement progress
  const missingReqProgress = progressReqPairs.filter(
    p => !reqProgressMap.has(`${p.badgeProgressId}:${p.requirementId}`)
  )

  // 9. Batch insert missing requirement progress
  if (missingReqProgress.length > 0) {
    const newReqProgressRecords = missingReqProgress.map(p => ({
      scout_merit_badge_progress_id: p.badgeProgressId,
      requirement_id: p.requirementId,
      status: 'not_started' as const,
    }))

    const { data: insertedReqProgress } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .insert(newReqProgressRecords)
      .select('id, scout_merit_badge_progress_id, requirement_id, status')

    for (const p of insertedReqProgress || []) {
      reqProgressMap.set(`${p.scout_merit_badge_progress_id}:${p.requirement_id}`, {
        id: p.id,
        status: p.status,
      })
    }
  }

  // 10. Batch update requirements
  const idsToUpdate: string[] = []
  let skippedCount = 0

  for (const pair of progressReqPairs) {
    const reqProgress = reqProgressMap.get(`${pair.badgeProgressId}:${pair.requirementId}`)
    if (!reqProgress) {
      errors.push(`Requirement progress not found for scout ${pair.scoutId}`)
      continue
    }

    if (['completed', 'approved'].includes(reqProgress.status)) {
      skippedCount++
      continue
    }

    idsToUpdate.push(reqProgress.id)
  }

  let updatedCount = 0
  if (idsToUpdate.length > 0) {
    const { data: updated, error: updateError } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .update({
        status: 'completed',
        completed_at: completedAt,
        completed_by: profileId,
        notes,
        updated_at: new Date().toISOString(),
      })
      .in('id', idsToUpdate)
      .select('id')

    if (updateError) {
      console.error('Error batch updating MB requirements:', updateError)
      return {
        successCount: skippedCount,
        failedCount: idsToUpdate.length + errors.length,
        errors: [...errors, 'Failed to mark requirements complete'],
      }
    }

    updatedCount = updated?.length || 0
  }

  return {
    successCount: updatedCount + skippedCount,
    failedCount: errors.length,
    errors,
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
