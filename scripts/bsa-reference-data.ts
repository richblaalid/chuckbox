#!/usr/bin/env npx tsx

/**
 * BSA Reference Data Management CLI
 *
 * This script manages BSA official requirements data in the database.
 * Reference data is platform-level (not unit-specific) and versioned per-item.
 *
 * Configuration is centralized in seed-config.ts.
 *
 * Usage:
 *   npx tsx scripts/bsa-reference-data.ts import-all       # Import all data
 *   npx tsx scripts/bsa-reference-data.ts import-ranks     # Import rank requirements only
 *   npx tsx scripts/bsa-reference-data.ts import-badges    # Import merit badges only
 *   npx tsx scripts/bsa-reference-data.ts import-positions # Import leadership positions only
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import dotenv from 'dotenv'
import { BSA_SEED_CONFIG } from './seed-config'

// Detect --prod flag for environment switching
const isProd = process.argv.includes('--prod')
const envFile = isProd ? '.env.prod' : '.env.local'
dotenv.config({ path: envFile })

// Display which environment we're using
const envLabel = isProd ? '🔴 PRODUCTION' : '🟢 Development'
console.log(`Environment: ${envLabel}`)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.error(`Make sure ${envFile} is configured correctly`)
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const { versionYear, files, batchSize } = BSA_SEED_CONFIG

// Helper to read JSON files
function readJsonFile<T>(filename: string): T {
  const filepath = path.join(process.cwd(), 'data', filename)
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`)
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'))
}

// Helper to chunk arrays for batch operations
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

// Types for JSON files
interface LeadershipPosition {
  code: string
  name: string
  qualifies_for_star: boolean
  qualifies_for_life: boolean
  qualifies_for_eagle: boolean
  min_tenure_months: number
  is_patrol_level: boolean
  is_troop_level: boolean
  description: string
}

interface LeadershipFile {
  positions: LeadershipPosition[]
}

// Types for canonical data file (bsa-data-canonical-normalized.json)
interface CanonicalResourceLink {
  name: string
  url: string
  type: string
}

interface CanonicalRequirement {
  requirement_number: string
  scoutbook_id: string
  description: string
  is_header: boolean
  nesting_depth?: number
  display_order: number
  resources?: CanonicalResourceLink[]
  children: CanonicalRequirement[]
}

interface CanonicalBadgeVersion {
  version_year: number
  is_estimated?: boolean
  requirements: CanonicalRequirement[]
}

interface CanonicalMeritBadge {
  code: string
  name: string
  category: string
  description: string | null
  is_eagle_required: boolean
  is_active: boolean
  image_url: string
  requirement_version_year?: number
  versions: CanonicalBadgeVersion[]
}

// Types for canonical rank data (from bsa-data-canonical-normalized.json)
interface CanonicalRankRequirement {
  requirement_number: string
  description: string
  is_header: boolean
  display_order: number
  children?: CanonicalRankRequirement[]
}

interface CanonicalRankVersion {
  version_year: number
  requirements: CanonicalRankRequirement[]
}

interface CanonicalRank {
  code: string
  name: string
  description: string
  display_order: number
  image_url?: string
  is_eagle_required: boolean
  requirement_version_year: number
  versions: CanonicalRankVersion[]
}

interface CanonicalDataFile {
  generated?: string
  source?: string
  merit_badges: CanonicalMeritBadge[]
  ranks?: CanonicalRank[]
  leadership_positions?: unknown[]
}

/**
 * Import ranks from canonical normalized data file.
 * This function reads ranks from bsa-data-canonical-normalized.json (same file as merit badges)
 * and supports multiple version years per rank with nested requirement structure.
 *
 * Key differences from importRanks():
 * - Reads from normalized JSON with versions[] array instead of flat structure
 * - Handles nested children[] arrays (converted to parent_requirement_id)
 * - Supports multiple version years per rank (e.g., Second Class has both 2022 and 2016)
 */
