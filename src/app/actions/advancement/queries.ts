'use server'

/**
 * Read-only query functions for advancement data
 *
 * These functions fetch data for display in the UI. They use admin client
 * to bypass RLS - authorization is handled by the calling pages/components.
 *
 * Sub-categories:
 * - User info queries
 * - BSA reference data (ranks, badges, positions)
 * - Scout progress queries
 * - Unit advancement queries
 * - Browser data (lazy-loaded tabs)
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionResult } from './types'
import { verifyLeaderRole } from './utils'

// ==========================================
// USER INFO
// ==========================================

/**
 * Get the current user's profile info for display in UI
 */
export async function getCurrentUserInfo(unitId: string): Promise<ActionResult<{
  profileId: string
  fullName: string
  role: string
}>> {
  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  return {
    success: true,
    data: {
      profileId: auth.profileId,
      fullName: auth.fullName,
      role: auth.role,
    },
  }
}

// ==========================================
// BSA REFERENCE DATA
// ==========================================

/**
 * Get BSA ranks reference data
 */
export async function getBsaRanks() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('bsa_ranks')
    .select('*')
    .order('display_order')

  if (error) {
    console.error('Error fetching ranks:', error)
    return []
  }

  return data
}

/**
 * Get BSA merit badges reference data
 */
export async function getBsaMeritBadges(filters?: { category?: string; isEagleRequired?: boolean }) {
  const supabase = createAdminClient()

  let query = supabase
    .from('bsa_merit_badges')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (filters?.category) {
    query = query.eq('category', filters.category)
  }
  if (filters?.isEagleRequired !== undefined) {
    query = query.eq('is_eagle_required', filters.isEagleRequired)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching merit badges:', error)
    return []
  }

  return data
}

/**
 * Get leadership positions reference data
 */
export async function getBsaLeadershipPositions() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('bsa_leadership_positions')
    .select('*')
    .order('name')

  if (error) {
    console.error('Error fetching leadership positions:', error)
    return []
  }

  return data
}

// ==========================================
// SCOUT PROGRESS QUERIES
// ==========================================

/**
 * Get scout's advancement progress
 */
export async function getScoutAdvancementProgress(scoutId: string) {
  const supabase = createAdminClient()

  // Run all 4 queries in parallel - they are completely independent
  const [rankResult, mbResult, leadResult, actResult] = await Promise.all([
    supabase
      .from('scout_rank_progress')
      .select(`
        *,
        bsa_ranks(*),
        scout_rank_requirement_progress(
          *,
          bsa_rank_requirements(*)
        )
      `)
      .eq('scout_id', scoutId)
      .order('bsa_ranks(display_order)'),
    supabase
      .from('scout_merit_badge_progress')
      .select(`
        *,
        bsa_merit_badges(*),
        scout_merit_badge_requirement_progress(
          *,
          bsa_merit_badge_requirements(*)
        )
      `)
      .eq('scout_id', scoutId),
    supabase
      .from('scout_leadership_history')
      .select(`
        *,
        bsa_leadership_positions(*)
      `)
      .eq('scout_id', scoutId)
      .order('start_date', { ascending: false }),
    supabase
      .from('scout_activity_entries')
      .select('*')
      .eq('scout_id', scoutId)
      .order('activity_date', { ascending: false }),
  ])

  const { data: rankProgress, error: rankError } = rankResult
  const { data: meritBadgeProgress, error: mbError } = mbResult
  const { data: leadershipHistory, error: leadError } = leadResult
  const { data: activityEntries, error: actError } = actResult

  if (rankError || mbError || leadError || actError) {
    console.error('Error fetching advancement progress')
    return null
  }

  // Calculate activity totals
  const activityTotals = {
    camping: 0,
    hiking: 0,
    service: 0,
    conservation: 0,
  }

  activityEntries?.forEach((entry) => {
    activityTotals[entry.activity_type as keyof typeof activityTotals] += Number(entry.value)
  })

  return {
    rankProgress,
    meritBadgeProgress,
    leadershipHistory,
    activityEntries,
    activityTotals,
  }
}

/**
 * Get pending parent submissions for a unit
 */
