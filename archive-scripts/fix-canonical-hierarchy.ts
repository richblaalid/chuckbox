/**
 * Fix hierarchy structure in canonical merit badge data.
 *
 * This script:
 * 1. Identifies parent-child relationships based on scoutbook_id patterns
 * 2. Nests children inside their parent's children[] array
 * 3. Recalculates display_order sequentially
 *
 * Usage: npx tsx scripts/fix-canonical-hierarchy.ts
 *        npx tsx scripts/fix-canonical-hierarchy.ts --dry-run
 */

import * as fs from 'fs'
import * as path from 'path'

interface Requirement {
  requirement_number: string
  scoutbook_id: string
  description: string
  is_header: boolean
  display_order: number
  children: Requirement[]
}

interface BadgeVersion {
  version_year: number
  is_estimated: boolean
  requirements: Requirement[]
}

interface MeritBadge {
  code: string
  name: string
  category: string
  description: string | null
  is_eagle_required: boolean
  is_active: boolean
  image_url: string
  requirement_version_year: number
  versions: BadgeVersion[]
}

interface CanonicalData {
  generated: string
  source: string
  merit_badges: MeritBadge[]
}

const isDryRun = process.argv.includes('--dry-run')

/**
 * Determine if childId is a direct child of parentId based on common patterns.
 *
 * Examples:
 * - "1" -> "1a", "1b" (letter suffix)
 * - "1a" -> "1a(1)", "1a(2)" (wrapped number suffix)
 * - "5A" -> "5A(a)", "5A(b)" (option with wrapped letter)
 * - "5A(e)" -> "5A(e)(1)" (option-letter with wrapped number)
 * - "6" -> "6a beef", "6a avian" (Animal Science named options)
 * - "6a" -> "6a1 beef" (sub-numbered named options)
 */
