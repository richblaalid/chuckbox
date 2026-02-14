#!/usr/bin/env npx tsx
/**
 * Export Full Database Script
 *
 * Exports all BSA reference data from the database to JSON files.
 * Handles pagination for large tables (16k+ rows).
 *
 * Usage:
 *   npx tsx scripts/export-full-db.ts              # Export from dev
 *   npx tsx scripts/export-full-db.ts --prod       # Export from prod
 *   npx tsx scripts/export-full-db.ts --table=bsa_merit_badge_requirements  # Export single table
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

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
  console.error(`Missing environment variables. Ensure ${envFile} is configured.`)
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const EXPORT_DIR = path.join(process.cwd(), 'data', 'dev-export')
const PAGE_SIZE = 1000

// Tables to export (in order for proper foreign key handling during import)
const BSA_TABLES = [
  'bsa_ranks',
  'bsa_rank_requirements',
  'bsa_merit_badges',
  'bsa_merit_badge_versions',
  'bsa_merit_badge_requirements',
  'bsa_leadership_positions',
]

/**
 * Export a table with pagination support
 */
async function exportTable(tableName: string): Promise<number> {
  console.log(`\nExporting ${tableName}...`)

  const allRows: unknown[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(offset, offset + PAGE_SIZE - 1)
      .order('id')

    if (error) {
      console.error(`  Error fetching ${tableName}:`, error.message)
      return 0
    }

    if (!data || data.length === 0) {
      hasMore = false
    } else {
      allRows.push(...data)
      offset += PAGE_SIZE

      if (data.length < PAGE_SIZE) {
        hasMore = false
      }

      // Progress indicator for large tables
      if (allRows.length % 5000 === 0) {
        console.log(`  ... ${allRows.length} rows fetched`)
      }
    }
  }

  // Write to file
  const filename = `${tableName}.json`
  const filepath = path.join(EXPORT_DIR, filename)
  fs.writeFileSync(filepath, JSON.stringify(allRows, null, 2))

  console.log(`  ✓ Exported ${allRows.length} rows to ${filename}`)
  return allRows.length
}

/**
 * Export all BSA reference tables
 */
async function exportBsaTables() {
  console.log('\n╔════════════════════════════════════════╗')
  console.log('║   BSA Reference Data Export            ║')
  console.log('╚════════════════════════════════════════╝')
  console.log(`\nOutput directory: ${EXPORT_DIR}`)

  // Ensure export directory exists
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true })
  }

  const startTime = Date.now()
  const results: { table: string; count: number }[] = []

  for (const table of BSA_TABLES) {
    const count = await exportTable(table)
    results.push({ table, count })
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

  // Summary
  console.log('\n' + '═'.repeat(50))
  console.log('EXPORT SUMMARY')
  console.log('═'.repeat(50))

  let totalRows = 0
  results.forEach(r => {
    console.log(`  ${r.table.padEnd(35)} ${String(r.count).padStart(8)} rows`)
    totalRows += r.count
  })

  console.log('─'.repeat(50))
  console.log(`  ${'TOTAL'.padEnd(35)} ${String(totalRows).padStart(8)} rows`)
  console.log(`\n✅ Export complete in ${elapsed}s`)
  console.log(`   Files saved to: ${EXPORT_DIR}/`)
}

/**
 * Export a single table (for targeted exports)
 */
async function exportSingleTable(tableName: string) {
  console.log(`\nExporting single table: ${tableName}`)

  // Ensure export directory exists
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true })
  }

  const count = await exportTable(tableName)
  console.log(`\n✅ Exported ${count} rows from ${tableName}`)
}

// CLI
const tableArg = process.argv.find(a => a.startsWith('--table='))
const specificTable = tableArg ? tableArg.split('=')[1] : null

if (specificTable) {
  exportSingleTable(specificTable)
} else {
  exportBsaTables()
}
