#!/usr/bin/env npx tsx

/**
 * Canonical Data Normalization Script
 *
 * Normalizes BSA merit badge requirement data in bsa-data-canonical.json
 * to produce consistent structures that don't require runtime fix scripts.
 *
 * Usage:
 *   npx tsx scripts/normalize-canonical-data.ts
 *   npx tsx scripts/normalize-canonical-data.ts --dry-run
 *   npx tsx scripts/normalize-canonical-data.ts --badge "Cycling"
 *   npx tsx scripts/normalize-canonical-data.ts --output custom-output.json
 */

import * as fs from 'fs'
import * as path from 'path'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

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

interface TransformRule {
  from: string // Regex pattern as string
  to: string // Replacement string with $1, $2, etc.
  flags?: string // Regex flags (default: '')
}

interface BadgeTransforms {
  badge: string
  version: number
  rules: TransformRule[]
  insertHeaders?: Array<{
    number: string
    description: string
    insertAfter: string
  }>
}

interface TransformRegistry {
  description: string
  standardFormat: string
  transforms: BadgeTransforms[]
}

interface NormalizationStats {
  badge: string
  version: number
  requirementsProcessed: number
  requirementsRenamed: number
  headersInserted: number
  hierarchyFixed: number
}

interface NormalizationReport {
  timestamp: string
  mode: 'dry-run' | 'applied'
  inputFile: string
  outputFile: string
  stats: NormalizationStats[]
  totalBadgesProcessed: number
  totalRequirementsProcessed: number
  totalChanges: number
}

// =============================================================================
// CLI ARGUMENT PARSING
// =============================================================================

const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const badgeFilterIndex = args.indexOf('--badge')
const badgeFilter = badgeFilterIndex !== -1 ? args[badgeFilterIndex + 1] : null
const outputIndex = args.indexOf('--output')
const customOutput = outputIndex !== -1 ? args[outputIndex + 1] : null

// =============================================================================
// FILE PATHS
// =============================================================================

const DATA_DIR = path.join(process.cwd(), 'data')
const INPUT_FILE = path.join(DATA_DIR, 'bsa-data-canonical.json')
const OUTPUT_FILE = customOutput
  ? path.join(DATA_DIR, customOutput)
  : path.join(DATA_DIR, 'bsa-data-canonical-normalized.json')
