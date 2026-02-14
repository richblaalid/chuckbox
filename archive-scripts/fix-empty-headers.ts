/**
 * Mark all remaining empty headers as completable.
 *
 * These are headers that either:
 * 1. Have children with completely mismatched naming conventions
 * 2. Have no children at all (incomplete data)
 *
 * Making them completable eliminates validation warnings and
 * maintains functionality since they have no children to display anyway.
 *
 * Usage: npx tsx scripts/fix-empty-headers.ts
 *        npx tsx scripts/fix-empty-headers.ts --dry-run
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

const canonicalPath = path.join(dataDir, 'bsa-data-canonical.json')
const data = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'))

let fixedCount = 0
const fixes: Array<{ badge: string; version: number; id: string; desc: string }> = []

function fixEmptyHeaders(reqs: Requirement[], badge: string, version: number): void {
  for (const req of reqs) {
    // If it's a header with no children, mark as completable
    if (req.is_header && (!req.children || req.children.length === 0)) {
      if (!isDryRun) {
        req.is_header = false
      }
      fixedCount++
      fixes.push({
        badge,
        version,
        id: req.scoutbook_id,
        desc: (req.description || '').substring(0, 50)
      })
    }
    // Recurse into children
    if (req.children?.length) {
      fixEmptyHeaders(req.children, badge, version)
    }
  }
}

// Process all badges and versions
for (const badge of data.merit_badges) {
  for (const version of badge.versions) {
    if (version.requirements?.length) {
      fixEmptyHeaders(version.requirements, badge.name, version.version_year)
    }
  }
}

console.log(`Fixed ${fixedCount} empty headers → marked as completable`)
console.log('')

if (fixes.length > 0 && fixes.length <= 40) {
  console.log('Changes:')
  for (const f of fixes) {
    console.log(`  ${f.badge} v${f.version} | ${f.id}: ${f.desc}...`)
  }
} else if (fixes.length > 40) {
  console.log('Changes (first 20):')
  for (const f of fixes.slice(0, 20)) {
    console.log(`  ${f.badge} v${f.version} | ${f.id}: ${f.desc}...`)
  }
  console.log(`  ... and ${fixes.length - 20} more`)
}

if (!isDryRun) {
  data.generated = new Date().toISOString()
  fs.writeFileSync(canonicalPath, JSON.stringify(data, null, 2))
  console.log('\n✅ Changes saved')
} else {
  console.log('\n⚠️  Dry run - no changes saved')
}
