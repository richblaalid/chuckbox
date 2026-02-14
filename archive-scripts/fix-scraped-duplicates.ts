#!/usr/bin/env npx tsx
/**
 * Fix Duplicate Requirement Numbers in Scraped Data
 *
 * This script post-processes the scraped merit badge requirements JSON
 * to fix duplicate requirement numbers caused by Option A/B/C/D patterns.
 *
 * The scraper doesn't detect option boundaries, so when a badge has multiple
 * options (like Skating with Ice/Roller/In-Line/Skateboarding), the same
 * requirement numbers appear multiple times.
 *
 * This script:
 * 1. Detects when requirement numbers repeat within a badge/version
 * 2. Assigns them to options based on sequence (A, B, C, D, etc.)
 * 3. Prefixes requirement numbers with the option letter
 *
 * Usage:
 *   npx tsx scripts/fix-scraped-duplicates.ts              # Dry run
 *   npx tsx scripts/fix-scraped-duplicates.ts --confirm    # Apply fixes
 */

import * as fs from 'fs'

const isConfirmed = process.argv.includes('--confirm')

interface Requirement {
  number: string
  description: string
  parentNumber: string | null
  depth: number
}

interface BadgeEntry {
  badgeName: string
  badgeSlug: string
  versionYear: number
  versionLabel: string
  requirements: Requirement[]
  scrapedAt?: string
}

interface Data {
  totalBadges: number
  completedBadges: number
  currentBadge: string | null
  badges: BadgeEntry[]
  errors?: string[]
  startedAt?: string
  lastUpdatedAt?: string
}

// Option letters for prefixing
const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function findDuplicatesInBadge(requirements: Requirement[]): Map<string, number[]> {
  const positions = new Map<string, number[]>()

  for (let i = 0; i < requirements.length; i++) {
    const num = requirements[i].number
    const existing = positions.get(num) || []
    existing.push(i)
    positions.set(num, existing)
  }

  // Return only numbers that appear more than once
  const duplicates = new Map<string, number[]>()
  for (const [num, indices] of positions) {
    if (indices.length > 1) {
      duplicates.set(num, indices)
    }
  }

  return duplicates
}

function detectOptionBoundaries(requirements: Requirement[], duplicates: Map<string, number[]>): number[] {
  // Find the main parent requirement that has duplicate children
  // The option boundaries occur where duplicate top-level sub-requirements restart

  if (duplicates.size === 0) return []

  // Find the first duplicated requirement at depth 1 (direct child of main req)
  // This tells us where options restart
  let firstDupAtDepth1: string | null = null
  for (const [num, indices] of duplicates) {
    const firstReq = requirements[indices[0]]
    if (firstReq.depth === 1) {
      firstDupAtDepth1 = num
      break
    }
  }

  if (!firstDupAtDepth1) {
    // Try depth 0 duplicates
    for (const [num, indices] of duplicates) {
      const firstReq = requirements[indices[0]]
      if (firstReq.depth === 0) {
        firstDupAtDepth1 = num
        break
      }
    }
  }

  if (!firstDupAtDepth1) return []

  // The positions of this duplicated requirement mark option boundaries
  const boundaries = duplicates.get(firstDupAtDepth1) || []
  return boundaries
}

