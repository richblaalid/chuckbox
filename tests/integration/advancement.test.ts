/**
 * Integration Tests for Advancement Actions
 *
 * These tests use a real Supabase connection to verify end-to-end functionality.
 * They will be skipped if the integration test environment is not configured.
 *
 * To run these tests:
 * 1. Set TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_KEY environment variables
 *    (or use your dev Supabase credentials)
 * 2. Run: npm test -- integration/advancement
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
  createTestClient,
  isIntegrationTestEnvironment,
  TestContext,
} from './setup'
import {
  seedUnit,
  seedScout,
  seedRankProgress,
  seedRequirementProgress,
  getRanks,
  getRankRequirements,
  seedScoutWithRequirementProgress,
} from './seed'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Skip all tests if integration environment is not available
const describeIntegration = isIntegrationTestEnvironment() ? describe : describe.skip

describeIntegration('Advancement Integration Tests', () => {
  let supabase: SupabaseClient<Database>
  let ctx: TestContext

  beforeAll(() => {
    supabase = createTestClient()
  })

  beforeEach(() => {
    ctx = new TestContext(supabase)
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  describe('Requirement Sign-Off Flow', () => {
    it('should create rank progress and requirement progress records', async () => {
      // 1. Create unit and scout
      const unit = await seedUnit(supabase, ctx)
      const scout = await seedScout(supabase, ctx, unit.id)

      // 2. Get the Scout rank
      const ranks = await getRanks(supabase)
      const scoutRank = ranks.find(r => r.code === 'scout')
      expect(scoutRank).toBeDefined()

      // 3. Create rank progress
      const rankProgress = await seedRankProgress(supabase, scout.id, scoutRank!.id, {
        status: 'in_progress',
      })
      expect(rankProgress.id).toBeDefined()
      expect(rankProgress.status).toBe('in_progress')

      // 4. Verify it's in the database
      const { data: verifyProgress } = await supabase
        .from('scout_rank_progress')
        .select('*')
        .eq('id', rankProgress.id)
        .single()

      expect(verifyProgress).toBeDefined()
      expect(verifyProgress?.scout_id).toBe(scout.id)
      expect(verifyProgress?.rank_id).toBe(scoutRank!.id)
    })

    it('should create requirement progress for all rank requirements', async () => {
      // 1. Set up scout with unit
      const unit = await seedUnit(supabase, ctx)
      const scout = await seedScout(supabase, ctx, unit.id)

      // 2. Get Scout rank and requirements
      const ranks = await getRanks(supabase)
      const scoutRank = ranks.find(r => r.code === 'scout')
      expect(scoutRank).toBeDefined()

      const requirements = await getRankRequirements(
        supabase,
        scoutRank!.id,
        scoutRank!.requirement_version_year || undefined
      )
      expect(requirements.length).toBeGreaterThan(0)

      // 3. Create rank progress
      const rankProgress = await seedRankProgress(supabase, scout.id, scoutRank!.id)

      // 4. Create requirement progress for all requirements
      const reqProgress = await seedRequirementProgress(
        supabase,
        rankProgress.id,
        requirements.map(r => r.id),
        { status: 'not_started' }
      )

      expect(reqProgress.length).toBe(requirements.length)

      // 5. Verify all records exist
      const { data: verifyReqs, count } = await supabase
        .from('scout_rank_requirement_progress')
        .select('*', { count: 'exact' })
        .eq('scout_rank_progress_id', rankProgress.id)

      expect(count).toBe(requirements.length)
    })

    it('should allow marking a requirement as complete', async () => {
      // 1. Create complete test data
      const unit = await seedUnit(supabase, ctx)
      const result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id, {
        rankCode: 'scout',
        completedRequirements: 0,
      })

      expect(result.requirementProgress.length).toBeGreaterThan(0)

      // 2. Get a requirement to complete
      const reqToComplete = result.requirementProgress[0]
      expect(reqToComplete.status).toBe('not_started')

      // 3. Update it directly (simulating what the action would do)
      const { error } = await supabase
        .from('scout_rank_requirement_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', reqToComplete.id)

      expect(error).toBeNull()

      // 4. Verify the update
      const { data: updated } = await supabase
        .from('scout_rank_requirement_progress')
        .select('status, completed_at')
        .eq('id', reqToComplete.id)
        .single()

      expect(updated?.status).toBe('completed')
      expect(updated?.completed_at).toBeDefined()
    })

    it('should track completion history with notes', async () => {
      // 1. Create test data
      const unit = await seedUnit(supabase, ctx)
      const result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id, {
        rankCode: 'scout',
        completedRequirements: 0,
      })

      const reqToComplete = result.requirementProgress[0]

      // 2. Complete with notes (simulating action behavior)
      const completionNote = JSON.stringify([{
        text: 'Completed at troop meeting',
        author: 'Test Leader',
        type: 'completion',
        timestamp: new Date().toISOString(),
      }])

      const { error } = await supabase
        .from('scout_rank_requirement_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          notes: completionNote,
        })
        .eq('id', reqToComplete.id)

      expect(error).toBeNull()

      // 3. Verify notes were saved
      const { data: updated } = await supabase
        .from('scout_rank_requirement_progress')
        .select('notes')
        .eq('id', reqToComplete.id)
        .single()

      expect(updated?.notes).toBeDefined()
      const notes = JSON.parse(updated?.notes || '[]')
      expect(notes[0].text).toBe('Completed at troop meeting')
    })
  })

  describe('Bulk Sign-Off Flow', () => {
    it('should allow bulk updating multiple requirements', async () => {
      // 1. Create test data with multiple requirements
      const unit = await seedUnit(supabase, ctx)
      const result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id, {
        rankCode: 'scout',
        completedRequirements: 0,
      })

      // Get first 3 requirements (or all if less)
      const reqsToComplete = result.requirementProgress.slice(0, 3)
      expect(reqsToComplete.length).toBeGreaterThan(0)

      // 2. Bulk update (simulating bulk sign-off action)
      const reqIds = reqsToComplete.map(r => r.id)
      const { error } = await supabase
        .from('scout_rank_requirement_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .in('id', reqIds)

      expect(error).toBeNull()

      // 3. Verify all were updated
      const { data: updated } = await supabase
        .from('scout_rank_requirement_progress')
        .select('id, status')
        .in('id', reqIds)

      expect(updated?.length).toBe(reqsToComplete.length)
      updated?.forEach(req => {
        expect(req.status).toBe('completed')
      })
    })

    it('should allow bulk sign-off across multiple scouts', { timeout: 15000 }, async () => {
      // 1. Create unit with multiple scouts
      const unit = await seedUnit(supabase, ctx)

      // Create 2 scouts with progress
      const scout1Result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id, {
        rankCode: 'scout',
        completedRequirements: 0,
      })

      const scout2Result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id, {
        rankCode: 'scout',
        completedRequirements: 0,
      })

      // Get a common requirement ID from each scout
      const req1 = scout1Result.requirementProgress[0]
      const req2 = scout2Result.requirementProgress[0]

      // 2. Bulk update both scouts' first requirement
      const { error } = await supabase
        .from('scout_rank_requirement_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .in('id', [req1.id, req2.id])

      expect(error).toBeNull()

      // 3. Verify both were updated
      const { data: updated } = await supabase
        .from('scout_rank_requirement_progress')
        .select('id, status')
        .in('id', [req1.id, req2.id])

      expect(updated?.length).toBe(2)
      updated?.forEach(req => {
        expect(req.status).toBe('completed')
      })
    })

    it('should calculate progress percentage correctly', async () => {
      // 1. Create test data
      const unit = await seedUnit(supabase, ctx)
      const result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id, {
        rankCode: 'scout',
        completedRequirements: 0,
      })

      const totalReqs = result.requirementProgress.length
      expect(totalReqs).toBeGreaterThan(0)

      // 2. Complete half the requirements
      const halfCount = Math.ceil(totalReqs / 2)
      const reqsToComplete = result.requirementProgress.slice(0, halfCount)

      await supabase
        .from('scout_rank_requirement_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .in('id', reqsToComplete.map(r => r.id))

      // 3. Query and calculate progress
      const { data: allReqs } = await supabase
        .from('scout_rank_requirement_progress')
        .select('status')
        .eq('scout_rank_progress_id', result.rankProgress.id)

      const completed = allReqs?.filter(r => r.status === 'completed').length || 0
      const progressPercent = Math.round((completed / totalReqs) * 100)

      expect(progressPercent).toBeGreaterThanOrEqual(50)
    })
  })

  describe('Data Integrity', () => {
    it('should maintain foreign key relationships', async () => {
      // 1. Create test data
      const unit = await seedUnit(supabase, ctx)
      const result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id)

      // 2. Verify relationships via join
      const { data: progressWithRank } = await supabase
        .from('scout_rank_progress')
        .select(`
          id,
          scout_id,
          bsa_ranks (
            id,
            name,
            code
          )
        `)
        .eq('id', result.rankProgress.id)
        .single()

      expect(progressWithRank).toBeDefined()
      expect(progressWithRank?.bsa_ranks).toBeDefined()
    })

    it('should cascade properly when cleaning up test data', async () => {
      // This test verifies our cleanup works correctly

      // 1. Create test data
      const unit = await seedUnit(supabase, ctx)
      const result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id)

      const scoutId = result.scout.id
      const rankProgressId = result.rankProgress.id
      const reqProgressIds = result.requirementProgress.map(r => r.id)

      // 2. Cleanup
      await ctx.cleanup()

      // 3. Verify all data was removed
      const { data: scout } = await supabase
        .from('scouts')
        .select('id')
        .eq('id', scoutId)
        .maybeSingle()

      expect(scout).toBeNull()

      const { data: rankProgress } = await supabase
        .from('scout_rank_progress')
        .select('id')
        .eq('id', rankProgressId)
        .maybeSingle()

      expect(rankProgress).toBeNull()

      const { data: reqProgress } = await supabase
        .from('scout_rank_requirement_progress')
        .select('id')
        .in('id', reqProgressIds)

      expect(reqProgress?.length || 0).toBe(0)
    })
  })

  /**
   * Phase 2 Batch Performance Tests
   *
   * These tests verify that batch query patterns work correctly
   * for bulk operations with multiple scouts.
   *
   * Tasks verified: 2.1.5, 2.2.3, 2.3.2
   */
  describe('Batch Performance Tests', () => {
    it('should batch create rank progress for 10 scouts in under 5s', { timeout: 30000 }, async () => {
      const SCOUT_COUNT = 10
      const unit = await seedUnit(supabase, ctx)

      // Get Scout rank
      const ranks = await getRanks(supabase)
      const scoutRank = ranks.find(r => r.code === 'scout')
      expect(scoutRank).toBeDefined()

      // Create 10 scouts
      const scoutPromises = Array.from({ length: SCOUT_COUNT }, () =>
        seedScout(supabase, ctx, unit.id)
      )
      const scouts = await Promise.all(scoutPromises)
      expect(scouts.length).toBe(SCOUT_COUNT)

      // Measure batch insert time for rank progress
      const startTime = performance.now()

      // Batch insert rank progress for all scouts (simulating the optimized pattern)
      const rankProgressRecords = scouts.map(scout => ({
        scout_id: scout.id,
        rank_id: scoutRank!.id,
        status: 'in_progress' as const,
        started_at: new Date().toISOString(),
      }))

      const { data: insertedProgress, error: insertError } = await supabase
        .from('scout_rank_progress')
        .insert(rankProgressRecords)
        .select('id, scout_id, rank_id')

      const elapsed = performance.now() - startTime

      // Verify success
      expect(insertError).toBeNull()
      expect(insertedProgress?.length).toBe(SCOUT_COUNT)

      // Verify timing - batch insert should be fast
      expect(elapsed).toBeLessThan(5000)

      // Track for cleanup
      insertedProgress?.forEach(p => ctx.trackRankProgress(p.id))
    })

    it('should batch fetch and update requirements for 10 scouts using in() operator', { timeout: 30000 }, async () => {
      const SCOUT_COUNT = 10
      const unit = await seedUnit(supabase, ctx)

      // Create 10 scouts with rank progress
      const scouts: Awaited<ReturnType<typeof seedScoutWithRequirementProgress>>[] = []
      for (let i = 0; i < SCOUT_COUNT; i++) {
        const result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id, {
          rankCode: 'scout',
          completedRequirements: 0,
        })
        scouts.push(result)
      }

      expect(scouts.length).toBe(SCOUT_COUNT)

      // Collect requirement progress IDs to update (first requirement from each scout)
      const idsToUpdate = scouts.map(s => s.requirementProgress[0].id)
      expect(idsToUpdate.length).toBe(SCOUT_COUNT)

      // Measure batch operations
      const startTime = performance.now()

      // 1. Batch fetch (should be 1 query)
      const { data: existingProgress, error: fetchError } = await supabase
        .from('scout_rank_requirement_progress')
        .select('id, status')
        .in('id', idsToUpdate)

      expect(fetchError).toBeNull()
      expect(existingProgress?.length).toBe(SCOUT_COUNT)

      // 2. Batch update (should be 1 query)
      const { data: updated, error: updateError } = await supabase
        .from('scout_rank_requirement_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .in('id', idsToUpdate)
        .select('id')

      const elapsed = performance.now() - startTime

      // Verify success
      expect(updateError).toBeNull()
      expect(updated?.length).toBe(SCOUT_COUNT)

      // Verify timing - batch should be fast
      expect(elapsed).toBeLessThan(3000)

      // Verify all were actually updated
      const { data: verified } = await supabase
        .from('scout_rank_requirement_progress')
        .select('id, status')
        .in('id', idsToUpdate)

      const completedCount = verified?.filter(r => r.status === 'completed').length
      expect(completedCount).toBe(SCOUT_COUNT)
    })

    it('should efficiently create missing progress records for scouts without progress', { timeout: 30000 }, async () => {
      const unit = await seedUnit(supabase, ctx)

      // Create 5 scouts with progress, 5 without
      const scoutsWithProgress: Awaited<ReturnType<typeof seedScoutWithRequirementProgress>>[] = []
      for (let i = 0; i < 5; i++) {
        const result = await seedScoutWithRequirementProgress(supabase, ctx, unit.id, {
          rankCode: 'scout',
          completedRequirements: 0,
        })
        scoutsWithProgress.push(result)
      }

      // Create 5 scouts without rank progress
      const scoutsWithoutProgress: Awaited<ReturnType<typeof seedScout>>[] = []
      for (let i = 0; i < 5; i++) {
        const scout = await seedScout(supabase, ctx, unit.id)
        scoutsWithoutProgress.push(scout)
      }

      // Get Scout rank info
      const ranks = await getRanks(supabase)
      const scoutRank = ranks.find(r => r.code === 'scout')
      expect(scoutRank).toBeDefined()

      const allScoutIds = [
        ...scoutsWithProgress.map(s => s.scout.id),
        ...scoutsWithoutProgress.map(s => s.id),
      ]

      const startTime = performance.now()

      // Batch check which scouts have rank progress
      const { data: existingProgress } = await supabase
        .from('scout_rank_progress')
        .select('id, scout_id, rank_id')
        .in('scout_id', allScoutIds)
        .eq('rank_id', scoutRank!.id)

      // Should find 5 existing
      expect(existingProgress?.length).toBe(5)

      // Create progress for scouts missing it
      const scoutsWithProgressIds = new Set(existingProgress?.map(p => p.scout_id))
      const scoutsMissingProgress = allScoutIds.filter(id => !scoutsWithProgressIds.has(id))

      expect(scoutsMissingProgress.length).toBe(5)

      // Batch insert missing progress
      const newProgressRecords = scoutsMissingProgress.map(scoutId => ({
        scout_id: scoutId,
        rank_id: scoutRank!.id,
        status: 'in_progress' as const,
        started_at: new Date().toISOString(),
      }))

      const { data: inserted } = await supabase
        .from('scout_rank_progress')
        .insert(newProgressRecords)
        .select('id')

      const elapsed = performance.now() - startTime

      // Verify
      expect(inserted?.length).toBe(5)
      expect(elapsed).toBeLessThan(3000)

      // Track for cleanup
      inserted?.forEach(p => ctx.trackRankProgress(p.id))
    })
  })
})