async function importCanonicalRanks(filename?: string) {
  const file = filename || 'bsa-data-canonical-normalized.json'
  console.log('\n=== Importing Canonical Ranks ===')
  console.log(`  File: ${file}`)

  const data = readJsonFile<CanonicalDataFile>(file)

  if (!data.ranks || data.ranks.length === 0) {
    console.log('  No ranks found in canonical data file')
    return
  }

  console.log(`  Ranks: ${data.ranks.length}`)

  const totalVersions = data.ranks.reduce((sum, r) => sum + r.versions.length, 0)
  console.log(`  Rank versions: ${totalVersions}`)

  // Count all requirements (including nested)
  function countReqs(reqs: CanonicalRankRequirement[]): number {
    let count = 0
    for (const r of reqs) {
      count++
      if (r.children) count += countReqs(r.children)
    }
    return count
  }

  const totalReqs = data.ranks.reduce((sum, r) =>
    sum + r.versions.reduce((vsum, v) => vsum + countReqs(v.requirements), 0), 0)
  console.log(`  Total requirements: ${totalReqs}`)

  const startTime = Date.now()

  // Step 1: Upsert rank records
  const rankRecords = data.ranks.map(r => ({
    code: r.code,
    name: r.name,
    display_order: r.display_order,
    is_eagle_required: r.is_eagle_required,
    description: r.description,
    image_url: r.image_url,
    requirement_version_year: r.requirement_version_year,
  }))

  for (const batch of chunk(rankRecords, batchSize)) {
    const { error } = await supabase
      .from('bsa_ranks')
      .upsert(batch, { onConflict: 'code' })
    if (error) {
      console.error('Error upserting ranks:', error)
    }
  }
  console.log(`  Upserted ${rankRecords.length} ranks`)

  // Step 2: Get rank ID map
  const { data: ranks, error: ranksError } = await supabase
    .from('bsa_ranks')
    .select('id, code')

  if (ranksError || !ranks) {
    console.error('Error fetching ranks:', ranksError)
    return
  }

  const rankCodeToId = new Map(ranks.map(r => [r.code, r.id]))
  console.log(`  Found ${ranks.length} ranks in DB`)

  // Step 3: Flatten requirements tree by nesting level
  type FlatReq = {
    rankId: string
    versionYear: number
    number: string
    description: string
    parentNumber: string | null
    depth: number
    displayOrder: number
    isHeader: boolean
  }

  const requirementsByLevel = new Map<number, FlatReq[]>()
  let maxLevel = 0

  function flattenReqs(
    reqs: CanonicalRankRequirement[],
    rankId: string,
    versionYear: number,
    parentNumber: string | null,
    depth: number
  ) {
    for (const req of reqs) {
      maxLevel = Math.max(maxLevel, depth)

      if (!requirementsByLevel.has(depth)) {
        requirementsByLevel.set(depth, [])
      }

      requirementsByLevel.get(depth)!.push({
        rankId,
        versionYear,
        number: req.requirement_number,
        description: req.description,
        parentNumber,
        depth,
        displayOrder: req.display_order,
        isHeader: req.is_header,
      })

      if (req.children && req.children.length > 0) {
        flattenReqs(req.children, rankId, versionYear, req.requirement_number, depth + 1)
      }
    }
  }

  for (const rank of data.ranks) {
    const rankId = rankCodeToId.get(rank.code)
    if (!rankId) continue

    for (const version of rank.versions) {
      flattenReqs(version.requirements, rankId, version.version_year, null, 0)
    }
  }

  console.log(`  Max nesting depth: ${maxLevel}`)

  // Step 4: Delete existing requirements (to handle structure changes)
  // We delete and re-insert because the unique constraint includes sub_requirement_letter
  // which we're not using with the new canonical structure
  const versionYears = [...new Set(data.ranks.flatMap(r => r.versions.map(v => v.version_year)))]
  const rankIds = ranks.map(r => r.id)

  console.log('  Deleting existing requirements for these version years...')
  for (const versionYear of versionYears) {
    const { error } = await supabase
      .from('bsa_rank_requirements')
      .delete()
      .in('rank_id', rankIds)
      .eq('version_year', versionYear)
    if (error) {
      console.error(`Error deleting requirements for year ${versionYear}:`, error)
    }
  }

  // Step 5: Process level by level (insert only, since we deleted existing)
  const reqDbIdMap = new Map<string, string>()
  let totalInserted = 0

  for (let level = 0; level <= maxLevel; level++) {
    const levelReqs = requirementsByLevel.get(level) || []
    if (levelReqs.length === 0) continue

    const insertRecords: {
      version_year: number
      rank_id: string
      requirement_number: string
      parent_requirement_id: string | null
      description: string
      display_order: number
      sub_requirement_letter: string | null
      is_header: boolean
    }[] = []

    for (const req of levelReqs) {
      let parentId: string | null = null
      if (req.parentNumber) {
        const parentKey = `${req.rankId}:${req.versionYear}:${req.parentNumber}`
        parentId = reqDbIdMap.get(parentKey) || null
      }

      insertRecords.push({
        version_year: req.versionYear,
        rank_id: req.rankId,
        requirement_number: req.number,
        parent_requirement_id: parentId,
        description: req.description,
        display_order: req.displayOrder,
        sub_requirement_letter: null, // Not using legacy field
        is_header: req.isHeader,       // Headers are not completable
      })
    }

    // Insert this level's requirements
    for (const batch of chunk(insertRecords, batchSize)) {
      const { error } = await supabase
        .from('bsa_rank_requirements')
        .insert(batch)
      if (error) {
        console.error(`Error inserting level ${level}:`, error.message)
      }
    }
    totalInserted += insertRecords.length

    // Fetch inserted records to get their IDs for parent references
    let offset = 0
    const pageSize = 1000
    while (true) {
      const { data: inserted } = await supabase
        .from('bsa_rank_requirements')
        .select('id, rank_id, version_year, requirement_number')
        .in('rank_id', rankIds)
        .in('version_year', versionYears)
        .is('parent_requirement_id', level === 0 ? null : undefined)
        .range(offset, offset + pageSize - 1)

      if (!inserted || inserted.length === 0) break

      for (const row of inserted) {
        const key = `${row.rank_id}:${row.version_year}:${row.requirement_number}`
        reqDbIdMap.set(key, row.id)
      }

      if (inserted.length < pageSize) break
      offset += pageSize
    }

    console.log(`  Level ${level}: ${insertRecords.length} inserted`)
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`  Total: ${totalInserted} requirements inserted in ${elapsed}s`)
  console.log('\n=== Canonical Ranks Import Complete ===')
}

