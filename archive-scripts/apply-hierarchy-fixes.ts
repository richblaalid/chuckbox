/**
 * Apply hierarchy fixes based on analysis.
 *
 * 1. Mark non-choice headers without children as completable
 * 2. Add pattern matching for "Opt A/B" and "Grp N" naming
 *
 * Usage: npx tsx scripts/apply-hierarchy-fixes.ts
 *        npx tsx scripts/apply-hierarchy-fixes.ts --dry-run
 */

import * as fs from 'fs'
import * as path from 'path'

const isDryRun = process.argv.includes('--dry-run')
const dataDir = path.join(process.cwd(), 'data')

interface Requirement {
  requirement_number: string
  scoutbook_id: string
  description: string
  is_header: boolean
  display_order: number
  children: Requirement[]
}

// Load data
const canonicalPath = path.join(dataDir, 'bsa-data-canonical.json')
const analysisPath = path.join(dataDir, 'hierarchy-issue-analysis.json')

const data = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'))
const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'))

// Step 1: Mark auto-fix candidates as completable
let markedCompletable = 0

for (const item of analysis.autoFixCandidates) {
  const badge = data.merit_badges.find((b: any) => b.name === item.badge)
  if (!badge) continue

  const version = badge.versions.find((v: any) => v.version_year === item.version)
  if (!version) continue

  // Find and update the header
  const updateReq = (reqs: Requirement[]): boolean => {
    for (const req of reqs) {
      if (req.scoutbook_id === item.headerId && req.is_header) {
        req.is_header = false
        markedCompletable++
        return true
      }
      if (req.children?.length && updateReq(req.children)) {
        return true
      }
    }
    return false
  }

  updateReq(version.requirements || [])
}

console.log(`Step 1: Marked ${markedCompletable} headers as completable`)

// Step 2: Enhanced pattern matching for complex children
// Patterns like "5" -> "5a Opt A", "5a Grp 1", "5. Opt A (1)"

function isDirectChild(parentId: string, childId: string): boolean {
  if (!childId.startsWith(parentId)) return false
  const suffix = childId.slice(parentId.length)
  if (!suffix) return false

  // Standard patterns (already in fix script)
  if (/^[a-z]\.?$/.test(suffix)) return true
  if (/^\(\d+\)\.?$/.test(suffix)) return true
  if (/^\([a-z]\)\.?$/.test(suffix)) return true
  if (/^[A-B]\.?$/.test(suffix) && /\d\.?$/.test(parentId)) return true
  if (/^[a-z]\.? \w+$/.test(suffix) && /^\d+\.?$/.test(parentId)) return true
  if (/^\d+\.? \w+$/.test(suffix) && /[a-z]\.?$/.test(parentId)) return true
  if (/^[a-z]\(\d+\)$/.test(suffix) && /^\d+$/.test(parentId)) return true
  if (/^[A-B]\([a-z]\)$/.test(suffix) && /^\d+$/.test(parentId)) return true
  if (/^ \w+ \(\d+\)$/.test(suffix) && /^\d+$/.test(parentId)) return true
  if (/^ \w+ \(\d+\)\([a-z]\)$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // NEW: Option patterns (5 -> "5a Opt A", "5b Opt B")
  if (/^[a-z] Opt [A-Z]$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // NEW: Group patterns (5 -> "5a Grp 1", "5b Grp 2")
  if (/^[a-z] Grp \d+$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // NEW: Dot-option patterns (5 -> "5. Opt A (1)")
  if (/^\. Opt [A-Z] \(\d+\)$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // NEW: Option with group (5 -> "5 Option A(1)", "5 Grp H(1)")
  if (/^ Option [A-Z]\(\d+\)$/.test(suffix) && /^\d+$/.test(parentId)) return true
  if (/^ Grp [A-Z]\(\d+\)$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // NEW: Square bracket notation (7 -> "7a[1]", "7b[2]")
  if (/^[a-z]\[\d+\]$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // NEW: Deep square bracket + letter (7a[1] -> "7a[1]a", "7a[1]b")
  if (/^[a-z]$/.test(suffix) && /\[\d+\]$/.test(parentId)) return true

  // NEW: "in Option X" patterns (4 -> "4a in Option A")
  if (/^[a-z] in Option [A-Z]$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // NEW: Space + Option X (N) patterns (4 -> "4 Option A (1)")
  if (/^ Option [A-Z] \(\d+\)$/.test(suffix) && /^\d+$/.test(parentId)) return true

  // NEW: Complex f-option patterns (5A(f) children like "5f[1]a Opt A")
  // These don't start with parent ID, so we need special handling elsewhere

  return false
}

// Step 3: Rebuild hierarchy with new patterns
let hierarchyFixes = 0

function buildHierarchy(flatReqs: Requirement[]): Requirement[] {
  const sorted = [...flatReqs].sort((a, b) => {
    if (a.scoutbook_id.length !== b.scoutbook_id.length) {
      return a.scoutbook_id.length - b.scoutbook_id.length
    }
    return a.scoutbook_id.localeCompare(b.scoutbook_id, undefined, { numeric: true })
  })

  // Deduplicate
  const dedupedIds = new Set<string>()
  const deduped = sorted.filter(req => {
    if (dedupedIds.has(req.scoutbook_id)) return false
    dedupedIds.add(req.scoutbook_id)
    return true
  })

  const byId = new Map<string, Requirement>()
  for (const req of deduped) {
    req.children = []
    byId.set(req.scoutbook_id, req)
  }

  const roots: Requirement[] = []

  for (const req of deduped) {
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
    } else {
      roots.push(req)
    }
  }

  // Sort children
  const sortChildren = (reqs: Requirement[]) => {
    reqs.sort((a, b) => a.scoutbook_id.localeCompare(b.scoutbook_id, undefined, { numeric: true }))
    for (const req of reqs) {
      if (req.children.length > 0) sortChildren(req.children)
    }
  }
  sortChildren(roots)

  return roots
}

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

function flatten(reqs: Requirement[]): Requirement[] {
  const result: Requirement[] = []
  for (const req of reqs) {
    result.push(req)
    if (req.children.length > 0) result.push(...flatten(req.children))
  }
  return result
}

// Apply to all versions
for (const badge of data.merit_badges) {
  for (const version of badge.versions) {
    if (!version.requirements?.length) continue

    const flat = flatten(version.requirements)
    const newHierarchy = buildHierarchy(flat)
    assignDisplayOrders(newHierarchy)

    const before = JSON.stringify(version.requirements)
    const after = JSON.stringify(newHierarchy)

    if (before !== after) {
      hierarchyFixes++
      if (!isDryRun) {
        version.requirements = newHierarchy
      }
    }
  }
}

console.log(`Step 2: Fixed hierarchy in ${hierarchyFixes} versions with new patterns`)

// Save
if (!isDryRun) {
  data.generated = new Date().toISOString()
  fs.writeFileSync(canonicalPath, JSON.stringify(data, null, 2))
  console.log('\n✅ Changes saved to canonical file')
} else {
  console.log('\n⚠️  Dry run - no changes saved')
}
