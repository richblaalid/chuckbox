#!/usr/bin/env npx tsx

/**
 * Fix Archery source data structure for v2016
 *
 * Issues:
 * 1. 5f[1]a Opt A/B, 5f[1]b Opt A/B, etc. are at ROOT level - should be nested
 * 2. 5f[2] Opt A/B, 5f[3] Opt A/B, 5f[4] Opt A/B are at ROOT level
 *
 * Fix:
 * 1. Create missing intermediate headers in the tree (5f, 5f[1])
 * 2. Move misplaced requirements from ROOT to correct positions
 * 3. Normalize naming to use parentheses instead of brackets
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

function findOrCreateChild(parent: Requirement, childNumber: string, description: string): Requirement {
  if (!parent.children) {
    parent.children = []
  }

  let child = parent.children.find(c => c.requirement_number === childNumber)
  if (!child) {
    child = {
      requirement_number: childNumber,
      scoutbook_id: childNumber,
      description: description,
      is_header: true,
      nesting_depth: parent.nesting_depth + 1,
      display_order: 0,
      children: [],
    }
    parent.children.push(child)
  }
  return child
}

function fixArcheryV2016(v2016: BadgeVersion, changes: string[]): boolean {
  const rootReqs = v2016.requirements

  // Pattern for misplaced requirements: 5f[N] or 5f[N]x Opt A/B
  const misplacedPattern = /^5f\[(\d+)\]([a-e])? Opt ([AB])$/
  const misplacedReqs = rootReqs.filter(r => misplacedPattern.test(r.requirement_number))

  if (misplacedReqs.length === 0) {
    console.log('v2016: No misplaced requirements found at root level')
    return false
  }

  console.log(`v2016: Found ${misplacedReqs.length} misplaced requirements at root level`)

  // Remove from root
  v2016.requirements = rootReqs.filter(r => !misplacedPattern.test(r.requirement_number))
  changes.push(`v2016: Removed ${misplacedReqs.length} requirements from root level`)

  // Find requirement 5
  const req5 = v2016.requirements.find(r => r.requirement_number === '5')
  if (!req5) {
    console.error('v2016: Requirement 5 not found')
    return false
  }

  // Ensure 5f exists
  const req5f = findOrCreateChild(req5, '5f', 'Demonstrate shooting technique')
  changes.push('v2016: Ensured 5f header exists')

  // Group misplaced requirements by bracket number
  const byBracketNum: Record<string, Requirement[]> = {}
  for (const req of misplacedReqs) {
    const match = req.requirement_number.match(misplacedPattern)
    if (match) {
      const bracketNum = match[1]
      if (!byBracketNum[bracketNum]) {
        byBracketNum[bracketNum] = []
      }
      byBracketNum[bracketNum].push(req)
    }
  }

  // For each bracket number, ensure the parent exists and add children
  for (const [bracketNum, reqs] of Object.entries(byBracketNum)) {
    // Create 5f[N] header (or 5f(N) in normalized form)
    const headerNum = `5f[${bracketNum}]`
    const header = findOrCreateChild(req5f, headerNum, `Requirement 5f part ${bracketNum}`)
    changes.push(`v2016: Ensured ${headerNum} header exists`)

    // Group by letter (a-e or none)
    const byLetter: Record<string, Requirement[]> = { '': [] }
    for (const req of reqs) {
      const match = req.requirement_number.match(misplacedPattern)
      if (match) {
        const letter = match[2] || ''
        if (!byLetter[letter]) {
          byLetter[letter] = []
        }
        byLetter[letter].push(req)
      }
    }

    for (const [letter, letterReqs] of Object.entries(byLetter)) {
      if (letterReqs.length === 0) continue

      if (letter) {
        // Create 5f[N]x header
        const letterHeaderNum = `5f[${bracketNum}]${letter}`
        const letterHeader = findOrCreateChild(header, letterHeaderNum, `Part ${letter}`)
        letterHeader.children = letterReqs.map(r => ({
          ...r,
          nesting_depth: letterHeader.nesting_depth + 1,
        }))
        letterHeader.is_header = true
        changes.push(`v2016: Created ${letterHeaderNum} with ${letterReqs.length} children`)
      } else {
        // No letter - add directly to bracket header
        header.children = header.children || []
        header.children.push(...letterReqs.map(r => ({
          ...r,
          nesting_depth: header.nesting_depth + 1,
        })))
        changes.push(`v2016: Added ${letterReqs.length} children to ${headerNum}`)
      }
    }
  }

  return true
}

function fixArchery(data: CanonicalData): { fixed: boolean; changes: string[] } {
  const changes: string[] = []

  // Find Archery badge
  const archery = data.merit_badges.find(b => b.name === 'Archery')
  if (!archery) {
    console.error('Archery badge not found')
    return { fixed: false, changes }
  }

  let anyFixed = false

  // Fix v2016
  const v2016 = archery.versions.find(v => v.version_year === 2016)
  if (v2016) {
    const fixed = fixArcheryV2016(v2016, changes)
    if (fixed) {
      anyFixed = true
      recalculateNestingDepth(v2016.requirements, 1)
      recalculateDisplayOrder(v2016.requirements, 1)
      changes.push('v2016: Recalculated nesting_depth and display_order')
    }
  }

  return { fixed: anyFixed, changes }
}

async function main() {
  console.log('Loading canonical data...')
  const data: CanonicalData = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf-8'))

  console.log('\nFixing Archery...')
  const result = fixArchery(data)

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