/**
 * Import leadership positions with bulk upsert
 */
async function importLeadershipPositions(filename?: string) {
  const file = filename || files.leadershipPositions
  console.log('\n=== Importing Leadership Positions ===')
  console.log(`  File: ${file}`)

  const data = readJsonFile<LeadershipFile>(file)

  const positionRecords = data.positions.map(position => ({
    code: position.code,
    name: position.name,
    qualifies_for_star: position.qualifies_for_star,
    qualifies_for_life: position.qualifies_for_life,
    qualifies_for_eagle: position.qualifies_for_eagle,
    min_tenure_months: position.min_tenure_months,
    is_patrol_level: position.is_patrol_level,
    is_troop_level: position.is_troop_level,
    description: position.description,
  }))

  const { error } = await supabase
    .from('bsa_leadership_positions')
    .upsert(positionRecords, { onConflict: 'code' })

  if (error) {
    console.error('Error upserting leadership positions:', error)
    return
  }

  console.log(`  Upserted ${positionRecords.length} leadership positions`)
  console.log('\n=== Leadership Positions Import Complete ===')
}

/**
 * Import merit badge requirements from canonical data file (bsa-data-canonical-normalized.json)
 *
 * This is the preferred method - uses normalized, validated data with proper
 * tree structure and scoutbook_id preservation for Scoutbook sync.
 *
 * The canonical file contains:
 * - 141 badges with full metadata
 * - Multiple versions per badge with hierarchical requirements
 * - Correct parent/child relationships already resolved
 * - scoutbook_id for Scoutbook upload/download compatibility
 */
