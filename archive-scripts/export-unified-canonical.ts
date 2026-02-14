#!/usr/bin/env npx tsx
/**
 * Export Unified Canonical BSA Data
 *
 * Creates a single source of truth JSON file containing:
 * - Merit badges with all versions and requirements
 * - is_header pre-computed (from parent/child relationships)
 * - Scoutbook IDs for import matching
 * - Ranks with requirements
 * - Leadership positions
 *
 * Usage:
 *   npx tsx scripts/export-unified-canonical.ts
 *   npx tsx scripts/export-unified-canonical.ts --prod  # Export from production
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

// Check for --prod flag
const isProd = process.argv.includes('--prod')
const envFile = isProd ? '.env.prod' : '.env.local'
dotenv.config({ path: envFile })

console.log(`Exporting from: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'}`)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Types for the unified canonical format
interface CanonicalRequirement {
  requirement_number: string
  sub_requirement_letter: string | null
  description: string
  display_order: number
  is_header: boolean
  is_alternative: boolean
  alternatives_group: string | null
  required_count: number | null
  scoutbook_id: string | null
  children: CanonicalRequirement[]
}

interface CanonicalVersion {
  version_year: number
  requirements: CanonicalRequirement[]
}

interface CanonicalBadge {
  code: string
  name: string
  category: string | null
  description: string | null
  is_eagle_required: boolean
  is_active: boolean
  image_url: string | null
  pamphlet_url: string | null
  active_version_year: number | null
  versions: CanonicalVersion[]
}

interface CanonicalRankRequirement {
  requirement_number: string
  description: string
  is_header: boolean
  children: CanonicalRankRequirement[]
}

interface CanonicalRank {
  code: string
  name: string
  description: string | null
  display_order: number
  image_url: string | null
  is_eagle_required: boolean
  requirements: CanonicalRankRequirement[]
}

interface CanonicalLeadershipPosition {
  code: string
  name: string
  description: string | null
  min_tenure_months: number | null
  is_patrol_level: boolean
  is_troop_level: boolean
  qualifies_for_star: boolean
  qualifies_for_life: boolean
  qualifies_for_eagle: boolean
}

interface UnifiedCanonical {
  exported_at: string
  exported_from: string
  version: string
  stats: {
    merit_badges: number
    badge_versions: number
    badge_requirements: number
    ranks: number
    rank_requirements: number
    leadership_positions: number
  }
  merit_badges: CanonicalBadge[]
  ranks: CanonicalRank[]
  leadership_positions: CanonicalLeadershipPosition[]
}

async function fetchAllPaginated<T>(
  table: string,
  select: string,
  orderBy: string = 'id'
): Promise<T[]> {
  const results: T[] = []
  let offset = 0
  const batchSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderBy)
      .range(offset, offset + batchSize - 1)

    if (error) throw new Error(`Error fetching ${table}: ${error.message}`)
    if (!data || data.length === 0) break

    results.push(...(data as T[]))
    offset += batchSize
    process.stdout.write(`  Fetched ${results.length} from ${table}...\r`)
  }
  console.log(`  Fetched ${results.length} from ${table}    `)
  return results
}

function buildRequirementTree(
  requirements: Array<{
    id: string
    requirement_number: string
    sub_requirement_letter: string | null
    description: string
    display_order: number
    is_header: boolean | null
    is_alternative: boolean | null
    alternatives_group: string | null
    required_count: number | null
    parent_requirement_id: string | null
    scoutbook_requirement_number: string | null
  }>
): CanonicalRequirement[] {
  // Build id -> requirement map
  const byId = new Map(requirements.map(r => [r.id, r]))

  // Find root requirements (no parent)
  const roots = requirements.filter(r => !r.parent_requirement_id)

  // Build tree recursively
  function buildNode(req: typeof requirements[0]): CanonicalRequirement {
    const children = requirements
      .filter(r => r.parent_requirement_id === req.id)
      .sort((a, b) => a.display_order - b.display_order)
      .map(buildNode)

    // A requirement is a header if it has children OR is explicitly marked
    const isHeader = req.is_header === true || children.length > 0

    return {
      requirement_number: req.requirement_number,
      sub_requirement_letter: req.sub_requirement_letter,
      description: req.description,
      display_order: req.display_order,
      is_header: isHeader,
      is_alternative: req.is_alternative || false,
      alternatives_group: req.alternatives_group,
      required_count: req.required_count,
      scoutbook_id: req.scoutbook_requirement_number,
      children,
    }
  }

  return roots
    .sort((a, b) => a.display_order - b.display_order)
    .map(buildNode)
}

function buildRankRequirementTree(
  requirements: Array<{
    id: string
    requirement_number: string
    description: string
    display_order: number
    parent_requirement_id: string | null
  }>
): CanonicalRankRequirement[] {
  const roots = requirements.filter(r => !r.parent_requirement_id)

  function buildNode(req: typeof requirements[0]): CanonicalRankRequirement {
    const children = requirements
      .filter(r => r.parent_requirement_id === req.id)
      .sort((a, b) => a.display_order - b.display_order)
      .map(buildNode)

    return {
      requirement_number: req.requirement_number,
      description: req.description,
      is_header: children.length > 0,
      children,
    }
  }

  return roots
    .sort((a, b) => a.display_order - b.display_order)
    .map(buildNode)
}

async function main() {
  console.log('=' .repeat(60))
  console.log('EXPORT UNIFIED CANONICAL BSA DATA')
  console.log('='.repeat(60))
  console.log('')

  // 1. Fetch all merit badges
  console.log('Fetching merit badges...')
  const badges = await fetchAllPaginated<{
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
  }>('bsa_merit_badges', 'id, code, name, category, description, is_eagle_required, is_active, image_url, pamphlet_url, requirement_version_year', 'name')

  // 2. Fetch all requirements
  console.log('Fetching merit badge requirements...')
  const requirements = await fetchAllPaginated<{
    id: string
    merit_badge_id: string
    version_year: number
    requirement_number: string
    sub_requirement_letter: string | null
    description: string
    display_order: number
    is_header: boolean | null
    is_alternative: boolean | null
    alternatives_group: string | null
    required_count: number | null
    parent_requirement_id: string | null
    scoutbook_requirement_number: string | null
  }>('bsa_merit_badge_requirements',
    'id, merit_badge_id, version_year, requirement_number, sub_requirement_letter, description, display_order, is_header, is_alternative, alternatives_group, required_count, parent_requirement_id, scoutbook_requirement_number',
    'display_order')

  // 3. Fetch ranks
  console.log('Fetching ranks...')
  const ranks = await fetchAllPaginated<{
    id: string
    code: string
    name: string
    description: string | null
    display_order: number
    image_url: string | null
    is_eagle_required: boolean | null
  }>('bsa_ranks', 'id, code, name, description, display_order, image_url, is_eagle_required', 'display_order')

  // 4. Fetch rank requirements
  console.log('Fetching rank requirements...')
  const rankRequirements = await fetchAllPaginated<{
    id: string
    rank_id: string
    requirement_number: string
    description: string
    display_order: number
    parent_requirement_id: string | null
  }>('bsa_rank_requirements', 'id, rank_id, requirement_number, description, display_order, parent_requirement_id', 'display_order')

  // 5. Fetch leadership positions
  console.log('Fetching leadership positions...')
  const positions = await fetchAllPaginated<{
    code: string
    name: string
    description: string | null
    min_tenure_months: number | null
    is_patrol_level: boolean | null
    is_troop_level: boolean | null
    qualifies_for_star: boolean | null
    qualifies_for_life: boolean | null
    qualifies_for_eagle: boolean | null
  }>('bsa_leadership_positions', 'code, name, description, min_tenure_months, is_patrol_level, is_troop_level, qualifies_for_star, qualifies_for_life, qualifies_for_eagle', 'name')

  // Build canonical structure
  console.log('\nBuilding canonical structure...')

  // Group requirements by badge and version
  const reqsByBadgeVersion = new Map<string, typeof requirements>()
  for (const req of requirements) {
    const key = `${req.merit_badge_id}:${req.version_year}`
    if (!reqsByBadgeVersion.has(key)) {
      reqsByBadgeVersion.set(key, [])
    }
    reqsByBadgeVersion.get(key)!.push(req)
  }

  // Find all version years per badge
  const versionsByBadge = new Map<string, Set<number>>()
  for (const req of requirements) {
    if (!versionsByBadge.has(req.merit_badge_id)) {
      versionsByBadge.set(req.merit_badge_id, new Set())
    }
    versionsByBadge.get(req.merit_badge_id)!.add(req.version_year)
  }

  // Build canonical badges
  const canonicalBadges: CanonicalBadge[] = badges.map(badge => {
    const versions = [...(versionsByBadge.get(badge.id) || [])]
      .sort((a, b) => b - a) // Most recent first
      .map(year => {
        const reqs = reqsByBadgeVersion.get(`${badge.id}:${year}`) || []
        return {
          version_year: year,
          requirements: buildRequirementTree(reqs),
        }
      })

    return {
      code: badge.code,
      name: badge.name,
      category: badge.category,
      description: badge.description,
      is_eagle_required: badge.is_eagle_required || false,
      is_active: badge.is_active !== false,
      image_url: badge.image_url,
      pamphlet_url: badge.pamphlet_url,
      active_version_year: badge.requirement_version_year,
      versions,
    }
  })

  // Group rank requirements by rank
  const rankReqsByRank = new Map<string, typeof rankRequirements>()
  for (const req of rankRequirements) {
    if (!rankReqsByRank.has(req.rank_id)) {
      rankReqsByRank.set(req.rank_id, [])
    }
    rankReqsByRank.get(req.rank_id)!.push(req)
  }

  // Build canonical ranks
  const canonicalRanks: CanonicalRank[] = ranks.map(rank => ({
    code: rank.code,
    name: rank.name,
    description: rank.description,
    display_order: rank.display_order,
    image_url: rank.image_url,
    is_eagle_required: rank.is_eagle_required || false,
    requirements: buildRankRequirementTree(rankReqsByRank.get(rank.id) || []),
  }))

  // Build canonical positions
  const canonicalPositions: CanonicalLeadershipPosition[] = positions.map(p => ({
    code: p.code,
    name: p.name,
    description: p.description,
    min_tenure_months: p.min_tenure_months,
    is_patrol_level: p.is_patrol_level || false,
    is_troop_level: p.is_troop_level || false,
    qualifies_for_star: p.qualifies_for_star || false,
    qualifies_for_life: p.qualifies_for_life || false,
    qualifies_for_eagle: p.qualifies_for_eagle || false,
  }))

  // Count total requirements (including nested)
  function countRequirements(reqs: CanonicalRequirement[]): number {
    return reqs.reduce((sum, r) => sum + 1 + countRequirements(r.children), 0)
  }
  function countRankRequirements(reqs: CanonicalRankRequirement[]): number {
    return reqs.reduce((sum, r) => sum + 1 + countRankRequirements(r.children), 0)
  }

  const totalBadgeReqs = canonicalBadges.reduce(
    (sum, b) => sum + b.versions.reduce((vsum, v) => vsum + countRequirements(v.requirements), 0),
    0
  )
  const totalRankReqs = canonicalRanks.reduce(
    (sum, r) => sum + countRankRequirements(r.requirements),
    0
  )
  const totalVersions = canonicalBadges.reduce((sum, b) => sum + b.versions.length, 0)

  // Build final structure
  const canonical: UnifiedCanonical = {
    exported_at: new Date().toISOString(),
    exported_from: isProd ? 'production' : 'development',
    version: '1.0.0',
    stats: {
      merit_badges: canonicalBadges.length,
      badge_versions: totalVersions,
      badge_requirements: totalBadgeReqs,
      ranks: canonicalRanks.length,
      rank_requirements: totalRankReqs,
      leadership_positions: canonicalPositions.length,
    },
    merit_badges: canonicalBadges,
    ranks: canonicalRanks,
    leadership_positions: canonicalPositions,
  }

  // Write to file
  const outputPath = path.join(process.cwd(), 'data', 'bsa-data-unified.json')
  fs.writeFileSync(outputPath, JSON.stringify(canonical, null, 2))

  console.log('')
  console.log('='.repeat(60))
  console.log('EXPORT COMPLETE')
  console.log('='.repeat(60))
  console.log(`Output: ${outputPath}`)
  console.log('')
  console.log('Stats:')
  console.log(`  Merit Badges: ${canonical.stats.merit_badges}`)
  console.log(`  Badge Versions: ${canonical.stats.badge_versions}`)
  console.log(`  Badge Requirements: ${canonical.stats.badge_requirements}`)
  console.log(`  Ranks: ${canonical.stats.ranks}`)
  console.log(`  Rank Requirements: ${canonical.stats.rank_requirements}`)
  console.log(`  Leadership Positions: ${canonical.stats.leadership_positions}`)
  console.log('')

  // Validate is_header counts
  let headersCount = 0
  let nonHeadersCount = 0
  function countHeaders(reqs: CanonicalRequirement[]) {
    for (const r of reqs) {
      if (r.is_header) headersCount++
      else nonHeadersCount++
      countHeaders(r.children)
    }
  }
  canonicalBadges.forEach(b => b.versions.forEach(v => countHeaders(v.requirements)))

  console.log('Header Analysis:')
  console.log(`  Requirements marked as headers: ${headersCount}`)
  console.log(`  Requirements NOT headers (trackable): ${nonHeadersCount}`)
  console.log(`  Header ratio: ${((headersCount / totalBadgeReqs) * 100).toFixed(1)}%`)
}

main().catch(console.error)
