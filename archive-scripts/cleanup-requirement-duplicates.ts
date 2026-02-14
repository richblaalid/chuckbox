#!/usr/bin/env npx tsx
/**
 * Cleanup Duplicate Merit Badge Requirements
 *
 * Finds and removes duplicate requirements where:
 * - Same merit_badge_id
 * - Same version_year
 * - Same requirement_number
 * - Same description (first 100 chars)
 *
 * Keeps the row with the lowest display_order (or first inserted).
 *
 * Usage:
 *   npx tsx scripts/cleanup-requirement-duplicates.ts              # Dry run on dev
 *   npx tsx scripts/cleanup-requirement-duplicates.ts --confirm    # Actually delete on dev
 *   npx tsx scripts/cleanup-requirement-duplicates.ts --prod       # Dry run on prod
 *   npx tsx scripts/cleanup-requirement-duplicates.ts --prod --confirm  # Actually delete on prod
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

const isProd = process.argv.includes('--prod')
const isConfirmed = process.argv.includes('--confirm')
const envFile = isProd ? '.env.prod' : '.env.local'
dotenv.config({ path: envFile })

const envLabel = isProd ? '🔴 PRODUCTION' : '🟢 Development'
console.log(`Environment: ${envLabel}`)

if (!isConfirmed) {
  console.log('⚠️  DRY RUN MODE - No changes will be made')
  console.log('   Add --confirm to actually delete duplicates\n')
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

interface Requirement {
  id: string
  merit_badge_id: string
  version_year: number
  requirement_number: string
  description: string
  display_order: number
}

async function findDuplicates(): Promise<{ keep: Requirement; delete: Requirement[] }[]> {
  console.log('Fetching all requirements...')

  // Fetch all requirements with pagination
  const allReqs: Requirement[] = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('id, merit_badge_id, version_year, requirement_number, description, display_order')
      .order('merit_badge_id')
      .order('version_year')
      .order('requirement_number')
      .order('display_order')
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error('Error fetching requirements:', error.message)
      return []
    }

    if (!data || data.length === 0) break
    allReqs.push(...data)
    offset += pageSize

    if (data.length < pageSize) break
  }

  console.log(`Fetched ${allReqs.length} total requirements`)

  // Group by duplicate key
  // Note: We CANNOT include description in the key because different requirements
  // (e.g., 1, 2, 3) may have the same description ("Do the following:").
  // True duplicates have the same badge + version + requirement_number AND same description,
  // but we identify duplicates by the trio and verify descriptions match.
  const groups = new Map<string, Requirement[]>()

  for (const req of allReqs) {
    // Key: badge + version + requirement_number (NOT description)
    const key = `${req.merit_badge_id}:${req.version_year}:${req.requirement_number}`

    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(req)
  }

  // Find groups with duplicates
  const duplicateGroups: { keep: Requirement; delete: Requirement[] }[] = []

  for (const [key, reqs] of groups) {
    if (reqs.length > 1) {
      // Further group by description to only delete true duplicates
      // (same badge/version/number AND same description)
      const byDescription = new Map<string, Requirement[]>()
      for (const req of reqs) {
        const descKey = req.description.substring(0, 200)
        if (!byDescription.has(descKey)) {
          byDescription.set(descKey, [])
        }
        byDescription.get(descKey)!.push(req)
      }

      // Only process groups where description also matches (true duplicates)
      for (const [descKey, descReqs] of byDescription) {
        if (descReqs.length > 1) {
          // Sort by display_order, then by id (to ensure deterministic selection)
          descReqs.sort((a, b) => {
            if (a.display_order !== b.display_order) return a.display_order - b.display_order
            return a.id.localeCompare(b.id)
          })

          duplicateGroups.push({
            keep: descReqs[0],
            delete: descReqs.slice(1)
          })
        }
      }
    }
  }

  return duplicateGroups
}

async function deleteDuplicates(groups: { keep: Requirement; delete: Requirement[] }[]): Promise<number> {
  let totalDeleted = 0
  const idsToDelete: string[] = []

  for (const group of groups) {
    for (const req of group.delete) {
      idsToDelete.push(req.id)
    }
  }

  console.log(`\nDeleting ${idsToDelete.length} duplicate requirements...`)

  // Delete in batches
  const batchSize = 100
  for (let i = 0; i < idsToDelete.length; i += batchSize) {
    const batch = idsToDelete.slice(i, i + batchSize)

    const { error } = await supabase
      .from('bsa_merit_badge_requirements')
      .delete()
      .in('id', batch)

    if (error) {
      console.error(`Error deleting batch at ${i}:`, error.message)
    } else {
      totalDeleted += batch.length
    }

    // Progress indicator
    if ((i + batchSize) % 500 === 0 || i + batchSize >= idsToDelete.length) {
      console.log(`  Deleted ${Math.min(i + batchSize, idsToDelete.length)}/${idsToDelete.length}...`)
    }
  }

  return totalDeleted
}

async function main() {
  const duplicateGroups = await findDuplicates()

  if (duplicateGroups.length === 0) {
    console.log('\n✅ No duplicates found!')
    return
  }

  const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.delete.length, 0)

  console.log(`\nFound ${duplicateGroups.length} groups with duplicates`)
  console.log(`Total duplicate rows to delete: ${totalDuplicates}`)

  // Show sample
  console.log('\nSample duplicates:')
  duplicateGroups.slice(0, 5).forEach((g, i) => {
    console.log(`  ${i + 1}. [${g.keep.requirement_number}] "${g.keep.description.substring(0, 40)}..."`)
    console.log(`     Keep: ${g.keep.id.substring(0, 8)}... (order: ${g.keep.display_order})`)
    console.log(`     Delete: ${g.delete.length} duplicate(s)`)
  })

  if (isConfirmed) {
    const deleted = await deleteDuplicates(duplicateGroups)
    console.log(`\n✅ Deleted ${deleted} duplicate requirements`)

    // Verify
    const { count } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('*', { count: 'exact', head: true })
    console.log(`Remaining requirements: ${count}`)
  } else {
    console.log('\n⚠️  DRY RUN - No changes made')
    console.log(`   Run with --confirm to delete ${totalDuplicates} duplicates`)
  }
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
