#!/usr/bin/env npx tsx

/**
 * Fix ALL source data structure issues across all badges
 *
 * This script automatically:
 * 1. Identifies requirements at wrong tree depth
 * 2. Creates missing parent headers
 * 3. Moves requirements to their correct positions
 * 4. Recalculates nesting_depth and display_order
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
  version_date?: string
  is_current?: boolean
  is_estimated?: boolean
  requirements: Requirement[]
}

interface Badge {
  name: string
  code?: string
  category: string
  description?: string | null
  is_eagle_required?: boolean
  is_active?: boolean
  image_url: string
  requirement_version_year?: number
  versions: BadgeVersion[]
}

interface CanonicalData {
  generated?: string
  source?: string
  merit_badges: Badge[]
  ranks?: unknown[]
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

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
 * Parse a requirement number into its component parts.
 * Handles both bracket [N] and parenthetical (N) notation.
 */
function parseRequirementNumber(num: string): Array<{ type: string; value: string }> {
  const parts: Array<{ type: string; value: string }> = []
  let remaining = num

  // Extract leading number
  const leadingMatch = remaining.match(/^(\d+)/)
  if (leadingMatch) {
    parts.push({ type: 'number', value: leadingMatch[1] })
    remaining = remaining.slice(leadingMatch[0].length)
  }

  // Extract remaining parts
  while (remaining.length > 0) {
    // Uppercase letter (option)
    const upperMatch = remaining.match(/^([A-Z])/)
    if (upperMatch) {
      parts.push({ type: 'uppercase', value: upperMatch[1] })
      remaining = remaining.slice(1)
      continue
    }

    // Lowercase letter
    const lowerMatch = remaining.match(/^([a-z])/)
    if (lowerMatch) {
      parts.push({ type: 'lowercase', value: lowerMatch[1] })
      remaining = remaining.slice(1)
      continue
    }

    // Bracket number [1], [2], etc.
    const bracketNumMatch = remaining.match(/^\[(\d+)\]/)
    if (bracketNumMatch) {
      parts.push({ type: 'paren_number', value: bracketNumMatch[1] })
      remaining = remaining.slice(bracketNumMatch[0].length)
      continue
    }

    // Parenthetical number
    const parenNumMatch = remaining.match(/^\((\d+)\)/)
    if (parenNumMatch) {
      parts.push({ type: 'paren_number', value: parenNumMatch[1] })
      remaining = remaining.slice(parenNumMatch[0].length)
      continue
    }

    // Parenthetical letter
    const parenLetterMatch = remaining.match(/^\(([a-z])\)/)
    if (parenLetterMatch) {
      parts.push({ type: 'paren_letter', value: parenLetterMatch[1] })
      remaining = remaining.slice(parenLetterMatch[0].length)
      continue
    }

    // Skip spaces and other characters
    remaining = remaining.slice(1)
  }

  return parts
}

/**
 * Calculate expected depth from requirement number.
 */
function calculateExpectedDepth(reqNum: string): number {
  const parts = parseRequirementNumber(reqNum)
  return Math.max(0, parts.length - 1)
}

/**
 * Get parent requirement number from a child number.
 * Handles both bracket [N] and parenthetical (N) notation.
 */
function getParentNumber(num: string): string | null {
  // Pattern: ends with (letter) like (a), (b)
  if (/\([a-z]\)$/.test(num)) {
    return num.replace(/\([a-z]\)$/, '')
  }

  // Pattern: ends with trailing lowercase letter after bracket/parenthetical like 7a[1]a or 7a(1)a
  if (/[\]\)][a-z]$/.test(num)) {
    return num.replace(/[a-z]$/, '')
  }

  // Pattern: ends with [number] like [1], [2]
  if (/\[\d+\]$/.test(num)) {
    return num.replace(/\[\d+\]$/, '')
  }

  // Pattern: ends with (number) like (1), (2)
  if (/\(\d+\)$/.test(num)) {
    return num.replace(/\(\d+\)$/, '')
  }

  // Pattern: ends with uppercase letter option like 6A, 6B
  if (/^\d+[A-Z]$/.test(num)) {
    return num.replace(/[A-Z]$/, '')
  }

  // Pattern: option sub-requirement like 4Aa, 4Ab (digit + uppercase + lowercase)
  if (/^\d+[A-Z][a-z]$/.test(num)) {
    return num.replace(/[a-z]$/, '')
  }

  // Pattern: ends with lowercase letter like 1a, 1b
  if (/^\d+[a-z]$/.test(num)) {
    return num.replace(/[a-z]$/, '')
  }

  // Top-level number
  return null
}