function assignOptionsToRequirements(
  requirements: Requirement[],
  boundaries: number[]
): { requirements: Requirement[]; optionCount: number } {
  if (boundaries.length <= 1) {
    return { requirements, optionCount: 0 }
  }

  const result: Requirement[] = []
  let currentOption = 0
  let boundaryIndex = 0

  // Find the parent requirement - it's the parentNumber of the first boundary requirement
  const firstBoundaryReq = requirements[boundaries[0]]
  const parentNum = firstBoundaryReq.parentNumber || ''

  if (!parentNum) {
    // Can't determine parent, return unchanged
    return { requirements, optionCount: 0 }
  }

  // Track current lettered parent within each option (e.g., "a", "b", "c")
  let currentLetteredParent = ''

  // First pass: assign option letters and track letter parents
  for (let i = 0; i < requirements.length; i++) {
    const req = { ...requirements[i] }

    // Check if we've hit a new option boundary
    if (boundaryIndex < boundaries.length && i === boundaries[boundaryIndex]) {
      currentOption = boundaryIndex
      currentLetteredParent = '' // Reset for new option
      boundaryIndex++
    }

    // If this requirement is at or after the first boundary, it belongs to an option
    if (i >= boundaries[0]) {
      const optionLetter = OPTION_LETTERS[currentOption] || `${currentOption + 1}`

      if (req.number.startsWith(parentNum) && req.number !== parentNum) {
        const suffix = req.number.slice(parentNum.length)

        // Check if this is a lettered requirement (e.g., "a", "b")
        const letterMatch = suffix.match(/^([a-z])$/i)
        if (letterMatch) {
          currentLetteredParent = letterMatch[1].toLowerCase()
          // e.g., "2a" -> "2Aa"
          req.number = `${parentNum}${optionLetter}${suffix}`
        }
        // Check if this is a numbered requirement (e.g., "(1)", "(2)")
        else if (suffix.match(/^\(\d+\)$/)) {
          if (currentLetteredParent) {
            // Include the lettered parent: "2(1)" -> "2Aa(1)"
            req.number = `${parentNum}${optionLetter}${currentLetteredParent}${suffix}`
          } else {
            // No lettered parent, just option: "2(1)" -> "2A(1)"
            req.number = `${parentNum}${optionLetter}${suffix}`
          }
        }
        // Other patterns (keep option prefix)
        else {
          req.number = `${parentNum}${optionLetter}${suffix}`
        }
      }
    }

    result.push(req)
  }

  // Second pass: fix parent references
  currentOption = 0
  boundaryIndex = 0
  currentLetteredParent = ''

  for (let i = 0; i < result.length; i++) {
    // Track option boundaries again
    if (boundaryIndex < boundaries.length && i === boundaries[boundaryIndex]) {
      currentOption = boundaryIndex
      currentLetteredParent = ''
      boundaryIndex++
    }

    if (i >= boundaries[0]) {
      const req = result[i]
      const optionLetter = OPTION_LETTERS[currentOption] || `${currentOption + 1}`

      // Track lettered parent for this pass too
      const numSuffix = req.number.slice(parentNum.length)
      const letterMatch = numSuffix.match(/^[A-Z]([a-z])$/i)
      if (letterMatch) {
        currentLetteredParent = letterMatch[1].toLowerCase()
      }

      // Update parentNumber
      if (req.parentNumber && req.parentNumber.startsWith(parentNum) && req.parentNumber !== parentNum) {
        const parentSuffix = req.parentNumber.slice(parentNum.length)
        req.parentNumber = `${parentNum}${optionLetter}${parentSuffix}`
      } else if (req.parentNumber === parentNum) {
        // Direct child of main requirement - check if it should point to lettered parent
        const myNumSuffix = req.number.slice(parentNum.length)
        if (myNumSuffix.match(/^[A-Z][a-z]\(\d+\)$/)) {
          // This is like "2Aa(1)" - parent should be "2Aa"
          const match = myNumSuffix.match(/^([A-Z][a-z])/)
          if (match) {
            req.parentNumber = `${parentNum}${match[1]}`
          }
        }
      }
    }
  }

  return { requirements: result, optionCount: boundaries.length }
}

function deduplicateBySequence(requirements: Requirement[]): Requirement[] {
  // For any remaining duplicates, append a sequence number to make them unique
  const result: Requirement[] = []
  const seenNumbers = new Map<string, number>()

  for (const req of requirements) {
    const count = seenNumbers.get(req.number) || 0
    seenNumbers.set(req.number, count + 1)

    if (count > 0) {
      // This is a duplicate - append sequence number
      result.push({
        ...req,
        number: `${req.number}_${count + 1}`
      })
    } else {
      result.push({ ...req })
    }
  }

  return result
}

