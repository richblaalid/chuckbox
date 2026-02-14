#!/usr/bin/env npx tsx

/**
 * BSA Requirements Structure Validation
 *
 * Validates the database structure of merit badge requirements to catch
 * issues before they affect users. Run after seeding to ensure data integrity.
 *
 * Checks:
 * - Orphaned requirements (parent_id points to non-existent record)
 * - Headers without children (is_header=true but no children)
 * - Inconsistent nesting depth (nesting_depth doesn't match parent chain)
 * - Duplicate requirement numbers within a version
 *
 * Usage:
 *   npx tsx scripts/validate-bsa-structure.ts
 *   npx tsx scripts/validate-bsa-structure.ts --strict  # Exit with error on any issue
 *   npx tsx scripts/validate-bsa-structure.ts --badge "Cycling"  # Check specific badge
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

interface ValidationIssue {
  type: 'orphaned' | 'header_no_children' | 'inconsistent_nesting' | 'duplicate_number'
  requirementNumber: string
  requirementId: string
  details: string
}

interface BadgeValidation {
  badge: string
  badgeId: string
  version: number
  requirementCount: number
  issues: ValidationIssue[]
}

interface ValidationResult {
  timestamp: string
  totalBadges: number
  totalRequirements: number
  badgesWithIssues: number
  totalIssues: number
  issuesByType: Record<string, number>
  badges: BadgeValidation[]
}

// Load fix registry for suggesting available fixes
interface FixEntry {
  badge: string
  version: number
  script: string
  description: string
  enabled: boolean
}

interface FixRegistry {
  fixes: FixEntry[]
  knownIssues: Array<{ badge: string; version: number; description: string; status: string }>
}

function loadFixRegistry(): Map<string, FixEntry> {
  const registryPath = path.join(process.cwd(), 'data', 'requirement-fixes.json')
  const fixMap = new Map<string, FixEntry>()

  try {
    const registry: FixRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
    for (const fix of registry.fixes) {
      if (fix.enabled) {
        fixMap.set(`${fix.badge}:${fix.version}`, fix)
      }
    }
  } catch {
    // Registry not found, return empty map
  }

  return fixMap
}

async function validateBadge(
  badgeId: string,
  badgeName: string,
  versionYear: number
): Promise<BadgeValidation> {
  const issues: ValidationIssue[] = []

  // Fetch all requirements for this badge version
  const { data: reqs, error } = await supabase
    .from('bsa_merit_badge_requirements')
    .select('id, requirement_number, is_header, parent_requirement_id, nesting_depth')
    .eq('merit_badge_id', badgeId)
    .eq('version_year', versionYear)
    .order('display_order')

  if (error || !reqs) {
    return {
      badge: badgeName,
      badgeId,
      version: versionYear,
      requirementCount: 0,
      issues: [{
        type: 'orphaned',
        requirementNumber: 'N/A',
        requirementId: 'N/A',
        details: `Failed to fetch requirements: ${error?.message || 'Unknown error'}`,
      }],
    }
  }

  // Build lookup maps
  const idToReq = new Map(reqs.map(r => [r.id, r]))
  const reqNumbers = new Map<string, string[]>() // number -> [ids]

  // Check 1: Orphaned requirements
  for (const req of reqs) {
    if (req.parent_requirement_id) {
      const parent = idToReq.get(req.parent_requirement_id)
      if (!parent) {
        issues.push({
          type: 'orphaned',
          requirementNumber: req.requirement_number,
          requirementId: req.id,
          details: `Parent ID ${req.parent_requirement_id} not found in this version`,
        })
      }
    }
  }

  // Check 2: Headers without children
  const childrenByParent = new Map<string, number>()
  for (const req of reqs) {
    if (req.parent_requirement_id) {
      const count = childrenByParent.get(req.parent_requirement_id) || 0
      childrenByParent.set(req.parent_requirement_id, count + 1)
    }
  }

  for (const req of reqs) {
    if (req.is_header && !childrenByParent.has(req.id)) {
      issues.push({
        type: 'header_no_children',
        requirementNumber: req.requirement_number,
        requirementId: req.id,
        details: `Marked as header but has no children`,
      })
    }
  }

  // Check 3: Inconsistent nesting depth
  for (const req of reqs) {
    const expectedDepth = calculateExpectedDepth(req, idToReq)
    if (req.nesting_depth !== expectedDepth) {
      issues.push({
        type: 'inconsistent_nesting',
        requirementNumber: req.requirement_number,
        requirementId: req.id,
        details: `nesting_depth=${req.nesting_depth} but parent chain suggests depth=${expectedDepth}`,
      })
    }
  }

  // Check 4: Duplicate requirement numbers
  for (const req of reqs) {
    const existing = reqNumbers.get(req.requirement_number) || []
    existing.push(req.id)
    reqNumbers.set(req.requirement_number, existing)
  }

  for (const [number, ids] of reqNumbers) {
    if (ids.length > 1) {
      issues.push({
        type: 'duplicate_number',
        requirementNumber: number,
        requirementId: ids[0],
        details: `Requirement number appears ${ids.length} times`,
      })
    }
  }

  return {
    badge: badgeName,
    badgeId,
    version: versionYear,
    requirementCount: reqs.length,
    issues,
  }
}

function calculateExpectedDepth(
  req: { parent_requirement_id: string | null },
  idToReq: Map<string, { parent_requirement_id: string | null; nesting_depth: number }>
): number {
  if (!req.parent_requirement_id) {
    return 0
  }

  let depth = 0
  let currentId: string | null = req.parent_requirement_id
  const visited = new Set<string>()

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    depth++
    const parent = idToReq.get(currentId)
    currentId = parent?.parent_requirement_id || null
  }

  return depth
}

async function main() {
  const args = process.argv.slice(2)
  const strictMode = args.includes('--strict')
  const badgeFilter = args.find(a => a.startsWith('--badge='))?.split('=')[1]
    || (args.includes('--badge') ? args[args.indexOf('--badge') + 1] : null)

  // Load fix registry for suggestions
  const fixRegistry = loadFixRegistry()

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('             BSA REQUIREMENTS STRUCTURE VALIDATION')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Mode: ${strictMode ? 'STRICT (will exit with error on issues)' : 'REPORT ONLY'}`)
  if (badgeFilter) {
    console.log(`Filter: ${badgeFilter}`)
  }
  console.log('')

  // Fetch all badges with their active version
  let badgeQuery = supabase
    .from('bsa_merit_badges')
    .select('id, name, requirement_version_year')
    .not('requirement_version_year', 'is', null)
    .order('name')

  if (badgeFilter) {
    badgeQuery = badgeQuery.ilike('name', `%${badgeFilter}%`)
  }

  const { data: badges, error: badgeError } = await badgeQuery

  if (badgeError || !badges) {
    console.error('Failed to fetch badges:', badgeError?.message)
    process.exit(1)
  }

  console.log(`Validating ${badges.length} badges...\n`)

  const results: BadgeValidation[] = []
  let totalRequirements = 0

  for (const badge of badges) {
    const validation = await validateBadge(
      badge.id,
      badge.name,
      badge.requirement_version_year
    )
    results.push(validation)
    totalRequirements += validation.requirementCount

    // Show progress for badges with issues
    if (validation.issues.length > 0) {
      console.log(`${badge.name} v${badge.requirement_version_year}: ${validation.issues.length} issue(s)`)
    }
  }

  // Summarize results
  const badgesWithIssues = results.filter(r => r.issues.length > 0)
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0)

  const issuesByType: Record<string, number> = {
    orphaned: 0,
    header_no_children: 0,
    inconsistent_nesting: 0,
    duplicate_number: 0,
  }

  for (const result of results) {
    for (const issue of result.issues) {
      issuesByType[issue.type]++
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('                         SUMMARY')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Total badges validated: ${badges.length}`)
  console.log(`Total requirements: ${totalRequirements}`)
  console.log(`Badges with issues: ${badgesWithIssues.length}`)
  console.log(`Total issues: ${totalIssues}`)
  console.log('')
  console.log('Issues by type:')
  console.log(`  Orphaned requirements: ${issuesByType.orphaned}`)
  console.log(`  Headers without children: ${issuesByType.header_no_children}`)
  console.log(`  Inconsistent nesting: ${issuesByType.inconsistent_nesting}`)
  console.log(`  Duplicate numbers: ${issuesByType.duplicate_number}`)

  // Show detailed issues for each badge
  if (badgesWithIssues.length > 0) {
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('                      DETAILED ISSUES')
    console.log('═══════════════════════════════════════════════════════════════')

    for (const badge of badgesWithIssues) {
      console.log(`\n${badge.badge} v${badge.version} (${badge.requirementCount} reqs):`)

      // Group issues by type
      const byType = new Map<string, ValidationIssue[]>()
      for (const issue of badge.issues) {
        const existing = byType.get(issue.type) || []
        existing.push(issue)
        byType.set(issue.type, existing)
      }

      for (const [type, issues] of byType) {
        console.log(`  ${type} (${issues.length}):`)
        for (const issue of issues.slice(0, 5)) {
          console.log(`    - ${issue.requirementNumber}: ${issue.details}`)
        }
        if (issues.length > 5) {
          console.log(`    ... and ${issues.length - 5} more`)
        }
      }

      // Suggest fix script if available
      const fixKey = `${badge.badge}:${badge.version}`
      const fix = fixRegistry.get(fixKey)
      if (fix) {
        console.log(`  → Fix available: npx tsx ${fix.script}`)
      }
    }

    // Suggest running the fix command if any fixes are available
    const badgesWithFixes = badgesWithIssues.filter(b => fixRegistry.has(`${b.badge}:${b.version}`))
    if (badgesWithFixes.length > 0) {
      console.log('\n💡 Run: npm run db:fix  (to apply all available fixes)')
    }
  }

  // Save validation report
  const report: ValidationResult = {
    timestamp: new Date().toISOString(),
    totalBadges: badges.length,
    totalRequirements,
    badgesWithIssues: badgesWithIssues.length,
    totalIssues,
    issuesByType,
    badges: badgesWithIssues, // Only include badges with issues in report
  }

  const reportPath = path.join(process.cwd(), 'data', 'validation-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\n📋 Report saved to: ${reportPath}`)

  // Exit with error in strict mode if issues found
  if (strictMode && totalIssues > 0) {
    console.log('\n❌ VALIDATION FAILED - Issues found in strict mode')
    process.exit(1)
  }

  if (totalIssues === 0) {
    console.log('\n✅ All badges validated successfully - no issues found')
  }
}

main().catch(console.error)