async function importCanonicalMeritBadgeRequirements(filename?: string) {
  const file = filename || 'bsa-data-canonical-normalized.json'
  console.log('\n=== Importing Canonical Merit Badge Requirements ===')
  console.log(`  File: ${file}`)

  const data = readJsonFile<CanonicalDataFile>(file)
  console.log(`  Badges: ${data.merit_badges.length}`)

  const totalVersions = data.merit_badges.reduce((sum, b) => sum + b.versions.length, 0)
  console.log(`  Badge versions: ${totalVersions}`)

  // Count all requirements (including nested)
  function countReqs(reqs: CanonicalRequirement[]): number {
    let count = 0
    for (const r of reqs) {
      count++
      if (r.children) count += countReqs(r.children)
    }
    return count
  }

  const totalReqs = data.merit_badges.reduce((sum, b) =>
    sum + b.versions.reduce((vsum, v) => vsum + countReqs(v.requirements), 0), 0)
  console.log(`  Total requirements: ${totalReqs}`)

  const startTime = Date.now()

  // Step 0: Upsert badge records
  const badgeRecords = data.merit_badges.map(b => ({
    code: b.code,
    name: b.name,
    is_eagle_required: b.is_eagle_required,
    category: b.category,
    description: b.description,
    image_url: b.image_url,
    is_active: b.is_active ?? true,
  }))

  for (const batch of chunk(badgeRecords, batchSize)) {
    const { error } = await supabase
      .from('bsa_merit_badges')
      .upsert(batch, { onConflict: 'code' })
    if (error) {
      console.error('Error upserting badges:', error)
    }
  }
  console.log(`  Upserted ${badgeRecords.length} merit badges`)

  // Step 1: Get badge ID map
  const { data: badges, error: badgesError } = await supabase
    .from('bsa_merit_badges')
    .select('id, code')

  if (badgesError || !badges) {
    console.error('Error fetching badges:', badgesError)
    return
  }

  const badgeCodeToId = new Map(badges.map(b => [b.code, b.id]))
  console.log(`  Found ${badges.length} badges in DB`)

  // Step 2: Build version records
  const versionRecords: {
    merit_badge_id: string
    version_year: number
    is_current: boolean
    source: string
    scraped_at: string
  }[] = []

  const seenVersions = new Set<string>()
  for (const badge of data.merit_badges) {
    const badgeId = badgeCodeToId.get(badge.code)
    if (!badgeId) continue

    for (const version of badge.versions) {
      const versionKey = `${badgeId}:${version.version_year}`
      if (seenVersions.has(versionKey)) continue
      seenVersions.add(versionKey)

      // The active version is the one matching requirement_version_year
      const isActive = version.version_year === badge.requirement_version_year

      versionRecords.push({
        merit_badge_id: badgeId,
        version_year: version.version_year,
        is_current: isActive,
        source: 'scoutbook',  // Canonical data is derived from Scoutbook
        scraped_at: new Date().toISOString(),
      })
    }
  }

  for (const batch of chunk(versionRecords, batchSize)) {
    const { error } = await supabase
      .from('bsa_merit_badge_versions')
      .upsert(batch, { onConflict: 'merit_badge_id,version_year' })
    if (error) {
      console.error('Error upserting versions:', error)
    }
  }
  console.log(`  Upserted ${versionRecords.length} versions`)

  // Update badge requirement_version_year
  let badgesUpdated = 0
  for (const badge of data.merit_badges) {
    const badgeId = badgeCodeToId.get(badge.code)
    if (!badgeId || !badge.requirement_version_year) continue

    const { error } = await supabase
      .from('bsa_merit_badges')
      .update({ requirement_version_year: badge.requirement_version_year })
      .eq('id', badgeId)
    if (!error) badgesUpdated++
  }
  console.log(`  Updated ${badgesUpdated} badges with active version year`)

  // Step 3: Flatten requirements tree and collect by nesting level
  type FlatReq = {
    badgeId: string
    versionYear: number
    number: string
    scoutbookId: string
    description: string
    parentNumber: string | null
    depth: number
    displayOrder: number
    isHeader: boolean
  }

  const requirementsByLevel = new Map<number, FlatReq[]>()
  let maxLevel = 0

  function flattenReqs(
    reqs: CanonicalRequirement[],
    badgeId: string,
    versionYear: number,
    parentNumber: string | null,
    depth: number
  ) {
    for (const req of reqs) {
      maxLevel = Math.max(maxLevel, depth)

      if (!requirementsByLevel.has(depth)) {
        requirementsByLevel.set(depth, [])
      }

      requirementsByLevel.get(depth)!.push({
        badgeId,
        versionYear,
        number: req.requirement_number,
        scoutbookId: req.scoutbook_id,
        description: req.description,
        parentNumber,
        depth,
        displayOrder: req.display_order,
        isHeader: req.is_header,
      })

      if (req.children && req.children.length > 0) {
        flattenReqs(req.children, badgeId, versionYear, req.requirement_number, depth + 1)
      }
    }
  }

  for (const badge of data.merit_badges) {
    const badgeId = badgeCodeToId.get(badge.code)
    if (!badgeId) continue

    for (const version of badge.versions) {
      flattenReqs(version.requirements, badgeId, version.version_year, null, 0)
    }
  }

  console.log(`  Max nesting depth: ${maxLevel}`)

  // Step 4: Get existing requirements
  const existingReqMap = new Map<string, { id: string; is_header: boolean | null }>()
  console.log('  Fetching existing requirements...')

  let existingOffset = 0
  const existingPageSize = 1000
  while (true) {
    const { data: existingReqs } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('id, merit_badge_id, version_year, requirement_number, is_header')
      .range(existingOffset, existingOffset + existingPageSize - 1)

    if (!existingReqs || existingReqs.length === 0) break

    for (const row of existingReqs) {
      const key = `${row.merit_badge_id}:${row.version_year}:${row.requirement_number}`
      existingReqMap.set(key, { id: row.id, is_header: row.is_header })
    }

    if (existingReqs.length < existingPageSize) break
    existingOffset += existingPageSize
  }
  console.log(`  Found ${existingReqMap.size} existing requirements`)

  // Step 5: Process level by level
  const versionYears = [...new Set(data.merit_badges.flatMap(b => b.versions.map(v => v.version_year)))]
  const badgeIds = badges.map(b => b.id)

  const reqDbIdMap = new Map<string, string>()
  let totalInserted = 0
  let totalUpdated = 0

  for (let level = 0; level <= maxLevel; level++) {
    const levelReqs = requirementsByLevel.get(level) || []
    if (levelReqs.length === 0) continue

    const insertRecords: {
      merit_badge_id: string
      version_year: number
      requirement_number: string
      scoutbook_requirement_number: string
      description: string
      parent_requirement_id: string | null
      nesting_depth: number
      display_order: number
      is_header: boolean
    }[] = []

    const updateRecords: {
      id: string
      merit_badge_id: string
      version_year: number
      requirement_number: string
      scoutbook_requirement_number: string
      description: string
      parent_requirement_id: string | null
      nesting_depth: number
      display_order: number
      is_header: boolean
    }[] = []

    for (const req of levelReqs) {
      const reqKey = `${req.badgeId}:${req.versionYear}:${req.number}`
      const existing = existingReqMap.get(reqKey)

      let parentId: string | null = null
      if (req.parentNumber) {
        const parentKey = `${req.badgeId}:${req.versionYear}:${req.parentNumber}`
        parentId = reqDbIdMap.get(parentKey) || null
      }

      const record = {
        merit_badge_id: req.badgeId,
        version_year: req.versionYear,
        requirement_number: req.number,
        scoutbook_requirement_number: req.scoutbookId,
        description: req.description,
        parent_requirement_id: parentId,
        nesting_depth: req.depth,
        display_order: req.displayOrder,
        is_header: req.isHeader,
      }

      if (existing) {
        updateRecords.push({ id: existing.id, ...record })
        reqDbIdMap.set(reqKey, existing.id)
      } else {
        insertRecords.push(record)
      }
    }

    // Update existing
    if (updateRecords.length > 0) {
      for (const batch of chunk(updateRecords, batchSize)) {
        const { error } = await supabase
          .from('bsa_merit_badge_requirements')
          .upsert(batch, { onConflict: 'id' })
        if (error) {
          console.error(`Error updating level ${level}:`, error.message)
        }
      }
      totalUpdated += updateRecords.length
    }

    // Insert new
    if (insertRecords.length > 0) {
      for (const batch of chunk(insertRecords, batchSize)) {
        const { error } = await supabase
          .from('bsa_merit_badge_requirements')
          .insert(batch)
        if (error) {
          console.error(`Error inserting level ${level}:`, error.message)
        }
      }
      totalInserted += insertRecords.length

      // Fetch inserted records to get their IDs for parent references
      let offset = 0
      const pageSize = 1000
      while (true) {
        const { data: inserted } = await supabase
          .from('bsa_merit_badge_requirements')
          .select('id, merit_badge_id, version_year, requirement_number')
          .in('merit_badge_id', badgeIds)
          .in('version_year', versionYears)
          .eq('nesting_depth', level)
          .range(offset, offset + pageSize - 1)

        if (!inserted || inserted.length === 0) break

        for (const row of inserted) {
          const key = `${row.merit_badge_id}:${row.version_year}:${row.requirement_number}`
          reqDbIdMap.set(key, row.id)
        }

        if (inserted.length < pageSize) break
        offset += pageSize
      }
    }

    console.log(`  Level ${level}: ${insertRecords.length} inserted, ${updateRecords.length} updated`)
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`  Total: ${totalInserted} inserted, ${totalUpdated} updated in ${elapsed}s`)
  console.log('\n=== Canonical Requirements Import Complete ===')
}

