#!/usr/bin/env npx tsx
/**
 * Import Unified Canonical Data
 *
 * Imports BSA reference data from bsa-data-unified.json into the database.
 * Uses Scoutbook's exact requirement IDs with full hierarchical structure.
 *
 * This ensures imports from Scoutbook exports match 100% while preserving
 * parent-child requirement relationships and header descriptions.
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const BATCH_SIZE = 500

// Unified export requirement structure
interface UnifiedRequirement {
  requirement_number: string
  sub_requirement_letter: string | null
  description: string | null
  display_order: number
  is_header: boolean
  is_alternative: boolean
  alternatives_group: string | null
  required_count: number | null
  scoutbook_id: string | null
  children: UnifiedRequirement[]
}

interface UnifiedVersion {
  version_year: number
  requirements: UnifiedRequirement[]
}

interface UnifiedBadge {
  code: string
  name: string
  category: string | null
  description: string | null
  is_eagle_required: boolean
  is_active: boolean
  image_url: string | null
  pamphlet_url: string | null
  active_version_year: number
  versions: UnifiedVersion[]
}

interface FlatRequirement {
  temp_id: string
  merit_badge_id: string
  version_year: number
  requirement_number: string
  scoutbook_requirement_number: string | null
  description: string | null
  is_header: boolean
  display_order: number
  parent_temp_id: string | null
  depth: number
}

function flattenRequirements(
  requirements: UnifiedRequirement[],
  badgeId: string,
  versionYear: number,
  parentTempId: string | null = null,
  depth: number = 1,
  counter: { value: number } = { value: 0 }
): FlatRequirement[] {
  const result: FlatRequirement[] = []

  for (const req of requirements) {
    counter.value++
    const tempId = `${badgeId}:${versionYear}:${counter.value}`

    result.push({
      temp_id: tempId,
      merit_badge_id: badgeId,
      version_year: versionYear,
      requirement_number: req.requirement_number,
      scoutbook_requirement_number: req.scoutbook_id,
      description: req.description,
      is_header: req.is_header || (req.children && req.children.length > 0) || false,
      display_order: req.display_order,
      parent_temp_id: parentTempId,
      depth,
    })

    if (req.children && req.children.length > 0) {
      result.push(...flattenRequirements(req.children, badgeId, versionYear, tempId, depth + 1, counter))
    }
  }

  return result
}

async function importData() {
  console.log('='.repeat(60))
  console.log('IMPORT UNIFIED CANONICAL BSA DATA')
  console.log('='.repeat(60))
  console.log('')

  // Load the canonical data (merged from unified hierarchy + Scoutbook IDs)
  const dataPath = path.join(process.cwd(), 'data/bsa-data-canonical.json')
  if (!fs.existsSync(dataPath)) {
    console.error(`Data file not found: ${dataPath}`)
    process.exit(1)
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
  console.log(`Loaded: ${dataPath}`)
  console.log(`Source: ${data.source || 'unknown'} (exported ${data.exported_at})`)
  console.log(`Version: ${data.version}`)
  console.log('')
  console.log('Stats from file:')
  console.log(`  Merit Badges: ${data.stats.merit_badges}`)
  console.log(`  Badge Versions: ${data.stats.badge_versions}`)
  console.log(`  Badge Requirements: ${data.stats.badge_requirements}`)
  console.log(`  Ranks: ${data.stats.ranks}`)
  console.log(`  Rank Requirements: ${data.stats.rank_requirements}`)
  console.log(`  Leadership Positions: ${data.stats.leadership_positions}`)
  console.log('')

  // Step 1: Import leadership positions
  console.log('Importing leadership positions...')
  if (data.leadership_positions && data.leadership_positions.length > 0) {
    const { error } = await supabase.from('bsa_leadership_positions').upsert(
      data.leadership_positions.map((l: any) => ({
        code: l.code,
        name: l.name,
        min_tenure_months: l.min_tenure_months ?? 4,
        qualifies_for_star: l.qualifies_for_star ?? false,
        qualifies_for_life: l.qualifies_for_life ?? false,
        qualifies_for_eagle: l.qualifies_for_eagle ?? false,
        is_patrol_level: l.is_patrol_level ?? false,
        is_troop_level: l.is_troop_level ?? false,
        description: l.description ?? null,
      })),
      { onConflict: 'code' }
    )
    if (error) console.error('  Error:', error.message)
    else console.log(`  Upserted ${data.leadership_positions.length} leadership positions`)
  }

  // Step 2: Import ranks - create if they don't exist, then import requirements
  console.log('Importing ranks...')
  if (data.ranks && data.ranks.length > 0) {
    // First, upsert ranks themselves
    console.log('  Upserting rank records...')
    const ranksToUpsert = data.ranks.map((r: any, idx: number) => ({
      code: r.code,
      name: r.name,
      description: r.description || null,
      display_order: r.display_order || idx + 1,
      image_url: r.image_url || null,
      is_eagle_required: r.is_eagle_required ?? false,
      requirement_version_year: r.requirement_version_year,
    }))

    const { error: rankUpsertError } = await supabase
      .from('bsa_ranks')
      .upsert(ranksToUpsert, { onConflict: 'code' })

    if (rankUpsertError) {
      console.error('  Error upserting ranks:', rankUpsertError.message)
    } else {
      console.log(`  Upserted ${ranksToUpsert.length} ranks`)
    }

    // Now look up rank IDs
    const { data: existingRanks, error: rankLookupError } = await supabase
      .from('bsa_ranks')
      .select('id, code, name')

    if (rankLookupError || !existingRanks) {
      console.error('  Error looking up ranks:', rankLookupError?.message)
    } else {
      const rankIdByCode = new Map(existingRanks.map(r => [r.code, r.id]))
      console.log(`  Found ${existingRanks.length} ranks in database`)

      // Clear and re-insert rank requirements
      console.log('  Clearing existing rank requirements...')
      const { count: rankReqDeleteCount } = await supabase
        .from('bsa_rank_requirements')
        .delete({ count: 'exact' })
        .gt('id', '00000000-0000-0000-0000-000000000000')
      console.log(`  Deleted ${rankReqDeleteCount} existing rank requirements`)

      console.log('  Inserting rank requirements...')

      // Collect all requirements with metadata for two-pass insert
      interface RankReqData {
        rank_id: string
        version_year: number
        requirement_number: string
        description: string
        display_order: number
        is_header: boolean
        temp_key: string // For parent lookup: "rankId:version:reqNum"
        parent_key: string | null // Parent's temp_key if this is a child
      }

      const allRankReqs: RankReqData[] = []
      for (const rank of data.ranks) {
        const rankId = rankIdByCode.get(rank.code)
        if (!rankId) {
          console.warn(`    WARNING: No database entry for rank "${rank.name}" (${rank.code})`)
          continue
        }

        // Handle versions array (new structure) or flat requirements (legacy)
        const versions = rank.versions || [{
          version_year: rank.requirement_version_year,
          requirements: rank.requirements || []
        }]

        for (const version of versions) {
          let displayOrder = 0
          for (const req of version.requirements || []) {
            displayOrder++

            // Determine parent key: "2a" -> parent is "2"
            let parentKey: string | null = null
            const match = req.requirement_number.match(/^(\d+)[a-z]/)
            if (match) {
              const parentNum = match[1]
              // Only set parent if parent exists as a header in this version
              const parentReq = version.requirements.find(
                (r: any) => r.requirement_number === parentNum && r.is_header
              )
              if (parentReq) {
                parentKey = `${rankId}:${version.version_year}:${parentNum}`
              }
            }

            allRankReqs.push({
              rank_id: rankId,
              version_year: version.version_year,
              requirement_number: req.requirement_number,
              description: req.description,
              display_order: req.display_order || displayOrder,
              is_header: req.is_header || false,
              temp_key: `${rankId}:${version.version_year}:${req.requirement_number}`,
              parent_key: parentKey,
            })
          }
        }
      }

      // Two-pass insert: headers first, then children
      const tempKeyToId = new Map<string, string>()

      // Pass 1: Insert headers (no parent)
      const headers = allRankReqs.filter(r => r.is_header)
      for (let i = 0; i < headers.length; i += BATCH_SIZE) {
        const batch = headers.slice(i, i + BATCH_SIZE)
        const insertData = batch.map(r => ({
          rank_id: r.rank_id,
          version_year: r.version_year,
          requirement_number: r.requirement_number,
          description: r.description,
          display_order: r.display_order,
          parent_requirement_id: null,
        }))

        const { data: inserted, error } = await supabase
          .from('bsa_rank_requirements')
          .insert(insertData)
          .select('id, requirement_number, rank_id, version_year')

        if (error) {
          console.error(`  Header batch error:`, error.message)
        } else if (inserted) {
          for (let j = 0; j < inserted.length; j++) {
            tempKeyToId.set(batch[j].temp_key, inserted[j].id)
          }
        }
      }
      console.log(`  Inserted ${headers.length} header requirements`)

      // Pass 2: Insert non-headers with parent references
      const children = allRankReqs.filter(r => !r.is_header)
      for (let i = 0; i < children.length; i += BATCH_SIZE) {
        const batch = children.slice(i, i + BATCH_SIZE)
        const insertData = batch.map(r => ({
          rank_id: r.rank_id,
          version_year: r.version_year,
          requirement_number: r.requirement_number,
          description: r.description,
          display_order: r.display_order,
          parent_requirement_id: r.parent_key ? tempKeyToId.get(r.parent_key) || null : null,
        }))

        const { error } = await supabase.from('bsa_rank_requirements').insert(insertData)
        if (error) console.error(`  Child batch error:`, error.message)
      }
      console.log(`  Inserted ${children.length} child requirements`)
      console.log(`  Total: ${allRankReqs.length} rank requirements`)
    }
  }

  // Step 3: Create/update merit badges, then get IDs
  console.log('Importing merit badges...')
  const badges: UnifiedBadge[] = data.merit_badges

  // First, upsert all badges
  console.log('  Upserting badge records...')
  const badgesToUpsert = badges.map((b: any) => ({
    code: b.code,
    name: b.name,
    category: b.category || null,
    description: b.description || null,
    is_eagle_required: b.is_eagle_required ?? false,
    is_active: b.is_active ?? true,
    image_url: b.image_url || null,
    requirement_version_year: b.requirement_version_year || Math.max(...b.versions.map((v: any) => v.version_year)),
  }))

  // Batch upsert badges
  for (let i = 0; i < badgesToUpsert.length; i += BATCH_SIZE) {
    const batch = badgesToUpsert.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('bsa_merit_badges')
      .upsert(batch, { onConflict: 'code' })
    if (error) console.error('  Badge upsert error:', error.message)
  }
  console.log(`  Upserted ${badgesToUpsert.length} badges`)

  // Now look up badge IDs
  console.log('  Looking up badge IDs...')
  const { data: existingBadges, error: badgeLookupError } = await supabase
    .from('bsa_merit_badges')
    .select('id, code, name')

  if (badgeLookupError || !existingBadges) {
    console.error('  Error looking up badges:', badgeLookupError?.message)
    process.exit(1)
  }

  const badgeIdByCode = new Map(existingBadges.map(b => [b.code, b.id]))
  const badgeIdByName = new Map(existingBadges.map(b => [b.name.toLowerCase(), b.id]))
  console.log(`  Found ${existingBadges.length} badges in database`)

  // Step 3b: Create/update badge versions
  console.log('Importing badge versions...')
  const versionRecords: {
    merit_badge_id: string
    version_year: number
    is_current: boolean
    source: string
    scraped_at: string
  }[] = []

  for (const badge of badges) {
    const badgeId = badgeIdByCode.get(badge.code) || badgeIdByName.get(badge.name.toLowerCase())
    if (!badgeId) continue

    for (const version of badge.versions) {
      const isCurrent = badge.active_version_year === version.version_year ||
        (badge.versions.length === 1) ||
        (version.version_year === Math.max(...badge.versions.map(v => v.version_year)))

      versionRecords.push({
        merit_badge_id: badgeId,
        version_year: version.version_year,
        is_current: isCurrent,
        source: 'scoutbook',
        scraped_at: new Date().toISOString(),
      })
    }
  }

  for (let i = 0; i < versionRecords.length; i += BATCH_SIZE) {
    const batch = versionRecords.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('bsa_merit_badge_versions')
      .upsert(batch, { onConflict: 'merit_badge_id,version_year' })
    if (error) console.error('  Version upsert error:', error.message)
  }
  console.log(`  Upserted ${versionRecords.length} badge versions`)

  // Step 4: Clear existing merit badge requirements
  console.log('Clearing existing merit badge requirements...')
  const { error: deleteError, count: deleteCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .delete({ count: 'exact' })
    .gt('id', '00000000-0000-0000-0000-000000000000')

  if (deleteError) {
    console.error('  Delete error:', deleteError.message)
  } else {
    console.log(`  Deleted ${deleteCount} existing requirements`)
  }

  // Step 5: Flatten and insert merit badge requirements
  console.log('Inserting merit badge requirements...')

  const allFlatReqs: FlatRequirement[] = []
  let skippedBadges = 0

  for (const badge of badges) {
    // Look up badge ID by code or name
    let badgeId = badgeIdByCode.get(badge.code)
    if (!badgeId) {
      badgeId = badgeIdByName.get(badge.name.toLowerCase())
    }

    if (!badgeId) {
      console.warn(`  WARNING: No database entry for badge "${badge.name}" (${badge.code})`)
      skippedBadges++
      continue
    }

    for (const version of badge.versions) {
      const flat = flattenRequirements(version.requirements, badgeId, version.version_year)
      allFlatReqs.push(...flat)
    }
  }

  if (skippedBadges > 0) {
    console.log(`  Skipped ${skippedBadges} badges not found in database`)
  }

  console.log(`  Flattened ${allFlatReqs.length} requirements`)

  // Group by depth for level-by-level insertion (to handle parent_requirement_id)
  const maxDepth = Math.max(...allFlatReqs.map((r) => r.depth))
  const tempIdToRealId = new Map<string, string>()

  let insertedCount = 0
  for (let depth = 1; depth <= maxDepth; depth++) {
    const levelReqs = allFlatReqs.filter((r) => r.depth === depth)
    if (levelReqs.length === 0) continue

    // Insert in batches
    for (let i = 0; i < levelReqs.length; i += BATCH_SIZE) {
      const batch = levelReqs.slice(i, i + BATCH_SIZE)

      const insertData = batch.map((req) => ({
        merit_badge_id: req.merit_badge_id,
        version_year: req.version_year,
        requirement_number: req.requirement_number,
        scoutbook_requirement_number: req.scoutbook_requirement_number,
        description: req.description,
        is_header: req.is_header,
        display_order: req.display_order,
        parent_requirement_id: req.parent_temp_id ? tempIdToRealId.get(req.parent_temp_id) || null : null,
      }))

      const { data: inserted, error } = await supabase
        .from('bsa_merit_badge_requirements')
        .insert(insertData)
        .select('id, requirement_number, merit_badge_id, version_year')

      if (error) {
        console.error(`  Insert error at depth ${depth}:`, error.message)
      } else if (inserted) {
        // Map temp IDs to real IDs for parent references
        for (let j = 0; j < inserted.length; j++) {
          const req = batch[j]
          tempIdToRealId.set(req.temp_id, inserted[j].id)
        }
        insertedCount += inserted.length
      }
    }

    process.stdout.write(`  Processed depth ${depth}: ${levelReqs.length} requirements\r`)
  }

  console.log('')
  console.log(`  Inserted ${insertedCount} merit badge requirements`)

  // Stats summary
  const { count: headerCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .eq('is_header', true)

  const { count: withParentCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .not('parent_requirement_id', 'is', null)

  console.log('')
  console.log('Database stats:')
  console.log(`  Headers (is_header=true): ${headerCount}`)
  console.log(`  With parent_requirement_id: ${withParentCount}`)

  console.log('')
  console.log('='.repeat(60))
  console.log('IMPORT COMPLETE')
  console.log('='.repeat(60))
}

importData().catch(console.error)
