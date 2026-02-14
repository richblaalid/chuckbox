/**
 * Show detailed view of all remaining hierarchy issues
 * to help manually define parent-child mappings.
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

// Group issues by badge+version
const byVersion = new Map<string, any[]>()
for (const item of analysis.needsReview) {
  const key = `${item.badge}|${item.version}`
  if (!byVersion.has(key)) byVersion.set(key, [])
  byVersion.get(key)!.push(item)
}

for (const [key, issues] of Array.from(byVersion.entries()).sort()) {
  const [badgeName, versionStr] = key.split('|')
  const version = parseInt(versionStr)

  const badge = data.merit_badges.find((b: any) => b.name === badgeName)
  if (!badge) continue

  const ver = badge.versions.find((v: any) => v.version_year === version)
  if (!ver) continue

  const allReqs = flatten(ver.requirements || [])

  console.log('═'.repeat(70))
  console.log(`${badgeName} v${version}`)
  console.log('═'.repeat(70))

  for (const issue of issues) {
    const header = allReqs.find((r: any) => r.scoutbook_id === issue.headerId)
    if (!header) continue

    console.log('')
    console.log(`HEADER: ${issue.headerId}`)
    console.log(`  Description: ${(header.description || '').substring(0, 60)}...`)
    console.log('')

    // Find all IDs in this version to show potential children
    const allIds = allReqs.map((r: any) => ({
      id: r.scoutbook_id,
      isHeader: r.is_header,
      desc: (r.description || '').substring(0, 40)
    }))

    // Show IDs that might be related (contain similar patterns)
    const headerBase = issue.headerId.replace(/[^a-zA-Z0-9]/g, '')
    console.log('  All requirement IDs in this version:')
    for (const r of allIds) {
      const marker = r.isHeader ? '[H]' : '   '
      console.log(`    ${marker} ${r.id}`)
    }
  }
  console.log('')
}
