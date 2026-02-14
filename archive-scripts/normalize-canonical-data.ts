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
  preRules?: TransformRule[] // Run BEFORE generic normalization (for sport/type name conversion)
  rules: TransformRule[] // Run AFTER generic normalization
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
const doValidate = args.includes('--validate')
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

  // Validation (if requested)
  if (doValidate) {
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('                       VALIDATION')
    console.log('═══════════════════════════════════════════════════════════════')

    let totalValidationIssues = 0
    const badgesWithIssues: Array<{ badge: string; version: number; issues: number }> = []

    for (const badge of badgesToProcess) {
      for (const version of badge.versions) {
        const issues = validateHierarchy(version.requirements)
        if (issues.length > 0) {
          totalValidationIssues += issues.length
          badgesWithIssues.push({
            badge: badge.name,
            version: version.version_year,
            issues: issues.length,
          })
          console.log(`\n❌ ${badge.name} v${version.version_year}: ${issues.length} issues`)
          for (const issue of issues.slice(0, 5)) {
            console.log(`   ${issue.number}: ${issue.issue}`)
          }
          if (issues.length > 5) {
            console.log(`   ... and ${issues.length - 5} more`)
          }
        }
      }
    }

    if (totalValidationIssues === 0) {
      console.log('\n✅ All badges pass hierarchy validation!')
    } else {
      console.log(`\n⚠️  ${totalValidationIssues} validation issues in ${badgesWithIssues.length} badge versions`)
    }
  }

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

  // Pattern 0: Strip trailing periods (Cooking, Sustainability, Insect Study)
  // "4a." → "4a"
  // "5b(1)." → "5b(1)"
  result = result.replace(/\.+$/, '')

  // Pattern 5: Strip trailing sport/type/animal labels
  // "4a1 Triathlon Option" → "4a1"
  // "2a[1] Ice" → "2a[1]"
  // "6a avian" → "6a"
  // "7a Alpine" → "7a"
  // Order matters: strip compound labels first, then single labels
  result = result
    .replace(/\s+(Triathlon|Duathlon|Aquathlon|Aquabike)\s+Option\s*$/i, '')
    .replace(/\s+Option\s*$/i, '')
    // Sport types (Skating, Snow Sports)
    .replace(/\s+(Ice|Roll|Board|Triathlon|Duathlon|Aquathlon|Aquabike|Alpine|Nordic|Shoe|Snow|Snowboard)\s*$/i, '')
    // Animal types (Animal Science)
    .replace(/\s+(avian|beef|dairy|hog|horse|sheep|rabbit|dog|cat|small)\s*$/i, '')

  // Pattern 6: Convert "in Option X" format (Disabilities Awareness)
  // "4a in Option A" → "4A(a)"
  // "4b in Option B" → "4B(b)"
  result = result.replace(/^(\d+)([a-z])\s+in\s+Option\s+([A-Z])$/i, (_, num, letter, optLetter) => {
    return `${num}${optLetter.toUpperCase()}(${letter.toLowerCase()})`
  })

  // Pattern 7: Convert "Grp N" format (Athletics)
  // "5a Grp 1" → "5a(1)"
  // "5b Grp 2" → "5b(2)"
  result = result.replace(/\s+Grp\s+(\d+)$/i, '($1)')

  // Pattern 8: Convert "Opt x" format (Rifle Shooting)
  // "2a Opt a" → "2A(a)" - becomes Option A subrequirement a
  // "2b Opt b" → "2B(b)"
  // Note: The lowercase "a" after Opt indicates which option AND subreq letter
  result = result.replace(/^(\d+)([a-z])\s+Opt\s+([a-z])$/i, (_, num, subLetter, optLetter) => {
    return `${num}${optLetter.toUpperCase()}(${subLetter.toLowerCase()})`
  })

  // Pattern 9: Convert bracket with letter notation (Lifesaving)
  // "1a[5a]" → "1a(5)(a)"
  // "1a[6b]" → "1a(6)(b)"
  result = result.replace(/\[(\d+)([a-z])\]/g, '($1)($2)')

  // Pattern 1: Underscore to parenthetical
  // "4Aa_2" → "4Aa(2)"
  // Note: This handles multi-level underscores
  result = result.replace(/_(\d+)/g, '($1)')

  // Pattern 2: Standardize "Option X" format
  // "6 Option A" → "6A"
  // "6 Option A (1)" → "6A(1)"
  // "4 Option A (1)(a)" → "4A(1)(a)"
  // "8 Option E" → "8E"
  result = result.replace(/^(\d+)\s+Option\s+([A-Z])\s*/i, (_, num, letter) => {
    return `${num}${letter.toUpperCase()}`
  })

  // Pattern 3: Convert bracket notation to parenthetical
  // "9a[1]" → "9a(1)"
  result = result.replace(/\[(\d+)\]/g, '($1)')

  // Normalize spacing: Remove extra spaces around parentheticals
  // "4A (1) (a)" → "4A(1)(a)"
  // But preserve trailing spaces before type labels like "Line" or "Ice"
  result = result.replace(/\s*\(\s*/g, '(').replace(/\)\s+(?=\()/g, ')')

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

  // Step 0: Apply pre-transforms if any exist (before generic normalization)
  // Used for sport/type name conversion like "4 Triathlon" → "4A"
  if (transforms && transforms.preRules && transforms.preRules.length > 0) {
    const preRenamed = applyTransforms(version.requirements, transforms.preRules)
    stats.requirementsRenamed += preRenamed
  }

  // Step 1: Apply generic normalization (always runs)
  const genericNormalized = applyGenericNormalization(version.requirements, badge.name)
  stats.requirementsRenamed += genericNormalized

  // Step 2: Apply badge-specific transforms if any exist (after generic normalization)
  if (transforms && transforms.rules.length > 0) {
    // Apply requirement number transforms
    const renamed = applyTransforms(version.requirements, transforms.rules)
    stats.requirementsRenamed += renamed
  }

  // Step 3: Insert missing headers from transform rules
  if (transforms && transforms.insertHeaders && transforms.insertHeaders.length > 0) {
    const inserted = insertHeaders(version.requirements, transforms.insertHeaders)
    stats.headersInserted = inserted
  }

  // Step 3.5: Auto-create missing parent headers
  // If 4a, 4b exist but 4 doesn't, create 4 as a header
  const autoInserted = insertMissingParentHeaders(version.requirements)
  stats.headersInserted += autoInserted

  // Step 4: Re-parent misplaced requirements (run after headers are inserted)
  const reparented = reparentRequirements(version.requirements)
  stats.hierarchyFixed += reparented

  // Step 5: Fix hierarchy flags and sort (always run)
  const hierarchyFixes = fixHierarchy(version.requirements)
  stats.hierarchyFixed += hierarchyFixes

  // Step 6: Assign sequential display_order values (always run)
  assignDisplayOrders(version.requirements)

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

/**
 * Insert missing header requirements based on transform rules.
 *
 * Each header rule specifies:
 * - number: The requirement number for the new header (e.g., "6A")
 * - description: The header description text
 * - insertAfter: The requirement number after which to insert
 *
 * The function calculates the parent from the number (e.g., "6A" → "6")
 * and inserts the new header as a child of that parent.
 */
function insertHeaders(
  reqs: Requirement[],
  headers: Array<{ number: string; description: string; insertAfter: string }>
): number {
  let inserted = 0

  for (const header of headers) {
    // Calculate parent number from the header number
    const parentNumber = getParentNumber(header.number)

    // Find the parent requirement (or root level if no parent)
    const parent = parentNumber ? findRequirement(reqs, parentNumber) : null

    // Ensure parent.children exists if parent was found
    if (parent && !parent.children) {
      parent.children = []
    }

    const targetArray = parent ? parent.children! : reqs

    // Check if header already exists
    const existingIndex = targetArray.findIndex(
      (r) => r.requirement_number === header.number
    )
    if (existingIndex !== -1) {
      // Header already exists, skip
      continue
    }

    // Find the position to insert (after insertAfter requirement)
    let insertIndex = 0
    if (header.insertAfter) {
      const afterIndex = targetArray.findIndex(
        (r) => r.requirement_number === header.insertAfter
      )
      if (afterIndex !== -1) {
        insertIndex = afterIndex + 1
      } else if (parent && parent.requirement_number === header.insertAfter) {
        // insertAfter refers to the parent itself, insert at beginning
        insertIndex = 0
      }
    }

    // Create the new header requirement
    const newHeader: Requirement = {
      requirement_number: header.number,
      scoutbook_id: header.number, // Use same as requirement_number for synthetic headers
      description: header.description,
      is_header: true,
      display_order: 0, // Will be recalculated later
      children: [],
    }

    // Insert the header
    targetArray.splice(insertIndex, insertIndex === targetArray.length ? 0 : 0, newHeader)
    inserted++
  }

  return inserted
}

/**
 * Auto-create missing parent headers.
 *
 * If requirements like 4a, 4b exist at root level but their parent 4 doesn't exist,
 * this function creates the parent header automatically.
 */
function insertMissingParentHeaders(reqs: Requirement[]): number {
  let inserted = 0

  // Collect all requirement numbers in the tree
  const existingNumbers = new Set<string>()
  function collectNumbers(requirements: Requirement[]) {
    for (const req of requirements) {
      existingNumbers.add(req.requirement_number)
      if (req.children && req.children.length > 0) {
        collectNumbers(req.children)
      }
    }
  }
  collectNumbers(reqs)

  // Find requirements that need parents
  const parentsNeeded = new Set<string>()
  function findMissingParents(requirements: Requirement[]) {
    for (const req of requirements) {
      const parentNum = getParentNumber(req.requirement_number)
      if (parentNum && !existingNumbers.has(parentNum)) {
        // Check if this parent's parent exists (need to create chain)
        let current: string | null = parentNum
        while (current && !existingNumbers.has(current)) {
          parentsNeeded.add(current)
          current = getParentNumber(current)
        }
      }
      if (req.children && req.children.length > 0) {
        findMissingParents(req.children)
      }
    }
  }
  findMissingParents(reqs)

  if (parentsNeeded.size === 0) {
    return 0
  }

  // Sort parents by depth (shallow first)
  const sortedParents = Array.from(parentsNeeded).sort((a, b) => {
    const depthA = calculateNestingDepth(a)
    const depthB = calculateNestingDepth(b)
    if (depthA !== depthB) return depthA - depthB
    return a.localeCompare(b)
  })

  // Create missing parents
  for (const parentNum of sortedParents) {
    // Determine where to insert (at root or under grandparent)
    const grandparentNum = getParentNumber(parentNum)
    const grandparent = grandparentNum ? findRequirement(reqs, grandparentNum) : null

    const targetArray = grandparent ? (grandparent.children || (grandparent.children = [])) : reqs

    // Check if already exists (may have been created in a previous iteration)
    if (targetArray.some(r => r.requirement_number === parentNum)) {
      continue
    }

    // Create the header
    const newHeader: Requirement = {
      requirement_number: parentNum,
      scoutbook_id: parentNum,
      description: 'Do the following:',
      is_header: true,
      display_order: 0,
      children: [],
    }

    // Find insert position (before first child that would belong to this parent)
    let insertIndex = targetArray.length
    for (let i = 0; i < targetArray.length; i++) {
      const reqParent = getParentNumber(targetArray[i].requirement_number)
      if (reqParent === parentNum) {
        insertIndex = i
        break
      }
    }

    targetArray.splice(insertIndex, 0, newHeader)
    existingNumbers.add(parentNum)
    inserted++
  }

  return inserted
}

/**
 * Get the parent requirement number from a child number.
 *
 * Examples:
 * - "6A" → "6"
 * - "6A(1)" → "6A"
 * - "6A(1)(a)" → "6A(1)"
 * - "1a" → "1"
 * - "1a(1)" → "1a"
 * - "7a(1)a" → "7a(1)" (trailing letter after parenthetical)
 * - "1" → null (top-level)
 */
function getParentNumber(num: string): string | null {
  // Pattern: ends with (letter) like (a), (b)
  if (/\([a-z]\)$/.test(num)) {
    return num.replace(/\([a-z]\)$/, '')
  }

  // Pattern: ends with trailing lowercase letter after parenthetical like 7a(1)a
  // This is a legacy format where the sub-sub-sub level uses letter without parens
  if (/\(\d+\)[a-z]$/.test(num)) {
    return num.replace(/[a-z]$/, '')
  }

  // Pattern: ends with (number) like (1), (2)
  if (/\(\d+\)$/.test(num)) {
    return num.replace(/\(\d+\)$/, '')
  }

  // Pattern: ends with uppercase letter option like 6A, 6B
  if (/^\d+[A-Z]$/.test(num)) {
    return num.replace(/[A-Z]$/, '')
  }

  // Pattern: option sub-requirement like 4Aa, 4Ab (digit + uppercase + lowercase)
  // Parent is the option (4A)
  if (/^\d+[A-Z][a-z]$/.test(num)) {
    return num.replace(/[a-z]$/, '')
  }

  // Pattern: digit + letter + digit like 6c1, 8a2 (Animal Science, Automotive, Pottery)
  // Parent is the base number (6, 8)
  // Note: 6c1 goes under 6, not 6c, because 6c may not exist
  if (/^\d+[a-z]\d+$/.test(num)) {
    return num.replace(/[a-z]\d+$/, '')
  }

  // Pattern: ends with lowercase letter like 1a, 1b
  if (/^\d+[a-z]$/.test(num)) {
    return num.replace(/[a-z]$/, '')
  }

  // Top-level number
  return null
}

/**
 * Find a requirement by number in the hierarchy.
 */
function findRequirement(reqs: Requirement[], number: string): Requirement | null {
  for (const req of reqs) {
    if (req.requirement_number === number) {
      return req
    }
    if (req.children && req.children.length > 0) {
      const found = findRequirement(req.children, number)
      if (found) {
        return found
      }
    }
  }
  return null
}

/**
 * Re-parent misplaced requirements to their correct parent.
 *
 * This function identifies requirements that are nested under the wrong parent
 * based on their requirement_number and moves them to the correct location.
 *
 * For example, if "6A(1)(a)" is a direct child of "6" but should be under "6A(1)",
 * this function will move it to the correct parent.
 */
function reparentRequirements(reqs: Requirement[]): number {
  let reparented = 0

  // Collect all requirements that need to be moved
  const toMove: Array<{
    req: Requirement
    currentParent: Requirement | null
    correctParentNumber: string
  }> = []

  function findMisplaced(requirements: Requirement[], parent: Requirement | null) {
    for (const req of requirements) {
      const expectedParentNum = getParentNumber(req.requirement_number)

      // Check if current placement is wrong
      if (expectedParentNum !== null) {
        const currentParentNum = parent?.requirement_number || null
        if (currentParentNum !== expectedParentNum) {
          toMove.push({
            req,
            currentParent: parent,
            correctParentNumber: expectedParentNum,
          })
        }
      }

      // Recurse into children
      if (req.children && req.children.length > 0) {
        findMisplaced(req.children, req)
      }
    }
  }

  findMisplaced(reqs, null)

  // Move misplaced requirements to their correct parents
  for (const move of toMove) {
    // Find the correct parent
    const correctParent = findRequirement(reqs, move.correctParentNumber)
    if (!correctParent) {
      // Parent doesn't exist yet, skip (will be handled in next iteration or by insertHeaders)
      continue
    }

    // Remove from current location
    const currentArray = move.currentParent ? move.currentParent.children : reqs
    const currentIndex = currentArray.indexOf(move.req)
    if (currentIndex !== -1) {
      currentArray.splice(currentIndex, 1)

      // Add to correct parent
      if (!correctParent.children) {
        correctParent.children = []
      }
      correctParent.children.push(move.req)
      reparented++
    }
  }

  return reparented
}

/**
 * Fix hierarchy issues:
 * 1. Set is_header based on children presence
 * 2. Sort children by requirement number
 */
function fixHierarchy(reqs: Requirement[]): number {
  let fixes = 0

  function fixReq(req: Requirement, depth: number) {
    // Fix is_header based on children presence
    const shouldBeHeader = req.children && req.children.length > 0
    if (req.is_header !== shouldBeHeader) {
      req.is_header = shouldBeHeader
      fixes++
    }

    // Sort children by requirement number for consistent ordering
    if (req.children && req.children.length > 1) {
      req.children.sort(compareRequirementNumbers)
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

  // Sort top-level requirements
  if (reqs.length > 1) {
    reqs.sort(compareRequirementNumbers)
  }

  return fixes
}

/**
 * Compare two requirement numbers for sorting.
 * Handles numeric parts and letter parts correctly.
 *
 * Examples ordering: 1 < 1a < 1b < 1a(1) < 1a(2) < 2 < 6A < 6A(1) < 6B
 */
function compareRequirementNumbers(a: Requirement, b: Requirement): number {
  const numA = a.requirement_number
  const numB = b.requirement_number

  // Extract components for comparison
  const partsA = parseRequirementNumber(numA)
  const partsB = parseRequirementNumber(numB)

  // Compare each level
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || { type: 'none', value: '' }
    const partB = partsB[i] || { type: 'none', value: '' }

    // 'none' comes before any value
    if (partA.type === 'none' && partB.type !== 'none') return -1
    if (partA.type !== 'none' && partB.type === 'none') return 1
    if (partA.type === 'none' && partB.type === 'none') return 0

    // Compare by type priority: number < uppercase < lowercase < parenthetical
    const typePriority: Record<string, number> = {
      number: 0,
      uppercase: 1,
      lowercase: 2,
      paren_number: 3,
      paren_letter: 4,
    }

    const priorityA = typePriority[partA.type] ?? 5
    const priorityB = typePriority[partB.type] ?? 5

    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }

    // Same type, compare values
    if (partA.type === 'number' || partA.type === 'paren_number') {
      const valA = parseInt(partA.value, 10)
      const valB = parseInt(partB.value, 10)
      if (valA !== valB) return valA - valB
    } else {
      if (partA.value !== partB.value) {
        return partA.value.localeCompare(partB.value)
      }
    }
  }

  return 0
}

/**
 * Parse a requirement number into its component parts.
 *
 * Examples:
 * - "1" → [{ type: 'number', value: '1' }]
 * - "1a" → [{ type: 'number', value: '1' }, { type: 'lowercase', value: 'a' }]
 * - "6A(1)(a)" → [{ type: 'number', value: '6' }, { type: 'uppercase', value: 'A' },
 *                 { type: 'paren_number', value: '1' }, { type: 'paren_letter', value: 'a' }]
 */
function parseRequirementNumber(num: string): Array<{ type: string; value: string }> {
  const parts: Array<{ type: string; value: string }> = []
  let remaining = num

  // Extract leading number
  const leadingMatch = remaining.match(/^(\d+)/)
  if (leadingMatch) {
    parts.push({ type: 'number', value: leadingMatch[1] })
    remaining = remaining.slice(leadingMatch[0].length)
  }

  // Extract remaining parts
  while (remaining.length > 0) {
    // Uppercase letter (option)
    const upperMatch = remaining.match(/^([A-Z])/)
    if (upperMatch) {
      parts.push({ type: 'uppercase', value: upperMatch[1] })
      remaining = remaining.slice(1)
      continue
    }

    // Lowercase letter followed by digit like "c1" in "6c1"
    // Treat the letter+digit as a compound sub-requirement (counts as ONE depth level)
    const letterDigitMatch = remaining.match(/^([a-z])(\d+)/)
    if (letterDigitMatch) {
      // Combine letter+digit as one part to keep depth correct
      // 6c1 should be depth 1 (child of 6), not depth 2
      parts.push({ type: 'letter_digit', value: letterDigitMatch[1] + letterDigitMatch[2] })
      remaining = remaining.slice(letterDigitMatch[0].length)
      continue
    }

    // Lowercase letter (single)
    const lowerMatch = remaining.match(/^([a-z])/)
    if (lowerMatch) {
      parts.push({ type: 'lowercase', value: lowerMatch[1] })
      remaining = remaining.slice(1)
      continue
    }

    // Parenthetical number
    const parenNumMatch = remaining.match(/^\((\d+)\)/)
    if (parenNumMatch) {
      parts.push({ type: 'paren_number', value: parenNumMatch[1] })
      remaining = remaining.slice(parenNumMatch[0].length)
      continue
    }

    // Parenthetical letter
    const parenLetterMatch = remaining.match(/^\(([a-z])\)/)
    if (parenLetterMatch) {
      parts.push({ type: 'paren_letter', value: parenLetterMatch[1] })
      remaining = remaining.slice(parenLetterMatch[0].length)
      continue
    }

    // Unknown character, skip it
    remaining = remaining.slice(1)
  }

  return parts
}

// =============================================================================
// DEPTH & ORDER CALCULATION
// =============================================================================

/**
 * Calculate the nesting depth for a requirement based on its number.
 *
 * Depth levels:
 * - "1" → 0 (top-level)
 * - "1a" or "1A" → 1
 * - "1a(1)" or "1A(1)" → 2
 * - "1a(1)(a)" or "1A(1)(a)" → 3
 */
function calculateNestingDepth(requirementNumber: string): number {
  const parts = parseRequirementNumber(requirementNumber)
  // Depth is number of parts minus 1 (the leading number doesn't count as depth)
  return Math.max(0, parts.length - 1)
}

/**
 * Assign sequential display_order values to all requirements in a tree.
 * Orders are assigned in depth-first traversal order.
 *
 * @returns The number of requirements ordered
 */
function assignDisplayOrders(reqs: Requirement[]): number {
  let order = 1

  function assignOrder(req: Requirement) {
    req.display_order = order++

    // Process children in sorted order
    if (req.children && req.children.length > 0) {
      for (const child of req.children) {
        assignOrder(child)
      }
    }
  }

  for (const req of reqs) {
    assignOrder(req)
  }

  return order - 1
}

/**
 * Validate that the parent chain matches the nesting depth.
 * This detects requirements that are misplaced in the hierarchy.
 *
 * @returns Array of validation issues found
 */
function validateHierarchy(
  reqs: Requirement[]
): Array<{ number: string; issue: string; expectedDepth: number; actualDepth: number }> {
  const issues: Array<{
    number: string
    issue: string
    expectedDepth: number
    actualDepth: number
  }> = []

  function validate(req: Requirement, actualDepth: number) {
    const expectedDepth = calculateNestingDepth(req.requirement_number)

    if (expectedDepth !== actualDepth) {
      issues.push({
        number: req.requirement_number,
        issue: `depth mismatch: expected ${expectedDepth}, found at ${actualDepth}`,
        expectedDepth,
        actualDepth,
      })
    }

    // Validate children
    if (req.children && req.children.length > 0) {
      for (const child of req.children) {
        validate(child, actualDepth + 1)
      }
    }
  }

  for (const req of reqs) {
    validate(req, 0)
  }

  return issues
}

// =============================================================================
// RUN
// =============================================================================

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
