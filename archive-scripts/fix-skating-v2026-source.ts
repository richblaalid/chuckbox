#!/usr/bin/env npx tsx

/**
 * Fix Skating v2026 source data structure
 *
 * Issues:
 * 1. 2 Option D (14)(a) through (e) are at ROOT level - should be children of 2 Option D (14)
 * 2. All option sub-requirements are direct children of 2 - need intermediate option headers
 *
 * Fix:
 * 1. Remove 2 Option D (14)(a-e) from root level
 * 2. Create option headers: 2 Option A, 2 Option B, 2 Option C, 2 Option D
 * 3. Group each option's sub-requirements under its header
 * 4. Create 2 Option D (14) header with (a-e) as children
 *
 * PRESERVES: All scoutbook_id values unchanged
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CANONICAL_PATH = path.join(__dirname, '../data/bsa-data-canonical.json')

interface Requirement {
  requirement_number: string
  scoutbook_id: string
  description: string
  is_header: boolean
  nesting_depth: number
  display_order: number
  children?: Requirement[]
}

interface BadgeVersion {
  version_year: number
  version_date: string
  is_current: boolean
  requirements: Requirement[]
}

interface Badge {
  name: string
  category: string
  image_url: string
  versions: BadgeVersion[]
}

interface CanonicalData {
  merit_badges: Badge[]
  ranks: unknown[]
}

// Option header descriptions for Skating
const OPTION_DESCRIPTIONS: Record<string, string> = {
  A: 'Ice Skating',
  B: 'Roller Skating',
  C: 'In-Line Skating',
  D: 'Skateboarding',
}

function recalculateDisplayOrder(reqs: Requirement[], startOrder: number = 1): number {
  let order = startOrder
  for (const req of reqs) {
    req.display_order = order++
    if (req.children && req.children.length > 0) {
      order = recalculateDisplayOrder(req.children, order)
    }
  }
  return order
}

function recalculateNestingDepth(reqs: Requirement[], depth: number = 1): void {
  for (const req of reqs) {
    req.nesting_depth = depth
    if (req.children && req.children.length > 0) {
      recalculateNestingDepth(req.children, depth + 1)
    }
  }
}

function fixSkatingV2026(data: CanonicalData): { fixed: boolean; changes: string[] } {
  const changes: string[] = []

  // Find Skating badge
  const skating = data.merit_badges.find(b => b.name === 'Skating')
  if (!skating) {
    console.error('Skating badge not found')
    return { fixed: false, changes }
  }

  // Find v2026
  const v2026 = skating.versions.find(v => v.version_year === 2026)
  if (!v2026) {
    console.error('Skating v2026 not found')
    return { fixed: false, changes }
  }

  const rootReqs = v2026.requirements

  // Find and remove 2 Option D (14)(a-e) from root level
  const optionD14Pattern = /^2 Option D \(14\)\([a-e]\)$/
  const misplacedReqs = rootReqs.filter(r => optionD14Pattern.test(r.requirement_number))

  if (misplacedReqs.length === 0) {
    console.log('No misplaced requirements found at root level')
  } else {
    console.log(`Found ${misplacedReqs.length} misplaced requirements at root level:`)
    misplacedReqs.forEach(r => console.log(`  - ${r.requirement_number}`))

    // Remove them from root
    v2026.requirements = rootReqs.filter(r => !optionD14Pattern.test(r.requirement_number))
    changes.push(`Removed ${misplacedReqs.length} requirements from root level`)
  }

  // Find requirement 2
  const req2 = v2026.requirements.find(r => r.requirement_number === '2')
  if (!req2) {
    console.error('Requirement 2 not found')
    return { fixed: false, changes }
  }

  if (!req2.children) {
    console.error('Requirement 2 has no children')
    return { fixed: false, changes }
  }

  // Check if already has option headers
  const hasOptionHeaders = req2.children.some(c => /^2 Option [A-D]$/.test(c.requirement_number))
  if (hasOptionHeaders) {
    console.log('Option headers already exist - may already be fixed')
    return { fixed: false, changes }
  }

  // Group children by option letter
  const optionGroups: Record<string, Requirement[]> = { A: [], B: [], C: [], D: [] }

  for (const child of req2.children) {
    const match = child.requirement_number.match(/^2 Option ([A-D])/)
    if (match) {
      const option = match[1]
      optionGroups[option].push(child)
    }
  }

  console.log('\nCurrent option counts:')
  for (const [option, reqs] of Object.entries(optionGroups)) {
    console.log(`  Option ${option}: ${reqs.length} requirements`)
  }

  // Create new structure with option headers
  const newChildren: Requirement[] = []

  for (const option of ['A', 'B', 'C', 'D']) {
    const optionReqs = optionGroups[option]
    if (optionReqs.length === 0) continue

    // Create option header
    const optionHeader: Requirement = {
      requirement_number: `2 Option ${option}`,
      scoutbook_id: `2 Option ${option}`,
      description: OPTION_DESCRIPTIONS[option] || `Option ${option}`,
      is_header: true,
      nesting_depth: 2,
      display_order: 0,
      children: optionReqs.map(r => ({
        ...r,
        nesting_depth: 3,
      })),
    }

    // For Option D, we need to add (14) with its children
    if (option === 'D' && misplacedReqs.length > 0) {
      // Create 2 Option D (14) header
      const optD14Header: Requirement = {
        requirement_number: '2 Option D (14)',
        scoutbook_id: '2 Option D (14)',
        description: 'Demonstrate the following skateboard tricks:',
        is_header: true,
        nesting_depth: 3,
        display_order: 0,
        children: misplacedReqs.map(r => ({
          ...r,
          nesting_depth: 4,
        })),
      }

      // Add (14) to Option D's children
      optionHeader.children!.push(optD14Header)
      changes.push(`Created 2 Option D (14) header with ${misplacedReqs.length} children`)
    }

    newChildren.push(optionHeader)
    changes.push(`Created 2 Option ${option} header with ${optionReqs.length} children`)
  }

  // Replace req2's children with the new structure
  req2.children = newChildren
  changes.push('Replaced requirement 2 children with option-grouped structure')

  // Recalculate nesting depths and display orders for the whole badge version
  recalculateNestingDepth(v2026.requirements, 1)
  recalculateDisplayOrder(v2026.requirements, 1)

  changes.push('Recalculated nesting_depth and display_order for all requirements')

  return { fixed: true, changes }
}

async function main() {
  console.log('Loading canonical data...')
  const data: CanonicalData = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf-8'))

  console.log('\nFixing Skating v2026...')
  const result = fixSkatingV2026(data)

  if (result.fixed) {
    console.log('\nChanges made:')
    result.changes.forEach(c => console.log(`  - ${c}`))

    // Write back
    console.log('\nWriting updated canonical data...')
    fs.writeFileSync(CANONICAL_PATH, JSON.stringify(data, null, 2))
    console.log('Done!')
  } else {
    console.log('\nNo changes needed or fix failed')
  }
}

main().catch(console.error)
