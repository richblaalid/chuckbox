'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { StagedTroopAdvancement, TroopAdvancementImportResult } from '@/lib/import/troop-advancement-types'
import type { Json } from '@/types/database'

interface ActionResult<T = void> {
  success: boolean
  error?: string
  data?: T
}

export interface ImportJob {
  id: string
  unit_id: string
  created_by: string
  type: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  total_scouts: number
  processed_scouts: number
  total_items: number
  processed_items: number
  current_phase: string | null
  result: TroopAdvancementImportResult | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

// ============================================
// Auth Helper
// ============================================

async function verifyLeaderRole(unitId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('unit_id', unitId)
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership || !['admin', 'treasurer', 'leader'].includes(membership.role)) {
    return { error: 'Only leaders can manage import jobs' }
  }

  return { profileId: profile.id }
}

// ============================================
// Create Import Job
// ============================================

/**
 * Create a new import job and return its ID
 * The job will be processed in the background
 */
export async function createImportJob(
  unitId: string,
  type: 'troop_advancement' | 'scout_history',
  stagedData: StagedTroopAdvancement,
  selectedBsaMemberIds: string[]
): Promise<ActionResult<{ jobId: string }>> {
  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Calculate totals for progress tracking
  const selectedScouts = stagedData.scouts.filter(s =>
    selectedBsaMemberIds.includes(s.bsaMemberId)
  )

  const totalItems = selectedScouts.reduce((sum, scout) => {
    return sum +
      scout.ranks.length +
      scout.rankRequirements.length +
      scout.meritBadges.length +
      scout.meritBadgeRequirements.length
  }, 0)

  const { data: job, error } = await adminSupabase
    .from('import_jobs')
    .insert({
      unit_id: unitId,
      created_by: auth.profileId,
      type,
      status: 'pending',
      total_scouts: selectedScouts.length,
      processed_scouts: 0,
      total_items: totalItems,
      processed_items: 0,
      staged_data: stagedData as unknown as Json,
      selected_scout_ids: selectedBsaMemberIds as unknown as Json,
    })
    .select('id')
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, data: { jobId: job.id } }
}

// ============================================
// Get Import Job Status
// ============================================

/**
 * Get the current status of an import job
 * Used for polling progress
 */
export async function getImportJobStatus(
  jobId: string
): Promise<ActionResult<ImportJob>> {
  const supabase = await createClient()

  const { data: job, error } = await supabase
    .from('import_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  if (!job) {
    return { success: false, error: 'Job not found' }
  }

  return {
    success: true,
    data: {
      ...job,
      result: job.result as TroopAdvancementImportResult | null,
    } as ImportJob
  }
}

// ============================================
// Process Import Job
// ============================================

/**
 * Process an import job in the background
 * This is called after createImportJob returns
 */
export async function processImportJob(
  jobId: string
): Promise<ActionResult<TroopAdvancementImportResult>> {
  const adminSupabase = createAdminClient()

  // Get the job
  const { data: job, error: jobError } = await adminSupabase
    .from('import_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (jobError || !job) {
    return { success: false, error: jobError?.message || 'Job not found' }
  }

  if (job.status !== 'pending') {
    return { success: false, error: `Job is already ${job.status}` }
  }

  // Mark as processing
  await adminSupabase
    .from('import_jobs')
    .update({
      status: 'processing',
      started_at: new Date().toISOString()
    })
    .eq('id', jobId)

  try {
    // Import the actual processing function
    const { processImportJobInternal } = await import('./troop-advancement-import')

    const result = await processImportJobInternal(
      job.unit_id,
      job.staged_data as unknown as StagedTroopAdvancement,
      job.selected_scout_ids as string[],
      job.created_by,
      // Progress callback - update phase and items
      async (processed: number, phase: string) => {
        // Calculate phase-based progress when processed is 0
        // This gives visual feedback during setup phases
        const totalItems = job.total_items || 1
        const phaseProgress: Record<string, number> = {
          'loading_reference_data': Math.floor(totalItems * 0.05),
          'scouts': Math.floor(totalItems * 0.10),
          'ranks': Math.floor(totalItems * 0.15),
          'badges': Math.floor(totalItems * 0.25),
          'rank_requirements': Math.floor(totalItems * 0.40),
          'badge_requirements': Math.floor(totalItems * 0.50),
        }

        // Use actual processed count if available, otherwise use phase estimate
        const effectiveProcessed = processed > 0
          ? processed
          : (phaseProgress[phase] || 0)

        await adminSupabase
          .from('import_jobs')
          .update({
            processed_items: effectiveProcessed,
            current_phase: phase,
          })
          .eq('id', jobId)
      }
    )

    // Mark as completed
    await adminSupabase
      .from('import_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: result as unknown as Json,
        processed_items: job.total_items,
        processed_scouts: job.total_scouts,
      })
      .eq('id', jobId)

    return { success: true, data: result }

  } catch (err) {
    // Mark as failed
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await adminSupabase
      .from('import_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq('id', jobId)

    return { success: false, error: errorMessage }
  }
}