export async function getPendingSubmissions(unitId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('scout_rank_requirement_progress')
    .select(`
      *,
      scout_rank_progress!inner(
        scout_id,
        scouts!inner(
          id,
          first_name,
          last_name,
          unit_id
        ),
        bsa_ranks(name)
      ),
      bsa_rank_requirements(
        requirement_number,
        description
      ),
      profiles:submitted_by(
        first_name,
        last_name
      )
    `)
    .eq('approval_status', 'pending_approval')
    .eq('scout_rank_progress.scouts.unit_id', unitId)
    .order('submitted_at', { ascending: false })

  if (error) {
    console.error('Error fetching pending submissions:', error)
    return []
  }

  return data
}

/**
 * Get a scout's current version year for a merit badge
 */
export async function getScoutMeritBadgeVersion(
  scoutId: string,
  meritBadgeId: string
): Promise<ActionResult<{ versionYear: number | null; progressId: string | null }>> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('scout_merit_badge_progress')
    .select('id, requirement_version_year')
    .eq('scout_id', scoutId)
    .eq('merit_badge_id', meritBadgeId)
    .maybeSingle()

  if (error) {
    console.error('Error fetching scout merit badge version:', error)
    return { success: false, error: 'Failed to fetch version' }
  }

  return {
    success: true,
    data: {
      versionYear: data?.requirement_version_year || null,
      progressId: data?.id || null,
    },
  }
}

// ==========================================
// REQUIREMENT QUERIES
// ==========================================

/**
 * Get requirements for a specific merit badge
 * @param meritBadgeId - The merit badge ID
 * @param versionYear - Optional version year. If not provided, uses the current active version.
 */
export async function getMeritBadgeRequirements(meritBadgeId: string, versionYear?: number) {
  const supabase = createAdminClient()

  let effectiveVersionYear = versionYear

  // If no version year provided, get the current active version
  if (!effectiveVersionYear) {
    const { data: currentVersion } = await supabase
      .from('bsa_merit_badge_versions')
      .select('version_year')
      .eq('merit_badge_id', meritBadgeId)
      .eq('is_current', true)
      .maybeSingle()

    if (currentVersion) {
      effectiveVersionYear = currentVersion.version_year
    } else {
      // Fallback: get the badge's requirement_version_year
      const { data: badge } = await supabase
        .from('bsa_merit_badges')
        .select('requirement_version_year')
        .eq('id', meritBadgeId)
        .single()

      if (!badge?.requirement_version_year) {
        console.error('Merit badge does not have a version year set')
        return []
      }
      effectiveVersionYear = badge.requirement_version_year
    }
  }

  const { data, error } = await supabase
    .from('bsa_merit_badge_requirements')
    .select(`
      id,
      version_year,
      merit_badge_id,
      requirement_number,
      parent_requirement_id,
      sub_requirement_letter,
      description,
      display_order,
      is_alternative,
      alternatives_group,
      nesting_depth,
      required_count,
      is_header
    `)
    .eq('merit_badge_id', meritBadgeId)
    .eq('version_year', effectiveVersionYear)
    .order('display_order')

  if (error) {
    console.error('Error fetching merit badge requirements:', error)
    return []
  }

  return data as Array<{
    id: string
    version_year: number | null
    merit_badge_id: string
    requirement_number: string
    parent_requirement_id: string | null
    sub_requirement_letter: string | null
    description: string
    display_order: number
    is_alternative: boolean | null
    alternatives_group: string | null
    nesting_depth: number | null
    required_count: number | null
    is_header: boolean | null
  }>
}

/**
 * Get rank requirements by rank code
 * Returns requirements for display even when scout has no progress record
 */
export async function getRankRequirements(rankCode: string) {
  const supabase = await createClient()

  // Get the rank with its requirement_version_year
  const { data: rankData, error: rankError } = await supabase
    .from('bsa_ranks')
    .select('id, code, name, display_order, requirement_version_year')
    .eq('code', rankCode)
    .single()

  if (rankError || !rankData) {
    console.error('Error fetching rank:', rankError)
    return null
  }

  if (!rankData.requirement_version_year) {
    console.error('Rank does not have a version year set')
    return null
  }

  const versionYear = rankData.requirement_version_year

  const rank = {
    ...rankData,
    image_url: null as string | null,
  }

  // Get all requirements for this rank's current version
  const { data: requirements, error: reqError } = await supabase
    .from('bsa_rank_requirements')
    .select('id, requirement_number, description, parent_requirement_id, is_alternative, alternatives_group, version_year')
    .eq('rank_id', rank.id)
    .eq('version_year', versionYear)
    .order('display_order')

  if (reqError) {
    console.error('Error fetching requirements:', reqError)
    return null
  }

  return {
    rank,
    requirements: requirements || [],
  }
}

