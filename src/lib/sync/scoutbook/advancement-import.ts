/**
 * Advancement Import Functions
 *
 * Stages and imports advancement data (rank requirements, merit badges)
 * from Scoutbook sync sessions using the sync_staged_advancement table.
 *
 * Key principles:
 * - Additive only: never un-complete requirements
 * - Preserve earlier dates: if Chuckbox has an earlier completion date, keep it
 * - Track source: know whether completion came from Scoutbook or Chuckbox
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import {
  mapRankRequirements,
  mapMeritBadgeRequirements,
  normalizeRankCode,
  normalizeBadgeCode,
} from './requirement-mapper';
import {
  MeritBadgeDetail,
  MeritBadgeRequirement,
} from './parsers/advancement';
import { RankRequirementDetail, Requirement } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Staged advancement record
 */
export interface StagedAdvancement {
  id: string;
  sessionId: string;
  scoutId: string;
  dataType: 'rank_progress' | 'rank_requirement' | 'merit_badge' | 'leadership' | 'activity';
  changeType: 'new' | 'update';
  existingRecordId: string | null;
  stagedData: Record<string, unknown>;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  conflictDetected: boolean;
  conflictDetails: string | null;
  isSelected: boolean;
}

/**
 * Result of staging advancement data
 */
export interface AdvancementStagingResult {
  success: boolean;
  sessionId: string;
  rankRequirementsStaged: number;
  meritBadgeRequirementsStaged: number;
  newCompletions: number;
  conflicts: number;
  errors: string[];
}

/**
 * Result of confirming advancement import
 */
export interface AdvancementImportResult {
  success: boolean;
  rankRequirementsImported: number;
  meritBadgeRequirementsImported: number;
  skipped: number;
  errors: string[];
}

// ============================================================================
// Staging Functions
// ============================================================================

/**
 * Stage rank requirement completions from Scoutbook data
 *
 * @param supabase - Supabase client
 * @param sessionId - Sync session ID
 * @param scoutId - Scout database ID
 * @param rankDetail - Parsed rank detail with requirements
 * @param versionYear - Requirement version year
 */
export async function stageRankRequirements(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  scoutId: string,
  rankDetail: RankRequirementDetail,
  versionYear: number = 2024
): Promise<{ staged: number; conflicts: number; errors: string[] }> {
  const errors: string[] = [];
  let staged = 0;
  let conflicts = 0;

  // Get the rank
  const rankCode = normalizeRankCode(rankDetail.rankName);
  const { data: rank } = await supabase
    .from('bsa_ranks')
    .select('id')
    .eq('code', rankCode)
    .single();

  if (!rank) {
    errors.push(`Rank not found: ${rankDetail.rankName}`);
    return { staged: 0, conflicts: 0, errors };
  }

  // Get or create scout rank progress
  let { data: rankProgress } = await supabase
    .from('scout_rank_progress')
    .select('id')
    .eq('scout_id', scoutId)
    .eq('rank_id', rank.id)
    .single();

  if (!rankProgress) {
    // Create rank progress record
    const { data: newProgress, error: createError } = await supabase
      .from('scout_rank_progress')
      .insert({
        scout_id: scoutId,
        rank_id: rank.id,
        version_year: versionYear,
        status: 'in_progress',
      })
      .select('id')
      .single();

    if (createError) {
      errors.push(`Failed to create rank progress: ${createError.message}`);
      return { staged: 0, conflicts: 0, errors };
    }
    rankProgress = newProgress;
  }

  // Map Scoutbook requirement IDs to Chuckbox IDs
  const scoutbookIds = rankDetail.requirements.map((r) => r.id);
  const mapping = await mapRankRequirements(supabase, rankCode, versionYear, scoutbookIds);

  // Get existing requirement completions
  const { data: existingCompletions } = await supabase
    .from('scout_rank_requirement_progress')
    .select('id, requirement_id, status, completed_at')
    .eq('scout_rank_progress_id', rankProgress.id);

  const completionMap = new Map<string, NonNullable<typeof existingCompletions>[0]>();
  for (const completion of existingCompletions || []) {
    completionMap.set(completion.requirement_id, completion);
  }

  // Stage each requirement completion
  for (const req of rankDetail.requirements) {
    // Skip if not approved
    if (req.status !== 'APPROVED') continue;

    // Find the Chuckbox requirement ID
    const mappedReq = mapping.mappings.find((m) => m.scoutbookId === req.id);
    if (!mappedReq?.chuckboxId) {
      errors.push(`Could not map requirement ${req.id} for ${rankDetail.rankName}`);
      continue;
    }

    const existing = completionMap.get(mappedReq.chuckboxId);
    const scoutbookDate = parseDate(req.completedDate);

    // Determine if this is a conflict
    let conflictDetected = false;
    let conflictDetails: string | null = null;
    let changeType: 'new' | 'update' = 'new';

    if (existing) {
      changeType = 'update';

      // Conflict: requirement already completed in Chuckbox
      if (existing.status === 'completed' || existing.status === 'approved') {
        conflictDetected = true;
        const existingDate = existing.completed_at;

        // If Scoutbook date is later, that's a non-issue (we keep earlier date)
        if (scoutbookDate && existingDate && new Date(scoutbookDate) > new Date(existingDate)) {
          conflictDetails = `Already completed on ${existingDate}. Scoutbook shows ${scoutbookDate}. Will keep earlier date.`;
        } else if (scoutbookDate && existingDate && new Date(scoutbookDate) < new Date(existingDate)) {
          conflictDetails = `Completed ${existingDate} in Chuckbox, but Scoutbook shows earlier date ${scoutbookDate}. Will update to earlier date.`;
          conflictDetected = false; // Not really a conflict - we want the earlier date
        } else {
          conflictDetails = `Already completed on ${existingDate}`;
        }
        conflicts++;
      }
    }

    // Insert staged record
    const { error: stageError } = await supabase.from('sync_staged_advancement').insert({
      session_id: sessionId,
      scout_id: scoutId,
      data_type: 'rank_requirement',
      change_type: changeType,
      existing_record_id: existing?.id || null,
      staged_data: {
        requirement_id: mappedReq.chuckboxId,
        scout_rank_progress_id: rankProgress.id,
        status: 'completed',
        completed_at: scoutbookDate,
        scoutbook_requirement_id: req.id,
        description: req.description,
      },
      changes: existing
        ? {
            status: { old: existing.status, new: 'completed' },
            completed_at: { old: existing.completed_at, new: scoutbookDate },
          }
        : null,
      conflict_detected: conflictDetected,
      conflict_details: conflictDetails,
      is_selected: !conflictDetected, // Auto-select non-conflicts
    } as Database['public']['Tables']['sync_staged_advancement']['Insert']);

    if (stageError) {
      errors.push(`Failed to stage requirement ${req.id}: ${stageError.message}`);
    } else {
      staged++;
    }
  }

  return { staged, conflicts, errors };
}

