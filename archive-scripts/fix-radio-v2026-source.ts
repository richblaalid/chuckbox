#!/usr/bin/env npx tsx

/**
 * Fix Radio v2026 source data structure
 *
 * Issues:
 * 1. 8 Option E(2)(a) through (g) were at ROOT level - FIXED
 * 2. All option sub-requirements (8 Option A (1), etc.) are direct children of 8
 *    but should be under intermediate option headers (8 Option A, 8 Option B, etc.)
 *
 * Fix:
 * 1. Create headers: 8 Option A, 8 Option B, 8 Option C, 8 Option D, 8 Option E
 * 2. Move each option's sub-requirements under its header
 * 3. 8 Option E(2) should contain (a-g) as children
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

// Option header descriptions from BSA
const OPTION_DESCRIPTIONS: Record<string, string> = {
  A: 'Amateur Radio',
  B: 'Radio Broadcasting',
  C: 'Shortwave and Medium-Wave Listening',
  D: 'Amateur Radio Direction Finding',
  E: 'Family Radio Service (FRS) or General Mobile Radio Service (GMRS)',
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

function fixRadioV2026(data: CanonicalData): { fixed: boolean; changes: string[] } {
  const changes: string[] = []

  // Find Radio badge
  const radio = data.merit_badges.find(b => b.name === 'Radio')
  if (!radio) {
    console.error('Radio badge not found')
    return { fixed: false, changes }
  }

  // Find v2026
  const v2026 = radio.versions.find(v => v.version_year === 2026)
  if (!v2026) {
    console.error('Radio v2026 not found')
    return { fixed: false, changes }
  }

  // Find requirement 8
  const req8 = v2026.requirements.find(r => r.requirement_number === '8')
  if (!req8) {
    console.error('Requirement 8 not found')
    return { fixed: false, changes }
  }

  if (!req8.children) {
    console.error('Requirement 8 has no children')
    return { fixed: false, changes }
  }

  // Group children by option letter
  const optionGroups: Record<string, Requirement[]> = { A: [], B: [], C: [], D: [], E: [] }

  for (const child of req8.children) {
    // Match "8 Option X" or "8 Option X(...)"
    const match = child.requirement_number.match(/^8 Option ([A-E])/)
    if (match) {
      const option = match[1]
      optionGroups[option].push(child)
    }
  }

  // Check if already has option headers
  const hasOptionHeaders = req8.children.some(c => /^8 Option [A-E]$/.test(c.requirement_number))
  if (hasOptionHeaders) {
    console.log('Option headers already exist - may already be fixed')
    return { fixed: false, changes }
  }

  console.log('Current option counts:')
  for (const [option, reqs] of Object.entries(optionGroups)) {
    console.log(`  Option ${option}: ${reqs.length} requirements`)
  }

  // Create new structure with option headers
  const newChildren: Requirement[] = []

  for (const option of ['A', 'B', 'C', 'D', 'E']) {
    const optionReqs = optionGroups[option]
    if (optionReqs.length === 0) continue

    // Create option header
    const optionHeader: Requirement = {
      requirement_number: `8 Option ${option}`,
      scoutbook_id: `8 Option ${option}`,
      description: OPTION_DESCRIPTIONS[option] || `Option ${option}`,
      is_header: true,
      nesting_depth: 2, // Will be recalculated
      display_order: 0, // Will be recalculated
      children: optionReqs.map(r => ({
        ...r,
        nesting_depth: 3, // Will be recalculated
      })),
    }

    newChildren.push(optionHeader)
    changes.push(`Created 8 Option ${option} header with ${optionReqs.length} children`)
  }

  // Replace req8's children with the new structure
  req8.children = newChildren
  changes.push('Replaced requirement 8 children with option-grouped structure')

  // Recalculate nesting depths and display orders for the whole badge version
  recalculateNestingDepth(v2026.requirements, 1)
  recalculateDisplayOrder(v2026.requirements, 1)

  changes.push('Recalculated nesting_depth and display_order for all requirements')

  return { fixed: true, changes }
}

async function main() {
  console.log('Loading canonical data...')
  const data: CanonicalData = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf-8'))

  console.log('\nFixing Radio v2026...')
  const result = fixRadioV2026(data)

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