/**
 * Find a requirement by number in the tree.
 */
function findRequirement(reqs: Requirement[], number: string): Requirement | null {
  for (const req of reqs) {
    if (req.requirement_number === number) {
      return req
    }
    if (req.children && req.children.length > 0) {
      const found = findRequirement(req.children, number)
      if (found) return found
    }
  }
  return null
}

/**
 * Create a header requirement with default values.
 */
function createHeader(reqNum: string, description: string = ''): Requirement {
  return {
    requirement_number: reqNum,
    scoutbook_id: reqNum,
    description: description || `Do the following:`,
    is_header: true,
    nesting_depth: 0,
    display_order: 0,
    children: [],
  }
}

/**
 * Collect all requirements from the tree into a flat list.
 */
function collectAllRequirements(reqs: Requirement[]): Requirement[] {
  const all: Requirement[] = []
  function collect(requirements: Requirement[]) {
    for (const req of requirements) {
      all.push(req)
      if (req.children && req.children.length > 0) {
        collect(req.children)
      }
    }
  }
  collect(reqs)
  return all
}

/**
 * Compare requirement numbers for sorting.
 */
function compareRequirementNumbers(a: Requirement, b: Requirement): number {
  const partsA = parseRequirementNumber(a.requirement_number)
  const partsB = parseRequirementNumber(b.requirement_number)

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || { type: 'none', value: '' }
    const partB = partsB[i] || { type: 'none', value: '' }

    if (partA.type === 'none' && partB.type !== 'none') return -1
    if (partA.type !== 'none' && partB.type === 'none') return 1
    if (partA.type === 'none' && partB.type === 'none') return 0

    const typePriority: Record<string, number> = {
      number: 0,
      uppercase: 1,
      lowercase: 2,
      paren_number: 3,
      paren_letter: 4,
    }

    const priorityA = typePriority[partA.type] ?? 5
    const priorityB = typePriority[partB.type] ?? 5

    if (priorityA !== priorityB) return priorityA - priorityB

    if (partA.type === 'number' || partA.type === 'paren_number') {
      const valA = parseInt(partA.value, 10)
      const valB = parseInt(partB.value, 10)
      if (valA !== valB) return valA - valB
    } else {
      if (partA.value !== partB.value) {
        return partA.value.localeCompare(partB.value)
      }
    }
  }

  return 0
}

// =============================================================================
// MAIN FIX LOGIC
// =============================================================================

interface FixResult {
  badge: string
  version: number
  headersCreated: number
  requirementsMoved: number
  fixed: boolean
}

