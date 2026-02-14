#!/usr/bin/env npx tsx

/**
 * Import Canonical Merit Badge Data
 *
 * Imports merit badge data from the canonical JSON file to the database.
 * This replaces the scraped file import and preserves all parent/child
 * relationships and header flags.
 *
 * Usage:
 *   npx tsx scripts/import-canonical-merit-badges.ts           # Import to dev
 *   npx tsx scripts/import-canonical-merit-badges.ts --prod    # Import to prod
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

// Check for --prod flag
const isProd = process.argv.includes('--prod')
const envFile = isProd ? '.env.prod' : '.env.local'

dotenv.config({ path: envFile })

console.log(`Environment: ${isProd ? '🔴 PRODUCTION' : '🟢 Development'}`)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface CanonicalData {
  exportedAt: string
  source: string
  stats: {
    badges: number
    versions: number
    requirements: number
    headers: number
    eagleRequired: number
  }
  badges: Array<{
    id: string
    code: string
    name: string
    is_eagle_required: boolean
    category: string | null
    description: string | null
    image_url: string | null
    pamphlet_url: string | null
    requirement_version_year: number | null
    is_active: boolean
  }>
  versions: Array<{
    id: string
    merit_badge_id: string
    version_year: number
    is_current: boolean
    source: string | null
  }>
  requirements: Array<{
    id: string
    merit_badge_id: string
    version_year: number
    requirement_number: string
    scoutbook_requirement_number: string | null
    description: string
    parent_requirement_id: string | null
    is_header: boolean
    is_alternative: boolean | null
    alternatives_group: string | null
    required_count: number | null
    nesting_depth: number
    display_order: number
  }>
}

function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

async function main() {
  const inputPath = 'data/merit-badges-canonical.json'

  console.log('\n=== Importing Canonical Merit Badge Data ===')
  console.log(`Source: ${inputPath}`)
  console.log('')

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: ${inputPath} not found`)
    console.error('Run: npx tsx scripts/export-canonical-merit-badges.ts')
    process.exit(1)
  }

  const data: CanonicalData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'))

  console.log('Canonical file stats:')
  console.log(`  Exported: ${data.exportedAt}`)
  console.log(`  Badges: ${data.stats.badges}`)
  console.log(`  Versions: ${data.stats.versions}`)
  console.log(`  Requirements: ${data.stats.requirements}`)
  console.log(`  Headers: ${data.stats.headers}`)
  console.log('')

  const startTime = Date.now()
  const batchSize = 100

  // Step 1: Upsert badges
  console.log('Importing badges...')
  for (const batch of chunk(data.badges, batchSize)) {
    const { error } = await supabase
      .from('bsa_merit_badges')
      .upsert(batch, { onConflict: 'code' })

    if (error) {
      console.error('Error upserting badges:', error.message)
    }
  }
  console.log(`  Upserted ${data.badges.length} badges`)

  // Step 2: Upsert versions
  console.log('Importing versions...')
  for (const batch of chunk(data.versions, batchSize)) {
    const { error } = await supabase
      .from('bsa_merit_badge_versions')
      .upsert(batch, { onConflict: 'merit_badge_id,version_year' })

    if (error) {
      console.error('Error upserting versions:', error.message)
    }
  }
  console.log(`  Upserted ${data.versions.length} versions`)

  // Step 3: Clear existing requirements for version years in the import
  console.log('Clearing existing requirements...')
  const versionYears = [...new Set(data.requirements.map((r) => r.version_year))]
  const badgeIds = [...new Set(data.requirements.map((r) => r.merit_badge_id))]

  for (const year of versionYears) {
    const { error } = await supabase
      .from('bsa_merit_badge_requirements')
      .delete()
      .in('merit_badge_id', badgeIds)
      .eq('version_year', year)

    if (error && !error.message.includes('foreign key')) {
      console.error(`Error clearing year ${year}:`, error.message)
    }
  }
  console.log(`  Cleared ${versionYears.length} version years`)

  // Step 4: Insert requirements using topological order (parents before children)
  // This is necessary because nesting_depth values may be inconsistent
  console.log('Importing requirements (topological order)...')

  // Build old ID -> new ID mapping for parent references
  const idMap = new Map<string, string>()
  const pending = new Set(data.requirements.map((r) => r.id))
  const reqById = new Map(data.requirements.map((r) => [r.id, r]))
  let totalInserted = 0
  let round = 0

  while (pending.size > 0) {
    round++
    // Find requirements whose parents have been inserted (or have no parent)
    const ready: typeof data.requirements = []
    for (const id of pending) {
      const req = reqById.get(id)!
      if (!req.parent_requirement_id || idMap.has(req.parent_requirement_id)) {
        ready.push(req)
      }
    }

    if (ready.length === 0) {
      console.error(`  ERROR: Circular dependency or missing parents. ${pending.size} requirements stuck.`)
      break
    }

    // Remove from pending
    for (const req of ready) {
      pending.delete(req.id)
    }

    // Prepare records with remapped parent IDs
    const records = ready.map((req) => ({
      merit_badge_id: req.merit_badge_id,
      version_year: req.version_year,
      requirement_number: req.requirement_number,
      scoutbook_requirement_number: req.scoutbook_requirement_number,
      description: req.description,
      parent_requirement_id: req.parent_requirement_id
        ? idMap.get(req.parent_requirement_id) || null
        : null,
      is_header: req.is_header,
      is_alternative: req.is_alternative,
      alternatives_group: req.alternatives_group,
      required_count: req.required_count,
      nesting_depth: req.nesting_depth,
      display_order: req.display_order,
    }))

    // Insert in batches
    for (const batch of chunk(records, batchSize)) {
      const { data: inserted, error } = await supabase
        .from('bsa_merit_badge_requirements')
        .insert(batch)
        .select('id, requirement_number, merit_badge_id, version_year')

      if (error) {
        console.error(`Error inserting round ${round}:`, error.message)
        continue
      }

      // Map old IDs to new IDs for this batch
      if (inserted) {
        for (const row of inserted) {
          // Find the original record to get its old ID
          const original = ready.find(
            (r) =>
              r.requirement_number === row.requirement_number &&
              r.merit_badge_id === row.merit_badge_id &&
              r.version_year === row.version_year
          )
          if (original) {
            idMap.set(original.id, row.id)
          }
        }
      }
    }

    console.log(`  Round ${round}: ${ready.length} requirements`)
    totalInserted += ready.length
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log('')
  console.log('=== Import Complete ===')
  console.log(`  Total requirements: ${totalInserted}`)
  console.log(`  Time: ${elapsed}s`)

  // Verify
  const { count: reqCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })

  const { count: headerCount } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .eq('is_header', true)

  console.log('')
  console.log('Verification:')
  console.log(`  Requirements in DB: ${reqCount}`)
  console.log(`  Headers in DB: ${headerCount}`)
}

main().catch(console.error)