/**
 * Get requirements for a specific version of a merit badge
 * Used for version comparison/switching
 */
export async function getMeritBadgeRequirementsForVersion(
  meritBadgeId: string,
  versionYear: number
): Promise<ActionResult<Array<{
  id: string
  requirement_number: string
  scoutbook_requirement_number: string | null
  description: string
  display_order: number
  parent_requirement_id: string | null
  nesting_depth: number | null
  is_header: boolean | null
}>>> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('bsa_merit_badge_requirements')
    .select(`
      id,
      requirement_number,
      scoutbook_requirement_number,
      description,
      display_order,
      parent_requirement_id,
      nesting_depth,
      is_header
    `)
    .eq('merit_badge_id', meritBadgeId)
    .eq('version_year', versionYear)
    .order('display_order')

  if (error) {
    console.error('Error fetching requirements for version:', error)
    return { success: false, error: 'Failed to fetch requirements' }
  }

  return { success: true, data: data || [] }
}

// ==========================================
// UNIT ADVANCEMENT QUERIES
// ==========================================

/**
 * Get unit advancement summary stats in a single optimized query.
 * Returns counts needed for the summary tab without loading all data.
 */
export async function getUnitAdvancementSummary(unitId: string): Promise<ActionResult<{
  scoutCount: number
  scouts: Array<{
    id: string
    first_name: string
    last_name: string
    rank: string | null
    patrol_name: string | null
  }>
  rankStats: {
    scoutsWorkingOnRanks: number
    avgProgressPercent: number
  }
  badgeStats: {
    inProgress: number
    earned: number
  }
  pendingApprovals: {
    rankRequirements: number
    meritBadges: number
  }
}>> {
  const supabase = createAdminClient()

  // Get scouts with minimal data
  const { data: scouts, error: scoutsError } = await supabase
    .from('scouts')
    .select(`
      id,
      first_name,
      last_name,
      rank,
      patrols (name)
    `)
    .eq('unit_id', unitId)
    .eq('is_active', true)
    .order('last_name')

  if (scoutsError) {
    console.error('Error fetching scouts:', scoutsError)
    return { success: false, error: 'Failed to fetch scouts' }
  }

  const scoutIds = scouts?.map(s => s.id) || []

  if (scoutIds.length === 0) {
    return {
      success: true,
      data: {
        scoutCount: 0,
        scouts: [],
        rankStats: { scoutsWorkingOnRanks: 0, avgProgressPercent: 0 },
        badgeStats: { inProgress: 0, earned: 0 },
        pendingApprovals: { rankRequirements: 0, meritBadges: 0 },
      },
    }
  }

  // Run parallel queries for stats only
  const [rankProgressResult, badgeProgressResult, pendingRankResult, pendingBadgeResult] = await Promise.all([
    supabase
      .from('scout_rank_progress')
      .select(`
        id,
        scout_id,
        status,
        scout_rank_requirement_progress (
          status
        )
      `)
      .in('scout_id', scoutIds)
      .eq('status', 'in_progress'),

    supabase
      .from('scout_merit_badge_progress')
      .select('id, status')
      .in('scout_id', scoutIds),

    supabase
      .from('scout_rank_requirement_progress')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending_approval'),

    supabase
      .from('scout_merit_badge_progress')
      .select('id', { count: 'exact', head: true })
      .in('scout_id', scoutIds)
      .eq('status', 'completed'),
  ])

  // Calculate rank stats
  const inProgressRanks = rankProgressResult.data || []
  let totalReqs = 0
  let completedReqs = 0
  for (const rp of inProgressRanks) {
    const reqs = rp.scout_rank_requirement_progress || []
    totalReqs += reqs.length
    completedReqs += reqs.filter((r: { status: string }) =>
      ['completed', 'approved', 'awarded'].includes(r.status)
    ).length
  }
  const avgProgressPercent = totalReqs > 0 ? Math.round((completedReqs / totalReqs) * 100) : 0

  // Calculate badge stats
  const badgeProgress = badgeProgressResult.data || []
  const inProgressBadges = badgeProgress.filter(b => b.status === 'in_progress').length
  const earnedBadges = badgeProgress.filter(b => b.status === 'awarded').length

  return {
    success: true,
    data: {
      scoutCount: scouts?.length || 0,
      scouts: (scouts || []).map(s => ({
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        rank: s.rank,
        patrol_name: (s.patrols as { name: string } | null)?.name || null,
      })),
      rankStats: {
        scoutsWorkingOnRanks: inProgressRanks.length,
        avgProgressPercent,
      },
      badgeStats: {
        inProgress: inProgressBadges,
        earned: earnedBadges,
      },
      pendingApprovals: {
        rankRequirements: pendingRankResult.count || 0,
        meritBadges: pendingBadgeResult.count || 0,
      },
    },
  }
}

