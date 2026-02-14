#!/usr/bin/env npx tsx

/**
 * Fix Plant Science v2026 source data structure
 *
 * Issues:
 * 1. 8 Option A/B/C sub-requirements are direct children of req 8
 * 2. Many deeper nested requirements are at ROOT level
 * 3. Need intermediate option headers and proper tree structure
 *
 * Fix:
 * 1. Remove all 8 Option* requirements from root level
 * 2. Create option headers: 8 Option A, 8 Option B, 8 Option C
 * 3. Build proper tree structure for all requirements
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

// Option header descriptions for Plant Science v2026
const OPTION_DESCRIPTIONS: Record<string, string> = {
  A: 'Agronomy',
  B: 'Horticulture',
  C: 'Field Botany',
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

/**
 * Parse a Plant Science requirement number to extract the parent path
 * e.g., "8 Option A (5)(a)(1)" -> parent is "8 Option A (5)(a)"
 */
function getParentNumber(reqNum: string): string | null {
  // Match: 8 Option X followed by parenthetical parts
  // "8 Option A (5)(a)(1)" -> "8 Option A (5)(a)"
  // "8 Option A (5)(a)" -> "8 Option A (5)"
  // "8 Option A (5)" -> "8 Option A"
  // "8 Option A" -> "8"

  // Try to remove the last parenthetical part
  const lastParenMatch = reqNum.match(/^(.+)\([^()]+\)$/)
  if (lastParenMatch) {
    return lastParenMatch[1].trim()
  }

  // If it's just "8 Option X", parent is "8"
  if (/^8 Option [A-C]$/.test(reqNum)) {
    return '8'
  }

  return null
}

function findOrCreateRequirement(
  allReqs: Map<string, Requirement>,
  reqNum: string,
  description: string = ''
): Requirement {
  let req = allReqs.get(reqNum)
  if (!req) {
    req = {
      requirement_number: reqNum,
      scoutbook_id: reqNum,
      description: description,
      is_header: true,
      nesting_depth: 0,
      display_order: 0,
      children: [],
    }
    allReqs.set(reqNum, req)
  }
  return req
}

function fixPlantScienceV2026(data: CanonicalData): { fixed: boolean; changes: string[] } {
  const changes: string[] = []

  // Find Plant Science badge
  const ps = data.merit_badges.find(b => b.name === 'Plant Science')
  if (!ps) {
    console.error('Plant Science badge not found')
    return { fixed: false, changes }
  }

  // Find v2026
  const v2026 = ps.versions.find(v => v.version_year === 2026)
  if (!v2026) {
    console.error('Plant Science v2026 not found')
    return { fixed: false, changes }
  }

  // Collect all 8 Option requirements (from root and from req 8's children)
  const allOptionReqs: Requirement[] = []

  // From root level
  const rootOptionReqs = v2026.requirements.filter(r => r.requirement_number.startsWith('8 Option'))
  allOptionReqs.push(...rootOptionReqs)
  changes.push(`Found ${rootOptionReqs.length} Option requirements at root level`)

  // From req 8's children
  const req8 = v2026.requirements.find(r => r.requirement_number === '8')
  if (req8?.children) {
    const childOptionReqs = req8.children.filter(r => r.requirement_number.startsWith('8 Option'))
    allOptionReqs.push(...childOptionReqs)
    changes.push(`Found ${childOptionReqs.length} Option requirements under req 8`)
  }

  console.log(`Total Option requirements to reorganize: ${allOptionReqs.length}`)

  // Remove Option requirements from root level
  v2026.requirements = v2026.requirements.filter(r => !r.requirement_number.startsWith('8 Option'))
  changes.push('Removed all Option requirements from root level')

  // Create a map to hold all requirements by number
  const allReqs = new Map<string, Requirement>()

  // Start with the option headers
  for (const option of ['A', 'B', 'C']) {
    const headerNum = `8 Option ${option}`
    findOrCreateRequirement(allReqs, headerNum, OPTION_DESCRIPTIONS[option])
  }

  // Add all requirements to the map
  for (const req of allOptionReqs) {
    // Some requirements have typos like "8 Option B(4(a)" - fix them
    let fixedNum = req.requirement_number.replace(/\((\d+)\(([a-z])\)$/, '($1)($2)')
    if (fixedNum !== req.requirement_number) {
      console.log(`  Fixed typo: "${req.requirement_number}" -> "${fixedNum}"`)
      req.requirement_number = fixedNum
    }

    allReqs.set(req.requirement_number, req)
  }

  // Build the tree structure
  const optionHeaders: Requirement[] = []

  for (const [reqNum, req] of allReqs.entries()) {
    const parentNum = getParentNumber(reqNum)

    if (parentNum === '8') {
      // This is a top-level option header
      optionHeaders.push(req)
    } else if (parentNum) {
      // Find or create parent and add this as child
      const parent = findOrCreateRequirement(allReqs, parentNum, `Header for ${parentNum}`)
      if (!parent.children) {
        parent.children = []
      }
      // Check if already a child
      if (!parent.children.some(c => c.requirement_number === req.requirement_number)) {
        parent.children.push(req)
      }
    }
  }

  // Sort children by requirement number
  function sortChildren(req: Requirement) {
    if (req.children && req.children.length > 0) {
      req.children.sort((a, b) => {
        // Natural sort for requirement numbers
        return a.requirement_number.localeCompare(b.requirement_number, undefined, { numeric: true })
      })
      req.children.forEach(sortChildren)
    }
  }

  optionHeaders.sort((a, b) => a.requirement_number.localeCompare(b.requirement_number))
  optionHeaders.forEach(sortChildren)

  // Update req 8 with the new structure
  if (!req8) {
    console.error('Requirement 8 not found after filtering')
    return { fixed: false, changes }
  }

  // Mark headers correctly
  function updateIsHeader(req: Requirement) {
    req.is_header = (req.children?.length ?? 0) > 0
    req.children?.forEach(updateIsHeader)
  }
  optionHeaders.forEach(updateIsHeader)

  req8.children = optionHeaders
  changes.push(`Set req 8 children to ${optionHeaders.length} option headers`)

  // Show structure
  function countTotal(req: Requirement): number {
    let count = 1
    if (req.children) {
      for (const child of req.children) {
        count += countTotal(child)
      }
    }
    return count
  }

  for (const header of optionHeaders) {
    const total = countTotal(header)
    console.log(`  ${header.requirement_number}: ${total} total requirements`)
  }

  // Recalculate nesting depths and display orders for the whole badge version
  recalculateNestingDepth(v2026.requirements, 1)
  recalculateDisplayOrder(v2026.requirements, 1)

  changes.push('Recalculated nesting_depth and display_order for all requirements')

  return { fixed: true, changes }
}

async function main() {
  console.log('Loading canonical data...')
  const data: CanonicalData = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf-8'))

  console.log('\nFixing Plant Science v2026...')
  const result = fixPlantScienceV2026(data)

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
