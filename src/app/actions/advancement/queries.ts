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
 * Get the current user's profile info for display in UI (for leaders)
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

/**
 * Get the current user's profile info for display in UI (for any authenticated user)
 * Used by parents to show their name in submission dialogs
 */
export async function getCurrentUserProfile(): Promise<ActionResult<{
  profileId: string
  fullName: string
}>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, full_name')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile) {
    return { success: false, error: 'Profile not found' }
  }

  const fullName = profile.full_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
    'Unknown'

  return {
    success: true,
    data: {
      profileId: profile.id,
      fullName,
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
 * Get all pending sign-offs for a unit (combined rank + merit badge requirements)
 * Used by the dashboard pending sign-offs card.
 *
 * Returns items in FIFO order (oldest submissions first).
 *
 * Note: Uses a three-step query approach for performance:
 * 1. Get scout IDs for the unit
 * 2. Get progress IDs for those scouts (efficient indexed lookup)
 * 3. Get pending requirements using progress IDs directly (avoids nested filtering)
 */
export async function getPendingSignoffs(unitId: string, limit: number = 5) {
  // Use admin client to bypass RLS - authorization handled by caller (dashboard checks role)
  const supabase = createAdminClient()

  // Step 1: Get scout IDs for this unit (fast indexed query)
  const { data: scouts, error: scoutsError } = await supabase
    .from('scouts')
    .select('id')
    .eq('unit_id', unitId)
    .eq('is_active', true)

  if (scoutsError || !scouts || scouts.length === 0) {
    if (scoutsError) {
      console.error('Error fetching scouts for pending signoffs:', scoutsError)
    }
    return []
  }

  const scoutIds = scouts.map(s => s.id)

  // Step 2: Get progress IDs for these scouts (parallel, indexed lookups)
  const [rankProgressResult, mbProgressResult] = await Promise.all([
    supabase
      .from('scout_rank_progress')
      .select('id')
      .in('scout_id', scoutIds),
    supabase
      .from('scout_merit_badge_progress')
      .select('id')
      .in('scout_id', scoutIds),
  ])

  const rankProgressIds = rankProgressResult.data?.map(rp => rp.id) || []
  const mbProgressIds = mbProgressResult.data?.map(mp => mp.id) || []

  // Early exit if no progress records
  if (rankProgressIds.length === 0 && mbProgressIds.length === 0) {
    return []
  }

  // Step 3: Query pending items using progress IDs directly (avoids nested filtering)
  // NOTE: PostgREST has a URL length limit, so we batch large ID arrays
  const BATCH_SIZE = 100  // UUIDs are 36 chars each, 100 keeps us well under limits

  // Query rank requirements (usually smaller, likely doesn't need batching)
  const rankResult = rankProgressIds.length > 0
    ? await supabase
        .from('scout_rank_requirement_progress')
        .select(`
          id,
          submitted_at,
          submission_notes,
          bsa_rank_requirements (
            requirement_number,
            description
          ),
          scout_rank_progress (
            scout_id,
            scouts (
              id,
              first_name,
              last_name
            ),
            bsa_ranks (
              name
            )
          ),
          profiles:submitted_by (
            first_name,
            last_name
          )
        `)
        .eq('approval_status', 'pending_approval')
        .in('scout_rank_progress_id', rankProgressIds.slice(0, BATCH_SIZE * 5))  // 500 max
        .order('submitted_at', { ascending: true })
        .limit(limit)
    : { data: [], error: null }

  // Query merit badge requirements - batch if needed due to large number of progress IDs
  let badgeData: unknown[] = []
  let badgeError: { message: string } | null = null

  if (mbProgressIds.length > 0) {
    // For pending approvals, we only need a few results, so batch until we have enough
    const batchCount = Math.ceil(mbProgressIds.length / BATCH_SIZE)

    for (let i = 0; i < batchCount && badgeData.length < limit; i++) {
      const batchIds = mbProgressIds.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
      const batchResult = await supabase
        .from('scout_merit_badge_requirement_progress')
        .select(`
          id,
          submitted_at,
          submission_notes,
          submitted_by,
          bsa_merit_badge_requirements (
            requirement_number,
            description
          ),
          scout_merit_badge_progress (
            scout_id,
            scouts (
              id,
              first_name,
              last_name
            ),
            bsa_merit_badges (
              name
            )
          )
        `)
        .eq('approval_status', 'pending_approval')
        .in('scout_merit_badge_progress_id', batchIds)
        .order('submitted_at', { ascending: true })
        .limit(limit - badgeData.length)

      if (batchResult.error) {
        badgeError = batchResult.error
        console.warn(`Error in MB batch ${i + 1}/${batchCount}:`, batchResult.error)
        break
      }

      if (batchResult.data) {
        badgeData = [...badgeData, ...batchResult.data]
      }
    }
  }

  const badgeResult = { data: badgeData, error: badgeError }

  // Use data if available, otherwise use empty array
  // Don't fail on errors - just use empty data for that type
  const rankData = Array.isArray(rankResult.data) ? rankResult.data : []
  // badgeData is already an array from the batching loop above

  // Log any errors for debugging but don't fail the request
  if (rankResult.error) {
    console.warn('Error fetching pending rank signoffs (using empty data):', rankResult.error)
  }
  if (badgeError) {
    console.warn('Error fetching pending merit badge signoffs:', badgeError)
  }

  // Helper to calculate relative time
  const getRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 14) return '1 week ago'
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    if (diffDays < 60) return '1 month ago'
    return `${Math.floor(diffDays / 30)} months ago`
  }

  // Transform rank requirements
  type RankRow = {
    id: string
    submitted_at: string | null
    submission_notes: string | null
    bsa_rank_requirements: { requirement_number: string; description: string } | null
    scout_rank_progress: {
      scout_id: string
      scouts: { id: string; first_name: string; last_name: string } | null
      bsa_ranks: { name: string } | null
    } | null
    profiles: { first_name: string | null; last_name: string | null } | null
  }

  const rankItems = (rankData as unknown as RankRow[])
    .filter(r => r.submitted_at && r.scout_rank_progress?.scouts)
    .map(r => ({
      id: r.id,
      type: 'rank' as const,
      scoutId: r.scout_rank_progress!.scouts!.id,
      scoutName: `${r.scout_rank_progress!.scouts!.first_name} ${r.scout_rank_progress!.scouts!.last_name}`,
      requirementNumber: r.bsa_rank_requirements?.requirement_number || '',
      requirementDescription: r.bsa_rank_requirements?.description || '',
      advancementName: r.scout_rank_progress!.bsa_ranks?.name || '',
      submittedAt: r.submitted_at!,
      submittedByName: r.profiles
        ? `${r.profiles.first_name || ''} ${r.profiles.last_name || ''}`.trim()
        : 'Unknown',
      submissionNotes: r.submission_notes,
      submittedAgo: getRelativeTime(r.submitted_at!),
    }))

  // Transform merit badge requirements
  // Note: We don't join profiles for MB - would need separate lookup or RPC for submitter names
  type BadgeRow = {
    id: string
    submitted_at: string | null
    submission_notes: string | null
    submitted_by: string | null  // UUID, not joined profile
    bsa_merit_badge_requirements: { requirement_number: string; description: string } | null
    scout_merit_badge_progress: {
      scout_id: string
      scouts: { id: string; first_name: string; last_name: string } | null
      bsa_merit_badges: { name: string } | null
    } | null
  }

  const badgeItems = (badgeData as unknown as BadgeRow[])
    .filter(r => r.submitted_at && r.scout_merit_badge_progress?.scouts)
    .map(r => ({
      id: r.id,
      type: 'merit_badge' as const,
      scoutId: r.scout_merit_badge_progress!.scouts!.id,
      scoutName: `${r.scout_merit_badge_progress!.scouts!.first_name} ${r.scout_merit_badge_progress!.scouts!.last_name}`,
      requirementNumber: r.bsa_merit_badge_requirements?.requirement_number || '',
      requirementDescription: r.bsa_merit_badge_requirements?.description || '',
      advancementName: r.scout_merit_badge_progress!.bsa_merit_badges?.name || '',
      submittedAt: r.submitted_at!,
      submittedByName: 'Parent',  // Can't easily join profiles for MB due to ALTER TABLE FK
      submissionNotes: r.submission_notes,
      submittedAgo: getRelativeTime(r.submitted_at!),
    }))

  // Combine and sort by submitted_at (oldest first = FIFO)
  const combined = [...rankItems, ...badgeItems]
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
    .slice(0, limit)

  return combined
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
      is_header,
      bsa_requirement_resources (
        id,
        name,
        url,
        resource_type,
        display_order
      )
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
    bsa_requirement_resources: Array<{
      id: string
      name: string
      url: string
      resource_type: string
      display_order: number
    }>
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
    .select('id, requirement_number, description, parent_requirement_id, is_alternative, alternatives_group, version_year, is_header')
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
    is_header: boolean | null
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
    .select('id, rank_id, version_year, requirement_number, parent_requirement_id, sub_requirement_letter, description, is_alternative, alternatives_group, display_order, is_header')
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
 * Get list of ranks only (for rank selector - very fast query).
 */
export async function getRanksList(): Promise<ActionResult<{
  ranks: Array<{
    id: string
    code: string
    name: string
    display_order: number
    is_eagle_required: boolean | null
    description: string | null
  }>
}>> {
  const supabase = createAdminClient()

  const { data: ranks, error } = await supabase
    .from('bsa_ranks')
    .select('id, code, name, display_order, is_eagle_required, description')
    .order('display_order')

  if (error) {
    console.error('Error fetching ranks list:', error)
    return { success: false, error: 'Failed to fetch ranks' }
  }

  return {
    success: true,
    data: { ranks: ranks || [] },
  }
}

/**
 * Get data for a SINGLE rank - requirements + scout progress for that rank only.
 *
 * This is the key performance optimization: instead of loading all 7 ranks
 * worth of data upfront (35,000+ rows), we load one rank at a time (~5,000 rows).
 * Switching ranks fetches that rank's data on demand.
 */
export async function getRankDataForRank(unitId: string, rankId: string): Promise<ActionResult<{
  requirements: Array<{
    id: string
    version_year: number | null
    rank_id: string
    requirement_number: string
    parent_requirement_id: string | null
    sub_requirement_letter: string | null
    description: string
    is_alternative: boolean | null
    alternatives_group: string | null
    display_order: number
    is_header: boolean | null
  }>
  scoutProgress: Array<{
    scoutId: string
    firstName: string
    lastName: string
    rankProgressId: string | null
    status: string | null
    requirementProgress: Array<{
      requirementId: string
      status: string
    }>
  }>
}>> {
  const supabase = createAdminClient()

  // First get the rank's current version year (fast single-row query)
  const { data: rank, error: rankError } = await supabase
    .from('bsa_ranks')
    .select('requirement_version_year')
    .eq('id', rankId)
    .single()

  if (rankError || !rank?.requirement_version_year) {
    console.error('Error fetching rank version:', rankError)
    return { success: false, error: 'Failed to fetch rank version' }
  }

  const versionYear = rank.requirement_version_year

  // Fetch requirements for this rank and scout progress in parallel
  const [requirementsResult, scoutsResult, progressResult] = await Promise.all([
    // Requirements for this specific rank AND version year only (fixes duplication bug)
    supabase
      .from('bsa_rank_requirements')
      .select('id, version_year, rank_id, requirement_number, parent_requirement_id, sub_requirement_letter, description, is_alternative, alternatives_group, display_order, is_header')
      .eq('rank_id', rankId)
      .eq('version_year', versionYear)
      .order('display_order'),

    // All active scouts in unit (small query)
    supabase
      .from('scouts')
      .select('id, first_name, last_name')
      .eq('unit_id', unitId)
      .eq('is_active', true)
      .order('last_name'),

    // Scout progress for THIS RANK ONLY, filtered by unit's scouts
    supabase
      .from('scout_rank_progress')
      .select(`
        id,
        scout_id,
        status,
        scouts!inner(unit_id),
        scout_rank_requirement_progress (
          id,
          requirement_id,
          status
        )
      `)
      .eq('rank_id', rankId)
      .eq('scouts.unit_id', unitId),
  ])

  if (requirementsResult.error) {
    console.error('Error fetching rank requirements:', requirementsResult.error)
    return { success: false, error: 'Failed to fetch requirements' }
  }

  if (scoutsResult.error) {
    console.error('Error fetching scouts:', scoutsResult.error)
    return { success: false, error: 'Failed to fetch scouts' }
  }

  if (progressResult.error) {
    console.error('Error fetching progress:', progressResult.error)
    return { success: false, error: 'Failed to fetch progress' }
  }

  // Build a map of scout_id -> progress for quick lookup
  const progressByScoutId = new Map<string, {
    rankProgressId: string
    status: string
    requirementProgress: Array<{ requirementId: string; status: string }>
  }>()

  for (const progress of progressResult.data || []) {
    progressByScoutId.set(progress.scout_id, {
      rankProgressId: progress.id,
      status: progress.status,
      requirementProgress: (progress.scout_rank_requirement_progress || []).map(rp => ({
        requirementId: rp.requirement_id,
        status: rp.status,
      })),
    })
  }

  // Combine scouts with their progress for this rank
  const scoutProgress = (scoutsResult.data || []).map(scout => {
    const progress = progressByScoutId.get(scout.id)
    return {
      scoutId: scout.id,
      firstName: scout.first_name,
      lastName: scout.last_name,
      rankProgressId: progress?.rankProgressId || null,
      status: progress?.status || null,
      requirementProgress: progress?.requirementProgress || [],
    }
  })

  return {
    success: true,
    data: {
      requirements: requirementsResult.data || [],
      scoutProgress,
    },
  }
}

/**
 * Get rank progress data for the Summary tab (lazy loaded).
 *
 * This is the heavy query that fetches all rank progress with nested
 * requirement progress for all scouts. Only loaded when Summary tab is visited.
 */
export async function getSummaryTabData(unitId: string): Promise<ActionResult<{
  rankProgress: Array<{
    id: string
    scout_id: string
    status: string
    awarded_at: string | null
    bsa_ranks: { id: string; code: string; name: string; display_order: number } | null
    scout_rank_requirement_progress: Array<{ id: string; status: string; completed_at: string | null }>
  }>
}>> {
  const supabase = createAdminClient()

  // Get scouts for this unit
  const { data: unitScouts, error: scoutsError } = await supabase
    .from('scouts')
    .select('id')
    .eq('unit_id', unitId)
    .eq('is_active', true)

  if (scoutsError) {
    console.error('Error fetching scouts:', scoutsError)
    return { success: false, error: 'Failed to fetch scouts' }
  }

  const scoutIds = unitScouts?.map(s => s.id) || []
  if (scoutIds.length === 0) {
    return { success: true, data: { rankProgress: [] } }
  }

  // Fetch rank progress with nested requirement progress
  const { data: rankProgress, error: progressError } = await supabase
    .from('scout_rank_progress')
    .select(`
      id,
      scout_id,
      status,
      awarded_at,
      bsa_ranks (
        id,
        code,
        name,
        display_order
      ),
      scout_rank_requirement_progress (
        id,
        status,
        completed_at
      )
    `)
    .in('scout_id', scoutIds)

  if (progressError) {
    console.error('Error fetching rank progress:', progressError)
    return { success: false, error: 'Failed to fetch rank progress' }
  }

  return {
    success: true,
    data: {
      rankProgress: (rankProgress || []) as Array<{
        id: string
        scout_id: string
        status: string
        awarded_at: string | null
        bsa_ranks: { id: string; code: string; name: string; display_order: number } | null
        scout_rank_requirement_progress: Array<{ id: string; status: string; completed_at: string | null }>
      }>,
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