/**
 * Get distinct merit badge categories.
 */
export async function getMeritBadgeCategories(): Promise<ActionResult<string[]>> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('bsa_merit_badges')
    .select('category')
    .eq('is_active', true)
    .not('category', 'is', null)

  if (error) {
    console.error('Error fetching categories:', error)
    return { success: false, error: 'Failed to fetch categories' }
  }

  const categories = [...new Set(data?.map(b => b.category).filter(Boolean) as string[])]
  return { success: true, data: categories.sort() }
}

/**
 * Get rank requirements filtered by version year.
 */
export async function getRankRequirementsForUnit(
  versionYear?: number
): Promise<ActionResult<{
  ranks: Array<{
    id: string
    code: string
    name: string
    display_order: number
    is_eagle_required: boolean | null
    description: string | null
    requirement_version_year: number | null
  }>
  requirements: Array<{
    id: string
    rank_id: string
    version_year: number | null
    requirement_number: string
    parent_requirement_id: string | null
    sub_requirement_letter: string | null
    description: string
    is_alternative: boolean | null
    alternatives_group: string | null
    display_order: number
  }>
}>> {
  const supabase = createAdminClient()

  const { data: ranks, error: ranksError } = await supabase
    .from('bsa_ranks')
    .select('id, code, name, display_order, is_eagle_required, description, requirement_version_year')
    .order('display_order')

  if (ranksError) {
    console.error('Error fetching ranks:', ranksError)
    return { success: false, error: 'Failed to fetch ranks' }
  }

  let reqQuery = supabase
    .from('bsa_rank_requirements')
    .select('id, rank_id, version_year, requirement_number, parent_requirement_id, sub_requirement_letter, description, is_alternative, alternatives_group, display_order')
    .order('display_order')

  if (versionYear) {
    reqQuery = reqQuery.eq('version_year', versionYear)
  } else {
    const rankVersionYears = [...new Set(
      (ranks || [])
        .map(r => r.requirement_version_year)
        .filter((y): y is number => y !== null)
    )]
    if (rankVersionYears.length > 0) {
      reqQuery = reqQuery.in('version_year', rankVersionYears)
    }
  }

  const { data: requirements, error: reqError } = await reqQuery

  if (reqError) {
    console.error('Error fetching rank requirements:', reqError)
    return { success: false, error: 'Failed to fetch requirements' }
  }

  return {
    success: true,
    data: {
      ranks: ranks || [],
      requirements: requirements || [],
    },
  }
}

// ==========================================
// BROWSER DATA (LAZY-LOADED TABS)
// ==========================================

/**
 * Get data for the Rank Requirements Browser tab (lazy loaded).
 *
 * OPTIMIZATION: Split into two parallel queries instead of one deeply nested query.
 * This improves performance by:
 * 1. Reducing query complexity (2-level max vs 3-level nest)
 * 2. Allowing database to parallelize the queries
 * 3. Transferring flatter data structures
 */
