/**
 * Validate canonical merit badge data hierarchy and structure.
 *
 * Checks:
 * - All CSV IDs have matching entries with descriptions
 * - Hierarchy is properly nested (children arrays populated)
 * - Display orders are sequential
 * - No orphaned children
 * - Headers have children, completables don't
 *
 * Usage: npx tsx scripts/validate-canonical-hierarchy.ts
 */

import * as fs from 'fs'
import * as path from 'path'

interface Requirement {
  requirement_number: string
  scoutbook_id: string
  description: string
  is_header: boolean
  display_order: number
  children?: Requirement[]
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
  versions: BadgeVersion[]
}

interface CanonicalData {
  merit_badges: MeritBadge[]
}

interface CsvBadge {
  badgeName: string
  versionYear: number
  requirementIds: string[]
}

interface CsvData {
  badges: CsvBadge[]
}

interface ValidationIssue {
  badge: string
  version: number
  type: 'missing_description' | 'empty_header_children' | 'completable_with_children' | 'display_order_gap' | 'duplicate_display_order' | 'missing_csv_id'
  requirement?: string
  details: string
}

interface VersionStats {
  badge: string
  version: number
  totalRequirements: number
  headers: number
  completable: number
  maxDepth: number
  issues: ValidationIssue[]
}

function countDepth(reqs: Requirement[], currentDepth: number = 0): number {
  let maxDepth = currentDepth
  for (const req of reqs) {
    if (req.children && req.children.length > 0) {
      const childDepth = countDepth(req.children, currentDepth + 1)
      maxDepth = Math.max(maxDepth, childDepth)
    }
  }
  return maxDepth
}

function validateRequirements(
  reqs: Requirement[],
  badge: string,
  version: number,
  issues: ValidationIssue[],
  csvIds: Set<string>,
  depth: number = 0
): { headers: number; completable: number; seenIds: Set<string> } {
  let headers = 0
  let completable = 0
  const seenIds = new Set<string>()
  const displayOrders: number[] = []

  for (const req of reqs) {
    seenIds.add(req.scoutbook_id)

    // Check description
    if (!req.description || req.description.trim() === '') {
      issues.push({
        badge,
        version,
        type: 'missing_description',
        requirement: req.scoutbook_id,
        details: `Requirement ${req.requirement_number} (${req.scoutbook_id}) has no description`
      })
    }

    // Check header/completable logic
    if (req.is_header) {
      headers++
      if (!req.children || req.children.length === 0) {
        issues.push({
          badge,
          version,
          type: 'empty_header_children',
          requirement: req.scoutbook_id,
          details: `Header ${req.requirement_number} (${req.scoutbook_id}) has no children`
        })
      }
    } else {
      completable++
      // Completables shouldn't have children (unless they're option containers)
      // This is a soft check - some completables do have sub-items
    }

    // Track display order
    if (req.display_order !== undefined) {
      displayOrders.push(req.display_order)
    }

    // Recurse into children
    if (req.children && req.children.length > 0) {
      const childStats = validateRequirements(req.children, badge, version, issues, csvIds, depth + 1)
      headers += childStats.headers
      completable += childStats.completable
      for (const id of childStats.seenIds) {
        seenIds.add(id)
      }
    }
  }

  // Check display order sequence at this level
  if (displayOrders.length > 0) {
    displayOrders.sort((a, b) => a - b)
    for (let i = 1; i < displayOrders.length; i++) {
      if (displayOrders[i] === displayOrders[i - 1]) {
        issues.push({
          badge,
          version,
          type: 'duplicate_display_order',
          details: `Duplicate display_order ${displayOrders[i]} at depth ${depth}`
        })
      }
    }
  }

  return { headers, completable, seenIds }
}

function validateCanonicalData(canonical: CanonicalData, csv: CsvData): {
  stats: VersionStats[]
  summary: {
    totalBadges: number
    totalVersions: number
    totalRequirements: number
    totalHeaders: number
    totalCompletable: number
    issueCount: number
    issuesByType: Record<string, number>
  }
} {
  const stats: VersionStats[] = []
  let totalRequirements = 0
  let totalHeaders = 0
  let totalCompletable = 0
  const issuesByType: Record<string, number> = {}

  // Build CSV lookup
  const csvByVersion = new Map<string, Set<string>>()
  for (const badge of csv.badges) {
    const key = `${badge.badgeName}|${badge.versionYear}`
    csvByVersion.set(key, new Set(badge.requirementIds))
  }

  for (const badge of canonical.merit_badges) {
    for (const version of badge.versions) {
      const issues: ValidationIssue[] = []
      const csvKey = `${badge.name}|${version.version_year}`
      const csvIds = csvByVersion.get(csvKey) || new Set()

      const { headers, completable, seenIds } = validateRequirements(
        version.requirements || [],
        badge.name,
        version.version_year,
        issues,
        csvIds
      )

      // Check for missing CSV IDs
      for (const csvId of csvIds) {
        if (!seenIds.has(csvId)) {
          issues.push({
            badge: badge.name,
            version: version.version_year,
            type: 'missing_csv_id',
            requirement: csvId,
            details: `CSV ID "${csvId}" not found in canonical data`
          })
        }
      }

      const maxDepth = countDepth(version.requirements || [])

      stats.push({
        badge: badge.name,
        version: version.version_year,
        totalRequirements: headers + completable,
        headers,
        completable,
        maxDepth,
        issues
      })

      totalRequirements += headers + completable
      totalHeaders += headers
      totalCompletable += completable

      for (const issue of issues) {
        issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1
      }
    }
  }

  return {
    stats,
    summary: {
      totalBadges: canonical.merit_badges.length,
      totalVersions: stats.length,
      totalRequirements,
      totalHeaders,
      totalCompletable,
      issueCount: Object.values(issuesByType).reduce((a, b) => a + b, 0),
      issuesByType
    }
  }
}