/**
 * Import requirement resources from canonical data.
 * Must run AFTER importCanonicalMeritBadgeRequirements() so requirement IDs exist.
 *
 * Reads the `resources` array from each canonical requirement and inserts records
 * into bsa_requirement_resources linked by requirement_id.
 */
async function importRequirementResources(filename?: string) {
  const file = filename || 'bsa-data-canonical-normalized.json'
  console.log('\n=== Importing Requirement Resources ===')
  console.log(`  File: ${file}`)

  const data = readJsonFile<CanonicalDataFile>(file)
  const startTime = Date.now()

  // Collect all resources with their requirement lookup keys
  type ResourceEntry = {
    badgeCode: string
    versionYear: number
    requirementNumber: string
    resources: CanonicalResourceLink[]
  }

  const entries: ResourceEntry[] = []

  function collectResources(
    reqs: CanonicalRequirement[],
    badgeCode: string,
    versionYear: number
  ) {
    for (const req of reqs) {
      if (req.resources?.length) {
        entries.push({
          badgeCode,
          versionYear,
          requirementNumber: req.requirement_number,
          resources: req.resources,
        })
      }
      if (req.children) {
        collectResources(req.children, badgeCode, versionYear)
      }
    }
  }

  for (const badge of data.merit_badges) {
    for (const version of badge.versions) {
      collectResources(version.requirements, badge.code, version.version_year)
    }
  }

  const totalResources = entries.reduce((sum, e) => sum + e.resources.length, 0)
  console.log(`  Requirements with resources: ${entries.length}`)
  console.log(`  Total resource links: ${totalResources}`)

  if (entries.length === 0) {
    console.log('  No resources to import')
    return
  }

  // Get badge code -> ID map
  const { data: badges, error: badgesError } = await supabase
    .from('bsa_merit_badges')
    .select('id, code')

  if (badgesError || !badges) {
    console.error('Error fetching badges:', badgesError)
    return
  }

  const badgeCodeToId = new Map(badges.map(b => [b.code, b.id]))

  // Fetch all requirement IDs in batches (same pagination pattern as importCanonicalMeritBadgeRequirements)
  const reqIdMap = new Map<string, string>()
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data: reqs } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('id, merit_badge_id, version_year, requirement_number')
      .range(offset, offset + pageSize - 1)

    if (!reqs || reqs.length === 0) break

    for (const row of reqs) {
      reqIdMap.set(`${row.merit_badge_id}:${row.version_year}:${row.requirement_number}`, row.id)
    }

    if (reqs.length < pageSize) break
    offset += pageSize
  }
  console.log(`  Fetched ${reqIdMap.size} requirement IDs`)

  // Clear existing resources (idempotent - neq trick deletes all rows)
  const { error: deleteError } = await supabase
    .from('bsa_requirement_resources')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (deleteError) {
    console.error('Error clearing existing resources:', deleteError)
    return
  }

  // Build insert records by resolving badge codes and requirement numbers to database IDs
  const records: {
    requirement_id: string
    name: string
    url: string
    resource_type: string
    display_order: number
  }[] = []
  let unmatched = 0

  for (const entry of entries) {
    const badgeId = badgeCodeToId.get(entry.badgeCode)
    if (!badgeId) {
      unmatched++
      continue
    }

    const reqId = reqIdMap.get(`${badgeId}:${entry.versionYear}:${entry.requirementNumber}`)
    if (!reqId) {
      unmatched++
      continue
    }

    entry.resources.forEach((res, i) => {
      records.push({
        requirement_id: reqId,
        name: res.name,
        url: res.url,
        resource_type: res.type,
        display_order: i,
      })
    })
  }

  console.log(`  Records to insert: ${records.length}`)
  if (unmatched > 0) {
    console.log(`  Unmatched requirements: ${unmatched}`)
  }

  // Insert in batches
  let inserted = 0
  for (const batch of chunk(records, batchSize)) {
    const { error } = await supabase
      .from('bsa_requirement_resources')
      .insert(batch)
    if (error) {
      console.error('Error inserting resources:', error.message)
    } else {
      inserted += batch.length
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`  Inserted ${inserted} resource records in ${elapsed}s`)
  console.log('\n=== Requirement Resources Import Complete ===')
}