export async function getRankBrowserData(unitId: string): Promise<ActionResult<{
  scouts: Array<{
    id: string
    first_name: string
    last_name: string
    rank: string | null
    is_active: boolean | null
    scout_rank_progress: Array<{
      id: string
      rank_id: string
      status: string
      scout_rank_requirement_progress: Array<{
        id: string
        requirement_id: string
        status: string
      }>
    }>
  }>
}>> {
  const supabase = createAdminClient()

  // Run two parallel queries instead of one deeply nested query
  const [scoutsResult, requirementProgressResult] = await Promise.all([
    // Query 1: Scouts with their rank progress (2-level nest)
    supabase
      .from('scouts')
      .select(`
        id,
        first_name,
        last_name,
        rank,
        is_active,
        scout_rank_progress (
          id,
          rank_id,
          status
        )
      `)
      .eq('unit_id', unitId)
      .eq('is_active', true)
      .order('last_name'),

    // Query 2: All requirement progress for scouts in this unit (flat query)
    supabase
      .from('scout_rank_requirement_progress')
      .select(`
        id,
        requirement_id,
        status,
        scout_rank_progress!inner (
          id,
          scouts!inner (
            unit_id
          )
        )
      `)
      .eq('scout_rank_progress.scouts.unit_id', unitId),
  ])

  if (scoutsResult.error) {
    console.error('Error fetching scouts for rank browser:', scoutsResult.error)
    return { success: false, error: 'Failed to fetch rank browser data' }
  }

  if (requirementProgressResult.error) {
    console.error('Error fetching requirement progress:', requirementProgressResult.error)
    return { success: false, error: 'Failed to fetch requirement progress' }
  }

  // Build a map of scout_rank_progress_id -> requirement progress array
  const progressByRankProgressId = new Map<string, Array<{ id: string; requirement_id: string; status: string }>>()

  for (const rp of requirementProgressResult.data || []) {
    const rankProgressId = rp.scout_rank_progress?.id
    if (!rankProgressId) continue

    if (!progressByRankProgressId.has(rankProgressId)) {
      progressByRankProgressId.set(rankProgressId, [])
    }
    progressByRankProgressId.get(rankProgressId)!.push({
      id: rp.id,
      requirement_id: rp.requirement_id,
      status: rp.status,
    })
  }

  // Combine the data into the expected nested structure
  const scouts = (scoutsResult.data || []).map(scout => ({
    ...scout,
    scout_rank_progress: (scout.scout_rank_progress || []).map(srp => ({
      ...srp,
      scout_rank_requirement_progress: progressByRankProgressId.get(srp.id) || [],
    })),
  }))

  return {
    success: true,
    data: {
      scouts,
    },
  }
}

/**
 * Get data for the Merit Badge Browser tab (lazy loaded).
 */
export async function getMeritBadgeBrowserData(unitId: string): Promise<ActionResult<{
  badges: Array<{
    id: string
    code: string
    name: string
    category: string | null
    description: string | null
    is_eagle_required: boolean | null
    is_active: boolean | null
    image_url: string | null
    pamphlet_url: string | null
    requirement_version_year: number | null
  }>
  scouts: Array<{
    id: string
    first_name: string
    last_name: string
    is_active: boolean | null
    scout_merit_badge_progress: Array<{
      id: string
      merit_badge_id: string
      status: string
      counselor_name: string | null
      started_at: string | null
      completed_at: string | null
      awarded_at: string | null
      scout_merit_badge_requirement_progress: Array<{
        id: string
        requirement_id: string
        status: string
        completed_at: string | null
        completed_by: string | null
        notes: string | null
      }>
    }>
  }>
}>> {
  const supabase = createAdminClient()

  const [badgesResult, scoutsResult] = await Promise.all([
    supabase
      .from('bsa_merit_badges')
      .select('id, code, name, category, description, is_eagle_required, is_active, image_url, pamphlet_url, requirement_version_year')
      .eq('is_active', true)
      .order('name'),

    supabase
      .from('scouts')
      .select(`
        id,
        first_name,
        last_name,
        is_active,
        scout_merit_badge_progress (
          id,
          merit_badge_id,
          status,
          counselor_name,
          started_at,
          completed_at,
          awarded_at,
          scout_merit_badge_requirement_progress (
            id,
            requirement_id,
            status,
            completed_at,
            completed_by,
            notes
          )
        )
      `)
      .eq('unit_id', unitId)
      .eq('is_active', true)
      .order('last_name'),
  ])

  if (badgesResult.error) {
    console.error('Error fetching badges:', badgesResult.error)
    return { success: false, error: 'Failed to fetch badges' }
  }

  if (scoutsResult.error) {
    console.error('Error fetching scouts with badge progress:', scoutsResult.error)
    return { success: false, error: 'Failed to fetch scout badge progress' }
  }

  return {
    success: true,
    data: {
      badges: badgesResult.data || [],
      scouts: scoutsResult.data || [],
    },
  }
}
