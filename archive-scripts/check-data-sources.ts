#!/usr/bin/env npx tsx

/**
 * Check Multisport 2026 structure in all data source files
 * to understand where the data actually comes from
 */

import * as fs from 'fs'
import * as path from 'path'

interface Req {
  requirement_number?: string
  number?: string
  scoutbook_id?: string
  description?: string
  children?: Req[]
  parentNumber?: string | null
  depth?: number
}

function countReqs(reqs: Req[]): number {
  let count = 0
  for (const r of reqs) {
    count++
    if (r.children) count += countReqs(r.children)
  }
  return count
}

function printTree(reqs: Req[], indent = 0, limit = 3) {
  for (const r of reqs.slice(0, limit)) {
    const num = r.requirement_number || r.number || '?'
    const childCount = r.children?.length || 0
    console.log('  '.repeat(indent + 2) + `${num} (children: ${childCount})`)
    if (r.children && r.children.length > 0) {
      printTree(r.children, indent + 1, 2)
    }
  }
  if (reqs.length > limit) {
    console.log('  '.repeat(indent + 2) + `... and ${reqs.length - limit} more`)
  }
}

console.log('=== Checking Multisport 2026 in all data files ===\n')

// 1. Check bsa-data-canonical.json
console.log('1. bsa-data-canonical.json:')
try {
  const data = JSON.parse(fs.readFileSync('data/bsa-data-canonical.json', 'utf-8'))
  const ms = data.merit_badges?.find((b: any) => b.name === 'Multisport')
  if (!ms) {
    console.log('   Multisport badge not found')
  } else {
    const v2026 = ms.versions?.find((v: any) => v.version_year === 2026)
    if (!v2026) {
      console.log('   v2026 not found')
    } else {
      console.log(`   Total requirements: ${countReqs(v2026.requirements || [])}`)
      console.log(`   Top-level: ${v2026.requirements?.length}`)
      const req4 = v2026.requirements?.find((r: any) => r.requirement_number === '4')
      if (req4) {
        console.log(`   Req 4 children: ${req4.children?.length || 0}`)
        console.log('   Req 4 tree:')
        printTree([req4], 0, 10)
      }
    }
  }
} catch (e: any) {
  console.log('   Error:', e.message)
}

console.log()

// 2. Check merit-badge-requirements-scraped.json
console.log('2. merit-badge-requirements-scraped.json:')
try {
  const data = JSON.parse(fs.readFileSync('data/merit-badge-requirements-scraped.json', 'utf-8'))
  // This file has a different structure - badges is an object keyed by index
  let msEntry = null
  for (const key of Object.keys(data.badges)) {
    const b = data.badges[key]
    if (b.badgeName === 'Multisport' && b.versionYear === 2026) {
      msEntry = b
      break
    }
  }
  if (!msEntry) {
    console.log('   Multisport 2026 not found')
  } else {
    console.log(`   Total requirements: ${msEntry.requirements?.length}`)
    // This is a flat list with parentNumber
    const req4Related = msEntry.requirements?.filter((r: any) => r.number.startsWith('4'))
    console.log(`   Req 4 related items: ${req4Related?.length}`)
    console.log('   Req 4 items:')
    for (const r of req4Related?.slice(0, 15) || []) {
      console.log(`     ${r.number} (parent: ${r.parentNumber}, depth: ${r.depth})`)
    }
    if (req4Related && req4Related.length > 15) {
      console.log(`     ... and ${req4Related.length - 15} more`)
    }
  }
} catch (e: any) {
  console.log('   Error:', e.message)
}

console.log()

// 3. Check what db.ts actually imports
console.log('3. What the seeder imports:')
console.log('   Checking bsa-reference-data.ts for import source...')

const bsaRefCode = fs.readFileSync('scripts/bsa-reference-data.ts', 'utf-8')
if (bsaRefCode.includes('importCanonicalMeritBadgeRequirements')) {
  console.log('   ✓ Has importCanonicalMeritBadgeRequirements function')
}
if (bsaRefCode.includes('importVersionedMeritBadgeRequirements')) {
  console.log('   ✓ Has importVersionedMeritBadgeRequirements function')
}

// Check which one db.ts uses
const dbCode = fs.readFileSync('scripts/db.ts', 'utf-8')
if (dbCode.includes('importCanonicalMeritBadgeRequirements')) {
  console.log('   → db.ts imports: importCanonicalMeritBadgeRequirements')
}
if (dbCode.includes('importVersionedMeritBadgeRequirements')) {
  console.log('   → db.ts imports: importVersionedMeritBadgeRequirements')
}

// Check which file the canonical import reads
const canonicalImportMatch = bsaRefCode.match(/importCanonicalMeritBadgeRequirements[\s\S]*?const file = filename \|\| '([^']+)'/)
if (canonicalImportMatch) {
  console.log(`   → Canonical import reads: ${canonicalImportMatch[1]}`)
}

const versionedImportMatch = bsaRefCode.match(/importVersionedMeritBadgeRequirements[\s\S]*?const file = filename \|\| '([^']+)'/)
if (versionedImportMatch) {
  console.log(`   → Versioned import reads: ${versionedImportMatch[1]}`)
}
