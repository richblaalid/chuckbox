#!/usr/bin/env npx tsx
/**
 * Merge Scoutbook IDs into Unified Export
 *
 * Takes the unified export (with hierarchy) and updates scoutbook_id values
 * using the actual Scoutbook requirement IDs from scoutbook-requirement-ids.json.
 *
 * This produces a merged export with both:
 * - Hierarchical structure with parent/child relationships
 * - Correct Scoutbook IDs for 100% import matching
 */

import * as fs from 'fs'
import * as path from 'path'

// Load the unified export
const unifiedPath = path.join(process.cwd(), 'data/bsa-data-unified.json')
const unified = JSON.parse(fs.readFileSync(unifiedPath, 'utf-8'))

// Load the Scoutbook requirement IDs
const scoutbookIdsPath = path.join(process.cwd(), 'data/scoutbook-requirement-ids.json')
const scoutbookIds: Record<string, Record<string, string[]>> = JSON.parse(
  fs.readFileSync(scoutbookIdsPath, 'utf-8')
)

console.log('='.repeat(60))
console.log('MERGE SCOUTBOOK IDS INTO UNIFIED EXPORT')
console.log('='.repeat(60))
console.log('')

// Badge name aliases for matching
const BADGE_NAME_ALIASES: Record<string, string> = {
  'fish & wildlife management': 'fish and wildlife management',
  'artificial intelligence': 'artificial intelligence (ai)',
}

function normalizeNameForLookup(name: string): string {
  const lower = name.toLowerCase()
  return BADGE_NAME_ALIASES[lower] || lower
}

// Process each badge
let updatedBadges = 0
let updatedVersions = 0
let updatedRequirements = 0
let missingVersions = 0

for (const badge of unified.merit_badges) {
  const lookupName = normalizeNameForLookup(badge.name)
  const badgeScoutbookVersions = scoutbookIds[badge.name] || scoutbookIds[lookupName]

  if (!badgeScoutbookVersions) {
    // Try case-insensitive search
    const key = Object.keys(scoutbookIds).find(
      k => k.toLowerCase() === badge.name.toLowerCase()
    )
    if (key) {
      Object.assign(badgeScoutbookVersions || {}, scoutbookIds[key])
    }
  }

  if (!badgeScoutbookVersions) {
    console.warn(`  No Scoutbook IDs found for: ${badge.name}`)
    continue
  }

  updatedBadges++

  for (const version of badge.versions) {
    const versionIds = badgeScoutbookVersions[String(version.version_year)]

    if (!versionIds) {
      missingVersions++
      // Keep existing scoutbook_id values as fallback
      continue
    }

    updatedVersions++

    // Create a set of Scoutbook IDs for this version
    const scoutbookIdSet = new Set(versionIds)

    // Update requirements recursively
    function updateRequirements(reqs: any[]): void {
      for (const req of reqs) {
        // Try to find matching Scoutbook ID
        const reqNum = req.requirement_number

        // Check various formats
        if (scoutbookIdSet.has(reqNum)) {
          req.scoutbook_id = reqNum
          updatedRequirements++
        } else if (scoutbookIdSet.has(reqNum + '.')) {
          req.scoutbook_id = reqNum + '.'
          updatedRequirements++
        } else if (reqNum.endsWith('.') && scoutbookIdSet.has(reqNum.slice(0, -1))) {
          req.scoutbook_id = reqNum.slice(0, -1)
          updatedRequirements++
        } else {
          // Try to find by matching the base requirement number
          // e.g., "9b" might match "9b[1]", "9b[2]", etc.
          const matching = versionIds.find(id => {
            // Exact match
            if (id === reqNum) return true
            // ID starts with requirement number (for sub-options like 9b[1])
            if (id.startsWith(reqNum + '[')) return false // Don't match parent to child
            // Requirement number matches ID without brackets
            if (reqNum === id.replace(/\[.*\]$/, '')) return false // Parent shouldn't match child's base
            return false
          })

          if (matching) {
            req.scoutbook_id = matching
            updatedRequirements++
          }
          // Otherwise keep the existing scoutbook_id
        }

        // Process children
        if (req.children && req.children.length > 0) {
          updateRequirements(req.children)
        }
      }
    }

    updateRequirements(version.requirements)
  }
}

console.log('Stats:')
console.log(`  Badges processed: ${updatedBadges}`)
console.log(`  Versions updated: ${updatedVersions}`)
console.log(`  Requirements updated: ${updatedRequirements}`)
console.log(`  Versions missing from Scoutbook data: ${missingVersions}`)

// Write the updated export
const outputPath = path.join(process.cwd(), 'data/bsa-data-merged.json')
unified.exported_at = new Date().toISOString()
unified.source = 'unified-with-scoutbook-ids'
fs.writeFileSync(outputPath, JSON.stringify(unified, null, 2))

console.log('')
console.log(`Output: ${outputPath}`)
console.log(`Size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`)
console.log('')
console.log('='.repeat(60))
console.log('MERGE COMPLETE')
console.log('='.repeat(60))
