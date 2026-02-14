#!/usr/bin/env npx tsx
/**
 * Fix Multisport 2025 Requirement Numbers and Structure
 *
 * Updates to match canonical Scoutbook format:
 * - Add Option headers (Option A—Triathlon, etc.)
 * - Update requirement numbers: 4Aa → 4 Option A (1), 4Aa(1) → 4 Option A (1)(a)
 * - Fix parent relationships for sub-requirements
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Mapping from current requirement_number to canonical format
// 2025 uses: 4Aa, 4Aa(1), 4Aa(2), 4Aa(3), 4Ab, 4Ab(1), etc.
// Canonical: 4 Option A (1), 4 Option A (1)(a), 4 Option A (1)(b), etc.
const requirementMapping: Record<string, { newNumber: string; isHeader: boolean }> = {
  // Requirements 1-3 use standard format (no changes needed for numbering)
  '1': { newNumber: '1', isHeader: true },
  '1a': { newNumber: '1(a)', isHeader: false },
  '1b': { newNumber: '1(b)', isHeader: false },
  '2': { newNumber: '2', isHeader: true },
  '2a': { newNumber: '2(a)', isHeader: false },
  '2b': { newNumber: '2(b)', isHeader: false },
  '2c': { newNumber: '2(c)', isHeader: false },
  '3': { newNumber: '3', isHeader: true },
  '3a': { newNumber: '3(a)', isHeader: false },
  '3b': { newNumber: '3(b)', isHeader: false },
  '3c': { newNumber: '3(c)', isHeader: false },
  '3d': { newNumber: '3(d)', isHeader: false },

  // Requirement 4 main header
  '4': { newNumber: '4', isHeader: true },

  // Option A—Triathlon: Swimming (1), Biking (2), Running (3)
  '4Aa': { newNumber: '4 Option A (1)', isHeader: true },   // Swimming
  '4Aa(1)': { newNumber: '4 Option A (1)(a)', isHeader: false },
  '4Aa(2)': { newNumber: '4 Option A (1)(b)', isHeader: false },
  '4Aa(3)': { newNumber: '4 Option A (1)(c)', isHeader: false },
  '4Ab': { newNumber: '4 Option A (2)', isHeader: true },   // Biking
  '4Ab(1)': { newNumber: '4 Option A (2)(a)', isHeader: false },
  '4Ab(2)': { newNumber: '4 Option A (2)(b)', isHeader: false },
  '4Ab(3)': { newNumber: '4 Option A (2)(c)', isHeader: false },
  '4Ac': { newNumber: '4 Option A (3)', isHeader: true },   // Running
  '4Ac(1)': { newNumber: '4 Option A (3)(a)', isHeader: false },
  '4Ac(2)': { newNumber: '4 Option A (3)(b)', isHeader: false },
  '4Ac(3)': { newNumber: '4 Option A (3)(c)', isHeader: false },

  // Option B—Duathlon: Biking (1), Running (2)
  '4Ba': { newNumber: '4 Option B (1)', isHeader: true },   // Biking
  '4Ba(1)': { newNumber: '4 Option B (1)(a)', isHeader: false },
  '4Ba(2)': { newNumber: '4 Option B (1)(b)', isHeader: false },
  '4Ba(3)': { newNumber: '4 Option B (1)(c)', isHeader: false },
  '4Bb': { newNumber: '4 Option B (2)', isHeader: true },   // Running
  '4Bb(1)': { newNumber: '4 Option B (2)(a)', isHeader: false },
  '4Bb(2)': { newNumber: '4 Option B (2)(b)', isHeader: false },
  '4Bb(3)': { newNumber: '4 Option B (2)(c)', isHeader: false },

  // Option C—Aquathlon: Swimming (1), Running (2)
  '4Ca': { newNumber: '4 Option C (1)', isHeader: true },   // Swimming
  '4Ca(1)': { newNumber: '4 Option C (1)(a)', isHeader: false },
  '4Ca(2)': { newNumber: '4 Option C (1)(b)', isHeader: false },
  '4Ca(3)': { newNumber: '4 Option C (1)(c)', isHeader: false },
  '4Cb': { newNumber: '4 Option C (2)', isHeader: true },   // Running
  '4Cb(1)': { newNumber: '4 Option C (2)(a)', isHeader: false },
  '4Cb(2)': { newNumber: '4 Option C (2)(b)', isHeader: false },
  '4Cb(3)': { newNumber: '4 Option C (2)(c)', isHeader: false },

  // Option D—Aquabike: Swimming (1), Biking (2)
  '4Da': { newNumber: '4 Option D (1)', isHeader: true },   // Swimming
  '4Da(1)': { newNumber: '4 Option D (1)(a)', isHeader: false },
  '4Da(2)': { newNumber: '4 Option D (1)(b)', isHeader: false },
  '4Da(3)': { newNumber: '4 Option D (1)(c)', isHeader: false },
  '4Db': { newNumber: '4 Option D (2)', isHeader: true },   // Biking
  '4Db(1)': { newNumber: '4 Option D (2)(a)', isHeader: false },
  '4Db(2)': { newNumber: '4 Option D (2)(b)', isHeader: false },
  '4Db(3)': { newNumber: '4 Option D (2)(c)', isHeader: false },

  // Requirements 5-8
  '5': { newNumber: '5', isHeader: true },
  '5a': { newNumber: '5(a)', isHeader: false },
  '5b': { newNumber: '5(b)', isHeader: false },
  '5c': { newNumber: '5(c)', isHeader: false },
  '5d': { newNumber: '5(d)', isHeader: false },
  '6': { newNumber: '6', isHeader: false },
  '7': { newNumber: '7', isHeader: false },
  '8': { newNumber: '8', isHeader: true },
  '8a': { newNumber: '8(a)', isHeader: false },
  '8b': { newNumber: '8(b)', isHeader: false },
  '8c': { newNumber: '8(c)', isHeader: false },
  '8d': { newNumber: '8(d)', isHeader: false },
  '8e': { newNumber: '8(e)', isHeader: false },
}

// Option headers to insert (these don't exist in current data)
const optionHeaders = [
  { number: '4 Option A', description: 'Option A—Triathlon', displayOrder: 14 },
  { number: '4 Option B', description: 'Option B—Duathlon', displayOrder: 26 },
  { number: '4 Option C', description: 'Option C—Aquathlon', displayOrder: 34 },
  { number: '4 Option D', description: 'Option D—Aquabike', displayOrder: 42 },
]

// Parent mappings for sub-requirements
// Maps the old requirement number to its parent's old requirement number
const parentMappings: Record<string, string> = {
  // Option A sub-requirements → their sport headers
  '4Aa(1)': '4Aa', '4Aa(2)': '4Aa', '4Aa(3)': '4Aa',
  '4Ab(1)': '4Ab', '4Ab(2)': '4Ab', '4Ab(3)': '4Ab',
  '4Ac(1)': '4Ac', '4Ac(2)': '4Ac', '4Ac(3)': '4Ac',
  // Option B
  '4Ba(1)': '4Ba', '4Ba(2)': '4Ba', '4Ba(3)': '4Ba',
  '4Bb(1)': '4Bb', '4Bb(2)': '4Bb', '4Bb(3)': '4Bb',
  // Option C
  '4Ca(1)': '4Ca', '4Ca(2)': '4Ca', '4Ca(3)': '4Ca',
  '4Cb(1)': '4Cb', '4Cb(2)': '4Cb', '4Cb(3)': '4Cb',
  // Option D
  '4Da(1)': '4Da', '4Da(2)': '4Da', '4Da(3)': '4Da',
  '4Db(1)': '4Db', '4Db(2)': '4Db', '4Db(3)': '4Db',
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  console.log('='.repeat(60))
  console.log('FIX MULTISPORT 2025 REQUIREMENTS')
  console.log('='.repeat(60))
  console.log(dryRun ? 'DRY RUN - No changes will be made' : 'LIVE RUN - Changes will be applied')
  console.log('')

  // Get Multisport badge
  const { data: badge } = await supabase
    .from('bsa_merit_badges')
    .select('id')
    .eq('name', 'Multisport')
    .single()

  if (!badge) {
    console.error('Multisport badge not found')
    return
  }

  // Get all 2025 requirements
  const { data: reqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, description, is_header, display_order, parent_requirement_id')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', 2025)
    .order('display_order')

  if (!reqs) {
    console.error('No requirements found')
    return
  }

  console.log(`Found ${reqs.length} requirements for Multisport 2025\n`)

  // Build a map of old requirement numbers to their IDs
  const reqNumToId = new Map(reqs.map(r => [r.requirement_number, r.id]))

  // Check which option headers already exist
  const existingNumbers = new Set(reqs.map(r => r.requirement_number))
  const headersToInsert = optionHeaders.filter(h => !existingNumbers.has(h.number))

  console.log(`Option headers to insert: ${headersToInsert.length}`)
  headersToInsert.forEach(h => console.log(`  + ${h.number}: "${h.description}"`))

  // Build update list for requirement numbers
  const updates: Array<{
    id: string
    oldNumber: string
    newNumber: string
    isHeader: boolean
  }> = []
  const unmapped: string[] = []

  for (const req of reqs) {
    const mapping = requirementMapping[req.requirement_number]
    if (mapping) {
      const needsUpdate =
        mapping.newNumber !== req.requirement_number ||
        mapping.isHeader !== req.is_header

      if (needsUpdate) {
        updates.push({
          id: req.id,
          oldNumber: req.requirement_number,
          newNumber: mapping.newNumber,
          isHeader: mapping.isHeader,
        })
      }
    } else {
      unmapped.push(req.requirement_number)
    }
  }

  console.log(`\nRequirement number updates: ${updates.length}`)
  if (unmapped.length > 0) {
    console.log(`Unmapped: ${unmapped.length}`)
    unmapped.forEach(n => console.log(`  ? ${n}`))
  }

  console.log('\nRequirement number changes:')
  for (const u of updates) {
    const flags: string[] = []
    if (u.isHeader) flags.push('HEADER')
    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : ''
    console.log(`  ${u.oldNumber.padEnd(12)} → ${u.newNumber}${flagStr}`)
  }

  // Build parent update list
  const parentUpdates: Array<{
    id: string
    reqNumber: string
    parentId: string
    parentReqNumber: string
  }> = []

  for (const [childNum, parentNum] of Object.entries(parentMappings)) {
    const childId = reqNumToId.get(childNum)
    const parentId = reqNumToId.get(parentNum)

    if (childId && parentId) {
      // Check if parent is already set correctly
      const childReq = reqs.find(r => r.id === childId)
      if (childReq && childReq.parent_requirement_id !== parentId) {
        parentUpdates.push({
          id: childId,
          reqNumber: childNum,
          parentId,
          parentReqNumber: parentNum,
        })
      }
    }
  }

  console.log(`\nParent relationship updates: ${parentUpdates.length}`)
  parentUpdates.forEach(u => {
    console.log(`  ${u.reqNumber} → parent: ${u.parentReqNumber}`)
  })

  if (dryRun) {
    console.log('\nDRY RUN - No changes made')
    return
  }

  // Insert option headers
  if (headersToInsert.length > 0) {
    console.log('\nInserting option headers...')
    for (const header of headersToInsert) {
      const { error } = await supabase.from('bsa_merit_badge_requirements').insert({
        merit_badge_id: badge.id,
        version_year: 2025,
        requirement_number: header.number,
        description: header.description,
        display_order: header.displayOrder,
        is_header: true,
        nesting_depth: 2,
      })
      if (error) {
        console.error(`  Failed to insert ${header.number}: ${error.message}`)
      } else {
        console.log(`  + ${header.number}: "${header.description}"`)
      }
    }
  }

  // Apply requirement number updates
  console.log('\nApplying requirement number updates...')
  let reqSuccess = 0
  let reqFailed = 0

  for (const u of updates) {
    const { error } = await supabase
      .from('bsa_merit_badge_requirements')
      .update({
        requirement_number: u.newNumber,
        is_header: u.isHeader,
      })
      .eq('id', u.id)

    if (error) {
      console.error(`  Failed ${u.oldNumber}: ${error.message}`)
      reqFailed++
    } else {
      reqSuccess++
    }
  }

  console.log(`Requirement updates: ${reqSuccess} success, ${reqFailed} failed`)

  // Apply parent relationship updates
  console.log('\nApplying parent relationship updates...')
  let parentSuccess = 0
  let parentFailed = 0

  for (const u of parentUpdates) {
    const { error } = await supabase
      .from('bsa_merit_badge_requirements')
      .update({ parent_requirement_id: u.parentId })
      .eq('id', u.id)

    if (error) {
      console.error(`  Failed ${u.reqNumber}: ${error.message}`)
      parentFailed++
    } else {
      parentSuccess++
    }
  }

  console.log(`Parent updates: ${parentSuccess} success, ${parentFailed} failed`)

  // Now set parents for sport headers to point to option headers
  console.log('\nSetting sport header parents to option headers...')

  // Re-fetch requirements to get the new option header IDs
  const { data: updatedReqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', 2025)

  if (updatedReqs) {
    const newReqMap = new Map(updatedReqs.map(r => [r.requirement_number, r.id]))

    // Sport headers should point to their option headers
    const sportToOption: Record<string, string> = {
      '4 Option A (1)': '4 Option A',  // Swimming
      '4 Option A (2)': '4 Option A',  // Biking
      '4 Option A (3)': '4 Option A',  // Running
      '4 Option B (1)': '4 Option B',  // Biking
      '4 Option B (2)': '4 Option B',  // Running
      '4 Option C (1)': '4 Option C',  // Swimming
      '4 Option C (2)': '4 Option C',  // Running
      '4 Option D (1)': '4 Option D',  // Swimming
      '4 Option D (2)': '4 Option D',  // Biking
    }

    for (const [sportNum, optionNum] of Object.entries(sportToOption)) {
      const sportId = newReqMap.get(sportNum)
      const optionId = newReqMap.get(optionNum)

      if (sportId && optionId) {
        const { error } = await supabase
          .from('bsa_merit_badge_requirements')
          .update({ parent_requirement_id: optionId })
          .eq('id', sportId)

        if (error) {
          console.error(`  Failed ${sportNum} → ${optionNum}: ${error.message}`)
        } else {
          console.log(`  ${sportNum} → parent: ${optionNum}`)
        }
      }
    }

    // Option headers should point to requirement 4
    const req4Id = newReqMap.get('4')
    if (req4Id) {
      for (const header of optionHeaders) {
        const optionId = newReqMap.get(header.number)
        if (optionId) {
          const { error } = await supabase
            .from('bsa_merit_badge_requirements')
            .update({ parent_requirement_id: req4Id })
            .eq('id', optionId)

          if (error) {
            console.error(`  Failed ${header.number} → 4: ${error.message}`)
          } else {
            console.log(`  ${header.number} → parent: 4`)
          }
        }
      }
    }
  }

  console.log('\n=== Complete ===')
}

main().catch(console.error)
