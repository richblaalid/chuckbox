'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import {
  parseTroopAdvancementCSV,
  validateParsedData,
} from '@/lib/import/scoutbook-troop-advancement-parser'
import type {
  StagedTroopAdvancement,
  StagedScoutAdvancement,
  StagedChange,
  TroopAdvancementImportResult,
} from '@/lib/import/troop-advancement-types'

interface ActionResult<T = void> {
  success: boolean
  error?: string
  data?: T
}

// Merit badge name aliases for historical/renamed badges
// Maps normalized alternate names to normalized current names in the database
const MERIT_BADGE_ALIASES: Record<string, string> = {
  // Naming variations
  'fish_and_wildlife_management': 'fish_wildlife_management',
  // Renamed badges - BSA renamed "American Indian Lore" to "American Indian Culture" in 2024
  // Map both directions since DB may have either name depending on canonical data version
  'american_indian_lore': 'american_indian_culture',
  'american_indian_culture': 'american_indian_lore',
  'atomic_energy': 'nuclear_science',
  'consumer_buying': 'personal_management',
  'world_brotherhood': 'citizenship_in_the_world',
  'farm_arrangement': 'farm_mechanics',
  'pigeon_raising': 'bird_study',
  'rabbit_raising': 'animal_science',
  'nut_culture': 'plant_science',
  'bee_keeping': 'beekeeping',
  'life_saving': 'lifesaving',
  'first_aid_to_animals': 'veterinary_medicine',
  'signaling': 'signs_signals_codes',
  'machinery': 'farm_mechanics',
  'physical_development': 'personal_fitness',
  'safety': 'emergency_preparedness',
}

// Batch size for database operations
const BATCH_SIZE = 500

/**
 * Normalize requirement number format from Scoutbook to database format
 * Handles various format mismatches:
 * - "2b[1]" -> "2(1)" (bracket with letter prefix)
 * - "3a[3]" -> "3a" (sub-option of a lettered requirement)
 * - "6a[1]a Aerobic" -> "6Aa", "6a" (complex nested format)
 *
 * Returns an array of possible matches to try (ordered by specificity)
 */
function normalizeRequirementNumber(reqNum: string): string[] {
  const variants: string[] = [reqNum]

  // Strip trailing descriptive text first: "6a[1]a Aerobic" -> "6a[1]a"
  let cleaned = reqNum
  const textMatch = reqNum.match(/^(.+?)\s+[A-Z]/)
  if (textMatch) {
    cleaned = textMatch[1]
    variants.push(cleaned)
  }

  // Remove trailing periods: "1a." -> "1a"
  if (cleaned.endsWith('.')) {
    cleaned = cleaned.slice(0, -1)
    variants.push(cleaned)
  }

  // Convert brackets to parentheses: "2b[1]" -> "2b(1)"
  if (cleaned.includes('[')) {
    variants.push(cleaned.replace(/\[/g, '(').replace(/\]/g, ')'))
  }

  // Pattern: "2b[1]" or "9b[4]" -> "2(1)", "9(4)" (number + bracket, strip letter)
  const numLetterBracketNum = cleaned.match(/^(\d+)[a-z]\[(\d+)\]$/i)
  if (numLetterBracketNum) {
    const [, num, idx] = numLetterBracketNum
    variants.push(`${num}(${idx})`)
    variants.push(`${num}[${idx}]`)
  }

  // Pattern: "3a[3]" -> "3a" (lettered requirement with sub-option, try parent)
  const letterBracket = cleaned.match(/^(\d+[a-z])\[\d+\]$/i)
  if (letterBracket) {
    variants.push(letterBracket[1]) // Just "3a"
  }

  // Pattern: "6a[1]a" -> "6Aa" (nested with trailing letter)
  // Scoutbook: 6a[1]a means requirement 6, sub a, option 1, sub-sub a
  // Database might have: 6Aa (capitalized second letter)
  const nestedPattern = cleaned.match(/^(\d+)([a-z])\[(\d+)\]([a-z])$/i)
  if (nestedPattern) {
    const [, num, firstLetter, , secondLetter] = nestedPattern
    // Try: "6Aa" format (number + uppercase first letter + lowercase second)
    variants.push(`${num}${firstLetter.toUpperCase()}${secondLetter.toLowerCase()}`)
    // Try: "6a" (just the first part)
    variants.push(`${num}${firstLetter.toLowerCase()}`)
  }

  // Pattern: "2b(1)" -> "2(1)" (parentheses format, strip letter)
  const parenMatch = cleaned.match(/^(\d+)[a-z]\((\d+)\)$/i)
  if (parenMatch) {
    const [, num, idx] = parenMatch
    variants.push(`${num}(${idx})`)
  }

  // Pattern: "2a1" or "2a2" -> "2(1)", "2(2)", "2a" (letter+number suffix)
  const letterNumSuffix = cleaned.match(/^(\d+)([a-z])(\d+)$/i)
  if (letterNumSuffix) {
    const [, num, letter, suffix] = letterNumSuffix
    variants.push(`${num}(${suffix})`)  // 2a1 -> 2(1)
    variants.push(`${num}${letter}`)     // 2a1 -> 2a
  }

  // Pattern: "1c[1]" -> "1A(1)", "1(1)" (try uppercase letter variant)
  const lcBracket = cleaned.match(/^(\d+)([a-z])\[(\d+)\]$/i)
  if (lcBracket) {
    const [, num, letter, idx] = lcBracket
    variants.push(`${num}${letter.toUpperCase()}(${idx})`)  // 1c[1] -> 1C(1)
    variants.push(`${num}(${idx})`)                          // 1c[1] -> 1(1)
  }

  // Fallback: try just the base number if nothing else works
  const baseNum = cleaned.match(/^(\d+)/)
  if (baseNum) {
    variants.push(baseNum[1])
  }

  return [...new Set(variants)]
}

// ============================================
// Auth Helpers
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
    .select('id, first_name, last_name')
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
    return { error: 'Only leaders can import advancement records' }
  }

  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Unknown'
  return { profileId: profile.id, role: membership.role, fullName }
}

// ============================================
// Staging Action
// ============================================

/**
 * Stage troop advancement data for import
 * Parses CSV, matches scouts, and identifies new vs duplicate records
 */
