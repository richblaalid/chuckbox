#!/usr/bin/env npx tsx
/**
 * Import Full Database Script
 *
 * Imports BSA reference data from JSON exports to the database.
 * Handles foreign key relationships by importing in the correct order.
 * Processes hierarchical data (requirements) level by level.
 *
 * Usage:
 *   npx tsx scripts/import-full-db.ts              # Import to dev (DRY RUN)
 *   npx tsx scripts/import-full-db.ts --prod       # Import to prod (DRY RUN)
 *   npx tsx scripts/import-full-db.ts --prod --confirm  # Actually import to prod
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

// Detect flags
const isProd = process.argv.includes('--prod')
const isConfirmed = process.argv.includes('--confirm')
const envFile = isProd ? '.env.prod' : '.env.local'
dotenv.config({ path: envFile })

// Display which environment we're using
const envLabel = isProd ? '🔴 PRODUCTION' : '🟢 Development'
console.log(`Environment: ${envLabel}`)

if (isProd && !isConfirmed) {
  console.log('\n⚠️  DRY RUN MODE - No changes will be made')
  console.log('   Add --confirm to actually import data')
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(`Missing environment variables. Ensure ${envFile} is configured.`)
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const EXPORT_DIR = path.join(process.cwd(), 'data', 'dev-export')
const BATCH_SIZE = 500

// Tables in import order (parents before children)
const IMPORT_ORDER = [
  'bsa_ranks',
  'bsa_merit_badges',
  'bsa_leadership_positions',
  'bsa_rank_requirements',
  'bsa_merit_badge_versions',
  // bsa_merit_badge_requirements handled specially due to self-referential parent_requirement_id
]

/**
 * Read JSON export file
 */
function readExportFile<T>(tableName: string): T[] {
  const filepath = path.join(EXPORT_DIR, `${tableName}.json`)
  if (!fs.existsSync(filepath)) {
    console.error(`  Export file not found: ${filepath}`)
    return []
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'))
}

/**
 * Chunk array into batches
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Clear a table
 */
async function clearTable(tableName: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`  [DRY RUN] Would clear ${tableName}`)
    return
  }

  const { error } = await supabase.from(tableName).delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) {
    // Ignore "no rows" errors
    if (!error.message.includes('0 rows')) {
      console.error(`  Error clearing ${tableName}:`, error.message)
    }
  }
}

/**
 * Import a simple table (no self-references)
 */
async function importSimpleTable(tableName: string, dryRun: boolean): Promise<number> {
  const data = readExportFile<Record<string, unknown>>(tableName)
  if (data.length === 0) return 0

  console.log(`\nImporting ${tableName} (${data.length} rows)...`)

  if (dryRun) {
    console.log(`  [DRY RUN] Would insert ${data.length} rows`)
    return data.length
  }

  // Clear existing data
  await clearTable(tableName, dryRun)

  // Insert in batches
  let inserted = 0
  for (const batch of chunk(data, BATCH_SIZE)) {
    const { error } = await supabase.from(tableName).insert(batch)
    if (error) {
      console.error(`  Error inserting batch:`, error.message)
    } else {
      inserted += batch.length
    }
  }

  console.log(`  ✓ Inserted ${inserted} rows`)
  return inserted
}

/**
 * Import merit badge requirements with level-by-level processing
 * This is needed because parent_requirement_id references other rows in the same table
 */
async function importMeritBadgeRequirements(dryRun: boolean): Promise<number> {
  const tableName = 'bsa_merit_badge_requirements'
  const data = readExportFile<{
    id: string
    merit_badge_id: string
    version_year: number
    requirement_number: string
    scoutbook_requirement_number: string | null
    description: string
    display_order: number
    parent_requirement_id: string | null
    is_alternative: boolean | null
    alternatives_group: string | null
    required_count: number | null
    nesting_depth: number
    sub_requirement_letter: string | null
    created_at: string
    updated_at: string
  }>(tableName)

  if (data.length === 0) return 0

  console.log(`\nImporting ${tableName} (${data.length} rows)...`)

  if (dryRun) {
    // Analyze the data
    const byLevel = new Map<number, number>()
    const withParent = data.filter(r => r.parent_requirement_id).length
    data.forEach(r => {
      const level = r.nesting_depth
      byLevel.set(level, (byLevel.get(level) || 0) + 1)
    })

    console.log(`  [DRY RUN] Would insert ${data.length} rows`)
    console.log(`  Nesting depth distribution:`)
    Array.from(byLevel.entries()).sort((a, b) => a[0] - b[0]).forEach(([level, count]) => {
      console.log(`    Level ${level}: ${count} rows`)
    })
    console.log(`  With parent: ${withParent} rows`)
    return data.length
  }

  // Clear existing data
  await clearTable(tableName, dryRun)

  // Group by nesting depth
  const byLevel = new Map<number, typeof data>()
  let maxLevel = 0
  data.forEach(r => {
    const level = r.nesting_depth
    maxLevel = Math.max(maxLevel, level)
    if (!byLevel.has(level)) {
      byLevel.set(level, [])
    }
    byLevel.get(level)!.push(r)
  })

  console.log(`  Max nesting depth: ${maxLevel}`)

  // Build old ID -> new ID map as we insert
  const idMap = new Map<string, string>()
  let totalInserted = 0

  // Process level by level
  for (let level = 0; level <= maxLevel; level++) {
    const levelData = byLevel.get(level) || []
    if (levelData.length === 0) continue

    // Prepare records, remapping parent_requirement_id
    const records = levelData.map(r => {
      const { id: oldId, created_at, updated_at, ...rest } = r

      // Remap parent_requirement_id to new ID
      let newParentId: string | null = null
      if (rest.parent_requirement_id) {
        newParentId = idMap.get(rest.parent_requirement_id) || null
        if (!newParentId && level > 0) {
          console.warn(`    Warning: Parent ${rest.parent_requirement_id} not found for req ${rest.requirement_number}`)
        }
      }

      return {
        ...rest,
        parent_requirement_id: newParentId,
        _old_id: oldId, // Track for ID mapping
      }
    })

    // Insert in batches
    let levelInserted = 0
    for (const batch of chunk(records, BATCH_SIZE)) {
      // Remove _old_id for actual insert
      const insertBatch = batch.map(({ _old_id, ...rest }) => rest)

      const { data: inserted, error } = await supabase
        .from(tableName)
        .insert(insertBatch)
        .select('id, merit_badge_id, version_year, requirement_number')

      if (error) {
        console.error(`    Error inserting level ${level} batch:`, error.message)
        continue
      }

      // Build ID map: match by merit_badge_id + version_year + requirement_number
      if (inserted) {
        for (const row of inserted) {
          // Find original record to get old ID
          const original = batch.find(
            b =>
              b.merit_badge_id === row.merit_badge_id &&
              b.version_year === row.version_year &&
              b.requirement_number === row.requirement_number
          )
          if (original) {
            idMap.set(original._old_id, row.id)
          }
        }
        levelInserted += inserted.length
      }
    }

    console.log(`  Level ${level}: ${levelInserted} rows`)
    totalInserted += levelInserted
  }

  console.log(`  ✓ Total inserted: ${totalInserted} rows`)
  return totalInserted
}

