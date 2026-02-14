#!/usr/bin/env npx tsx
/**
 * Fix Cycling 2026 Requirement 6 Structure
 *
 * The requirement numbers are malformed. This script fixes:
 * - 6A(a)-6A(e) → 6A(1)(a)-6A(1)(e) (children of 6A(1))
 * - 6A(e)(2) → 6A(2), 6A(e)(3) → 6A(3)
 * - 6A(a)_2, 6A(b)_2 → 6A(3)(a), 6A(3)(b)
 * - 6B(a)-6B(c) → 6B(1)(a)-6B(1)(c) (children of 6B(1))
 * - 6B(c)(2) → 6B(2)
 * - 6B(a)_2, 6B(b)_2, 6B(c)_2 → 6B(2)(a), 6B(2)(b), 6B(2)(c)
 * - 6B(c)(3)-6B(c)(5) → 6B(3)-6B(5)
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Mapping from current to correct requirement numbers
const numberMapping: Record<string, { newNumber: string; isHeader?: boolean }> = {
  // Option A fixes
  '6A(1)': { newNumber: '6A(1)', isHeader: true },
  '6A(a)': { newNumber: '6A(1)(a)' },
  '6A(b)': { newNumber: '6A(1)(b)' },
  '6A(c)': { newNumber: '6A(1)(c)' },
  '6A(d)': { newNumber: '6A(1)(d)' },
  '6A(e)': { newNumber: '6A(1)(e)', isHeader: false }, // Remove header flag
  '6A(e)(2)': { newNumber: '6A(2)' },
  '6A(e)(3)': { newNumber: '6A(3)', isHeader: true },
  '6A(a)_2': { newNumber: '6A(3)(a)' },
  '6A(b)_2': { newNumber: '6A(3)(b)' },

  // Option B fixes
  '6B(1)': { newNumber: '6B(1)', isHeader: true },
  '6B(a)': { newNumber: '6B(1)(a)' },
  '6B(b)': { newNumber: '6B(1)(b)' },
  '6B(c)': { newNumber: '6B(1)(c)', isHeader: false }, // Remove header flag
  '6B(c)(2)': { newNumber: '6B(2)', isHeader: true },
  '6B(a)_2': { newNumber: '6B(2)(a)' },
  '6B(b)_2': { newNumber: '6B(2)(b)' },
  '6B(c)_2': { newNumber: '6B(2)(c)' },
  '6B(c)(3)': { newNumber: '6B(3)' },
  '6B(c)(4)': { newNumber: '6B(4)' },
  '6B(c)(5)': { newNumber: '6B(5)' },
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  console.log('='.repeat(70))
  console.log('FIX CYCLING 2026 REQUIREMENT 6 STRUCTURE')
  console.log('='.repeat(70))
  console.log(dryRun ? 'DRY RUN - No changes will be made' : 'LIVE RUN - Changes will be applied')
  console.log('')

  // Get Cycling badge
  const { data: badge } = await supabase
    .from('bsa_merit_badges')
    .select('id')
    .eq('name', 'Cycling')
    .single()

  if (!badge) {
    console.error('Cycling badge not found')
    return
  }

  // Get all requirement 6 family
  const { data: reqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, description, is_header, parent_requirement_id, display_order')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', 2026)
    .like('requirement_number', '6%')
    .order('display_order')

  if (!reqs) {
    console.error('No requirements found')
    return
  }

  console.log(`Found ${reqs.length} requirements in the 6 family\n`)

  // Phase 1: Rename requirements
  console.log('Phase 1: Renaming requirements')
  console.log('-'.repeat(50))

  const renameUpdates: Array<{ id: string; oldNum: string; newNum: string; isHeader?: boolean }> = []

  for (const req of reqs) {
    const mapping = numberMapping[req.requirement_number]
    if (mapping && mapping.newNumber !== req.requirement_number) {
      renameUpdates.push({
        id: req.id,
        oldNum: req.requirement_number,
        newNum: mapping.newNumber,
        isHeader: mapping.isHeader,
      })
    } else if (mapping && mapping.isHeader !== undefined && mapping.isHeader !== req.is_header) {
      // Header flag change only
      renameUpdates.push({
        id: req.id,
        oldNum: req.requirement_number,
        newNum: req.requirement_number,
        isHeader: mapping.isHeader,
      })
    }
  }

  for (const u of renameUpdates) {
    const headerChange = u.isHeader !== undefined ? ` [is_header=${u.isHeader}]` : ''
    if (u.oldNum !== u.newNum) {
      console.log(`  ${u.oldNum.padEnd(12)} → ${u.newNum}${headerChange}`)
    } else {
      console.log(`  ${u.oldNum.padEnd(12)} (header change)${headerChange}`)
    }
  }

  if (!dryRun && renameUpdates.length > 0) {
    console.log('\nApplying renames...')
    for (const u of renameUpdates) {
      const updateData: Record<string, unknown> = { requirement_number: u.newNum }
      if (u.isHeader !== undefined) {
        updateData.is_header = u.isHeader
      }
      const { error } = await supabase
        .from('bsa_merit_badge_requirements')
        .update(updateData)
        .eq('id', u.id)

      if (error) {
        console.error(`  FAILED ${u.oldNum}: ${error.message}`)
      }
    }
    console.log(`  ${renameUpdates.length} requirements renamed`)
  }

  // Phase 2: Fix parent relationships
  // Need to re-fetch after renames
  const { data: updatedReqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, description, is_header, parent_requirement_id')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', 2026)
    .like('requirement_number', '6%')
    .order('display_order')

  if (!updatedReqs) {
    console.error('Failed to re-fetch requirements')
    return
  }

  const reqByNumber = new Map(updatedReqs.map(r => [r.requirement_number, r]))

  console.log('\nPhase 2: Fixing parent relationships')
  console.log('-'.repeat(50))

  // Define parent relationships based on the NEW numbers
  const parentMapping: Record<string, string> = {
    // 6A children
    '6A(1)': '6A',
    '6A(1)(a)': '6A(1)',
    '6A(1)(b)': '6A(1)',
    '6A(1)(c)': '6A(1)',
    '6A(1)(d)': '6A(1)',
    '6A(1)(e)': '6A(1)',
    '6A(2)': '6A',
    '6A(3)': '6A',
    '6A(3)(a)': '6A(3)',
    '6A(3)(b)': '6A(3)',
    // 6B children
    '6B(1)': '6B',
    '6B(1)(a)': '6B(1)',
    '6B(1)(b)': '6B(1)',
    '6B(1)(c)': '6B(1)',
    '6B(2)': '6B',
    '6B(2)(a)': '6B(2)',
    '6B(2)(b)': '6B(2)',
    '6B(2)(c)': '6B(2)',
    '6B(3)': '6B',
    '6B(4)': '6B',
    '6B(5)': '6B',
  }

  const parentUpdates: Array<{ id: string; reqNum: string; oldParent: string; newParent: string; newParentId: string }> = []

  for (const req of updatedReqs) {
    const expectedParentNum = parentMapping[req.requirement_number]
    if (!expectedParentNum) continue

    const expectedParent = reqByNumber.get(expectedParentNum)
    if (!expectedParent) {
      console.log(`  WARNING: Expected parent ${expectedParentNum} not found for ${req.requirement_number}`)
      continue
    }

    if (req.parent_requirement_id !== expectedParent.id) {
      const currentParent = req.parent_requirement_id
        ? updatedReqs.find(r => r.id === req.parent_requirement_id)
        : null
      parentUpdates.push({
        id: req.id,
        reqNum: req.requirement_number,
        oldParent: currentParent?.requirement_number || '(none)',
        newParent: expectedParentNum,
        newParentId: expectedParent.id,
      })
    }
  }

  for (const u of parentUpdates) {
    console.log(`  ${u.reqNum.padEnd(12)} parent: ${u.oldParent.padEnd(10)} → ${u.newParent}`)
  }

  if (!dryRun && parentUpdates.length > 0) {
    console.log('\nApplying parent updates...')
    for (const u of parentUpdates) {
      const { error } = await supabase
        .from('bsa_merit_badge_requirements')
        .update({ parent_requirement_id: u.newParentId })
        .eq('id', u.id)

      if (error) {
        console.error(`  FAILED ${u.reqNum}: ${error.message}`)
      }
    }
    console.log(`  ${parentUpdates.length} parent relationships updated`)
  }

  if (dryRun) {
    console.log('\nDRY RUN - No changes made')
    return
  }

  // Show final structure
  console.log('\n' + '='.repeat(70))
  console.log('FINAL STRUCTURE')
  console.log('='.repeat(70))

  const { data: finalReqs } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, description, is_header, parent_requirement_id')
    .eq('merit_badge_id', badge.id)
    .eq('version_year', 2026)
    .like('requirement_number', '6%')
    .order('display_order')

  const finalReqMap = new Map(finalReqs?.map(r => [r.id, r]) || [])

  for (const r of finalReqs || []) {
    const parent = r.parent_requirement_id ? finalReqMap.get(r.parent_requirement_id) : null
    const h = r.is_header ? ' [H]' : ''
    const depth = r.requirement_number.split(/[()]/).length - 1
    const indent = '  '.repeat(depth)
    console.log(`${indent}${r.requirement_number}${h} (parent: ${parent?.requirement_number || 'none'})`)
  }
}

main().catch(console.error)
