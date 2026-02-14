/**
 * Analyze remaining hierarchy issues and categorize them for fixing.
 *
 * Usage: npx tsx scripts/analyze-hierarchy-issues.ts
 */

import * as fs from 'fs'
import * as path from 'path'

const dataDir = path.join(process.cwd(), 'data')

interface AnalysisResult {
  badge: string
  version: number
  headerId: string
  headerDesc: string
  recommendation: 'mark_completable' | 'needs_review' | 'keep_header'
  reason: string
  potentialChildren: string[]
}

const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'bsa-data-canonical.json'), 'utf8'))
const report = JSON.parse(fs.readFileSync(path.join(dataDir, 'hierarchy-verification-report.json'), 'utf8'))

const results: AnalysisResult[] = []

for (const v of report.versionsWithIssues) {
  // Find badge and version in canonical data
  const badge = data.merit_badges.find((b: any) => b.name === v.badge)
  if (!badge) continue

  const version = badge.versions.find((ver: any) => ver.version_year === v.version)
  if (!version) continue

  // Flatten all requirements to find potential children
  const flatten = (reqs: any[]): any[] => {
    let result: any[] = []
    for (const r of reqs) {
      result.push(r)
      if (r.children?.length) result.push(...flatten(r.children))
    }
    return result
  }

  const allReqs = flatten(version.requirements || [])
  const allIds = allReqs.map((r: any) => r.scoutbook_id)

  for (const issue of v.issues) {
    if (issue.type !== 'empty_header_children') continue

    const headerId = issue.requirement
    const header = allReqs.find((r: any) => r.scoutbook_id === headerId && r.is_header)
    if (!header) continue

    // Find potential children (IDs that start with this header's ID)
    const potentialChildren = allIds.filter((id: string) =>
      id !== headerId &&
      id.startsWith(headerId) &&
      id.length > headerId.length
    )

    // Analyze the header description
    const desc = header.description || ''
    const isChoiceHeader = /do (one|two|three|any|all|the following|either)/i.test(desc) ||
                           /choose (one|two|three)/i.test(desc) ||
                           /complete (one|two|three|any)/i.test(desc) ||
                           /select (one|two)/i.test(desc)

    let recommendation: 'mark_completable' | 'needs_review' | 'keep_header'
    let reason: string

    if (potentialChildren.length === 0) {
      // No children found at all - likely should be completable
      if (isChoiceHeader) {
        recommendation = 'needs_review'
        reason = 'Choice header but no matching children found - naming mismatch'
      } else {
        recommendation = 'mark_completable'
        reason = 'No children and not a choice header - likely leaf requirement'
      }
    } else {
      // Has potential children but they weren't matched
      recommendation = 'needs_review'
      reason = 'Has potential children with non-standard IDs'
    }

    results.push({
      badge: v.badge,
      version: v.version,
      headerId,
      headerDesc: desc.substring(0, 60),
      recommendation,
      reason,
      potentialChildren: potentialChildren.slice(0, 5)
    })
  }
}

// Summary
const markCompletable = results.filter(r => r.recommendation === 'mark_completable')
const needsReview = results.filter(r => r.recommendation === 'needs_review')

console.log('=== ANALYSIS SUMMARY ===')
console.log('')
console.log(`Total issues: ${results.length}`)
console.log(`Can auto-fix (mark as completable): ${markCompletable.length}`)
console.log(`Needs manual review: ${needsReview.length}`)
console.log('')

console.log('=== AUTO-FIX CANDIDATES ===')
for (const r of markCompletable.slice(0, 15)) {
  console.log(`${r.badge} v${r.version} | ${r.headerId} | ${r.headerDesc}...`)
}
if (markCompletable.length > 15) {
  console.log(`... and ${markCompletable.length - 15} more`)
}

console.log('')
console.log('=== NEEDS REVIEW ===')
for (const r of needsReview.slice(0, 10)) {
  console.log(`${r.badge} v${r.version} | ${r.headerId}`)
  console.log(`  Desc: ${r.headerDesc}...`)
  console.log(`  Potential children: ${r.potentialChildren.length > 0 ? r.potentialChildren.join(', ') : 'none with prefix match'}`)
}
if (needsReview.length > 10) {
  console.log(`... and ${needsReview.length - 10} more`)
}

// Save full analysis
const analysisPath = path.join(dataDir, 'hierarchy-issue-analysis.json')
fs.writeFileSync(analysisPath, JSON.stringify({
  summary: {
    total: results.length,
    autoFix: markCompletable.length,
    needsReview: needsReview.length
  },
  autoFixCandidates: markCompletable,
  needsReview: needsReview
}, null, 2))
console.log('')
console.log(`Full analysis saved to: ${analysisPath}`)