const TRANSFORMS_FILE = path.join(DATA_DIR, 'canonical-transforms.json')
const REPORT_FILE = path.join(DATA_DIR, 'normalization-report.json')

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('             CANONICAL DATA NORMALIZATION')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (applying changes)'}`)
  if (badgeFilter) {
    console.log(`Filter: ${badgeFilter}`)
  }
  console.log(`Input: ${INPUT_FILE}`)
  console.log(`Output: ${OUTPUT_FILE}`)
  console.log('')

  // Load canonical data
  console.log('Loading canonical data...')
  let canonicalData: CanonicalData
  try {
    canonicalData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'))
  } catch (error) {
    console.error(`Failed to load ${INPUT_FILE}:`, (error as Error).message)
    process.exit(1)
  }
  console.log(`Loaded ${canonicalData.merit_badges.length} badges`)

  // Load transform registry
  console.log('Loading transform registry...')
  let transformRegistry: TransformRegistry
  try {
    transformRegistry = JSON.parse(fs.readFileSync(TRANSFORMS_FILE, 'utf-8'))
  } catch (error) {
    console.warn(`No transform registry found at ${TRANSFORMS_FILE}`)
    console.warn('Using empty transforms (no normalization will be applied)')
    transformRegistry = {
      description: 'Empty registry',
      standardFormat: '',
      transforms: [],
    }
  }
  console.log(`Loaded ${transformRegistry.transforms.length} badge transform rules`)

  // Filter badges if specified
  let badgesToProcess = canonicalData.merit_badges
  if (badgeFilter) {
    badgesToProcess = badgesToProcess.filter((b) =>
      b.name.toLowerCase().includes(badgeFilter.toLowerCase())
    )
    console.log(`Filtered to ${badgesToProcess.length} badges matching "${badgeFilter}"`)
  }

  // Process each badge
  const stats: NormalizationStats[] = []
  let totalChanges = 0

  console.log('\nProcessing badges...')
  console.log('-'.repeat(60))

  for (const badge of badgesToProcess) {
    for (const version of badge.versions) {
      const badgeStats = normalizeBadgeVersion(badge, version, transformRegistry)
      if (badgeStats.requirementsRenamed > 0 || badgeStats.headersInserted > 0 || badgeStats.hierarchyFixed > 0) {
        stats.push(badgeStats)
        totalChanges += badgeStats.requirementsRenamed + badgeStats.headersInserted + badgeStats.hierarchyFixed
        console.log(
          `  ${badge.name} v${version.version_year}: ` +
            `${badgeStats.requirementsRenamed} renamed, ` +
            `${badgeStats.headersInserted} headers inserted, ` +
            `${badgeStats.hierarchyFixed} hierarchy fixes`
        )
      }
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('                         SUMMARY')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Badges processed: ${badgesToProcess.length}`)
  console.log(`Badge versions with changes: ${stats.length}`)
  console.log(`Total changes: ${totalChanges}`)

  // Save output
  if (!isDryRun) {
    // Update timestamp
    canonicalData.generated = new Date().toISOString()

    // Write normalized data
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(canonicalData, null, 2))
    console.log(`\n✅ Normalized data saved to: ${OUTPUT_FILE}`)

    // Write report
    const report: NormalizationReport = {
      timestamp: new Date().toISOString(),
      mode: 'applied',
      inputFile: INPUT_FILE,
      outputFile: OUTPUT_FILE,
      stats,
      totalBadgesProcessed: badgesToProcess.length,
      totalRequirementsProcessed: stats.reduce((sum, s) => sum + s.requirementsProcessed, 0),
      totalChanges,
    }
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))
    console.log(`📋 Report saved to: ${REPORT_FILE}`)
  } else {
    console.log('\n⚠️  DRY RUN - No files were modified')
  }
}

// =============================================================================
// CORE NORMALIZATION FUNCTIONS
// =============================================================================

/**
 * Normalize a requirement number to the standard format.
 * Standard format: {Level}{Option}({Number})({Letter})
 * Examples: 1, 1a, 1a(1), 1a(1)(a), 4A, 4A(1), 4A(1)(a)
 *
 * This function applies patterns in order:
 * 1. Strip trailing sport/type labels (Ice, Roll, Board, Triathlon Option, etc.)
 * 2. Convert underscores to parentheticals (_2 → (2))
 * 3. Standardize option format (Option A → A, "4 Option A" → "4A")
 * 4. Convert brackets to parentheticals ([1] → (1))
 * 5. Normalize spacing and formatting
 */
function normalizeRequirementNumber(num: string, _badgeName?: string): string {
  let result = num

  // Pattern 5: Strip trailing sport/type labels
  // "4a1 Triathlon Option" → "4a1"
  // "2a[1] Ice" → "2a[1]"
  // Order matters: strip compound labels first, then single labels
  result = result
    .replace(/\s+(Triathlon|Duathlon|Aquathlon|Aquabike)\s+Option\s*$/i, '')
    .replace(/\s+Option\s*$/i, '')
    .replace(/\s+(Ice|Roll|Board|Triathlon|Duathlon|Aquathlon|Aquabike)\s*$/i, '')

  // Pattern 1: Underscore to parenthetical
  // "4Aa_2" → "4Aa(2)"
  // Note: This handles multi-level underscores
  result = result.replace(/_(\d+)/g, '($1)')

  // Pattern 2: Standardize "Option X" format
  // "6 Option A" → "6A"
  // "6 Option A (1)" → "6A(1)"
  // "4 Option A (1)(a)" → "4A(1)(a)"
  result = result.replace(/^(\d+)\s+Option\s+([A-D])\s*/i, (_, num, letter) => {
    return `${num}${letter.toUpperCase()}`
  })

  // Pattern 3: Convert bracket notation to parenthetical
  // "9a[1]" → "9a(1)"
  result = result.replace(/\[(\d+)\]/g, '($1)')

  // Normalize spacing: Remove extra spaces around parentheticals
  // "4A (1) (a)" → "4A(1)(a)"
  result = result.replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')')

  // Remove leading/trailing whitespace
  result = result.trim()

  return result
}

// =============================================================================
// BADGE VERSION NORMALIZATION
// =============================================================================

function normalizeBadgeVersion(
  badge: MeritBadge,
  version: BadgeVersion,
  registry: TransformRegistry
): NormalizationStats {
  const stats: NormalizationStats = {
    badge: badge.name,
    version: version.version_year,
    requirementsProcessed: 0,
    requirementsRenamed: 0,
    headersInserted: 0,
    hierarchyFixed: 0,
  }

  if (!version.requirements || version.requirements.length === 0) {
    return stats
  }

  // Find transforms for this badge/version
  const transforms = registry.transforms.find(
    (t) => t.badge === badge.name && t.version === version.version_year
  )

  // Count requirements
  stats.requirementsProcessed = countRequirements(version.requirements)

  // Step 1: Apply generic normalization (always runs)
  const genericNormalized = applyGenericNormalization(version.requirements, badge.name)
  stats.requirementsRenamed += genericNormalized

  // Step 2: Apply badge-specific transforms if any exist
  if (transforms) {
    // Apply requirement number transforms
    const renamed = applyTransforms(version.requirements, transforms.rules)
    stats.requirementsRenamed += renamed

    // Insert missing headers
    if (transforms.insertHeaders) {
      const inserted = insertHeaders(version.requirements, transforms.insertHeaders)
      stats.headersInserted = inserted
    }
  }

  // Step 3: Fix hierarchy (always run)
  const hierarchyFixes = fixHierarchy(version.requirements)
  stats.hierarchyFixed = hierarchyFixes

  return stats
}

function countRequirements(reqs: Requirement[]): number {
  let count = 0
  for (const req of reqs) {
    count++
    if (req.children && req.children.length > 0) {
      count += countRequirements(req.children)
    }
  }
  return count
}

/**
 * Apply generic normalization to all requirement numbers.
 * This runs before badge-specific transforms.
 *
 * IMPORTANT: Only normalizes `requirement_number` for UI display.
 * Preserves `scoutbook_id` as-is for Scoutbook import matching.
 */
function applyGenericNormalization(reqs: Requirement[], badgeName: string): number {
  let normalized = 0

  function normalizeReq(req: Requirement) {
    const newNumber = normalizeRequirementNumber(req.requirement_number, badgeName)
    if (newNumber !== req.requirement_number) {
      req.requirement_number = newNumber
      // DO NOT update scoutbook_id - it must remain in original format
      // for Scoutbook import matching (CSV format like "2b[1]", "4 Option A (1)(a)")
      normalized++
    }

    // Process children recursively
    if (req.children && req.children.length > 0) {
      for (const child of req.children) {
        normalizeReq(child)
      }
    }
  }

  for (const req of reqs) {
    normalizeReq(req)
  }

  return normalized
}

/**
 * Apply badge-specific transform rules from the registry.
 *
 * IMPORTANT: Only transforms `requirement_number` for UI display.
 * Preserves `scoutbook_id` as-is for Scoutbook import matching.
 */
function applyTransforms(reqs: Requirement[], rules: TransformRule[]): number {
  let renamed = 0

  function transformReq(req: Requirement) {
    for (const rule of rules) {
      const regex = new RegExp(rule.from, rule.flags || '')
      if (regex.test(req.requirement_number)) {
        const newNumber = req.requirement_number.replace(regex, rule.to)
        if (newNumber !== req.requirement_number) {
          req.requirement_number = newNumber
          // DO NOT update scoutbook_id - preserve for import matching
          renamed++
        }
      }
    }

    // Process children recursively
    if (req.children && req.children.length > 0) {
      for (const child of req.children) {
        transformReq(child)
      }
    }
  }

  for (const req of reqs) {
    transformReq(req)
  }

  return renamed
}

function insertHeaders(
  reqs: Requirement[],
  headers: Array<{ number: string; description: string; insertAfter: string }>
): number {
  // TODO: Implement header insertion
  // This will be implemented in Phase 1
  return 0
}

function fixHierarchy(reqs: Requirement[]): number {
  let fixes = 0

  function fixReq(req: Requirement, depth: number) {
    // Fix is_header based on children presence
    const shouldBeHeader = req.children && req.children.length > 0
    if (req.is_header !== shouldBeHeader) {
      req.is_header = shouldBeHeader
      fixes++
    }

    // Process children recursively
    if (req.children && req.children.length > 0) {
      for (const child of req.children) {
        fixReq(child, depth + 1)
      }
    }
  }

  for (const req of reqs) {
    fixReq(req, 0)
  }

  return fixes
}

// =============================================================================
// RUN
// =============================================================================

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