export async function stageTroopAdvancement(
  unitId: string,
  csvContent: string
): Promise<ActionResult<StagedTroopAdvancement>> {
  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Parse CSV
  const parsed = parseTroopAdvancementCSV(csvContent)
  const validationErrors = validateParsedData(parsed)

  if (validationErrors.length > 0 && parsed.scouts.size === 0) {
    return { success: false, error: validationErrors.join('; ') }
  }

  // Load all unit scouts
  const { data: unitScouts } = await adminSupabase
    .from('scouts')
    .select('id, first_name, last_name, bsa_member_id, is_active')
    .eq('unit_id', unitId)
    .neq('is_active', false)

  const scoutByBsaId = new Map(
    unitScouts?.filter((s) => s.bsa_member_id).map((s) => [s.bsa_member_id!, s]) || []
  )

  // Load rank reference data
  const { data: ranks } = await adminSupabase
    .from('bsa_ranks')
    .select('id, code, name, requirement_version_year')
    .order('display_order')

  const rankByCode = new Map(ranks?.map((r) => [r.code, r]) || [])

  // Load merit badge reference data (include inactive for historical imports)
  const { data: meritBadges } = await adminSupabase
    .from('bsa_merit_badges')
    .select('id, name, requirement_version_year')

  const badgeByNormalizedName = new Map(
    meritBadges?.map((mb) => [
      mb.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      mb,
    ]) || []
  )

  // Helper to look up badge with alias fallback
  const findBadge = (normalizedName: string) => {
    // Try direct match first
    let badge = badgeByNormalizedName.get(normalizedName)
    if (badge) return badge

    // Try alias lookup
    const aliasedName = MERIT_BADGE_ALIASES[normalizedName]
    if (aliasedName) {
      badge = badgeByNormalizedName.get(aliasedName)
    }
    return badge
  }

  // Get all scout IDs that match
  const matchedScoutIds = Array.from(parsed.scouts.keys())
    .map((bsaId) => scoutByBsaId.get(bsaId)?.id)
    .filter(Boolean) as string[]

  // Bulk load existing progress for all matched scouts
  const [existingRankProgress, existingBadgeProgress] = await Promise.all([
    matchedScoutIds.length > 0
      ? adminSupabase
          .from('scout_rank_progress')
          .select('id, scout_id, rank_id, status, awarded_at')
          .in('scout_id', matchedScoutIds)
      : Promise.resolve({ data: [] }),
    matchedScoutIds.length > 0
      ? adminSupabase
          .from('scout_merit_badge_progress')
          .select('id, scout_id, merit_badge_id, status')
          .in('scout_id', matchedScoutIds)
      : Promise.resolve({ data: [] }),
  ])

  // Create lookup maps for existing progress
  const existingRankProgressMap = new Map(
    (existingRankProgress.data || []).map((p) => [`${p.scout_id}:${p.rank_id}`, p])
  )
  const existingBadgeProgressMap = new Map(
    (existingBadgeProgress.data || []).map((p) => [`${p.scout_id}:${p.merit_badge_id}`, p])
  )

  // Stage each scout
  const stagedScouts: StagedScoutAdvancement[] = []
  let totalNewRanks = 0
  let totalNewRankReqs = 0
  let totalNewBadges = 0
  let totalNewBadgeReqs = 0
  let totalDuplicates = 0
  let totalUpdates = 0
  let matchedScouts = 0
  let unmatchedScouts = 0
  const warnings: string[] = []

  for (const [bsaMemberId, scoutData] of parsed.scouts) {
    const dbScout = scoutByBsaId.get(bsaMemberId)
    const matchStatus = dbScout ? 'matched' : 'unmatched'

    if (dbScout) {
      matchedScouts++
    } else {
      unmatchedScouts++
    }

    const stagedRanks: StagedChange[] = []
    const stagedRankReqs: StagedChange[] = []
    const stagedBadges: StagedChange[] = []
    const stagedBadgeReqs: StagedChange[] = []

    // Stage ranks (using pre-loaded data)
    for (const rank of scoutData.ranks) {
      const dbRank = rankByCode.get(rank.rankCode)
      if (!dbRank) {
        warnings.push(`Unknown rank: ${rank.rankName}`)
        continue
      }

      let status: 'new' | 'duplicate' | 'update' = 'new'
      let existingId: string | undefined

      if (dbScout) {
        const existing = existingRankProgressMap.get(`${dbScout.id}:${dbRank.id}`)
        if (existing) {
          existingId = existing.id
          if (existing.status === 'awarded') {
            status = 'duplicate'
            totalDuplicates++
          } else {
            status = 'update'
            totalUpdates++
          }
        } else {
          totalNewRanks++
        }
      } else {
        totalNewRanks++
      }

      stagedRanks.push({
        type: 'rank',
        name: rank.rankName,
        code: rank.rankCode,
        version: rank.version,
        date: rank.awardedDate,
        status,
        existingId,
      })
    }

    // Stage rank requirements (simplified - no individual DB queries)
    for (const req of scoutData.rankRequirements) {
      const dbRank = rankByCode.get(req.rankCode)
      if (!dbRank) continue

      // Mark as new for staging (detailed duplicate check during import)
      totalNewRankReqs++

      stagedRankReqs.push({
        type: 'rank_requirement',
        name: `${req.rankCode} ${req.requirementNumber}`,
        code: req.rankCode,
        requirementNumber: req.requirementNumber,
        version: req.version,
        date: req.completedDate,
        status: 'new',
      })
    }

    // Stage merit badges (using pre-loaded data)
    for (const badge of scoutData.meritBadges) {
      const dbBadge = findBadge(badge.normalizedName)
      if (!dbBadge) {
        warnings.push(`Unknown merit badge: ${badge.badgeName}`)
        continue
      }

      let status: 'new' | 'duplicate' | 'update' = 'new'
      let existingId: string | undefined

      if (dbScout) {
        const existing = existingBadgeProgressMap.get(`${dbScout.id}:${dbBadge.id}`)
        if (existing) {
          existingId = existing.id
          if (existing.status === 'awarded') {
            status = 'duplicate'
            totalDuplicates++
          } else {
            status = 'update'
            totalUpdates++
          }
        } else {
          totalNewBadges++
        }
      } else {
        totalNewBadges++
      }

      stagedBadges.push({
        type: 'merit_badge',
        name: badge.badgeName,
        code: badge.normalizedName,
        version: badge.version,
        date: badge.awardedDate,
        status,
        existingId,
      })
    }

    // Stage merit badge requirements (simplified)
    for (const req of scoutData.meritBadgeRequirements) {
      const dbBadge = findBadge(req.normalizedName)
      if (!dbBadge) continue

      totalNewBadgeReqs++

      stagedBadgeReqs.push({
        type: 'merit_badge_requirement',
        name: `${req.badgeName} ${req.requirementNumber}`,
        code: req.normalizedName,
        requirementNumber: req.requirementNumber,
        version: req.version,
        date: req.completedDate,
        status: 'new',
      })
    }

    const newItems =
      stagedRanks.filter((r) => r.status === 'new').length +
      stagedRankReqs.filter((r) => r.status === 'new').length +
      stagedBadges.filter((r) => r.status === 'new').length +
      stagedBadgeReqs.filter((r) => r.status === 'new').length

    const duplicates =
      stagedRanks.filter((r) => r.status === 'duplicate').length +
      stagedRankReqs.filter((r) => r.status === 'duplicate').length +
      stagedBadges.filter((r) => r.status === 'duplicate').length +
      stagedBadgeReqs.filter((r) => r.status === 'duplicate').length

    const updates =
      stagedRanks.filter((r) => r.status === 'update').length +
      stagedRankReqs.filter((r) => r.status === 'update').length +
      stagedBadges.filter((r) => r.status === 'update').length +
      stagedBadgeReqs.filter((r) => r.status === 'update').length

    stagedScouts.push({
      bsaMemberId,
      firstName: scoutData.firstName,
      lastName: scoutData.lastName,
      fullName: `${scoutData.firstName} ${scoutData.lastName}`.trim(),
      scoutId: dbScout?.id || null,
      matchStatus,
      ranks: stagedRanks,
      rankRequirements: stagedRankReqs,
      meritBadges: stagedBadges,
      meritBadgeRequirements: stagedBadgeReqs,
      summary: {
        newItems,
        duplicates,
        updates,
      },
    })
  }

  // Sort scouts: matched first, then by name
  stagedScouts.sort((a, b) => {
    if (a.matchStatus !== b.matchStatus) {
      return a.matchStatus === 'matched' ? -1 : 1
    }
    return a.fullName.localeCompare(b.fullName)
  })

  const staged: StagedTroopAdvancement = {
    scouts: stagedScouts,
    summary: {
      totalScouts: stagedScouts.length,
      matchedScouts,
      unmatchedScouts,
      newRanks: totalNewRanks,
      newRankRequirements: totalNewRankReqs,
      newMeritBadges: totalNewBadges,
      newMeritBadgeRequirements: totalNewBadgeReqs,
      duplicates: totalDuplicates,
      updates: totalUpdates,
    },
    errors: validationErrors,
    warnings: [...new Set(warnings)], // Deduplicate warnings
  }

  return { success: true, data: staged }
}

// ============================================
// Optimized Import Action (Batch Operations)
// ============================================

/**
 * Import staged advancement data using batch operations
 */