/**
 * Clear all BSA tables (in reverse order for foreign keys)
 */
async function clearAllBsaTables(dryRun: boolean): Promise<void> {
  console.log('\n═══ Clearing BSA Tables ═══')

  // Clear in reverse dependency order
  const clearOrder = [
    'scout_merit_badge_requirement_progress', // Depends on bsa_merit_badge_requirements
    'scout_merit_badge_progress',              // Depends on bsa_merit_badges
    'scout_rank_requirement_progress',         // Depends on bsa_rank_requirements
    'scout_rank_progress',                     // Depends on bsa_ranks
    'bsa_merit_badge_requirements',
    'bsa_merit_badge_versions',
    'bsa_rank_requirements',
    'bsa_leadership_positions',
    'bsa_merit_badges',
    'bsa_ranks',
  ]

  for (const table of clearOrder) {
    if (dryRun) {
      console.log(`  [DRY RUN] Would clear ${table}`)
    } else {
      const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (error && !error.message.includes('does not exist')) {
        // Ignore errors for tables that might not have data
        console.log(`  Cleared ${table} (or already empty)`)
      } else {
        console.log(`  ✓ Cleared ${table}`)
      }
    }
  }
}

/**
 * Main import function
 */
async function importAll() {
  const dryRun = isProd && !isConfirmed

  console.log('\n╔════════════════════════════════════════╗')
  console.log('║   BSA Reference Data Import            ║')
  console.log('╚════════════════════════════════════════╝')
  console.log(`\nSource directory: ${EXPORT_DIR}`)

  // Verify export files exist
  const requiredFiles = [...IMPORT_ORDER, 'bsa_merit_badge_requirements']
  for (const table of requiredFiles) {
    const filepath = path.join(EXPORT_DIR, `${table}.json`)
    if (!fs.existsSync(filepath)) {
      console.error(`\n❌ Missing export file: ${filepath}`)
      console.error('   Run: npx tsx scripts/export-full-db.ts')
      process.exit(1)
    }
  }
  console.log('✓ All export files found')

  const startTime = Date.now()

  // Step 1: Clear all BSA tables
  await clearAllBsaTables(dryRun)

  // Step 2: Import simple tables in order
  console.log('\n═══ Importing Tables ═══')
  const results: { table: string; count: number }[] = []

  for (const table of IMPORT_ORDER) {
    const count = await importSimpleTable(table, dryRun)
    results.push({ table, count })
  }

  // Step 3: Import merit badge requirements (special handling)
  const mbReqCount = await importMeritBadgeRequirements(dryRun)
  results.push({ table: 'bsa_merit_badge_requirements', count: mbReqCount })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

  // Summary
  console.log('\n' + '═'.repeat(50))
  console.log('IMPORT SUMMARY')
  console.log('═'.repeat(50))

  let totalRows = 0
  results.forEach(r => {
    console.log(`  ${r.table.padEnd(35)} ${String(r.count).padStart(8)} rows`)
    totalRows += r.count
  })

  console.log('─'.repeat(50))
  console.log(`  ${'TOTAL'.padEnd(35)} ${String(totalRows).padStart(8)} rows`)
  console.log(`\n${dryRun ? '⚠️  DRY RUN' : '✅ Import'} complete in ${elapsed}s`)

  if (dryRun) {
    console.log('\n To actually import, run:')
    console.log('   npx tsx scripts/import-full-db.ts --prod --confirm')
  }
}

importAll().catch(err => {
  console.error('Import failed:', err)
  process.exit(1)
})