function isDirectChild(parentId: string, childId: string): boolean {
  // Child must start with parent
  if (!childId.startsWith(parentId)) return false

  // Get the suffix after the parent
  const suffix = childId.slice(parentId.length)
  if (!suffix) return false

  // Pattern 1: Single lowercase letter with optional period (1 -> 1a, 1 -> 1a.)
  if (/^[a-z]\.?$/.test(suffix)) return true

  // Pattern 2: Wrapped number ((1), (2), etc.) with optional period
  if (/^\(\d+\)\.?$/.test(suffix)) return true

  // Pattern 3: Wrapped lowercase letter ((a), (b), etc.) with optional period
  if (/^\([a-z]\)\.?$/.test(suffix)) return true

  // Pattern 4: Option letter (A, B - uppercase single letter for options)
  // Only at certain positions (after a number)
  if (/^[A-B]\.?$/.test(suffix) && /\d\.?$/.test(parentId)) return true

  // Pattern 5: Named option with letter (6 -> "6a beef", "6a avian")
  // Must be letter + space + word, where parent is just a number
  if (/^[a-z]\.? \w+$/.test(suffix) && /^\d+\.?$/.test(parentId)) return true

  // Pattern 6: Sub-numbered named option (6a -> "6a1 beef")
  // Letter -> digit + space + word
  if (/^\d+\.? \w+$/.test(suffix) && /[a-z]\.?$/.test(parentId)) return true

  // Pattern 7: Letter + wrapped number (3 -> "3a(1)") - skips intermediate level
  // Only when no intermediate "3a" exists
  if (/^[a-z]\(\d+\)$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // Pattern 8: Letter + wrapped letter (5 -> "5A(a)") - option header children
  if (/^[A-B]\([a-z]\)$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // Pattern 9: Space + word + space + wrapped number (6 -> "6 beef (1)")
  // Animal Science v2025 style
  if (/^ \w+ \(\d+\)$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // Pattern 10: Space + word + space + wrapped number + wrapped letter (6 -> "6 avian (4)(a)")
  if (/^ \w+ \(\d+\)\([a-z]\)$/.test(suffix) && /^\d+$/.test(parentId)) return true

  return false
}

/**
 * Build hierarchy from flat list of requirements.
 */
function buildHierarchy(flatReqs: Requirement[]): Requirement[] {
  // Sort by scoutbook_id length then alphabetically to process parents first
  const sorted = [...flatReqs].sort((a, b) => {
    if (a.scoutbook_id.length !== b.scoutbook_id.length) {
      return a.scoutbook_id.length - b.scoutbook_id.length
    }
    return a.scoutbook_id.localeCompare(b.scoutbook_id, undefined, { numeric: true })
  })

  // Deduplicate by scoutbook_id - keep first occurrence
  const dedupedIds = new Set<string>()
  const deduped = sorted.filter(req => {
    if (dedupedIds.has(req.scoutbook_id)) {
      return false
    }
    dedupedIds.add(req.scoutbook_id)
    return true
  })

  // Map for quick lookup
  const byId = new Map<string, Requirement>()
  for (const req of deduped) {
    // Reset children array (will be populated)
    req.children = []
    byId.set(req.scoutbook_id, req)
  }

  // Root level requirements (those without a parent in the list)
  const roots: Requirement[] = []

  for (const req of deduped) {
    let foundParent = false

    // Find the immediate parent (longest matching prefix that is a direct parent)
    let bestParent: Requirement | null = null
    for (const [parentId, parentReq] of byId) {
      if (parentId !== req.scoutbook_id && isDirectChild(parentId, req.scoutbook_id)) {
        if (!bestParent || parentId.length > bestParent.scoutbook_id.length) {
          bestParent = parentReq
        }
      }
    }

    if (bestParent) {
      bestParent.children.push(req)
      foundParent = true
    }

    if (!foundParent) {
      roots.push(req)
    }
  }

  // Sort children within each node
  function sortChildren(reqs: Requirement[]) {
    reqs.sort((a, b) => a.scoutbook_id.localeCompare(b.scoutbook_id, undefined, { numeric: true }))
    for (const req of reqs) {
      if (req.children.length > 0) {
        sortChildren(req.children)
      }
    }
  }

  sortChildren(roots)

  return roots
}

/**
 * Assign sequential display_order values.
 */
function assignDisplayOrders(reqs: Requirement[], startOrder: number = 1): number {
  let order = startOrder
  for (const req of reqs) {
    req.display_order = order++
    if (req.children.length > 0) {
      order = assignDisplayOrders(req.children, order)
    }
  }
  return order
}

/**
 * Flatten hierarchy back to list for comparison.
 */
function flatten(reqs: Requirement[]): Requirement[] {
  const result: Requirement[] = []
  for (const req of reqs) {
    result.push(req)
    if (req.children.length > 0) {
      result.push(...flatten(req.children))
    }
  }
  return result
}

/**
 * Count depth of hierarchy.
 */
function countDepth(reqs: Requirement[], current: number = 0): number {
  let max = current
  for (const req of reqs) {
    if (req.children.length > 0) {
      max = Math.max(max, countDepth(req.children, current + 1))
    }
  }
  return max
}

// Main execution
const dataDir = path.join(process.cwd(), 'data')
const canonicalPath = path.join(dataDir, 'bsa-data-canonical.json')

console.log('Loading canonical data...')
const canonical: CanonicalData = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'))

let totalFixed = 0
let versionsFixed = 0
const fixDetails: Array<{ badge: string; version: number; beforeDepth: number; afterDepth: number; reqCount: number }> = []

for (const badge of canonical.merit_badges) {
  for (const version of badge.versions) {
    if (!version.requirements || version.requirements.length === 0) continue

    // Flatten existing hierarchy first
    const flat = flatten(version.requirements)
    const beforeDepth = countDepth(version.requirements)

    // Rebuild hierarchy
    const newHierarchy = buildHierarchy(flat)
    assignDisplayOrders(newHierarchy)
    const afterDepth = countDepth(newHierarchy)

    // Check if structure changed
    const before = JSON.stringify(version.requirements)
    const after = JSON.stringify(newHierarchy)

    if (before !== after) {
      versionsFixed++
      fixDetails.push({
        badge: badge.name,
        version: version.version_year,
        beforeDepth,
        afterDepth,
        reqCount: flat.length
      })

      if (!isDryRun) {
        version.requirements = newHierarchy
      }
    }
  }
}

// Update generated timestamp
if (!isDryRun) {
  canonical.generated = new Date().toISOString()
}

console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('                    HIERARCHY FIX SUMMARY')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (changes applied)'}`)
console.log(`Versions fixed: ${versionsFixed}`)
console.log('')

if (fixDetails.length > 0) {
  console.log('Versions with hierarchy changes:')
  for (const detail of fixDetails.slice(0, 20)) {
    console.log(`  ${detail.badge} v${detail.version}: depth ${detail.beforeDepth} → ${detail.afterDepth} (${detail.reqCount} reqs)`)
  }
  if (fixDetails.length > 20) {
    console.log(`  ... and ${fixDetails.length - 20} more`)
  }
}

// Save if not dry run
if (!isDryRun) {
  fs.writeFileSync(canonicalPath, JSON.stringify(canonical, null, 2))
  console.log(`\n✅ Saved updated canonical file`)
} else {
  console.log(`\n⚠️  Dry run - no changes saved. Run without --dry-run to apply.`)
}

// Save fix report
const reportPath = path.join(dataDir, 'hierarchy-fix-report.json')
fs.writeFileSync(reportPath, JSON.stringify({
  generated: new Date().toISOString(),
  mode: isDryRun ? 'dry-run' : 'applied',
  versionsFixed,
  details: fixDetails
}, null, 2))
console.log(`📋 Fix report saved to: ${reportPath}`)