export async function importStagedAdvancement(
  unitId: string,
  staged: StagedTroopAdvancement,
  selectedBsaMemberIds: string[],
  createUnmatchedScouts: boolean = true
): Promise<ActionResult<TroopAdvancementImportResult>> {
  const auth = await verifyLeaderRole(unitId)
  if ('error' in auth) return { success: false, error: auth.error }

  const adminSupabase = createAdminClient()

  // Load reference data
  const { data: ranks } = await adminSupabase
    .from('bsa_ranks')
    .select('id, code, name, requirement_version_year')
    .order('display_order')

  const rankByCode = new Map(ranks?.map((r) => [r.code, r]) || [])
  const rankById = new Map(ranks?.map((r) => [r.id, r]) || [])

  const { data: meritBadges } = await adminSupabase
    .from('bsa_merit_badges')
    .select('id, name, requirement_version_year')

  const badgeByNormalizedName = new Map(
    meritBadges?.map((mb) => [
      mb.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      mb,
    ]) || []
  )
  const badgeById = new Map(meritBadges?.map((mb) => [mb.id, mb]) || [])

  // Helper to look up badge with alias fallback
  const findBadge = (normalizedName: string) => {
    let badge = badgeByNormalizedName.get(normalizedName)
    if (badge) return badge
    const aliasedName = MERIT_BADGE_ALIASES[normalizedName]
    if (aliasedName) {
      badge = badgeByNormalizedName.get(aliasedName)
    }
    return badge
  }

  // Load all rank requirements using pagination
  // Supabase has a server-side limit of 1000 rows per query
  const allRankRequirements: Array<{
    id: string
    rank_id: string
    requirement_number: string
    version_year: number | null
  }> = []
  let rankReqOffset = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data: batch } = await adminSupabase
      .from('bsa_rank_requirements')
      .select('id, rank_id, requirement_number, version_year')
      .range(rankReqOffset, rankReqOffset + PAGE_SIZE - 1)
    if (!batch || batch.length === 0) break
    allRankRequirements.push(...batch)
    if (batch.length < PAGE_SIZE) break
    rankReqOffset += PAGE_SIZE
  }

  const rankReqMap = new Map(
    allRankRequirements.map((r) => [
      `${r.rank_id}:${r.requirement_number}:${r.version_year}`,
      r,
    ])
  )

  // Load all merit badge requirements using pagination
  // We have ~11,000+ requirements across all badges and versions
  // Include scoutbook_requirement_number for matching against CSV format
  const allBadgeRequirements: Array<{
    id: string
    merit_badge_id: string
    requirement_number: string
    scoutbook_requirement_number: string | null
    version_year: number | null
  }> = []
  let badgeReqOffset = 0
  while (true) {
    const { data: batch } = await adminSupabase
      .from('bsa_merit_badge_requirements')
      .select('id, merit_badge_id, requirement_number, scoutbook_requirement_number, version_year')
      .range(badgeReqOffset, badgeReqOffset + PAGE_SIZE - 1)
    if (!batch || batch.length === 0) break
    allBadgeRequirements.push(...batch)
    if (batch.length < PAGE_SIZE) break
    badgeReqOffset += PAGE_SIZE
  }

  // Build lookup maps - primary key is scoutbook_requirement_number (CSV format like "2b[1]")
  // Fallback to requirement_number for records without scoutbook mapping
  const badgeReqMap = new Map<string, typeof allBadgeRequirements[0]>()
  for (const r of allBadgeRequirements) {
    // Primary lookup: use scoutbook_requirement_number if available
    if (r.scoutbook_requirement_number) {
      badgeReqMap.set(`${r.merit_badge_id}:${r.scoutbook_requirement_number}:${r.version_year}`, r)
    }
    // Also index by requirement_number for fallback matching
    badgeReqMap.set(`${r.merit_badge_id}:${r.requirement_number}:${r.version_year}`, r)
  }

  const result: TroopAdvancementImportResult = {
    scoutsCreated: 0,
    ranksImported: 0,
    rankRequirementsImported: 0,
    badgesImported: 0,
    badgeRequirementsImported: 0,
    duplicatesSkipped: 0,
    warnings: [],
  }

  // Collect unmatched requirements for admin logging
  const unmatchedRequirements: Array<{
    unit_id: string
    import_type: 'troop_advancement'
    imported_by: string
    scout_id: string | null
    bsa_member_id: string
    scout_name: string
    advancement_type: 'rank_requirement' | 'badge_requirement'
    badge_or_rank_name: string
    version_year: number | null
    requirement_id: string
    error_reason: string
  }> = []

  // Filter to selected scouts
  const selectedScouts = staged.scouts.filter((s) => selectedBsaMemberIds.includes(s.bsaMemberId))

  // Step 1: Create unmatched scouts in batch
  const scoutsToCreate = selectedScouts.filter(
    (s) => s.matchStatus === 'unmatched' && createUnmatchedScouts
  )

  const scoutIdByBsaMemberId = new Map<string, string>()

  // Populate with existing scout IDs
  for (const scout of selectedScouts) {
    if (scout.scoutId) {
      scoutIdByBsaMemberId.set(scout.bsaMemberId, scout.scoutId)
    }
  }

  if (scoutsToCreate.length > 0) {
    const scoutInserts = scoutsToCreate.map((s) => ({
      unit_id: unitId,
      first_name: s.firstName,
      last_name: s.lastName,
      bsa_member_id: s.bsaMemberId,
      is_active: true,
    }))

    const { data: newScouts, error: createError } = await adminSupabase
      .from('scouts')
      .insert(scoutInserts)
      .select('id, bsa_member_id')

    if (createError) {
      result.warnings.push({
        type: 'scout_not_found',
        message: `Failed to create scouts: ${createError.message}`,
      })
    } else if (newScouts) {
      result.scoutsCreated = newScouts.length
      for (const scout of newScouts) {
        if (scout.bsa_member_id) {
          scoutIdByBsaMemberId.set(scout.bsa_member_id, scout.id)
        }
      }
    }
  }

  // Get all scout IDs we're working with
  const allScoutIds = Array.from(scoutIdByBsaMemberId.values())

  // Step 2: Load all existing progress records for these scouts
  const [existingRankProgress, existingBadgeProgress] = await Promise.all([
    adminSupabase
      .from('scout_rank_progress')
      .select('id, scout_id, rank_id, status')
      .in('scout_id', allScoutIds),
    adminSupabase
      .from('scout_merit_badge_progress')
      .select('id, scout_id, merit_badge_id, status')
      .in('scout_id', allScoutIds),
  ])

  const existingRankProgressMap = new Map(
    (existingRankProgress.data || []).map((p) => [`${p.scout_id}:${p.rank_id}`, p])
  )
  const existingBadgeProgressMap = new Map(
    (existingBadgeProgress.data || []).map((p) => [`${p.scout_id}:${p.merit_badge_id}`, p])
  )

  // Step 3: Collect all rank progress records to insert/update
  type RankProgressStatus = 'not_started' | 'in_progress' | 'pending_approval' | 'approved' | 'completed' | 'awarded'
  const rankProgressToInsert: Array<{
    scout_id: string
    rank_id: string
    status: RankProgressStatus
    started_at: string
    awarded_at: string | null
  }> = []
  const rankProgressToUpdate: Array<{
    id: string
    status: RankProgressStatus
    awarded_at: string | null
  }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedRank of scout.ranks) {
      if (stagedRank.status === 'duplicate') {
        result.duplicatesSkipped++
        continue
      }

      const dbRank = rankByCode.get(stagedRank.code)
      if (!dbRank) continue

      const existing = existingRankProgressMap.get(`${scoutId}:${dbRank.id}`)

      if (existing) {
        if (existing.status !== 'awarded') {
          rankProgressToUpdate.push({
            id: existing.id,
            status: 'awarded',
            awarded_at: stagedRank.date || null,
          })
        } else {
          result.duplicatesSkipped++
        }
      } else {
        rankProgressToInsert.push({
          scout_id: scoutId,
          rank_id: dbRank.id,
          status: 'awarded',
          started_at: stagedRank.date || new Date().toISOString(),
          awarded_at: stagedRank.date || null,
        })
      }
    }
  }

  // Step 4: Collect all badge progress records to insert/update
  type BadgeProgressStatus = 'not_started' | 'in_progress' | 'pending_approval' | 'approved' | 'completed' | 'awarded'
  const badgeProgressToInsert: Array<{
    scout_id: string
    merit_badge_id: string
    status: BadgeProgressStatus
    started_at: string
    completed_at: string | null
    awarded_at: string | null
    requirement_version_year: number | null
  }> = []
  const badgeProgressToUpdate: Array<{
    id: string
    status: BadgeProgressStatus
    completed_at: string | null
    awarded_at: string | null
  }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedBadge of scout.meritBadges) {
      if (stagedBadge.status === 'duplicate') {
        result.duplicatesSkipped++
        continue
      }

      const dbBadge = findBadge(stagedBadge.code)
      if (!dbBadge) continue

      const existing = existingBadgeProgressMap.get(`${scoutId}:${dbBadge.id}`)

      if (existing) {
        if (existing.status !== 'awarded') {
          badgeProgressToUpdate.push({
            id: existing.id,
            status: 'awarded',
            completed_at: stagedBadge.date || null,
            awarded_at: stagedBadge.date || null,
          })
        } else {
          result.duplicatesSkipped++
        }
      } else {
        // Parse version from staged data, fallback to badge's default version
        const versionYear = stagedBadge.version
          ? parseInt(stagedBadge.version, 10)
          : dbBadge.requirement_version_year
        badgeProgressToInsert.push({
          scout_id: scoutId,
          merit_badge_id: dbBadge.id,
          status: 'awarded',
          started_at: stagedBadge.date || new Date().toISOString(),
          completed_at: stagedBadge.date || null,
          awarded_at: stagedBadge.date || null,
          requirement_version_year: versionYear || null,
        })
      }
    }
  }

  // Step 5: Execute batch inserts for rank and badge progress
  // Insert ranks in batches
  for (let i = 0; i < rankProgressToInsert.length; i += BATCH_SIZE) {
    const batch = rankProgressToInsert.slice(i, i + BATCH_SIZE)
    const { data, error } = await adminSupabase
      .from('scout_rank_progress')
      .insert(batch)
      .select('id, scout_id, rank_id')

    if (!error && data) {
      result.ranksImported += data.length
      // Update our map with newly created records
      for (const p of data) {
        existingRankProgressMap.set(`${p.scout_id}:${p.rank_id}`, { ...p, status: 'awarded' })
      }
    }
  }

  // Update ranks in batches
  for (const update of rankProgressToUpdate) {
    await adminSupabase
      .from('scout_rank_progress')
      .update({ status: update.status, awarded_at: update.awarded_at })
      .eq('id', update.id)
    result.ranksImported++
  }

  // Insert badges in batches
  for (let i = 0; i < badgeProgressToInsert.length; i += BATCH_SIZE) {
    const batch = badgeProgressToInsert.slice(i, i + BATCH_SIZE)
    const { data, error } = await adminSupabase
      .from('scout_merit_badge_progress')
      .insert(batch)
      .select('id, scout_id, merit_badge_id')

    if (!error && data) {
      result.badgesImported += data.length
      // Update our map with newly created records
      for (const p of data) {
        existingBadgeProgressMap.set(`${p.scout_id}:${p.merit_badge_id}`, { ...p, status: 'awarded' })
      }
    }
  }

  // Update badges in batches
  for (const update of badgeProgressToUpdate) {
    await adminSupabase
      .from('scout_merit_badge_progress')
      .update({
        status: update.status,
        completed_at: update.completed_at,
        awarded_at: update.awarded_at,
      })
      .eq('id', update.id)
    result.badgesImported++
  }

  // Step 6: Now process requirements (need progress IDs first)
  // Reload progress maps to get all IDs including newly created
  const [updatedRankProgress, updatedBadgeProgress] = await Promise.all([
    adminSupabase
      .from('scout_rank_progress')
      .select('id, scout_id, rank_id')
      .in('scout_id', allScoutIds)
      .limit(10000),
    adminSupabase
      .from('scout_merit_badge_progress')
      .select('id, scout_id, merit_badge_id')
      .in('scout_id', allScoutIds)
      .limit(50000),
  ])

  let rankProgressIdMap = new Map(
    (updatedRankProgress.data || []).map((p) => [`${p.scout_id}:${p.rank_id}`, p.id])
  )
  let badgeProgressIdMap = new Map(
    (updatedBadgeProgress.data || []).map((p) => [`${p.scout_id}:${p.merit_badge_id}`, p.id])
  )

  // Step 6.5: Pre-create any missing progress records in batch
  // First pass: identify all missing rank progress records needed for requirements
  const missingRankProgress: Array<{
    scout_id: string
    rank_id: string
    status: 'in_progress'
    started_at: string
  }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedReq of scout.rankRequirements) {
      if (!stagedReq.requirementNumber) continue
      const dbRank = rankByCode.get(stagedReq.code)
      if (!dbRank) continue

      const key = `${scoutId}:${dbRank.id}`
      if (!rankProgressIdMap.has(key)) {
        // Check if we already added this to missing list
        const alreadyAdded = missingRankProgress.some(
          (p) => p.scout_id === scoutId && p.rank_id === dbRank.id
        )
        if (!alreadyAdded) {
          missingRankProgress.push({
            scout_id: scoutId,
            rank_id: dbRank.id,
            status: 'in_progress',
            started_at: new Date().toISOString(),
          })
        }
      }
    }
  }

  // First pass: identify all missing badge progress records needed for requirements
  const missingBadgeProgress: Array<{
    scout_id: string
    merit_badge_id: string
    status: 'in_progress'
    started_at: string
    requirement_version_year: number | null
  }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedReq of scout.meritBadgeRequirements) {
      if (!stagedReq.requirementNumber) continue
      const dbBadge = findBadge(stagedReq.code)
      if (!dbBadge) continue

      const key = `${scoutId}:${dbBadge.id}`
      if (!badgeProgressIdMap.has(key)) {
        const alreadyAdded = missingBadgeProgress.some(
          (p) => p.scout_id === scoutId && p.merit_badge_id === dbBadge.id
        )
        if (!alreadyAdded) {
          // Parse version from staged data, fallback to badge's default version
          const versionYear = stagedReq.version
            ? parseInt(stagedReq.version, 10)
            : dbBadge.requirement_version_year
          missingBadgeProgress.push({
            scout_id: scoutId,
            merit_badge_id: dbBadge.id,
            status: 'in_progress',
            started_at: new Date().toISOString(),
            requirement_version_year: versionYear || null,
          })
        }
      }
    }
  }

  // Batch insert missing rank progress records
  if (missingRankProgress.length > 0) {
    for (let i = 0; i < missingRankProgress.length; i += BATCH_SIZE) {
      const batch = missingRankProgress.slice(i, i + BATCH_SIZE)
      await adminSupabase.from('scout_rank_progress').upsert(batch, {
        onConflict: 'scout_id,rank_id',
        ignoreDuplicates: true,
      })
    }
  }

  // Batch insert missing badge progress records
  if (missingBadgeProgress.length > 0) {
    for (let i = 0; i < missingBadgeProgress.length; i += BATCH_SIZE) {
      const batch = missingBadgeProgress.slice(i, i + BATCH_SIZE)
      await adminSupabase.from('scout_merit_badge_progress').upsert(batch, {
        onConflict: 'scout_id,merit_badge_id',
        ignoreDuplicates: true,
      })
    }
  }

  // Reload progress maps after batch inserts (always reload to get version years)
  const [reloadedRankProgress, reloadedBadgeProgress] = await Promise.all([
    adminSupabase
      .from('scout_rank_progress')
      .select('id, scout_id, rank_id')
      .in('scout_id', allScoutIds)
      .limit(10000),
    adminSupabase
      .from('scout_merit_badge_progress')
      .select('id, scout_id, merit_badge_id, requirement_version_year')
      .in('scout_id', allScoutIds)
      .limit(50000),
  ])

  rankProgressIdMap = new Map(
    (reloadedRankProgress.data || []).map((p) => [`${p.scout_id}:${p.rank_id}`, p.id])
  )
  badgeProgressIdMap = new Map(
    (reloadedBadgeProgress.data || []).map((p) => [`${p.scout_id}:${p.merit_badge_id}`, p.id])
  )

  // Build map of badge progress -> version year (from DB or staged data)
  const badgeProgressVersionMap = new Map<string, number | null>()
  for (const p of reloadedBadgeProgress.data || []) {
    badgeProgressVersionMap.set(p.id, p.requirement_version_year)
  }

  // Build map to look up staged version by scoutId:badgeId for updating null versions
  const stagedBadgeVersionMap = new Map<string, number>()
  for (const scout of selectedScouts) {
    for (const req of scout.meritBadgeRequirements) {
      if (req.version) {
        const dbBadge = findBadge(req.code)
        if (dbBadge) {
          const key = `${scoutIdByBsaMemberId.get(scout.bsaMemberId)}:${dbBadge.id}`
          if (!stagedBadgeVersionMap.has(key)) {
            stagedBadgeVersionMap.set(key, parseInt(req.version, 10))
          }
        }
      }
    }
  }

  // Update badge progress records that have null version_year with the staged version
  const badgeProgressToUpdateVersion: Array<{ id: string; requirement_version_year: number }> = []
  for (const p of reloadedBadgeProgress.data || []) {
    if (p.requirement_version_year === null) {
      const key = `${p.scout_id}:${p.merit_badge_id}`
      const stagedVersion = stagedBadgeVersionMap.get(key)
      if (stagedVersion) {
        badgeProgressToUpdateVersion.push({
          id: p.id,
          requirement_version_year: stagedVersion,
        })
        // Update our local map too
        badgeProgressVersionMap.set(p.id, stagedVersion)
      }
    }
  }

  // Batch update version years
  if (badgeProgressToUpdateVersion.length > 0) {
    for (const update of badgeProgressToUpdateVersion) {
      await adminSupabase
        .from('scout_merit_badge_progress')
        .update({ requirement_version_year: update.requirement_version_year })
        .eq('id', update.id)
    }
  }

  // Load existing requirement progress
  const rankProgressIds = Array.from(new Set(rankProgressIdMap.values()))
  const badgeProgressIds = Array.from(new Set(badgeProgressIdMap.values()))

  const [existingRankReqProgress, existingBadgeReqProgress] = await Promise.all([
    rankProgressIds.length > 0
      ? adminSupabase
          .from('scout_rank_requirement_progress')
          .select('id, scout_rank_progress_id, requirement_id, status')
          .in('scout_rank_progress_id', rankProgressIds)
          .limit(50000)
      : Promise.resolve({ data: [] }),
    badgeProgressIds.length > 0
      ? adminSupabase
          .from('scout_merit_badge_requirement_progress')
          .select('id, scout_merit_badge_progress_id, requirement_id, status')
          .in('scout_merit_badge_progress_id', badgeProgressIds)
          .limit(100000)
      : Promise.resolve({ data: [] }),
  ])

  const existingRankReqMap = new Map(
    (existingRankReqProgress.data || []).map((p) => [
      `${p.scout_rank_progress_id}:${p.requirement_id}`,
      p,
    ])
  )
  const existingBadgeReqMap = new Map(
    (existingBadgeReqProgress.data || []).map((p) => [
      `${p.scout_merit_badge_progress_id}:${p.requirement_id}`,
      p,
    ])
  )

  // Step 6.75: Initialize ALL requirement progress records for any progress that's missing them
  // This ensures scouts see all requirements (not just completed ones) on their profile
  // Get unique rank IDs from progress records
  const uniqueRankIds = new Set<string>()
  for (const [key] of rankProgressIdMap) {
    const [, rankId] = key.split(':')
    uniqueRankIds.add(rankId)
  }

  // Build map of rank -> all requirements
  const rankAllRequirementsMap = new Map<string, string[]>()
  for (const rankId of uniqueRankIds) {
    const rank = rankById.get(rankId)
    if (!rank) continue
    const versionYear = rank.requirement_version_year
    const reqIds: string[] = []
    for (const [key, req] of rankReqMap) {
      if (key.startsWith(`${rankId}:`) && key.endsWith(`:${versionYear}`)) {
        reqIds.push(req.id)
      }
    }
    rankAllRequirementsMap.set(rankId, reqIds)
  }

  // For each rank progress, create missing requirement progress records
  const allRankReqInitRecords: Array<{
    scout_rank_progress_id: string
    requirement_id: string
    status: 'not_started'
  }> = []

  for (const [key, progressId] of rankProgressIdMap) {
    const [, rankId] = key.split(':')
    const allReqIds = rankAllRequirementsMap.get(rankId) || []

    for (const reqId of allReqIds) {
      const existingKey = `${progressId}:${reqId}`
      if (!existingRankReqMap.has(existingKey)) {
        allRankReqInitRecords.push({
          scout_rank_progress_id: progressId,
          requirement_id: reqId,
          status: 'not_started',
        })
      }
    }
  }

  // Batch insert missing rank requirement progress
  if (allRankReqInitRecords.length > 0) {
    for (let i = 0; i < allRankReqInitRecords.length; i += BATCH_SIZE) {
      const batch = allRankReqInitRecords.slice(i, i + BATCH_SIZE)
      await adminSupabase.from('scout_rank_requirement_progress').upsert(batch, {
        onConflict: 'scout_rank_progress_id,requirement_id',
        ignoreDuplicates: true,
      })
    }
    // Update existing map with newly created records
    for (const rec of allRankReqInitRecords) {
      existingRankReqMap.set(`${rec.scout_rank_progress_id}:${rec.requirement_id}`, {
        id: '', // We don't have the ID but don't need it for duplicate checking
        scout_rank_progress_id: rec.scout_rank_progress_id,
        requirement_id: rec.requirement_id,
        status: 'not_started',
      })
    }
  }

  // For each badge progress, create missing requirement progress records
  // Uses the version year from the progress record (set from staged data) to get correct requirements
  const allBadgeReqInitRecords: Array<{
    scout_merit_badge_progress_id: string
    requirement_id: string
    status: 'not_started'
  }> = []

  for (const [key, progressId] of badgeProgressIdMap) {
    const [, badgeId] = key.split(':')
    const badge = badgeById.get(badgeId)
    if (!badge) continue

    // Use version from progress record, or fall back to badge default
    const versionYear = badgeProgressVersionMap.get(progressId) || badge.requirement_version_year

    // Find all requirements for this badge+version
    const reqIds: string[] = []
    for (const [reqKey, req] of badgeReqMap) {
      if (reqKey.startsWith(`${badgeId}:`) && reqKey.endsWith(`:${versionYear}`)) {
        reqIds.push(req.id)
      }
    }

    for (const reqId of reqIds) {
      const existingKey = `${progressId}:${reqId}`
      if (!existingBadgeReqMap.has(existingKey)) {
        allBadgeReqInitRecords.push({
          scout_merit_badge_progress_id: progressId,
          requirement_id: reqId,
          status: 'not_started',
        })
      }
    }
  }

  // Batch insert missing badge requirement progress
  if (allBadgeReqInitRecords.length > 0) {
    for (let i = 0; i < allBadgeReqInitRecords.length; i += BATCH_SIZE) {
      const batch = allBadgeReqInitRecords.slice(i, i + BATCH_SIZE)
      await adminSupabase.from('scout_merit_badge_requirement_progress').upsert(batch, {
        onConflict: 'scout_merit_badge_progress_id,requirement_id',
        ignoreDuplicates: true,
      })
    }
    // Update existing map with newly created records
    for (const rec of allBadgeReqInitRecords) {
      existingBadgeReqMap.set(`${rec.scout_merit_badge_progress_id}:${rec.requirement_id}`, {
        id: '',
        scout_merit_badge_progress_id: rec.scout_merit_badge_progress_id,
        requirement_id: rec.requirement_id,
        status: 'not_started',
      })
    }
  }

  // Step 7: Collect rank requirement progress to insert
  type ReqProgressStatus = 'not_started' | 'in_progress' | 'pending_approval' | 'approved' | 'completed' | 'awarded'
  const rankReqToInsert: Array<{
    scout_rank_progress_id: string
    requirement_id: string
    status: ReqProgressStatus
    completed_at: string | null
    completed_by: string
  }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedReq of scout.rankRequirements) {
      if (!stagedReq.requirementNumber) continue

      const dbRank = rankByCode.get(stagedReq.code)
      if (!dbRank) continue

      const progressId = rankProgressIdMap.get(`${scoutId}:${dbRank.id}`)
      if (!progressId) {
        // Should have been created in batch - skip with warning
        continue
      }

      // Find requirement ID
      const versionYear = dbRank.requirement_version_year || parseInt(stagedReq.version, 10)
      const reqKey = `${dbRank.id}:${stagedReq.requirementNumber}:${versionYear}`
      const requirement = rankReqMap.get(reqKey)

      if (!requirement) {
        // Try without specific version
        let found = false
        for (const [key, req] of rankReqMap) {
          if (key.startsWith(`${dbRank.id}:${stagedReq.requirementNumber}:`)) {
            const existing = existingRankReqMap.get(`${progressId}:${req.id}`)
            if (!existing || !['completed', 'approved', 'awarded'].includes(existing.status)) {
              rankReqToInsert.push({
                scout_rank_progress_id: progressId,
                requirement_id: req.id,
                status: 'completed',
                completed_at: stagedReq.date || null,
                completed_by: auth.profileId,
              })
              found = true
              break
            }
          }
        }
        if (!found) {
          result.warnings.push({
            type: 'requirement_not_found',
            rank: dbRank.name,
            requirement: stagedReq.requirementNumber,
            version: stagedReq.version,
            message: `Rank requirement not found: ${dbRank.name} ${stagedReq.requirementNumber} (version ${stagedReq.version})`,
          })
          // Log for admin review
          unmatchedRequirements.push({
            unit_id: unitId,
            import_type: 'troop_advancement',
            imported_by: auth.profileId,
            scout_id: scoutId,
            bsa_member_id: scout.bsaMemberId,
            scout_name: scout.fullName,
            advancement_type: 'rank_requirement',
            badge_or_rank_name: dbRank.name,
            version_year: stagedReq.version ? parseInt(stagedReq.version, 10) : null,
            requirement_id: stagedReq.requirementNumber,
            error_reason: `No matching requirement found for ${dbRank.name} ${stagedReq.requirementNumber} (version ${stagedReq.version})`,
          })
        }
        continue
      }

      const existing = existingRankReqMap.get(`${progressId}:${requirement.id}`)
      if (existing && ['completed', 'approved', 'awarded'].includes(existing.status)) {
        result.duplicatesSkipped++
        continue
      }

      rankReqToInsert.push({
        scout_rank_progress_id: progressId,
        requirement_id: requirement.id,
        status: 'completed',
        completed_at: stagedReq.date || null,
        completed_by: auth.profileId,
      })
    }
  }

  // Step 8: Collect badge requirement progress to insert
  const badgeReqToInsert: Array<{
    scout_merit_badge_progress_id: string
    requirement_id: string
    status: ReqProgressStatus
    completed_at: string | null
    completed_by: string
  }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedReq of scout.meritBadgeRequirements) {
      if (!stagedReq.requirementNumber) continue

      const dbBadge = findBadge(stagedReq.code)
      if (!dbBadge) continue

      const progressId = badgeProgressIdMap.get(`${scoutId}:${dbBadge.id}`)
      if (!progressId) {
        // Should have been created in batch - skip
        continue
      }

      // Find requirement ID
      // The map is keyed by scoutbook_requirement_number (e.g., "2b[1]") which matches CSV format
      const versionYears = [
        parseInt(stagedReq.version, 10),
        dbBadge.requirement_version_year,
      ].filter((v) => v && !isNaN(v))

      let requirement = null

      // First: Try direct match with CSV requirement number (should match scoutbook_requirement_number)
      for (const versionYear of versionYears) {
        const reqKey = `${dbBadge.id}:${stagedReq.requirementNumber}:${versionYear}`
        requirement = badgeReqMap.get(reqKey)
        if (requirement) break
      }

      // Second: If no direct match, try normalized variants (for edge cases)
      if (!requirement) {
        const reqNumVariants = normalizeRequirementNumber(stagedReq.requirementNumber)
        for (const reqNum of reqNumVariants) {
          for (const versionYear of versionYears) {
            const reqKey = `${dbBadge.id}:${reqNum}:${versionYear}`
            requirement = badgeReqMap.get(reqKey)
            if (requirement) break
          }
          if (requirement) break
        }
      }

      // Third: Try any version as last resort
      if (!requirement) {
        for (const [key, req] of badgeReqMap) {
          if (key.startsWith(`${dbBadge.id}:${stagedReq.requirementNumber}:`)) {
            requirement = req
            break
          }
        }
      }

      if (!requirement) {
        result.warnings.push({
          type: 'requirement_not_found',
          badge: dbBadge.name,
          requirement: stagedReq.requirementNumber,
          version: stagedReq.version,
          message: `Merit badge requirement not found: ${dbBadge.name} ${stagedReq.requirementNumber} (version ${stagedReq.version})`,
        })
        // Log for admin review
        unmatchedRequirements.push({
          unit_id: unitId,
          import_type: 'troop_advancement',
          imported_by: auth.profileId,
          scout_id: scoutId,
          bsa_member_id: scout.bsaMemberId,
          scout_name: scout.fullName,
          advancement_type: 'badge_requirement',
          badge_or_rank_name: dbBadge.name,
          version_year: stagedReq.version ? parseInt(stagedReq.version, 10) : null,
          requirement_id: stagedReq.requirementNumber,
          error_reason: `No matching requirement found for ${dbBadge.name} ${stagedReq.requirementNumber} (version ${stagedReq.version})`,
        })
        continue
      }

      const existing = existingBadgeReqMap.get(`${progressId}:${requirement.id}`)
      if (existing && ['completed', 'approved', 'awarded'].includes(existing.status)) {
        result.duplicatesSkipped++
        continue
      }

      badgeReqToInsert.push({
        scout_merit_badge_progress_id: progressId,
        requirement_id: requirement.id,
        status: 'completed',
        completed_at: stagedReq.date || null,
        completed_by: auth.profileId,
      })
    }
  }

  // Step 9: Batch update requirement progress to completed status
  // Use upsert with onConflict to update existing records
  for (let i = 0; i < rankReqToInsert.length; i += BATCH_SIZE) {
    const batch = rankReqToInsert.slice(i, i + BATCH_SIZE)
    const { error } = await adminSupabase
      .from('scout_rank_requirement_progress')
      .upsert(batch, {
        onConflict: 'scout_rank_progress_id,requirement_id',
      })

    if (!error) {
      result.rankRequirementsImported += batch.length
    }
  }

  for (let i = 0; i < badgeReqToInsert.length; i += BATCH_SIZE) {
    const batch = badgeReqToInsert.slice(i, i + BATCH_SIZE)
    const { error } = await adminSupabase
      .from('scout_merit_badge_requirement_progress')
      .upsert(batch, {
        onConflict: 'scout_merit_badge_progress_id,requirement_id',
      })

    if (!error) {
      result.badgeRequirementsImported += batch.length
    }
  }

  // Step 10: Log unmatched requirements for admin review
  if (unmatchedRequirements.length > 0) {
    // Batch insert unmatched requirements
    for (let i = 0; i < unmatchedRequirements.length; i += BATCH_SIZE) {
      const batch = unmatchedRequirements.slice(i, i + BATCH_SIZE)
      const { error } = await adminSupabase
        .from('import_requirement_mismatches')
        .insert(batch)

      if (error) {
        console.error('Failed to log unmatched requirements:', error.message)
      }
    }

    // Add summary to warnings
    result.warnings.push({
      type: 'unmatched_requirements_logged',
      count: unmatchedRequirements.length,
      message: `${unmatchedRequirements.length} unmatched requirement(s) logged for admin review`,
    })
  }

  // Revalidate relevant pages
  revalidatePath('/advancement')
  revalidatePath('/roster')

  return { success: true, data: result }
}