/**
 * Stage merit badge requirement completions from Scoutbook data
 */
export async function stageMeritBadgeRequirements(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  scoutId: string,
  badgeDetail: MeritBadgeDetail,
  versionYear: number = 2024
): Promise<{ staged: number; conflicts: number; errors: string[] }> {
  const errors: string[] = [];
  let staged = 0;
  let conflicts = 0;

  // Get the merit badge
  const badgeCode = normalizeBadgeCode(badgeDetail.badgeName);
  const { data: badge } = await supabase
    .from('bsa_merit_badges')
    .select('id')
    .eq('code', badgeCode)
    .single();

  if (!badge) {
    errors.push(`Merit badge not found: ${badgeDetail.badgeName}`);
    return { staged: 0, conflicts: 0, errors };
  }

  // Get or create scout merit badge progress
  let { data: badgeProgress } = await supabase
    .from('scout_merit_badge_progress')
    .select('id')
    .eq('scout_id', scoutId)
    .eq('merit_badge_id', badge.id)
    .single();

  if (!badgeProgress) {
    // Create merit badge progress record
    const { data: newProgress, error: createError } = await supabase
      .from('scout_merit_badge_progress')
      .insert({
        scout_id: scoutId,
        merit_badge_id: badge.id,
        version_year: versionYear,
        status: 'in_progress',
        started_at: badgeDetail.startDate ? new Date(badgeDetail.startDate).toISOString() : new Date().toISOString(),
      })
      .select('id')
      .single();

    if (createError) {
      errors.push(`Failed to create badge progress: ${createError.message}`);
      return { staged: 0, conflicts: 0, errors };
    }
    badgeProgress = newProgress;
  }

  // Map Scoutbook requirement IDs to Chuckbox IDs
  const scoutbookIds = badgeDetail.requirements.map((r) => r.id);
  const mapping = await mapMeritBadgeRequirements(supabase, badgeCode, versionYear, scoutbookIds);

  // Get existing requirement completions
  const { data: existingCompletions } = await supabase
    .from('scout_merit_badge_requirement_progress')
    .select('id, requirement_id, status, completed_at')
    .eq('scout_merit_badge_progress_id', badgeProgress.id);

  const completionMap = new Map<string, NonNullable<typeof existingCompletions>[0]>();
  for (const completion of existingCompletions || []) {
    completionMap.set(completion.requirement_id, completion);
  }

  // Stage each requirement completion
  for (const req of badgeDetail.requirements) {
    // Skip if not approved
    if (req.status !== 'APPROVED') continue;

    // Find the Chuckbox requirement ID
    const mappedReq = mapping.mappings.find((m) => m.scoutbookId === req.id);
    if (!mappedReq?.chuckboxId) {
      errors.push(`Could not map requirement ${req.id} for ${badgeDetail.badgeName}`);
      continue;
    }

    const existing = completionMap.get(mappedReq.chuckboxId);
    const scoutbookDate = parseDate(req.completedDate);

    // Determine if this is a conflict
    let conflictDetected = false;
    let conflictDetails: string | null = null;
    let changeType: 'new' | 'update' = 'new';

    if (existing) {
      changeType = 'update';

      // Conflict: requirement already completed in Chuckbox
      if (existing.status === 'completed' || existing.status === 'approved') {
        conflictDetected = true;
        const existingDate = existing.completed_at;

        if (scoutbookDate && existingDate && new Date(scoutbookDate) > new Date(existingDate)) {
          conflictDetails = `Already completed on ${existingDate}. Scoutbook shows ${scoutbookDate}. Will keep earlier date.`;
        } else if (scoutbookDate && existingDate && new Date(scoutbookDate) < new Date(existingDate)) {
          conflictDetails = `Completed ${existingDate} in Chuckbox, but Scoutbook shows earlier date ${scoutbookDate}. Will update to earlier date.`;
          conflictDetected = false;
        } else {
          conflictDetails = `Already completed on ${existingDate}`;
        }
        conflicts++;
      }
    }

    // Insert staged record
    const { error: stageError } = await supabase.from('sync_staged_advancement').insert({
      session_id: sessionId,
      scout_id: scoutId,
      data_type: 'merit_badge',
      change_type: changeType,
      existing_record_id: existing?.id || null,
      staged_data: {
        requirement_id: mappedReq.chuckboxId,
        scout_merit_badge_progress_id: badgeProgress.id,
        status: 'completed',
        completed_at: scoutbookDate,
        scoutbook_requirement_id: req.id,
        description: req.description,
      },
      changes: existing
        ? {
            status: { old: existing.status, new: 'completed' },
            completed_at: { old: existing.completed_at, new: scoutbookDate },
          }
        : null,
      conflict_detected: conflictDetected,
      conflict_details: conflictDetails,
      is_selected: !conflictDetected,
    } as Database['public']['Tables']['sync_staged_advancement']['Insert']);

    if (stageError) {
      errors.push(`Failed to stage requirement ${req.id}: ${stageError.message}`);
    } else {
      staged++;
    }
  }

  return { staged, conflicts, errors };
}