function fixBadgeVersion(entry: BadgeEntry): { fixed: BadgeEntry; changes: string[] } {
  const changes: string[] = []
  const duplicates = findDuplicatesInBadge(entry.requirements)

  if (duplicates.size === 0) {
    return { fixed: entry, changes: [] }
  }

  const boundaries = detectOptionBoundaries(entry.requirements, duplicates)

  let fixedReqs: Requirement[]
  let optionCount = 0

  if (boundaries.length <= 1) {
    // No clear option pattern - use sequence-based deduplication
    fixedReqs = deduplicateBySequence(entry.requirements)
    changes.push(`  Deduplicated ${duplicates.size} numbers by sequence`)
  } else {
    // Apply option-based fix
    const result = assignOptionsToRequirements(entry.requirements, boundaries)
    fixedReqs = result.requirements
    optionCount = result.optionCount
    changes.push(`  Fixed: ${duplicates.size} duplicate numbers → ${optionCount} options (${OPTION_LETTERS.slice(0, optionCount)})`)
  }

  // Check for remaining duplicates and apply sequence fix if needed
  const newDuplicates = findDuplicatesInBadge(fixedReqs)
  if (newDuplicates.size > 0) {
    fixedReqs = deduplicateBySequence(fixedReqs)
    changes.push(`  Applied sequence dedup for ${newDuplicates.size} remaining duplicates`)
  }

  // Final verification
  const finalDuplicates = findDuplicatesInBadge(fixedReqs)
  if (finalDuplicates.size > 0) {
    changes.push(`  ERROR: ${finalDuplicates.size} duplicates still remain!`)
  }

  return {
    fixed: { ...entry, requirements: fixedReqs },
    changes
  }
}

async function main() {
  const inputPath = 'data/merit-badge-requirements-scraped.json'
  const outputPath = isConfirmed
    ? 'data/merit-badge-requirements-scraped.json'
    : 'data/merit-badge-requirements-scraped-fixed.json'

  console.log('Fix Scraped Duplicates')
  console.log('='.repeat(50))

  if (!isConfirmed) {
    console.log('⚠️  DRY RUN MODE - Will write to separate file')
    console.log('   Add --confirm to overwrite original\n')
  }

  const data: Data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'))

  console.log(`Processing ${data.badges.length} badge versions...\n`)

  const fixedBadges: BadgeEntry[] = []
  const allChanges: { badge: string; year: number; changes: string[] }[] = []
  let totalFixed = 0

  for (const entry of data.badges) {
    const { fixed, changes } = fixBadgeVersion(entry)
    fixedBadges.push(fixed)

    if (changes.length > 0) {
      allChanges.push({
        badge: entry.badgeName,
        year: entry.versionYear,
        changes
      })
      if (changes.some(c => c.includes('Fixed:'))) {
        totalFixed++
      }
    }
  }

  // Report changes
  console.log('Changes:')
  for (const { badge, year, changes } of allChanges) {
    console.log(`${badge} (${year}):`)
    for (const change of changes) {
      console.log(change)
    }
  }

  console.log(`\nSummary: ${totalFixed} badge versions fixed`)

  // Write output
  const outputData: Data = {
    ...data,
    badges: fixedBadges,
    lastUpdatedAt: new Date().toISOString()
  }

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2))
  console.log(`\nWritten to: ${outputPath}`)

  // Verify no duplicates remain
  let remainingDups = 0
  for (const entry of fixedBadges) {
    const dups = findDuplicatesInBadge(entry.requirements)
    remainingDups += dups.size
  }

  if (remainingDups > 0) {
    console.log(`\n⚠️  ${remainingDups} duplicate groups still remain (complex structures)`)
  } else {
    console.log(`\n✅ No duplicates remain in fixed data`)
  }
}

main().catch(console.error)