// ============================================
// Internal Processing Function for Background Jobs
// ============================================

export type ProgressCallback = (processedItems: number, phase: string) => Promise<void>

/**
 * Process import job internally - called from import-jobs.ts
 * This is the same as importStagedAdvancement but accepts profileId directly
 * and supports progress callbacks for background job tracking
 */
export async function processImportJobInternal(
  unitId: string,
  staged: StagedTroopAdvancement,
  selectedBsaMemberIds: string[],
  profileId: string,
  onProgress?: ProgressCallback
): Promise<TroopAdvancementImportResult> {
  const adminSupabase = createAdminClient()

  // Signal that we're loading reference data
  if (onProgress) await onProgress(0, 'loading_reference_data')

  // Load reference data
  const { data: ranks } = await adminSupabase
    .from('bsa_ranks')
    .select('id, code, name, requirement_version_year')
    .order('display_order')

  const rankByCode = new Map(ranks?.map((r) => [r.code, r]) || [])
  const rankById = new Map(ranks?.map((r) => [r.id, r]) || [])

  const { data: meritBadges } = await adminSupabase
    .from('bsa_merit_badges')
    .select('id, name, requirement_version_year')

  const badgeByNormalizedName = new Map(
    meritBadges?.map((mb) => [
      mb.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      mb,
    ]) || []
  )
  const badgeById = new Map(meritBadges?.map((mb) => [mb.id, mb]) || [])

  const findBadge = (normalizedName: string) => {
    let badge = badgeByNormalizedName.get(normalizedName)
    if (badge) return badge
    const aliasedName = MERIT_BADGE_ALIASES[normalizedName]
    if (aliasedName) {
      badge = badgeByNormalizedName.get(aliasedName)
    }
    return badge
  }

  // Load all rank requirements
  const allRankRequirements: Array<{
    id: string
    rank_id: string
    requirement_number: string
    version_year: number | null
  }> = []
  let rankReqOffset = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data: batch } = await adminSupabase
      .from('bsa_rank_requirements')
      .select('id, rank_id, requirement_number, version_year')
      .range(rankReqOffset, rankReqOffset + PAGE_SIZE - 1)
    if (!batch || batch.length === 0) break
    allRankRequirements.push(...batch)
    if (batch.length < PAGE_SIZE) break
    rankReqOffset += PAGE_SIZE
  }

  const rankReqMap = new Map(
    allRankRequirements.map((r) => [
      `${r.rank_id}:${r.requirement_number}:${r.version_year}`,
      r,
    ])
  )

  // Load all merit badge requirements
  const allBadgeRequirements: Array<{
    id: string
    merit_badge_id: string
    requirement_number: string
    scoutbook_requirement_number: string | null
    version_year: number | null
  }> = []
  let badgeReqOffset = 0
  while (true) {
    const { data: batch } = await adminSupabase
      .from('bsa_merit_badge_requirements')
      .select('id, merit_badge_id, requirement_number, scoutbook_requirement_number, version_year')
      .range(badgeReqOffset, badgeReqOffset + PAGE_SIZE - 1)
    if (!batch || batch.length === 0) break
    allBadgeRequirements.push(...batch)
    if (batch.length < PAGE_SIZE) break
    badgeReqOffset += PAGE_SIZE
  }

  const badgeReqMap = new Map<string, typeof allBadgeRequirements[0]>()
  for (const r of allBadgeRequirements) {
    if (r.scoutbook_requirement_number) {
      badgeReqMap.set(`${r.merit_badge_id}:${r.scoutbook_requirement_number}:${r.version_year}`, r)
    }
    badgeReqMap.set(`${r.merit_badge_id}:${r.requirement_number}:${r.version_year}`, r)
  }

  const result: TroopAdvancementImportResult = {
    scoutsCreated: 0,
    ranksImported: 0,
    rankRequirementsImported: 0,
    badgesImported: 0,
    badgeRequirementsImported: 0,
    duplicatesSkipped: 0,
    warnings: [],
  }

  let processedItems = 0

  const selectedScouts = staged.scouts.filter((s) => selectedBsaMemberIds.includes(s.bsaMemberId))

  // Debug: Log what's in the staged data
  const stagedDataSummary = {
    totalSelectedScouts: selectedScouts.length,
    totalMeritBadgeReqs: selectedScouts.reduce((sum, s) => sum + (s.meritBadgeRequirements?.length || 0), 0),
    totalRankReqs: selectedScouts.reduce((sum, s) => sum + (s.rankRequirements?.length || 0), 0),
    sampleScout: selectedScouts[0] ? {
      name: selectedScouts[0].fullName,
      meritBadgeReqCount: selectedScouts[0].meritBadgeRequirements?.length || 0,
      rankReqCount: selectedScouts[0].rankRequirements?.length || 0,
      firstMeritBadgeReq: selectedScouts[0].meritBadgeRequirements?.[0] || null,
    } : null,
  }
  console.log('[Staged Data Summary]', JSON.stringify(stagedDataSummary, null, 2))

  // Create scouts first
  const scoutsToCreate = selectedScouts.filter((s) => s.matchStatus === 'unmatched')
  const scoutIdByBsaMemberId = new Map<string, string>()

  for (const scout of selectedScouts) {
    if (scout.scoutId) {
      scoutIdByBsaMemberId.set(scout.bsaMemberId, scout.scoutId)
    }
  }

  if (scoutsToCreate.length > 0) {
    const scoutInserts = scoutsToCreate.map((s) => ({
      unit_id: unitId,
      first_name: s.firstName,
      last_name: s.lastName,
      bsa_member_id: s.bsaMemberId,
      is_active: true,
    }))

    const { data: newScouts } = await adminSupabase
      .from('scouts')
      .insert(scoutInserts)
      .select('id, bsa_member_id')

    if (newScouts) {
      result.scoutsCreated = newScouts.length
      for (const scout of newScouts) {
        if (scout.bsa_member_id) {
          scoutIdByBsaMemberId.set(scout.bsa_member_id, scout.id)
        }
      }
    }
  }

  if (onProgress) await onProgress(processedItems, 'scouts')

  const allScoutIds = Array.from(scoutIdByBsaMemberId.values())

  // Load existing progress
  const [existingRankProgress, existingBadgeProgress] = await Promise.all([
    adminSupabase.from('scout_rank_progress').select('id, scout_id, rank_id, status').in('scout_id', allScoutIds),
    adminSupabase.from('scout_merit_badge_progress').select('id, scout_id, merit_badge_id, status').in('scout_id', allScoutIds),
  ])

  const existingRankProgressMap = new Map(
    (existingRankProgress.data || []).map((p) => [`${p.scout_id}:${p.rank_id}`, p])
  )
  const existingBadgeProgressMap = new Map(
    (existingBadgeProgress.data || []).map((p) => [`${p.scout_id}:${p.merit_badge_id}`, p])
  )

  // Process ranks
  if (onProgress) await onProgress(processedItems, 'ranks')

  type ProgressStatus = 'not_started' | 'in_progress' | 'pending_approval' | 'approved' | 'completed' | 'awarded'
  const rankProgressToInsert: Array<{
    scout_id: string
    rank_id: string
    status: ProgressStatus
    started_at: string
    awarded_at: string | null
  }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedRank of scout.ranks) {
      if (stagedRank.status === 'duplicate') {
        result.duplicatesSkipped++
        continue
      }

      const dbRank = rankByCode.get(stagedRank.code)
      if (!dbRank) continue

      const existing = existingRankProgressMap.get(`${scoutId}:${dbRank.id}`)

      if (!existing) {
        rankProgressToInsert.push({
          scout_id: scoutId,
          rank_id: dbRank.id,
          status: 'awarded',
          started_at: stagedRank.date || new Date().toISOString(),
          awarded_at: stagedRank.date || null,
        })
      }
    }
  }

  for (let i = 0; i < rankProgressToInsert.length; i += BATCH_SIZE) {
    const batch = rankProgressToInsert.slice(i, i + BATCH_SIZE)
    const { data } = await adminSupabase.from('scout_rank_progress').insert(batch).select('id, scout_id, rank_id')
    if (data) {
      result.ranksImported += data.length
      processedItems += data.length
      for (const p of data) {
        existingRankProgressMap.set(`${p.scout_id}:${p.rank_id}`, { ...p, status: 'awarded' })
      }
    }
  }

  if (onProgress) await onProgress(processedItems, 'badges')

  // Process badges
  const badgeProgressToInsert: Array<{
    scout_id: string
    merit_badge_id: string
    status: ProgressStatus
    started_at: string
    completed_at: string | null
    awarded_at: string | null
    requirement_version_year: number | null
  }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedBadge of scout.meritBadges) {
      if (stagedBadge.status === 'duplicate') {
        result.duplicatesSkipped++
        continue
      }

      const dbBadge = findBadge(stagedBadge.code)
      if (!dbBadge) continue

      const existing = existingBadgeProgressMap.get(`${scoutId}:${dbBadge.id}`)

      if (!existing) {
        const versionYear = stagedBadge.version
          ? parseInt(stagedBadge.version, 10)
          : dbBadge.requirement_version_year
        badgeProgressToInsert.push({
          scout_id: scoutId,
          merit_badge_id: dbBadge.id,
          status: 'awarded',
          started_at: stagedBadge.date || new Date().toISOString(),
          completed_at: stagedBadge.date || null,
          awarded_at: stagedBadge.date || null,
          requirement_version_year: versionYear || null,
        })
      }
    }
  }

  for (let i = 0; i < badgeProgressToInsert.length; i += BATCH_SIZE) {
    const batch = badgeProgressToInsert.slice(i, i + BATCH_SIZE)
    const { data } = await adminSupabase.from('scout_merit_badge_progress').insert(batch).select('id, scout_id, merit_badge_id')
    if (data) {
      result.badgesImported += data.length
      processedItems += data.length
      for (const p of data) {
        existingBadgeProgressMap.set(`${p.scout_id}:${p.merit_badge_id}`, { ...p, status: 'awarded' })
      }
    }
  }

  if (onProgress) await onProgress(processedItems, 'rank_requirements')

  // Reload progress maps
  const [updatedRankProgress, updatedBadgeProgress] = await Promise.all([
    adminSupabase.from('scout_rank_progress').select('id, scout_id, rank_id').in('scout_id', allScoutIds).limit(10000),
    adminSupabase.from('scout_merit_badge_progress').select('id, scout_id, merit_badge_id, requirement_version_year').in('scout_id', allScoutIds).limit(50000),
  ])

  let rankProgressIdMap = new Map((updatedRankProgress.data || []).map((p) => [`${p.scout_id}:${p.rank_id}`, p.id]))
  let badgeProgressIdMap = new Map((updatedBadgeProgress.data || []).map((p) => [`${p.scout_id}:${p.merit_badge_id}`, p.id]))
  const badgeProgressVersionMap = new Map<string, number | null>()
  for (const p of updatedBadgeProgress.data || []) {
    badgeProgressVersionMap.set(p.id, p.requirement_version_year)
  }

  // Create missing progress records for requirements
  const missingRankProgress: Array<{ scout_id: string; rank_id: string; status: 'in_progress'; started_at: string }> = []
  const missingBadgeProgress: Array<{ scout_id: string; merit_badge_id: string; status: 'in_progress'; started_at: string; requirement_version_year: number | null }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedReq of scout.rankRequirements) {
      if (!stagedReq.requirementNumber) continue
      const dbRank = rankByCode.get(stagedReq.code)
      if (!dbRank) continue

      const key = `${scoutId}:${dbRank.id}`
      if (!rankProgressIdMap.has(key) && !missingRankProgress.some((p) => p.scout_id === scoutId && p.rank_id === dbRank.id)) {
        missingRankProgress.push({ scout_id: scoutId, rank_id: dbRank.id, status: 'in_progress', started_at: new Date().toISOString() })
      }
    }

    for (const stagedReq of scout.meritBadgeRequirements) {
      if (!stagedReq.requirementNumber) continue
      const dbBadge = findBadge(stagedReq.code)
      if (!dbBadge) continue

      const key = `${scoutId}:${dbBadge.id}`
      if (!badgeProgressIdMap.has(key) && !missingBadgeProgress.some((p) => p.scout_id === scoutId && p.merit_badge_id === dbBadge.id)) {
        const versionYear = stagedReq.version ? parseInt(stagedReq.version, 10) : dbBadge.requirement_version_year
        missingBadgeProgress.push({ scout_id: scoutId, merit_badge_id: dbBadge.id, status: 'in_progress', started_at: new Date().toISOString(), requirement_version_year: versionYear || null })
      }
    }
  }

  // Insert missing progress
  if (missingRankProgress.length > 0) {
    for (let i = 0; i < missingRankProgress.length; i += BATCH_SIZE) {
      const batch = missingRankProgress.slice(i, i + BATCH_SIZE)
      await adminSupabase.from('scout_rank_progress').upsert(batch, { onConflict: 'scout_id,rank_id', ignoreDuplicates: true })
    }
  }

  if (missingBadgeProgress.length > 0) {
    for (let i = 0; i < missingBadgeProgress.length; i += BATCH_SIZE) {
      const batch = missingBadgeProgress.slice(i, i + BATCH_SIZE)
      await adminSupabase.from('scout_merit_badge_progress').upsert(batch, { onConflict: 'scout_id,merit_badge_id', ignoreDuplicates: true })
    }
  }

  // Reload after inserts
  const [reloadedRankProgress, reloadedBadgeProgress] = await Promise.all([
    adminSupabase.from('scout_rank_progress').select('id, scout_id, rank_id').in('scout_id', allScoutIds).limit(10000),
    adminSupabase.from('scout_merit_badge_progress').select('id, scout_id, merit_badge_id, requirement_version_year').in('scout_id', allScoutIds).limit(50000),
  ])

  rankProgressIdMap = new Map((reloadedRankProgress.data || []).map((p) => [`${p.scout_id}:${p.rank_id}`, p.id]))
  badgeProgressIdMap = new Map((reloadedBadgeProgress.data || []).map((p) => [`${p.scout_id}:${p.merit_badge_id}`, p.id]))

  for (const p of reloadedBadgeProgress.data || []) {
    badgeProgressVersionMap.set(p.id, p.requirement_version_year)
  }

  // Load existing requirement progress
  const rankProgressIds = Array.from(new Set(rankProgressIdMap.values()))
  const badgeProgressIds = Array.from(new Set(badgeProgressIdMap.values()))

  const [existingRankReqProgress, existingBadgeReqProgress] = await Promise.all([
    rankProgressIds.length > 0
      ? adminSupabase.from('scout_rank_requirement_progress').select('id, scout_rank_progress_id, requirement_id, status').in('scout_rank_progress_id', rankProgressIds).limit(50000)
      : Promise.resolve({ data: [] }),
    badgeProgressIds.length > 0
      ? adminSupabase.from('scout_merit_badge_requirement_progress').select('id, scout_merit_badge_progress_id, requirement_id, status').in('scout_merit_badge_progress_id', badgeProgressIds).limit(100000)
      : Promise.resolve({ data: [] }),
  ])

  const existingRankReqMap = new Map((existingRankReqProgress.data || []).map((p) => [`${p.scout_rank_progress_id}:${p.requirement_id}`, p]))
  const existingBadgeReqMap = new Map((existingBadgeReqProgress.data || []).map((p) => [`${p.scout_merit_badge_progress_id}:${p.requirement_id}`, p]))

  // Initialize all requirement progress
  const uniqueRankIds = new Set<string>()
  for (const [key] of rankProgressIdMap) {
    const [, rankId] = key.split(':')
    uniqueRankIds.add(rankId)
  }

  const rankAllRequirementsMap = new Map<string, string[]>()
  for (const rankId of uniqueRankIds) {
    const rank = rankById.get(rankId)
    if (!rank) continue
    const versionYear = rank.requirement_version_year
    const reqIds: string[] = []
    for (const [key, req] of rankReqMap) {
      if (key.startsWith(`${rankId}:`) && key.endsWith(`:${versionYear}`)) {
        reqIds.push(req.id)
      }
    }
    rankAllRequirementsMap.set(rankId, reqIds)
  }

  const allRankReqInitRecords: Array<{ scout_rank_progress_id: string; requirement_id: string; status: 'not_started' }> = []

  for (const [key, progressId] of rankProgressIdMap) {
    const [, rankId] = key.split(':')
    const allReqIds = rankAllRequirementsMap.get(rankId) || []
    for (const reqId of allReqIds) {
      if (!existingRankReqMap.has(`${progressId}:${reqId}`)) {
        allRankReqInitRecords.push({ scout_rank_progress_id: progressId, requirement_id: reqId, status: 'not_started' })
      }
    }
  }

  if (allRankReqInitRecords.length > 0) {
    for (let i = 0; i < allRankReqInitRecords.length; i += BATCH_SIZE) {
      const batch = allRankReqInitRecords.slice(i, i + BATCH_SIZE)
      await adminSupabase.from('scout_rank_requirement_progress').upsert(batch, { onConflict: 'scout_rank_progress_id,requirement_id', ignoreDuplicates: true })
    }
    for (const rec of allRankReqInitRecords) {
      existingRankReqMap.set(`${rec.scout_rank_progress_id}:${rec.requirement_id}`, { id: '', scout_rank_progress_id: rec.scout_rank_progress_id, requirement_id: rec.requirement_id, status: 'not_started' })
    }
  }

  const allBadgeReqInitRecords: Array<{ scout_merit_badge_progress_id: string; requirement_id: string; status: 'not_started' }> = []

  for (const [key, progressId] of badgeProgressIdMap) {
    const [, badgeId] = key.split(':')
    const badge = badgeById.get(badgeId)
    if (!badge) continue
    const versionYear = badgeProgressVersionMap.get(progressId) || badge.requirement_version_year
    const reqIds: string[] = []
    for (const [reqKey, req] of badgeReqMap) {
      if (reqKey.startsWith(`${badgeId}:`) && reqKey.endsWith(`:${versionYear}`)) {
        reqIds.push(req.id)
      }
    }
    for (const reqId of reqIds) {
      if (!existingBadgeReqMap.has(`${progressId}:${reqId}`)) {
        allBadgeReqInitRecords.push({ scout_merit_badge_progress_id: progressId, requirement_id: reqId, status: 'not_started' })
      }
    }
  }

  if (allBadgeReqInitRecords.length > 0) {
    for (let i = 0; i < allBadgeReqInitRecords.length; i += BATCH_SIZE) {
      const batch = allBadgeReqInitRecords.slice(i, i + BATCH_SIZE)
      await adminSupabase.from('scout_merit_badge_requirement_progress').upsert(batch, { onConflict: 'scout_merit_badge_progress_id,requirement_id', ignoreDuplicates: true })
    }
    for (const rec of allBadgeReqInitRecords) {
      existingBadgeReqMap.set(`${rec.scout_merit_badge_progress_id}:${rec.requirement_id}`, { id: '', scout_merit_badge_progress_id: rec.scout_merit_badge_progress_id, requirement_id: rec.requirement_id, status: 'not_started' })
    }
  }

  if (onProgress) await onProgress(processedItems, 'badge_requirements')

  // Collect requirement progress to update
  type ReqProgressStatus = 'not_started' | 'in_progress' | 'pending_approval' | 'approved' | 'completed' | 'awarded'
  const rankReqToInsert: Array<{ scout_rank_progress_id: string; requirement_id: string; status: ReqProgressStatus; completed_at: string | null; completed_by: string }> = []

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) continue

    for (const stagedReq of scout.rankRequirements) {
      if (!stagedReq.requirementNumber) continue
      const dbRank = rankByCode.get(stagedReq.code)
      if (!dbRank) continue

      const progressId = rankProgressIdMap.get(`${scoutId}:${dbRank.id}`)
      if (!progressId) continue

      const versionYear = dbRank.requirement_version_year || parseInt(stagedReq.version, 10)
      const reqKey = `${dbRank.id}:${stagedReq.requirementNumber}:${versionYear}`
      let requirement = rankReqMap.get(reqKey)

      if (!requirement) {
        for (const [key, req] of rankReqMap) {
          if (key.startsWith(`${dbRank.id}:${stagedReq.requirementNumber}:`)) {
            requirement = req
            break
          }
        }
      }

      if (!requirement) continue

      const existing = existingRankReqMap.get(`${progressId}:${requirement.id}`)
      if (existing && ['completed', 'approved', 'awarded'].includes(existing.status)) continue

      rankReqToInsert.push({
        scout_rank_progress_id: progressId,
        requirement_id: requirement.id,
        status: 'completed',
        completed_at: stagedReq.date || null,
        completed_by: profileId,
      })
    }
  }

  const badgeReqToInsert: Array<{ scout_merit_badge_progress_id: string; requirement_id: string; status: ReqProgressStatus; completed_at: string | null; completed_by: string }> = []

  // Debug: Log badge requirements processing summary
  const badgeReqDebug = {
    totalScouts: selectedScouts.length,
    scoutsWithBadgeReqs: 0,
    totalBadgeReqs: 0,
    noScoutId: 0,
    noReqNumber: 0,
    noBadge: 0,
    noProgressId: 0,
    noRequirement: 0,
    alreadyCompleted: 0,
    toInsert: 0,
  }

  for (const scout of selectedScouts) {
    const scoutId = scoutIdByBsaMemberId.get(scout.bsaMemberId)
    if (!scoutId) {
      badgeReqDebug.noScoutId++
      continue
    }

    if (scout.meritBadgeRequirements.length > 0) {
      badgeReqDebug.scoutsWithBadgeReqs++
      badgeReqDebug.totalBadgeReqs += scout.meritBadgeRequirements.length
    }

    for (const stagedReq of scout.meritBadgeRequirements) {
      if (!stagedReq.requirementNumber) {
        badgeReqDebug.noReqNumber++
        continue
      }
      const dbBadge = findBadge(stagedReq.code)
      if (!dbBadge) {
        badgeReqDebug.noBadge++
        continue
      }

      const progressId = badgeProgressIdMap.get(`${scoutId}:${dbBadge.id}`)
      if (!progressId) {
        badgeReqDebug.noProgressId++
        continue
      }

      const versionYears = [parseInt(stagedReq.version, 10), dbBadge.requirement_version_year].filter((v) => v && !isNaN(v))
      let requirement = null

      for (const versionYear of versionYears) {
        const reqKey = `${dbBadge.id}:${stagedReq.requirementNumber}:${versionYear}`
        requirement = badgeReqMap.get(reqKey)
        if (requirement) break
      }

      if (!requirement) {
        const reqNumVariants = normalizeRequirementNumber(stagedReq.requirementNumber)
        for (const reqNum of reqNumVariants) {
          for (const versionYear of versionYears) {
            const reqKey = `${dbBadge.id}:${reqNum}:${versionYear}`
            requirement = badgeReqMap.get(reqKey)
            if (requirement) break
          }
          if (requirement) break
        }
      }

      if (!requirement) {
        for (const [key, req] of badgeReqMap) {
          if (key.startsWith(`${dbBadge.id}:${stagedReq.requirementNumber}:`)) {
            requirement = req
            break
          }
        }
      }

      if (!requirement) {
        badgeReqDebug.noRequirement++
        continue
      }

      const existing = existingBadgeReqMap.get(`${progressId}:${requirement.id}`)
      if (existing && ['completed', 'approved', 'awarded'].includes(existing.status)) {
        badgeReqDebug.alreadyCompleted++
        continue
      }

      badgeReqDebug.toInsert++
      badgeReqToInsert.push({
        scout_merit_badge_progress_id: progressId,
        requirement_id: requirement.id,
        status: 'completed',
        completed_at: stagedReq.date || null,
        completed_by: profileId,
      })
    }
  }

  // Log debug summary
  console.log('[Badge Requirements Import Debug]', JSON.stringify(badgeReqDebug, null, 2))

  // Deduplicate badge requirements - PostgreSQL can't upsert the same row twice in one statement
  const uniqueBadgeReqs = new Map<string, typeof badgeReqToInsert[0]>()
  for (const req of badgeReqToInsert) {
    const key = `${req.scout_merit_badge_progress_id}:${req.requirement_id}`
    // Keep the first occurrence (or one with a date if the first has no date)
    if (!uniqueBadgeReqs.has(key) || (!uniqueBadgeReqs.get(key)!.completed_at && req.completed_at)) {
      uniqueBadgeReqs.set(key, req)
    }
  }
  const deduplicatedBadgeReqs = Array.from(uniqueBadgeReqs.values())
  console.log(`[Badge Requirements] Deduplicated: ${badgeReqToInsert.length} -> ${deduplicatedBadgeReqs.length} (removed ${badgeReqToInsert.length - deduplicatedBadgeReqs.length} duplicates)`)

  // Batch upsert requirements
  for (let i = 0; i < rankReqToInsert.length; i += BATCH_SIZE) {
    const batch = rankReqToInsert.slice(i, i + BATCH_SIZE)
    const { error } = await adminSupabase.from('scout_rank_requirement_progress').upsert(batch, { onConflict: 'scout_rank_progress_id,requirement_id' })
    if (!error) {
      result.rankRequirementsImported += batch.length
      processedItems += batch.length
    }
    if (onProgress) await onProgress(processedItems, 'rank_requirements')
  }

  console.log(`[Badge Requirements] Attempting to upsert ${deduplicatedBadgeReqs.length} records in batches of ${BATCH_SIZE}`)
  for (let i = 0; i < deduplicatedBadgeReqs.length; i += BATCH_SIZE) {
    const batch = deduplicatedBadgeReqs.slice(i, i + BATCH_SIZE)
    const { error, data } = await adminSupabase.from('scout_merit_badge_requirement_progress').upsert(batch, { onConflict: 'scout_merit_badge_progress_id,requirement_id' }).select('id')
    if (error) {
      console.error(`[Badge Requirements] Batch ${i / BATCH_SIZE + 1} FAILED:`, error.message, error.details)
    } else {
      console.log(`[Badge Requirements] Batch ${i / BATCH_SIZE + 1} SUCCESS: ${data?.length || 0} records`)
      result.badgeRequirementsImported += batch.length
      processedItems += batch.length
    }
    if (onProgress) await onProgress(processedItems, 'badge_requirements')
  }

  // Revalidate pages
  revalidatePath('/advancement')
  revalidatePath('/roster')

  return result
}
