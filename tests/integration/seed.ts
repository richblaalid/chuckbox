/**
 * Test Data Seeding for Integration Tests
 *
 * Creates test data in the database for integration tests.
 * Uses the service role key to bypass RLS.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { generateTestId, TestContext } from './setup'

// ==========================================
// TYPES
// ==========================================

export interface SeededUnit {
  id: string
  name: string
  unit_type: 'troop' | 'pack' | 'crew'
}

export interface SeededScout {
  id: string
  unit_id: string
  first_name: string
  last_name: string
  rank: string | null
  is_active: boolean
}

export interface SeededRank {
  id: string
  code: string
  name: string
  display_order: number
  requirement_version_year: number | null
}

export interface SeededRankProgress {
  id: string
  scout_id: string
  rank_id: string
  status: string
}

export interface SeededRequirementProgress {
  id: string
  scout_rank_progress_id: string
  requirement_id: string
  status: string
}

// ==========================================
// SEEDING FUNCTIONS
// ==========================================

/**
 * Create a test unit
 */
export async function seedUnit(
  supabase: SupabaseClient<Database>,
  ctx: TestContext,
  options: {
    name?: string
    unitType?: 'troop' | 'pack' | 'crew'
  } = {}
): Promise<SeededUnit> {
  const id = generateTestId('unit')
  const name = options.name || `Test Unit ${id.slice(-6)}`
  const unitType = options.unitType || 'troop'

  // Generate a unique unit number using the ID suffix to avoid unique constraint conflicts
  const uniqueUnitNumber = id.slice(-8)

  const { data, error } = await supabase
    .from('units')
    .insert({
      id,
      name,
      unit_type: unitType,
      unit_number: uniqueUnitNumber,
      council: 'Test Council',
      district: 'Test District',
    })
    .select('id, name, unit_type')
    .single()

  if (error) {
    throw new Error(`Failed to seed unit: ${error.message}`)
  }

  ctx.trackUnit(id)

  return {
    id: data.id,
    name: data.name,
    unit_type: data.unit_type as 'troop' | 'pack' | 'crew',
  }
}

/**
 * Create a test scout
 */
export async function seedScout(
  supabase: SupabaseClient<Database>,
  ctx: TestContext,
  unitId: string,
  options: {
    firstName?: string
    lastName?: string
    rank?: string
    isActive?: boolean
  } = {}
): Promise<SeededScout> {
  const id = generateTestId('scout')
  const firstName = options.firstName || 'Test'
  const lastName = options.lastName || `Scout${id.slice(-4)}`
  const rank = options.rank ?? null
  const isActive = options.isActive ?? true

  const { data, error } = await supabase
    .from('scouts')
    .insert({
      id,
      unit_id: unitId,
      first_name: firstName,
      last_name: lastName,
      rank,
      is_active: isActive,
    })
    .select('id, unit_id, first_name, last_name, rank, is_active')
    .single()

  if (error) {
    throw new Error(`Failed to seed scout: ${error.message}`)
  }

  ctx.trackScout(id)

  return {
    id: data.id,
    unit_id: data.unit_id,
    first_name: data.first_name,
    last_name: data.last_name,
    rank: data.rank,
    // Column is nullable in the generated types, but we always insert a value.
    is_active: data.is_active ?? isActive,
  }
}

/**
 * Get existing BSA ranks from the database
 */
export async function getRanks(supabase: SupabaseClient<Database>): Promise<SeededRank[]> {
  const { data, error } = await supabase
    .from('bsa_ranks')
    .select('id, code, name, display_order, requirement_version_year')
    .order('display_order')

  if (error) {
    throw new Error(`Failed to fetch ranks: ${error.message}`)
  }

  return data || []
}

/**
 * Get rank requirements for a specific rank
 */