// ============================================================================
// Import Functions
// ============================================================================

/**
 * Get staged advancement records for a session
 */
export async function getStagedAdvancement(
  supabase: SupabaseClient<Database>,
  sessionId: string
): Promise<StagedAdvancement[]> {
  const { data, error } = await supabase
    .from('sync_staged_advancement')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to get staged advancement: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    scoutId: row.scout_id,
    dataType: row.data_type as StagedAdvancement['dataType'],
    changeType: row.change_type as StagedAdvancement['changeType'],
    existingRecordId: row.existing_record_id,
    stagedData: row.staged_data as Record<string, unknown>,
    changes: row.changes as StagedAdvancement['changes'],
    conflictDetected: row.conflict_detected || false,
    conflictDetails: row.conflict_details,
    isSelected: row.is_selected ?? true,
  }));
}

/**
 * Update selection status for staged advancement records
 */
export async function updateStagedAdvancementSelection(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  recordIds: string[],
  isSelected: boolean
): Promise<void> {
  const { error } = await supabase
    .from('sync_staged_advancement')
    .update({ is_selected: isSelected })
    .eq('session_id', sessionId)
    .in('id', recordIds);

  if (error) {
    throw new Error(`Failed to update selection: ${error.message}`);
  }
}

/**
 * Confirm and import staged advancement data
 *
 * Only imports selected records. Never un-completes existing completions.
 */
