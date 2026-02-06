/**
 * Integration Test Setup
 *
 * Provides utilities for integration tests that need real Supabase connections.
 * Uses the service role key to bypass RLS for test data setup/cleanup.
 *
 * IMPORTANT: These tests require a test Supabase instance or dev database.
 * Set TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_KEY environment variables.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Types for test data
export interface TestUnit {
  id: string
  name: string
  unit_type: 'troop' | 'pack' | 'crew'
}

export interface TestScout {
  id: string
  unit_id: string
  first_name: string
  last_name: string
  rank: string | null
  is_active: boolean
}

export interface TestProfile {
  id: string
  user_id: string
  email: string
  first_name: string
  last_name: string
}

export interface TestRankProgress {
  id: string
  scout_id: string
  rank_id: string
  status: 'not_started' | 'in_progress' | 'completed' | 'awarded'
}

// ==========================================
// CLIENT CREATION
// ==========================================

/**
 * Get Supabase URL for integration tests
 * Falls back to dev Supabase if TEST_SUPABASE_URL not set
 */
function getTestSupabaseUrl(): string {
  return process.env.TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
}

/**
 * Get Supabase service key for integration tests
 * Falls back to regular service key if TEST_SUPABASE_SERVICE_KEY not set
 */
function getTestServiceKey(): string {
  return process.env.TEST_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

/**
 * Create a Supabase client for integration tests
 * Uses service role to bypass RLS for test setup/teardown
 */
export function createTestClient(): SupabaseClient<Database> {
  const url = getTestSupabaseUrl()
  const key = getTestServiceKey()

  if (!url || !key) {
    throw new Error(
      'Integration tests require Supabase credentials. ' +
        'Set TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_KEY (or use dev credentials)'
    )
  }

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Check if integration test environment is available
 */
export function isIntegrationTestEnvironment(): boolean {
  const url = getTestSupabaseUrl()
  const key = getTestServiceKey()
  return Boolean(url && key)
}

// ==========================================
// TEST DATA IDENTIFIERS
// ==========================================

// Use a unique prefix for test data to avoid conflicts
const TEST_PREFIX = '00000000-0000-0000-0000-'

/**
 * Generate a unique UUID for test data
 * Uses a recognizable pattern: 00000000-0000-0000-0000-{random12chars}
 */
export function generateTestId(_type: string): string {
  // Generate a proper UUID but with a recognizable test prefix for easy identification
  const random = Math.random().toString(16).slice(2, 14).padStart(12, '0')
  return `${TEST_PREFIX}${random}`
}

/**
 * Check if an ID is a test ID
 */
export function isTestId(id: string): boolean {
  return id.startsWith(TEST_PREFIX)
}

// ==========================================
// CLEANUP UTILITIES
// ==========================================

/**
 * Clean up test data created during integration tests
 * Deletes data in the correct order to respect foreign key constraints
 */
export async function cleanupTestData(supabase: SupabaseClient<Database>, options: {
  unitIds?: string[]
  scoutIds?: string[]
  profileIds?: string[]
  rankProgressIds?: string[]
} = {}): Promise<void> {
  const { unitIds = [], scoutIds = [], profileIds = [], rankProgressIds = [] } = options

  // Delete in order of dependencies (most dependent first)

  // 1. Delete scout requirement progress
  if (scoutIds.length > 0) {
    // First get rank progress IDs
    const { data: rankProgressData } = await supabase
      .from('scout_rank_progress')
      .select('id')
      .in('scout_id', scoutIds)

    const rankProgressIds = rankProgressData?.map(rp => rp.id) || []

    if (rankProgressIds.length > 0) {
      await supabase
        .from('scout_rank_requirement_progress')
        .delete()
        .in('scout_rank_progress_id', rankProgressIds)
    }

    // Delete merit badge requirement progress
    const { data: badgeProgressData } = await supabase
      .from('scout_merit_badge_progress')
      .select('id')
      .in('scout_id', scoutIds)

    const badgeProgressIds = badgeProgressData?.map(bp => bp.id) || []

    if (badgeProgressIds.length > 0) {
      await supabase
        .from('scout_merit_badge_requirement_progress')
        .delete()
        .in('scout_merit_badge_progress_id', badgeProgressIds)
    }

    // 2. Delete rank progress
    await supabase
      .from('scout_rank_progress')
      .delete()
      .in('scout_id', scoutIds)

    // 3. Delete merit badge progress
    await supabase
      .from('scout_merit_badge_progress')
      .delete()
      .in('scout_id', scoutIds)

    // 4. Delete scout accounts (has ON DELETE RESTRICT)
    await supabase
      .from('scout_accounts')
      .delete()
      .in('scout_id', scoutIds)

    // 5. Delete scouts
    await supabase
      .from('scouts')
      .delete()
      .in('id', scoutIds)
  }

  // Delete directly-tracked rank progress (for batch insert tests)
  if (rankProgressIds.length > 0) {
    // First delete any requirement progress linked to these rank progress records
    await supabase
      .from('scout_rank_requirement_progress')
      .delete()
      .in('scout_rank_progress_id', rankProgressIds)

    // Then delete the rank progress records themselves
    await supabase
      .from('scout_rank_progress')
      .delete()
      .in('id', rankProgressIds)
  }

  // 5. Delete memberships and profiles
  if (profileIds.length > 0) {
    await supabase
      .from('unit_memberships')
      .delete()
      .in('profile_id', profileIds)
  }

  // 6. Delete units
  if (unitIds.length > 0) {
    // First delete any remaining memberships for these units
    await supabase
      .from('unit_memberships')
      .delete()
      .in('unit_id', unitIds)

    // Then delete the units
    await supabase
      .from('units')
      .delete()
      .in('id', unitIds)
  }
}

/**
 * Clean up all test data (matches test prefix pattern)
 * WARNING: Only use this for cleanup, not in production!
 */
export async function cleanupAllTestData(supabase: SupabaseClient<Database>): Promise<void> {
  // Find all test scouts
  const { data: testScouts } = await supabase
    .from('scouts')
    .select('id, unit_id')
    .like('id', `${TEST_PREFIX}%`)

  const scoutIds = testScouts?.map(s => s.id) || []
  const unitIds = Array.from(new Set(testScouts?.map(s => s.unit_id) || []))

  // Find all test units
  const { data: testUnits } = await supabase
    .from('units')
    .select('id')
    .like('id', `${TEST_PREFIX}%`)

  const allUnitIds = Array.from(new Set([...unitIds, ...(testUnits?.map(u => u.id) || [])]))

  // Clean up
  await cleanupTestData(supabase, {
    scoutIds,
    unitIds: allUnitIds,
  })
}

// ==========================================
// TEST CONTEXT
// ==========================================

/**
 * Context for a test session - tracks created resources for cleanup
 */
export class TestContext {
  private supabase: SupabaseClient<Database>
  private createdUnits: string[] = []
  private createdScouts: string[] = []
  private createdProfiles: string[] = []
  private createdRankProgress: string[] = []

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase
  }

  trackUnit(unitId: string): void {
    this.createdUnits.push(unitId)
  }

  trackScout(scoutId: string): void {
    this.createdScouts.push(scoutId)
  }

  trackProfile(profileId: string): void {
    this.createdProfiles.push(profileId)
  }

  trackRankProgress(progressId: string): void {
    this.createdRankProgress.push(progressId)
  }

  async cleanup(): Promise<void> {
    await cleanupTestData(this.supabase, {
      unitIds: this.createdUnits,
      scoutIds: this.createdScouts,
      profileIds: this.createdProfiles,
      rankProgressIds: this.createdRankProgress,
    })

    // Reset tracking
    this.createdUnits = []
    this.createdScouts = []
    this.createdProfiles = []
    this.createdRankProgress = []
  }
}

// ==========================================
// VITEST HELPERS
// ==========================================

/**
 * Skip test if integration environment is not available
 */
export function skipIfNoIntegrationEnv(): void {
  if (!isIntegrationTestEnvironment()) {
    throw new Error('Skipping: Integration test environment not configured')
  }
}
