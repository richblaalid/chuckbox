/**
 * Categorize remaining hierarchy issues into:
 * 1. Mismatched naming (children exist, need mapping)
 * 2. Missing data (children don't exist)
 */

import * as fs from 'fs'
import * as path from 'path'

const dataDir = path.join(process.cwd(), 'data')
const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'bsa-data-canonical.json'), 'utf8'))
const analysis = JSON.parse(fs.readFileSync(path.join(dataDir, 'hierarchy-issue-analysis.json'), 'utf8'))

function flatten(reqs: any[]): any[] {
  let result: any[] = []
  for (const r of reqs) {
    result.push(r)
    if (r.children?.length) result.push(...flatten(r.children))
  }
  return result
}

interface Issue {
  badge: string
  version: number
  headerId: string
  headerDesc: string
  category: 'mismatched_naming' | 'missing_data' | 'unknown'
  potentialChildren: string[]
  reason: string
}

const categorized: Issue[] = []

for (const item of analysis.needsReview) {
  const badge = data.merit_badges.find((b: any) => b.name === item.badge)
  if (!badge) continue

  const version = badge.versions.find((v: any) => v.version_year === item.version)
  if (!version) continue

  const allReqs = flatten(version.requirements || [])
  const header = allReqs.find((r: any) => r.scoutbook_id === item.headerId)
  if (!header) continue

  // Look for potential children - any ID that contains similar elements
  const headerId = item.headerId
  const headerNum = headerId.match(/^\d+/)?.[0] || ''

  // Find IDs that start with same number but aren't the header itself
  const sameNumberReqs = allReqs.filter((r: any) => {
    const id = r.scoutbook_id
    if (id === headerId) return false
    const idNum = id.match(/^\d+/)?.[0] || ''
    return idNum === headerNum && id.length > headerId.length
  })

  let category: 'mismatched_naming' | 'missing_data' | 'unknown'
  let reason: string

  if (sameNumberReqs.length > 0) {
    category = 'mismatched_naming'
    reason = `Found ${sameNumberReqs.length} potential children with same base number`
  } else {
    category = 'missing_data'
    reason = 'No requirements found with same base number - data may be incomplete'
  }

  categorized.push({
    badge: item.badge,
    version: item.version,
    headerId: item.headerId,
    headerDesc: (header.description || '').substring(0, 50),
    category,
    potentialChildren: sameNumberReqs.slice(0, 5).map((r: any) => r.scoutbook_id),
    reason
  })
}

// Summary
const mismatched = categorized.filter(c => c.category === 'mismatched_naming')
const missing = categorized.filter(c => c.category === 'missing_data')

console.log('=== CATEGORIZED HIERARCHY ISSUES ===')
console.log('')
console.log(`Total: ${categorized.length}`)
console.log(`  Mismatched naming (can map): ${mismatched.length}`)
console.log(`  Missing data (incomplete):   ${missing.length}`)
console.log('')

console.log('--- MISMATCHED NAMING (need parent-child mapping) ---')
for (const c of mismatched) {
  console.log(`${c.badge} v${c.version} | ${c.headerId}`)
  console.log(`  Potential children: ${c.potentialChildren.join(', ')}`)
}

console.log('')
console.log('--- MISSING DATA (children not in file) ---')
for (const c of missing) {
  console.log(`${c.badge} v${c.version} | ${c.headerId}: ${c.headerDesc}...`)
}

// Save categorization
fs.writeFileSync(
  path.join(dataDir, 'hierarchy-issues-categorized.json'),
  JSON.stringify({ mismatched, missing }, null, 2)
)
console.log('')
console.log('Saved to: data/hierarchy-issues-categorized.json')