export async function getRankRequirements(
  supabase: SupabaseClient<Database>,
  rankId: string,
  versionYear?: number
): Promise<Array<{ id: string; requirement_number: string; description: string }>> {
  let query = supabase
    .from('bsa_rank_requirements')
    .select('id, requirement_number, description')
    .eq('rank_id', rankId)
    .order('display_order')

  if (versionYear) {
    query = query.eq('version_year', versionYear)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to fetch rank requirements: ${error.message}`)
  }

  return data || []
}

/**
 * Create rank progress for a scout
 */
export async function seedRankProgress(
  supabase: SupabaseClient<Database>,
  scoutId: string,
  rankId: string,
  options: {
    status?: 'not_started' | 'in_progress' | 'completed' | 'awarded'
    startedAt?: string
    completedAt?: string
    awardedAt?: string
  } = {}
): Promise<SeededRankProgress> {
  const status = options.status || 'in_progress'
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('scout_rank_progress')
    .insert({
      scout_id: scoutId,
      rank_id: rankId,
      status,
      started_at: options.startedAt || now,
      completed_at: options.completedAt || null,
      awarded_at: options.awardedAt || null,
    })
    .select('id, scout_id, rank_id, status')
    .single()

  if (error) {
    throw new Error(`Failed to seed rank progress: ${error.message}`)
  }

  return {
    id: data.id,
    scout_id: data.scout_id,
    rank_id: data.rank_id,
    status: data.status,
  }
}

/**
 * Create requirement progress records for a rank progress
 */
export async function seedRequirementProgress(
  supabase: SupabaseClient<Database>,
  rankProgressId: string,
  requirementIds: string[],
  options: {
    status?: 'not_started' | 'in_progress' | 'completed'
    completedAt?: string
    completedBy?: string
  } = {}
): Promise<SeededRequirementProgress[]> {
  const status = options.status || 'not_started'

  const records = requirementIds.map(reqId => ({
    scout_rank_progress_id: rankProgressId,
    requirement_id: reqId,
    status,
    completed_at: status === 'completed' ? (options.completedAt || new Date().toISOString()) : null,
    completed_by: status === 'completed' ? options.completedBy : null,
  }))

  const { data, error } = await supabase
    .from('scout_rank_requirement_progress')
    .insert(records)
    .select('id, scout_rank_progress_id, requirement_id, status')

  if (error) {
    throw new Error(`Failed to seed requirement progress: ${error.message}`)
  }

  return data || []
}

// ==========================================
// COMPOSITE SEEDING
// ==========================================

/**
 * Seed a complete test scenario with unit, scouts, and progress
 */
export async function seedTestScenario(
  supabase: SupabaseClient<Database>,
  ctx: TestContext,
  options: {
    scoutCount?: number
    withRankProgress?: boolean
  } = {}
): Promise<{
  unit: SeededUnit
  scouts: SeededScout[]
  ranks: SeededRank[]
  rankProgress: SeededRankProgress[]
}> {
  const scoutCount = options.scoutCount || 3
  const withRankProgress = options.withRankProgress ?? true

  // Create unit
  const unit = await seedUnit(supabase, ctx)

  // Get existing ranks
  const ranks = await getRanks(supabase)
  const scoutRank = ranks.find(r => r.code === 'scout')

  // Create scouts
  const scouts: SeededScout[] = []
  const rankProgress: SeededRankProgress[] = []

  for (let i = 0; i < scoutCount; i++) {
    const scout = await seedScout(supabase, ctx, unit.id, {
      firstName: `Scout`,
      lastName: `Test${i + 1}`,
    })
    scouts.push(scout)

    // Optionally create rank progress
    if (withRankProgress && scoutRank) {
      const progress = await seedRankProgress(supabase, scout.id, scoutRank.id, {
        status: 'in_progress',
      })
      rankProgress.push(progress)
    }
  }

  return {
    unit,
    scouts,
    ranks,
    rankProgress,
  }
}

/**
 * Seed rank progress with requirement progress records
 */
export async function seedScoutWithRequirementProgress(
  supabase: SupabaseClient<Database>,
  ctx: TestContext,
  unitId: string,
  options: {
    rankCode?: string
    completedRequirements?: number
  } = {}
): Promise<{
  scout: SeededScout
  rankProgress: SeededRankProgress
  requirementProgress: SeededRequirementProgress[]
}> {
  const rankCode = options.rankCode || 'scout'
  const completedCount = options.completedRequirements || 0

  // Create scout
  const scout = await seedScout(supabase, ctx, unitId)

  // Get rank and requirements
  const ranks = await getRanks(supabase)
  const rank = ranks.find(r => r.code === rankCode)

  if (!rank) {
    throw new Error(`Rank not found: ${rankCode}`)
  }

  const requirements = await getRankRequirements(supabase, rank.id, rank.requirement_version_year || undefined)

  // Create rank progress
  const rankProgress = await seedRankProgress(supabase, scout.id, rank.id, {
    status: 'in_progress',
  })

  // Create requirement progress
  const requirementProgress: SeededRequirementProgress[] = []

  for (let i = 0; i < requirements.length; i++) {
    const reqProgress = await seedRequirementProgress(
      supabase,
      rankProgress.id,
      [requirements[i].id],
      {
        status: i < completedCount ? 'completed' : 'not_started',
      }
    )
    requirementProgress.push(...reqProgress)
  }

  return {
    scout,
    rankProgress,
    requirementProgress,
  }
}