/**
 * Validate seeded BSA reference data integrity.
 * Throws an error if critical data is missing or incomplete.
 *
 * Expected counts (approximate):
 * - 141 merit badges with image_url and category
 * - 140+ rank requirements
 * - 11,000+ merit badge requirements
 * - 18 leadership positions
 */
async function validateSeedData(): Promise<{ valid: boolean; errors: string[] }> {
  console.log('\n=== Validating Seed Data ===')
  const errors: string[] = []

  // Check merit badges have required fields
  const { data: badgesWithoutImages } = await supabase
    .from('bsa_merit_badges')
    .select('code, name')
    .is('image_url', null)

  if (badgesWithoutImages && badgesWithoutImages.length > 0) {
    errors.push(`${badgesWithoutImages.length} badges missing image_url: ${badgesWithoutImages.slice(0, 3).map(b => b.code).join(', ')}...`)
  }

  const { data: badgesWithoutCategory } = await supabase
    .from('bsa_merit_badges')
    .select('code, name')
    .is('category', null)

  if (badgesWithoutCategory && badgesWithoutCategory.length > 0) {
    errors.push(`${badgesWithoutCategory.length} badges missing category: ${badgesWithoutCategory.slice(0, 3).map(b => b.code).join(', ')}...`)
  }

  // Check expected counts
  const { count: badgeCount } = await supabase
    .from('bsa_merit_badges')
    .select('*', { count: 'exact', head: true })

  if (!badgeCount || badgeCount < 140) {
    errors.push(`Expected 140+ merit badges, found ${badgeCount}`)
  }

  const { count: rankReqCount } = await supabase
    .from('bsa_rank_requirements')
    .select('*', { count: 'exact', head: true })

  if (!rankReqCount || rankReqCount < 140) {
    errors.push(`Expected 140+ rank requirements, found ${rankReqCount}`)
  }

  const { count: mbReqCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })

  if (!mbReqCount || mbReqCount < 10000) {
    errors.push(`Expected 10,000+ merit badge requirements, found ${mbReqCount}`)
  }

  const { count: positionCount } = await supabase
    .from('bsa_leadership_positions')
    .select('*', { count: 'exact', head: true })

  if (!positionCount || positionCount < 15) {
    errors.push(`Expected 15+ leadership positions, found ${positionCount}`)
  }

  // Report results
  if (errors.length > 0) {
    console.log('  ❌ Validation FAILED:')
    errors.forEach(e => console.log(`    - ${e}`))
  } else {
    console.log('  ✅ Validation passed:')
    console.log(`    - ${badgeCount} merit badges (all with images and categories)`)
    console.log(`    - ${rankReqCount} rank requirements`)
    console.log(`    - ${mbReqCount} merit badge requirements`)
    console.log(`    - ${positionCount} leadership positions`)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Import BSA reference data (ranks and leadership positions only)
 *
 * NOTE: Merit badge requirements are imported separately via
 * importCanonicalMeritBadgeRequirements() which uses
 * bsa-data-canonical-normalized.json
 */
async function importAll() {
  console.log('\n╔════════════════════════════════════════╗')
  console.log('║   BSA Reference Data Import            ║')
  console.log('║   (Ranks & Leadership Positions)       ║')
  console.log('╚════════════════════════════════════════╝')
  console.log(`\nConfiguration:`)
  console.log(`  Version Year: ${versionYear}`)
  console.log(`  Batch Size: ${batchSize}`)
  console.log(`  Files:`)
  console.log(`    Canonical Data: bsa-data-canonical-normalized.json`)
  console.log(`    Positions: ${files.leadershipPositions}`)
  console.log(`  Note: Merit badges imported separately via import-canonical-reqs`)

  const startTime = Date.now()

  // Use canonical ranks import (reads from normalized JSON with versioned structure)
  await importCanonicalRanks()
  await importLeadershipPositions()

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`\n✅ BSA Reference Data Imported in ${elapsed}s`)
}