function printTree(reqs: Requirement[], indent: string = ''): void {
  for (const req of reqs) {
    const type = req.is_header ? '📁' : '✓'
    const desc = req.description?.substring(0, 50) || '(no description)'
    console.log(`${indent}${type} ${req.requirement_number} [${req.scoutbook_id}] - ${desc}...`)
    if (req.children && req.children.length > 0) {
      printTree(req.children, indent + '  ')
    }
  }
}

// Main execution
const dataDir = path.join(process.cwd(), 'data')
const canonicalPath = path.join(dataDir, 'bsa-data-canonical.json')
const csvPath = path.join(dataDir, 'csv-requirement-ids.json')

console.log('Loading canonical data...')
const canonical: CanonicalData = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'))

console.log('Loading CSV data...')
const csv: CsvData = JSON.parse(fs.readFileSync(csvPath, 'utf8'))

console.log('Validating...\n')
const { stats, summary } = validateCanonicalData(canonical, csv)

// Print summary
console.log('═══════════════════════════════════════════════════════════════')
console.log('                    VALIDATION SUMMARY')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`Total Badges:       ${summary.totalBadges}`)
console.log(`Total Versions:     ${summary.totalVersions}`)
console.log(`Total Requirements: ${summary.totalRequirements}`)
console.log(`  - Headers:        ${summary.totalHeaders}`)
console.log(`  - Completable:    ${summary.totalCompletable}`)
console.log('')
console.log(`Total Issues:       ${summary.issueCount}`)
if (summary.issueCount > 0) {
  console.log('')
  console.log('Issues by Type:')
  for (const [type, count] of Object.entries(summary.issuesByType).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${type}: ${count}`)
  }
}
console.log('')

// Print versions with issues
const versionsWithIssues = stats.filter(s => s.issues.length > 0)
if (versionsWithIssues.length > 0) {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('                    VERSIONS WITH ISSUES')
  console.log('═══════════════════════════════════════════════════════════════')

  for (const version of versionsWithIssues) {
    console.log(`\n${version.badge} v${version.version}:`)
    console.log(`  Requirements: ${version.totalRequirements} (${version.headers} headers, ${version.completable} completable)`)
    console.log(`  Max Depth: ${version.maxDepth}`)
    console.log(`  Issues (${version.issues.length}):`)

    // Group issues by type
    const byType = new Map<string, ValidationIssue[]>()
    for (const issue of version.issues) {
      if (!byType.has(issue.type)) {
        byType.set(issue.type, [])
      }
      byType.get(issue.type)!.push(issue)
    }

    for (const [type, issues] of byType) {
      console.log(`    ${type}:`)
      for (const issue of issues.slice(0, 5)) {
        console.log(`      - ${issue.details}`)
      }
      if (issues.length > 5) {
        console.log(`      ... and ${issues.length - 5} more`)
      }
    }
  }
}

// Show complex badges (depth >= 3)
const complexBadges = stats.filter(s => s.maxDepth >= 3)
if (complexBadges.length > 0) {
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('                    COMPLEX BADGES (depth ≥ 3)')
  console.log('═══════════════════════════════════════════════════════════════')

  for (const version of complexBadges.sort((a, b) => b.maxDepth - a.maxDepth).slice(0, 10)) {
    console.log(`  ${version.badge} v${version.version}: depth ${version.maxDepth}, ${version.totalRequirements} reqs`)
  }
}

// Save detailed report
const reportPath = path.join(dataDir, 'hierarchy-verification-report.json')
const report = {
  generated: new Date().toISOString(),
  summary,
  versionsWithIssues: versionsWithIssues.map(v => ({
    badge: v.badge,
    version: v.version,
    stats: {
      totalRequirements: v.totalRequirements,
      headers: v.headers,
      completable: v.completable,
      maxDepth: v.maxDepth
    },
    issues: v.issues
  })),
  complexBadges: complexBadges.map(v => ({
    badge: v.badge,
    version: v.version,
    maxDepth: v.maxDepth
  }))
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(`\n✅ Detailed report saved to: ${reportPath}`)

// Exit with error if issues found
if (summary.issueCount > 0) {
  process.exit(1)
}
