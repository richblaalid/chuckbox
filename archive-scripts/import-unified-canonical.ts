#!/usr/bin/env npx tsx
/**
 * Import Unified Canonical BSA Data
 *
 * Imports the single source of truth JSON file containing:
 * - Merit badges with all versions and requirements (is_header pre-computed)
 * - Ranks with requirements
 * - Leadership positions
 *
 * Usage:
 *   npx tsx scripts/import-unified-canonical.ts
 *   npx tsx scripts/import-unified-canonical.ts --prod  # Import to production
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

// Check for --prod flag
const isProd = process.argv.includes('--prod')
const envFile = isProd ? '.env.prod' : '.env.local'
dotenv.config({ path: envFile })

console.log(`Importing to: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'}`)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Types matching the unified canonical format
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

// Flatten hierarchical requirements into levels for batch insert
interface FlatRequirement {
  tempId: string // Temporary ID for parent linking
  parentTempId: string | null
  version_year: number
  merit_badge_id: string
  requirement_number: string
  sub_requirement_letter: string | null
  description: string
  display_order: number
  is_header: boolean
  is_alternative: boolean
  alternatives_group: string | null
  required_count: number | null
  scoutbook_requirement_number: string | null
  nesting_depth: number
}

function flattenRequirementsByLevel(
  requirements: CanonicalRequirement[],
  badgeId: string,
  versionYear: number,
  parentTempId: string | null = null,
  depth: number = 1,
  counter: { value: number } = { value: 0 }
): FlatRequirement[] {
  const flat: FlatRequirement[] = []

  for (const req of requirements) {
    const tempId = `${badgeId}:${versionYear}:${counter.value++}`

    flat.push({
      tempId,
      parentTempId,
      version_year: versionYear,
      merit_badge_id: badgeId,
      requirement_number: req.requirement_number,
      sub_requirement_letter: req.sub_requirement_letter,
      description: req.description,
      display_order: req.display_order,
      is_header: req.is_header,
      is_alternative: req.is_alternative,
      alternatives_group: req.alternatives_group,
      required_count: req.required_count,
      scoutbook_requirement_number: req.scoutbook_id,
      nesting_depth: depth,
    })

    if (req.children.length > 0) {
      flat.push(
        ...flattenRequirementsByLevel(req.children, badgeId, versionYear, tempId, depth + 1, counter)
      )
    }
  }

  return flat
}

async function batchInsert<T extends Record<string, unknown>>(
  table: string,
  records: T[],
  batchSize: number = 500
): Promise<void> {
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const { error } = await supabase.from(table).insert(batch)
    if (error) {
      console.error(`  Batch insert error (${table}):`, error.message)
    }
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('IMPORT UNIFIED CANONICAL BSA DATA')
  console.log('='.repeat(60))
  console.log('')

  // Load canonical file
  const filePath = path.join(process.cwd(), 'data', 'bsa-data-unified.json')
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    console.error('Run export-unified-canonical.ts first to create this file.')
    process.exit(1)
  }

  console.log(`Loading: ${filePath}`)
  const canonical: UnifiedCanonical = JSON.parse(fs.readFileSync(filePath, 'utf-8'))

  console.log(`Source: ${canonical.exported_from} (exported ${canonical.exported_at})`)
  console.log(`Version: ${canonical.version}`)
  console.log('')
  console.log('Stats from file:')
  console.log(`  Merit Badges: ${canonical.stats.merit_badges}`)
  console.log(`  Badge Versions: ${canonical.stats.badge_versions}`)
  console.log(`  Badge Requirements: ${canonical.stats.badge_requirements}`)
  console.log(`  Ranks: ${canonical.stats.ranks}`)
  console.log(`  Rank Requirements: ${canonical.stats.rank_requirements}`)
  console.log(`  Leadership Positions: ${canonical.stats.leadership_positions}`)
  console.log('')

  // === IMPORT LEADERSHIP POSITIONS ===
  console.log('Importing leadership positions...')
  const positionsToUpsert = canonical.leadership_positions.map(p => ({
    code: p.code,
    name: p.name,
    description: p.description,
    min_tenure_months: p.min_tenure_months,
    is_patrol_level: p.is_patrol_level,
    is_troop_level: p.is_troop_level,
    qualifies_for_star: p.qualifies_for_star,
    qualifies_for_life: p.qualifies_for_life,
    qualifies_for_eagle: p.qualifies_for_eagle,
  }))

  const { error: posError } = await supabase
    .from('bsa_leadership_positions')
    .upsert(positionsToUpsert, { onConflict: 'code' })

  if (posError) {
    console.error('Error upserting positions:', posError)
  } else {
    console.log(`  Upserted ${positionsToUpsert.length} leadership positions`)
  }

  // === IMPORT RANKS ===
  console.log('Importing ranks...')

  const ranksToUpsert = canonical.ranks.map(r => ({
    code: r.code,
    name: r.name,
    description: r.description,
    display_order: r.display_order,
    image_url: r.image_url,
    is_eagle_required: r.is_eagle_required,
  }))

  const { error: rankError } = await supabase
    .from('bsa_ranks')
    .upsert(ranksToUpsert, { onConflict: 'code' })

  if (rankError) {
    console.error('Error upserting ranks:', rankError)
  } else {
    console.log(`  Upserted ${ranksToUpsert.length} ranks`)
  }

  // Get rank IDs
  const { data: dbRanks } = await supabase.from('bsa_ranks').select('id, code')
  const rankIdByCode = new Map(dbRanks?.map(r => [r.code, r.id]) || [])

  // Clear existing rank requirements
  console.log('  Clearing existing rank requirements...')
  await supabase.from('bsa_rank_requirements').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  // Flatten and batch insert rank requirements level by level
  console.log('  Inserting rank requirements...')
  interface FlatRankReq {
    tempId: string
    parentTempId: string | null
    rank_id: string
    requirement_number: string
    description: string
    display_order: number
  }

  const allRankReqs: FlatRankReq[] = []

  for (const rank of canonical.ranks) {
    const rankId = rankIdByCode.get(rank.code)
    if (!rankId) continue

    let displayOrder = 1
    let counter = 0

    function flatten(
      reqs: CanonicalRankRequirement[],
      parentTempId: string | null
    ): void {
      for (const req of reqs) {
        const tempId = `${rankId}:${counter++}`
        allRankReqs.push({
          tempId,
          parentTempId,
          rank_id: rankId,
          requirement_number: req.requirement_number,
          description: req.description,
          display_order: displayOrder++,
        })
        if (req.children.length > 0) {
          flatten(req.children, tempId)
        }
      }
    }
    flatten(rank.requirements, null)
  }

  // Insert level 0 (no parent)
  const level0RankReqs = allRankReqs.filter(r => !r.parentTempId)
  const level0Insert = level0RankReqs.map(r => ({
    rank_id: r.rank_id,
    requirement_number: r.requirement_number,
    description: r.description,
    display_order: r.display_order,
    parent_requirement_id: null,
  }))

  await batchInsert('bsa_rank_requirements', level0Insert)

  // Get inserted IDs
  const { data: insertedRankReqs } = await supabase
    .from('bsa_rank_requirements')
    .select('id, rank_id, requirement_number')

  const rankReqIdMap = new Map<string, string>()
  for (const r of insertedRankReqs || []) {
    // Find matching tempId
    const match = level0RankReqs.find(
      lr => lr.rank_id === r.rank_id && lr.requirement_number === r.requirement_number
    )
    if (match) {
      rankReqIdMap.set(match.tempId, r.id)
    }
  }

  // Insert level 1+ (have parent)
  const level1RankReqs = allRankReqs.filter(r => r.parentTempId)
  if (level1RankReqs.length > 0) {
    const level1Insert = level1RankReqs.map(r => ({
      rank_id: r.rank_id,
      requirement_number: r.requirement_number,
      description: r.description,
      display_order: r.display_order,
      parent_requirement_id: r.parentTempId ? rankReqIdMap.get(r.parentTempId) || null : null,
    }))
    await batchInsert('bsa_rank_requirements', level1Insert)
  }

  const { count: rankReqCount } = await supabase
    .from('bsa_rank_requirements')
    .select('*', { count: 'exact', head: true })
  console.log(`  Inserted ${rankReqCount} rank requirements`)

  // === IMPORT MERIT BADGES ===
  console.log('Importing merit badges...')

  const badgesToUpsert = canonical.merit_badges.map(b => ({
    code: b.code,
    name: b.name,
    category: b.category,
    description: b.description,
    is_eagle_required: b.is_eagle_required,
    is_active: b.is_active,
    image_url: b.image_url,
    pamphlet_url: b.pamphlet_url,
    requirement_version_year: b.active_version_year,
  }))

  const { error: badgeError } = await supabase
    .from('bsa_merit_badges')
    .upsert(badgesToUpsert, { onConflict: 'code' })

  if (badgeError) {
    console.error('Error upserting badges:', badgeError)
  } else {
    console.log(`  Upserted ${badgesToUpsert.length} merit badges`)
  }

  // Get badge IDs
  const { data: dbBadges } = await supabase.from('bsa_merit_badges').select('id, code')
  const badgeIdByCode = new Map(dbBadges?.map(b => [b.code, b.id]) || [])

  // Clear existing requirements
  console.log('  Clearing existing merit badge requirements...')
  await supabase
    .from('bsa_merit_badge_requirements')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  // Flatten all requirements
  console.log('  Flattening requirements...')
  const allReqs: FlatRequirement[] = []

  for (const badge of canonical.merit_badges) {
    const badgeId = badgeIdByCode.get(badge.code)
    if (!badgeId) continue

    for (const version of badge.versions) {
      const flat = flattenRequirementsByLevel(version.requirements, badgeId, version.version_year)
      allReqs.push(...flat)
    }
  }

  console.log(`  Total requirements to insert: ${allReqs.length}`)

  // Group by nesting depth for level-by-level insert
  const byDepth = new Map<number, FlatRequirement[]>()
  for (const req of allReqs) {
    if (!byDepth.has(req.nesting_depth)) {
      byDepth.set(req.nesting_depth, [])
    }
    byDepth.get(req.nesting_depth)!.push(req)
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b)
  console.log(`  Depth levels: ${depths.join(', ')}`)

  // Map tempId -> actual DB id
  const tempIdToDbId = new Map<string, string>()

  // Insert level by level
  for (const depth of depths) {
    const levelReqs = byDepth.get(depth)!
    console.log(`  Inserting depth ${depth}: ${levelReqs.length} requirements...`)

    // Build insert records with resolved parent IDs
    const toInsert = levelReqs.map(r => ({
      version_year: r.version_year,
      merit_badge_id: r.merit_badge_id,
      requirement_number: r.requirement_number,
      sub_requirement_letter: r.sub_requirement_letter,
      description: r.description,
      display_order: r.display_order,
      is_header: r.is_header,
      is_alternative: r.is_alternative,
      alternatives_group: r.alternatives_group,
      required_count: r.required_count,
      scoutbook_requirement_number: r.scoutbook_requirement_number,
      nesting_depth: r.nesting_depth,
      parent_requirement_id: r.parentTempId ? tempIdToDbId.get(r.parentTempId) || null : null,
    }))

    // Batch insert
    const BATCH_SIZE = 500
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE)
      const batchReqs = levelReqs.slice(i, i + BATCH_SIZE)

      const { data, error } = await supabase
        .from('bsa_merit_badge_requirements')
        .insert(batch)
        .select('id, merit_badge_id, version_year, requirement_number, sub_requirement_letter')

      if (error) {
        console.error(`    Batch error at depth ${depth}:`, error.message)
      } else if (data) {
        // Map tempIds to actual IDs
        for (let j = 0; j < data.length && j < batchReqs.length; j++) {
          tempIdToDbId.set(batchReqs[j].tempId, data[j].id)
        }
      }

      process.stdout.write(`    Processed ${Math.min(i + BATCH_SIZE, toInsert.length)}/${toInsert.length}...\r`)
    }
    console.log(`    Inserted ${toInsert.length} at depth ${depth}                    `)
  }

  // === SUMMARY ===
  console.log('')
  console.log('='.repeat(60))
  console.log('IMPORT COMPLETE')
  console.log('='.repeat(60))

  // Verify counts
  const { count: badgeCount } = await supabase
    .from('bsa_merit_badges')
    .select('*', { count: 'exact', head: true })

  const { count: reqCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })

  const { count: headerCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .eq('is_header', true)

  const { count: finalRankCount } = await supabase
    .from('bsa_ranks')
    .select('*', { count: 'exact', head: true })

  const { count: finalRankReqCount } = await supabase
    .from('bsa_rank_requirements')
    .select('*', { count: 'exact', head: true })

  const { count: posCount } = await supabase
    .from('bsa_leadership_positions')
    .select('*', { count: 'exact', head: true })

  console.log('')
  console.log('Database now contains:')
  console.log(`  Merit Badges: ${badgeCount}`)
  console.log(`  Badge Requirements: ${reqCount} (${headerCount} headers)`)
  console.log(`  Ranks: ${finalRankCount}`)
  console.log(`  Rank Requirements: ${finalRankReqCount}`)
  console.log(`  Leadership Positions: ${posCount}`)
}

main().catch(console.error)