export async function confirmAdvancementImport(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  selectedIds?: string[]
): Promise<AdvancementImportResult> {
  const errors: string[] = [];
  let rankRequirementsImported = 0;
  let meritBadgeRequirementsImported = 0;
  let skipped = 0;

  // Get staged records
  const staged = await getStagedAdvancement(supabase, sessionId);

  // Filter to selected records
  const toImport = staged.filter((record) => {
    if (selectedIds) {
      return selectedIds.includes(record.id);
    }
    return record.isSelected;
  });

  for (const record of toImport) {
    try {
      if (record.dataType === 'rank_requirement') {
        const result = await importRankRequirement(supabase, record);
        if (result.imported) {
          rankRequirementsImported++;
        } else {
          skipped++;
        }
      } else if (record.dataType === 'merit_badge') {
        const result = await importMeritBadgeRequirement(supabase, record);
        if (result.imported) {
          meritBadgeRequirementsImported++;
        } else {
          skipped++;
        }
      }
    } catch (error) {
      errors.push(`Failed to import record ${record.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Clean up staged records
  await supabase.from('sync_staged_advancement').delete().eq('session_id', sessionId);

  // Update session status
  await supabase
    .from('sync_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  return {
    success: errors.length === 0,
    rankRequirementsImported,
    meritBadgeRequirementsImported,
    skipped,
    errors,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Import a single rank requirement completion
 */
async function importRankRequirement(
  supabase: SupabaseClient<Database>,
  record: StagedAdvancement
): Promise<{ imported: boolean }> {
  const data = record.stagedData;
  const requirementId = data.requirement_id as string;
  const progressId = data.scout_rank_progress_id as string;
  const completedAt = data.completed_at as string | null;

  if (record.changeType === 'new') {
    // Insert new completion
    const { error } = await supabase.from('scout_rank_requirement_progress').insert({
      scout_rank_progress_id: progressId,
      requirement_id: requirementId,
      status: 'completed',
      completed_at: completedAt,
      synced_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Insert failed: ${error.message}`);
    }
    return { imported: true };
  } else {
    // Update existing - but only if we should update
    // Rule: never un-complete, prefer earlier date
    if (!record.existingRecordId) {
      throw new Error('Cannot update without existing record ID');
    }

    const existingRecordId = record.existingRecordId;
    const { data: existing } = await supabase
      .from('scout_rank_requirement_progress')
      .select('status, completed_at')
      .eq('id', existingRecordId)
      .single();

    if (existing?.status === 'completed' || existing?.status === 'approved') {
      // Already completed - only update if Scoutbook date is earlier
      if (completedAt && existing.completed_at) {
        if (new Date(completedAt) < new Date(existing.completed_at)) {
          await supabase
            .from('scout_rank_requirement_progress')
            .update({
              completed_at: completedAt,
              synced_at: new Date().toISOString(),
            })
            .eq('id', existingRecordId);
          return { imported: true };
        }
      }
      return { imported: false }; // Skip - already completed with earlier date
    }

    // Not yet completed - update it
    const { error } = await supabase
      .from('scout_rank_requirement_progress')
      .update({
        status: 'completed',
        completed_at: completedAt,
        synced_at: new Date().toISOString(),
      })
      .eq('id', existingRecordId);

    if (error) {
      throw new Error(`Update failed: ${error.message}`);
    }
    return { imported: true };
  }
}

/**
 * Import a single merit badge requirement completion
 */
async function importMeritBadgeRequirement(
  supabase: SupabaseClient<Database>,
  record: StagedAdvancement
): Promise<{ imported: boolean }> {
  const data = record.stagedData;
  const requirementId = data.requirement_id as string;
  const progressId = data.scout_merit_badge_progress_id as string;
  const completedAt = data.completed_at as string | null;

  if (record.changeType === 'new') {
    // Insert new completion (merit badge table doesn't have synced_at)
    const { error } = await supabase.from('scout_merit_badge_requirement_progress').insert({
      scout_merit_badge_progress_id: progressId,
      requirement_id: requirementId,
      status: 'completed',
      completed_at: completedAt,
    });

    if (error) {
      throw new Error(`Insert failed: ${error.message}`);
    }
    return { imported: true };
  } else {
    // Update existing
    if (!record.existingRecordId) {
      throw new Error('Cannot update without existing record ID');
    }

    const existingRecordId = record.existingRecordId;
    const { data: existing } = await supabase
      .from('scout_merit_badge_requirement_progress')
      .select('status, completed_at')
      .eq('id', existingRecordId)
      .single();

    if (existing?.status === 'completed' || existing?.status === 'approved') {
      // Already completed - only update if Scoutbook date is earlier
      if (completedAt && existing.completed_at) {
        if (new Date(completedAt) < new Date(existing.completed_at)) {
          await supabase
            .from('scout_merit_badge_requirement_progress')
            .update({
              completed_at: completedAt,
            })
            .eq('id', existingRecordId);
          return { imported: true };
        }
      }
      return { imported: false };
    }

    // Not yet completed - update it
    const { error } = await supabase
      .from('scout_merit_badge_requirement_progress')
      .update({
        status: 'completed',
        completed_at: completedAt,
      })
      .eq('id', existingRecordId);

    if (error) {
      throw new Error(`Update failed: ${error.message}`);
    }
    return { imported: true };
  }
}

/**
 * Parse date string from various formats to ISO date
 */
function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;

  // Handle MM/DD/YYYY
  const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Handle MM-DD-YYYY
  const dashMatch = dateStr.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dashMatch) {
    const [, month, day, year] = dashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Already in ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }

  return null;
}
