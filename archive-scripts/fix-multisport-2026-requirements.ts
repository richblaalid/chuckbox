#!/usr/bin/env npx tsx
/**
 * Fix Multisport 2026 Requirement Structure
 *
 * Current database state:
 *   4A(1), 4Aa, 4Ab, 4Ac, 4Ac(2), 4Aa_2, etc. - flat under 4
 *
 * Target structure:
 *   4 [H]
 *   └── 4A [H] (Option A—Triathlon)
 *       ├── 4A(1) [H] (Swimming)
 *       │   ├── 4A(1)(a)
 *       │   ├── 4A(1)(b)
 *       │   └── 4A(1)(c)
 *       ├── 4A(2) [H] (Biking)
 *       │   └── ...
 *       └── 4A(3) [H] (Running)
 *           └── ...
 *   └── 4B [H] (Option B—Duathlon)
 *       └── ...
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const VERSION_YEAR = 2026

// Requirement number transformations
// Maps current DB format -> correct format
const numberTransforms: Record<string, { newNumber: string; isHeader: boolean }> = {
  // Option A - Triathlon (Swimming, Biking, Running)
  '4A(1)': { newNumber: '4A(1)', isHeader: true },      // Swimming header
  '4Aa': { newNumber: '4A(1)(a)', isHeader: false },
  '4Ab': { newNumber: '4A(1)(b)', isHeader: false },
  '4Ac': { newNumber: '4A(1)(c)', isHeader: false },
  '4Ac(2)': { newNumber: '4A(2)', isHeader: true },     // Biking header - RENAMED
  '4Aa_2': { newNumber: '4A(2)(a)', isHeader: false },
  '4Ab_2': { newNumber: '4A(2)(b)', isHeader: false },
  '4Ac_2': { newNumber: '4A(2)(c)', isHeader: false },
  '4Ac(3)': { newNumber: '4A(3)', isHeader: true },     // Running header - RENAMED
  '4Aa_3': { newNumber: '4A(3)(a)', isHeader: false },
  '4Ab_3': { newNumber: '4A(3)(b)', isHeader: false },
  '4Ac_3': { newNumber: '4A(3)(c)', isHeader: false },

  // Option B - Duathlon (Biking, Running)
  '4B(1)': { newNumber: '4B(1)', isHeader: true },      // Biking header
  '4Ba': { newNumber: '4B(1)(a)', isHeader: false },
  '4Bb': { newNumber: '4B(1)(b)', isHeader: false },
  '4Bc': { newNumber: '4B(1)(c)', isHeader: false },
  '4Bc(2)': { newNumber: '4B(2)', isHeader: true },     // Running header - RENAMED
  '4Ba_2': { newNumber: '4B(2)(a)', isHeader: false },
  '4Bb_2': { newNumber: '4B(2)(b)', isHeader: false },
  '4Bc_2': { newNumber: '4B(2)(c)', isHeader: false },
  '4Bc(3)': { newNumber: '4B(3)', isHeader: false },
  '4Bc(4)': { newNumber: '4B(4)', isHeader: false },
  '4Bc(5)': { newNumber: '4B(5)', isHeader: false },

  // Option C - Aquathlon (Swimming, Running)
  '4C(1)': { newNumber: '4C(1)', isHeader: true },
  '4Ca': { newNumber: '4C(1)(a)', isHeader: false },
  '4Cb': { newNumber: '4C(1)(b)', isHeader: false },
  '4Cc': { newNumber: '4C(1)(c)', isHeader: false },
  '4Cc(2)': { newNumber: '4C(2)', isHeader: true },
  '4Ca_2': { newNumber: '4C(2)(a)', isHeader: false },
  '4Cb_2': { newNumber: '4C(2)(b)', isHeader: false },
  '4Cc_2': { newNumber: '4C(2)(c)', isHeader: false },

  // Option D - Aquabike (Swimming, Biking)
  '4D(1)': { newNumber: '4D(1)', isHeader: true },
  '4Da': { newNumber: '4D(1)(a)', isHeader: false },
  '4Db': { newNumber: '4D(1)(b)', isHeader: false },
  '4Dc': { newNumber: '4D(1)(c)', isHeader: false },
  '4Dc(2)': { newNumber: '4D(2)', isHeader: true },
  '4Da_2': { newNumber: '4D(2)(a)', isHeader: false },
  '4Db_2': { newNumber: '4D(2)(b)', isHeader: false },
  '4Dc_2': { newNumber: '4D(2)(c)', isHeader: false },
}

// Parent relationships (child -> parent requirement_number)
// Applied AFTER renaming
const parentRelationships: Record<string, string> = {
  // Option A
  '4A': '4',
  '4A(1)': '4A',
  '4A(1)(a)': '4A(1)', '4A(1)(b)': '4A(1)', '4A(1)(c)': '4A(1)',
  '4A(2)': '4A',
  '4A(2)(a)': '4A(2)', '4A(2)(b)': '4A(2)', '4A(2)(c)': '4A(2)',
  '4A(3)': '4A',
  '4A(3)(a)': '4A(3)', '4A(3)(b)': '4A(3)', '4A(3)(c)': '4A(3)',

  // Option B
  '4B': '4',
  '4B(1)': '4B',
  '4B(1)(a)': '4B(1)', '4B(1)(b)': '4B(1)', '4B(1)(c)': '4B(1)',
  '4B(2)': '4B',
  '4B(2)(a)': '4B(2)', '4B(2)(b)': '4B(2)', '4B(2)(c)': '4B(2)',
  '4B(3)': '4B', '4B(4)': '4B', '4B(5)': '4B',

  // Option C
  '4C': '4',
  '4C(1)': '4C',
  '4C(1)(a)': '4C(1)', '4C(1)(b)': '4C(1)', '4C(1)(c)': '4C(1)',
  '4C(2)': '4C',
  '4C(2)(a)': '4C(2)', '4C(2)(b)': '4C(2)', '4C(2)(c)': '4C(2)',

  // Option D
  '4D': '4',
  '4D(1)': '4D',
  '4D(1)(a)': '4D(1)', '4D(1)(b)': '4D(1)', '4D(1)(c)': '4D(1)',
  '4D(2)': '4D',
  '4D(2)(a)': '4D(2)', '4D(2)(b)': '4D(2)', '4D(2)(c)': '4D(2)',
}

// Option headers that may need to be created
const optionHeaders = [
  { number: '4A', description: 'Option A—Triathlon: Do ALL of the following for swimming, biking, and running.', isHeader: true },
  { number: '4B', description: 'Option B—Duathlon: Do ALL of the following for biking and running.', isHeader: true },
  { number: '4C', description: 'Option C—Aquathlon: Do ALL of the following for swimming and running.', isHeader: true },
  { number: '4D', description: 'Option D—Aquabike: Do ALL of the following for swimming and biking.', isHeader: true },
]

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  console.log('='.repeat(70))
  console.log('FIX MULTISPORT 2026 REQUIREMENT STRUCTURE')
  console.log('='.repeat(70))
  console.log(dryRun ? 'DRY RUN - No changes will be made' : 'LIVE RUN - Changes will be applied')
  console.log('')

  // Get badge
  const { data: badge } = await supabase
    .from('bsa_merit_badges')
    .select('id, name, requirement_version_year')
    .eq('name', 'Multisport')
    .single()

  if (!badge) {
    console.error('Multisport badge not found')
    return
  }

  if (badge.requirement_version_year !== VERSION_YEAR) {
    console.log(`Active version is ${badge.requirement_version_year}, not ${VERSION_YEAR}`)
    console.log('Proceeding anyway...')
  }

  // Get all requirements for this version
  const { data: reqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, description, is_header, parent_requirement_id, display_order, nesting_depth')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', VERSION_YEAR)
    .order('display_order')

  if (!reqs || reqs.length === 0) {
    console.error(`No requirements found for Multisport ${VERSION_YEAR}`)
    return
  }

  console.log(`Found ${reqs.length} requirements for Multisport ${VERSION_YEAR}\n`)

  // Build lookup maps
  const idToReq = new Map(reqs.map(r => [r.id, r]))
  const numToId = new Map(reqs.map(r => [r.requirement_number, r.id]))
  const existingNumbers = new Set(reqs.map(r => r.requirement_number))

  // Phase 1: Identify option headers that need to be created
  console.log('Phase 1: Check for missing option headers')
  console.log('-'.repeat(50))

  const headersToCreate = optionHeaders.filter(h => !existingNumbers.has(h.number))
  if (headersToCreate.length > 0) {
    console.log('Missing headers to create:')
    headersToCreate.forEach(h => console.log(`  + ${h.number}`))
  } else {
    console.log('All option headers exist')
  }

  // Phase 2: Identify renames
  console.log('\nPhase 2: Renaming requirements')
  console.log('-'.repeat(50))

  const renames: Array<{ id: string; oldNum: string; newNum: string; isHeader: boolean }> = []

  for (const req of reqs) {
    const transform = numberTransforms[req.requirement_number]
    if (transform && transform.newNumber !== req.requirement_number) {
      renames.push({
        id: req.id,
        oldNum: req.requirement_number,
        newNum: transform.newNumber,
        isHeader: transform.isHeader,
      })
      console.log(`  ${req.requirement_number.padEnd(15)} → ${transform.newNumber}${transform.isHeader ? ' [H]' : ''}`)
    } else if (transform && transform.isHeader !== req.is_header) {
      // Just header flag change
      renames.push({
        id: req.id,
        oldNum: req.requirement_number,
        newNum: req.requirement_number,
        isHeader: transform.isHeader,
      })
      console.log(`  ${req.requirement_number.padEnd(15)} (header change) [is_header=${transform.isHeader}]`)
    }
  }

  if (renames.length === 0) {
    console.log('  No renames needed')
  }

  if (dryRun) {
    console.log('\nDRY RUN - No changes made')
    return
  }

  // Apply Phase 1: Create missing headers
  if (headersToCreate.length > 0) {
    console.log('\nCreating missing option headers...')

    // Find display_order for req 4 to insert after
    const req4 = reqs.find(r => r.requirement_number === '4')
    let insertOrder = req4 ? req4.display_order + 1 : 14

    for (const header of headersToCreate) {
      const { data: inserted, error } = await supabase
        .from('bsa_merit_badge_requirements')
        .insert({
          merit_badge_id: badge.id,
          version_year: VERSION_YEAR,
          requirement_number: header.number,
          description: header.description,
          is_header: true,
          nesting_depth: 1,
          display_order: insertOrder++,
        })
        .select()
        .single()

      if (error) {
        console.error(`  Failed to create ${header.number}: ${error.message}`)
      } else {
        console.log(`  Created ${header.number}`)
        numToId.set(header.number, inserted.id)
      }
    }
  }

  // Apply Phase 2: Renames
  if (renames.length > 0) {
    console.log('\nApplying renames...')
    let renamed = 0

    for (const rename of renames) {
      const { error } = await supabase
        .from('bsa_merit_badge_requirements')
        .update({
          requirement_number: rename.newNum,
          is_header: rename.isHeader,
        })
        .eq('id', rename.id)

      if (error) {
        console.error(`  Failed ${rename.oldNum}: ${error.message}`)
      } else {
        renamed++
        // Update our map
        numToId.delete(rename.oldNum)
        numToId.set(rename.newNum, rename.id)
      }
    }

    console.log(`  ${renamed} requirements renamed`)
  }

  // Phase 3: Fix parent relationships
  console.log('\nPhase 3: Fixing parent relationships')
  console.log('-'.repeat(50))

  // Re-fetch to get updated requirement numbers
  const { data: updatedReqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, parent_requirement_id')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', VERSION_YEAR)

  if (!updatedReqs) {
    console.error('Failed to fetch updated requirements')
    return
  }

  const updatedNumToId = new Map(updatedReqs.map(r => [r.requirement_number, r.id]))
  const updatedIdToNum = new Map(updatedReqs.map(r => [r.id, r.requirement_number]))

  let parentUpdates = 0

  for (const req of updatedReqs) {
    const expectedParentNum = parentRelationships[req.requirement_number]
    if (!expectedParentNum) continue

    const expectedParentId = updatedNumToId.get(expectedParentNum)
    if (!expectedParentId) {
      console.log(`  Warning: Parent ${expectedParentNum} not found for ${req.requirement_number}`)
      continue
    }

    const currentParentNum = req.parent_requirement_id
      ? updatedIdToNum.get(req.parent_requirement_id)
      : null

    if (currentParentNum !== expectedParentNum) {
      const { error } = await supabase
        .from('bsa_merit_badge_requirements')
        .update({ parent_requirement_id: expectedParentId })
        .eq('id', req.id)

      if (error) {
        console.error(`  Failed ${req.requirement_number}: ${error.message}`)
      } else {
        console.log(`  ${req.requirement_number.padEnd(15)} parent: ${currentParentNum || 'none'} → ${expectedParentNum}`)
        parentUpdates++
      }
    }
  }

  console.log(`\n  ${parentUpdates} parent relationships updated`)

  // Final structure display
  console.log('\n' + '='.repeat(70))
  console.log('FINAL STRUCTURE (requirement 4 family)')
  console.log('='.repeat(70))

  const { data: finalReqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, is_header, parent_requirement_id, nesting_depth')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', VERSION_YEAR)
    .order('display_order')

  if (finalReqs) {
    const finalIdToNum = new Map(finalReqs.map(r => [r.id, r.requirement_number]))
    const req4Family = finalReqs.filter(r => r.requirement_number.startsWith('4'))

    for (const req of req4Family) {
      const parentNum = req.parent_requirement_id ? finalIdToNum.get(req.parent_requirement_id) : null
      const indent = '    '.repeat(req.nesting_depth || 0)
      const headerMark = req.is_header ? ' [H]' : ''
      const parentMark = parentNum ? ` (parent: ${parentNum})` : ''
      console.log(`${indent}${req.requirement_number}${headerMark}${parentMark}`)
    }
  }
}

main().catch(console.error)