function fixBadgeVersion(badge: Badge, version: BadgeVersion): FixResult {
  const result: FixResult = {
    badge: badge.name,
    version: version.version_year,
    headersCreated: 0,
    requirementsMoved: 0,
    fixed: false,
  }

  // Collect all requirements (flattened)
  const allReqs = collectAllRequirements(version.requirements)

  // Build a map of all requirements by number
  const reqMap = new Map<string, Requirement>()
  for (const req of allReqs) {
    reqMap.set(req.requirement_number, req)
  }

  // Find requirements at wrong depth
  const misplaced: Array<{ req: Requirement; expectedParent: string }> = []

  function checkDepth(requirements: Requirement[], currentDepth: number) {
    for (const req of requirements) {
      const expectedDepth = calculateExpectedDepth(req.requirement_number)
      if (expectedDepth !== currentDepth) {
        const expectedParent = getParentNumber(req.requirement_number)
        if (expectedParent) {
          misplaced.push({ req, expectedParent })
        }
      }
      if (req.children && req.children.length > 0) {
        checkDepth(req.children, currentDepth + 1)
      }
    }
  }

  checkDepth(version.requirements, 0)

  if (misplaced.length === 0) {
    return result
  }

  // Create missing parent headers
  const parentsNeeded = new Set<string>()
  for (const { expectedParent } of misplaced) {
    // Build the chain of parents
    let parent: string | null = expectedParent
    while (parent && !reqMap.has(parent)) {
      parentsNeeded.add(parent)
      parent = getParentNumber(parent)
    }
  }

  // Create headers sorted by depth (shallowest first)
  const sortedParents = Array.from(parentsNeeded).sort((a, b) => {
    const depthA = calculateExpectedDepth(a)
    const depthB = calculateExpectedDepth(b)
    return depthA - depthB
  })

  for (const parentNum of sortedParents) {
    const header = createHeader(parentNum)
    reqMap.set(parentNum, header)
    result.headersCreated++
  }

  // Now rebuild the tree with correct structure
  // Start fresh with only top-level requirements
  const topLevel: Requirement[] = []
  const processed = new Set<string>()

  // Sort all requirements by number for consistent ordering
  const allReqsSorted = Array.from(reqMap.values()).sort(compareRequirementNumbers)

  // First pass: identify top-level requirements
  for (const req of allReqsSorted) {
    const expectedDepth = calculateExpectedDepth(req.requirement_number)
    if (expectedDepth === 0) {
      // Clear children, we'll rebuild
      req.children = []
      topLevel.push(req)
      processed.add(req.requirement_number)
    }
  }

  // Second pass: add children to their parents
  for (const req of allReqsSorted) {
    if (processed.has(req.requirement_number)) continue

    const parentNum = getParentNumber(req.requirement_number)
    if (!parentNum) continue

    const parent = reqMap.get(parentNum)
    if (!parent) continue

    // Clear children if this is a new insert
    if (!processed.has(req.requirement_number)) {
      req.children = req.children || []
    }

    if (!parent.children) {
      parent.children = []
    }

    // Check if already a child
    if (!parent.children.some(c => c.requirement_number === req.requirement_number)) {
      parent.children.push(req)
      result.requirementsMoved++
    }

    processed.add(req.requirement_number)
  }

  // Sort all children
  function sortChildren(req: Requirement) {
    if (req.children && req.children.length > 1) {
      req.children.sort(compareRequirementNumbers)
    }
    if (req.children) {
      for (const child of req.children) {
        sortChildren(child)
      }
    }
  }

  topLevel.sort(compareRequirementNumbers)
  for (const req of topLevel) {
    sortChildren(req)
  }

  // Update is_header based on children
  function updateIsHeader(req: Requirement) {
    req.is_header = (req.children?.length ?? 0) > 0
    if (req.children) {
      for (const child of req.children) {
        updateIsHeader(child)
      }
    }
  }

  for (const req of topLevel) {
    updateIsHeader(req)
  }

  // Replace requirements
  version.requirements = topLevel

  // Recalculate depths and orders
  recalculateNestingDepth(version.requirements, 1)
  recalculateDisplayOrder(version.requirements, 1)

  result.fixed = true
  return result
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('Loading canonical data...')
  const data: CanonicalData = JSON.parse(fs.readFileSync(CANONICAL_PATH, 'utf-8'))

  console.log(`Found ${data.merit_badges.length} badges`)

  const results: FixResult[] = []
  let totalFixed = 0
  let totalHeadersCreated = 0
  let totalMoved = 0

  for (const badge of data.merit_badges) {
    for (const version of badge.versions) {
      const result = fixBadgeVersion(badge, version)
      if (result.fixed) {
        results.push(result)
        totalFixed++
        totalHeadersCreated += result.headersCreated
        totalMoved += result.requirementsMoved
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('                         RESULTS')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Badge versions fixed: ${totalFixed}`)
  console.log(`Headers created: ${totalHeadersCreated}`)
  console.log(`Requirements moved: ${totalMoved}`)

  if (results.length > 0) {
    console.log('\nDetails:')
    for (const r of results.slice(0, 20)) {
      console.log(`  ${r.badge} v${r.version}: ${r.headersCreated} headers, ${r.requirementsMoved} moved`)
    }
    if (results.length > 20) {
      console.log(`  ... and ${results.length - 20} more`)
    }
  }

  // Write updated data
  console.log('\nWriting updated canonical data...')
  fs.writeFileSync(CANONICAL_PATH, JSON.stringify(data, null, 2))
  console.log('Done!')
}

main().catch(console.error)
