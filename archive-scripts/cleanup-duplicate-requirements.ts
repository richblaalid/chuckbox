#!/usr/bin/env npx tsx

/**
 * Cleanup Duplicate Requirements
 *
 * Removes duplicate requirements (same requirement_number, merit_badge_id, version_year)
 * while preserving parent-child relationships.
 *
 * Usage:
 *   npx tsx scripts/cleanup-duplicate-requirements.ts --dry-run  # Preview
 *   npx tsx scripts/cleanup-duplicate-requirements.ts             # Apply to dev
 *   npx tsx scripts/cleanup-duplicate-requirements.ts --prod      # Apply to prod
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

const isProd = process.argv.includes('--prod')
const dryRun = process.argv.includes('--dry-run')
const envFile = isProd ? '.env.prod' : '.env.local'

dotenv.config({ path: envFile })

console.log(`Environment: ${isProd ? '🔴 PRODUCTION' : '🟢 Development'}`)
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface Requirement {
  id: string
  merit_badge_id: string
  version_year: number
  requirement_number: string
  parent_requirement_id: string | null
  display_order: number
}

async function main() {
  console.log('\n=== Cleanup Duplicate Requirements ===\n')

  // Fetch all requirements
  console.log('Fetching requirements...')
  const allReqs: Requirement[] = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('bsa_merit_badge_requirements')
      .select('id, merit_badge_id, version_year, requirement_number, parent_requirement_id, display_order')
      .range(offset, offset + pageSize - 1)
      .order('display_order')

    if (error) {
      console.error('Error fetching:', error.message)
      break
    }
    if (!data || data.length === 0) break
    allReqs.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  console.log(`  Fetched ${allReqs.length} requirements`)

  // Find duplicates - keep the one with the lowest display_order
  const seen = new Map<string, Requirement>()
  const toDelete: string[] = []

  for (const req of allReqs) {
    const key = `${req.requirement_number}:${req.merit_badge_id}:${req.version_year}`

    if (seen.has(key)) {
      const existing = seen.get(key)!
      // Keep the one with lower display_order
      if (req.display_order < existing.display_order) {
        toDelete.push(existing.id)
        seen.set(key, req)
      } else {
        toDelete.push(req.id)
      }
    } else {
      seen.set(key, req)
    }
  }

  console.log(`\nFound ${toDelete.length} duplicate requirements to delete`)

  if (toDelete.length === 0) {
    console.log('No duplicates found!')
    return
  }

  // Check if any requirements reference the duplicates as parents
  const referencedAsParent: string[] = []
  for (const req of allReqs) {
    if (req.parent_requirement_id && toDelete.includes(req.parent_requirement_id)) {
      referencedAsParent.push(req.id)
    }
  }

  if (referencedAsParent.length > 0) {
    console.log(`\nWARNING: ${referencedAsParent.length} requirements reference duplicates as parents`)
    console.log('These will need their parent references updated first')

    // For each requirement that references a duplicate, find the kept version
    console.log('\nFixing parent references...')
    let fixedCount = 0

    for (const reqId of referencedAsParent) {
      const req = allReqs.find((r) => r.id === reqId)
      if (!req) continue

      const duplicateParent = allReqs.find((r) => r.id === req.parent_requirement_id)
      if (!duplicateParent) continue

      // Find the kept version of this parent
      const key = `${duplicateParent.requirement_number}:${duplicateParent.merit_badge_id}:${duplicateParent.version_year}`
      const keptParent = seen.get(key)

      if (keptParent && keptParent.id !== req.parent_requirement_id) {
        if (!dryRun) {
          const { error } = await supabase
            .from('bsa_merit_badge_requirements')
            .update({ parent_requirement_id: keptParent.id })
            .eq('id', reqId)

          if (error) {
            console.error(`  Error updating ${reqId}:`, error.message)
          } else {
            fixedCount++
          }
        } else {
          console.log(`  Would update ${req.requirement_number} parent: ${req.parent_requirement_id?.slice(0, 8)} -> ${keptParent.id.slice(0, 8)}`)
          fixedCount++
        }
      }
    }

    console.log(`  Fixed ${fixedCount} parent references`)
  }

  // Delete the duplicates
  if (!dryRun) {
    console.log('\nDeleting duplicates...')
    let deleted = 0

    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100)
      const { error } = await supabase
        .from('bsa_merit_badge_requirements')
        .delete()
        .in('id', batch)

      if (error) {
        console.error('Error deleting batch:', error.message)
      } else {
        deleted += batch.length
      }
    }

    console.log(`  Deleted ${deleted} duplicate requirements`)
  } else {
    console.log(`\nDRY RUN: Would delete ${toDelete.length} duplicate requirements`)
  }

  // Verify
  const { count } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('*', { count: 'exact', head: true })

  console.log(`\nTotal requirements remaining: ${count}`)
}

main().catch(console.error)