// Export functions for use by other scripts (like db.ts)
export {
  importCanonicalRanks,                     // Uses bsa-data-canonical-normalized.json
  importLeadershipPositions,
  importCanonicalMeritBadgeRequirements,    // Uses bsa-data-canonical-normalized.json
  importRequirementResources,               // Uses bsa-data-canonical-normalized.json
  importAll,
  validateSeedData,
}

// CLI - only run when executed directly
const isMainModule = process.argv[1]?.includes('bsa-reference-data')

if (isMainModule) {
  // Filter out flags like --prod to get positional arguments
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
  const command = args[0]
  const arg1 = args[1] // Optional filename argument (not a flag)

  switch (command) {
    case 'import-all':
      importAll()
      break

    case 'import-canonical-ranks':
    case 'import-ranks':
      importCanonicalRanks(arg1)
      break

    case 'import-positions':
      importLeadershipPositions(arg1)
      break

    case 'import-canonical-reqs':
    case 'import-reqs':
      importCanonicalMeritBadgeRequirements(arg1)
      break

    case 'import-resources':
      importRequirementResources(arg1)
      break

    default:
      console.log(`
BSA Reference Data Management CLI

Usage:
  npx tsx scripts/bsa-reference-data.ts <command> [options] [--prod]

Commands:
  import-all                       Import ranks and leadership positions from canonical data
  import-canonical-ranks [file]    Import ranks from bsa-data-canonical-normalized.json
  import-canonical-reqs [file]     Import merit badge requirements from canonical data
  import-positions [filename]      Import leadership positions
  import-resources [file]          Import requirement resources from canonical data

Options:
  --prod                           Use production database (.env.prod)

Data Source:
  All BSA reference data comes from: bsa-data-canonical-normalized.json
  Leadership positions from: ${files.leadershipPositions}

Examples:
  npx tsx scripts/bsa-reference-data.ts import-all
  npx tsx scripts/bsa-reference-data.ts import-all --prod
  npx tsx scripts/bsa-reference-data.ts import-canonical-reqs
`)
  }
}
