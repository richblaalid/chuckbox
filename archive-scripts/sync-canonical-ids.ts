#!/usr/bin/env npx tsx
/**
 * Sync Canonical Scoutbook IDs
 *
 * Updates bsa_merit_badge_requirements.scoutbook_requirement_number
 * with canonical IDs from merit_badge_requirements where they match.
 *
 * This improves Scoutbook import matching without changing any queries.
 *
 * Usage:
 *   npx tsx scripts/sync-canonical-ids.ts --dry-run    # Preview changes
 *   npx tsx scripts/sync-canonical-ids.ts              # Apply changes
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

interface BsaRequirement {
  id: string
  requirement_number: string
  scoutbook_requirement_number: string | null
  description: string
  version_year: number
  badge_name: string
}

interface NewRequirement {
  id: string
  scoutbook_id: string
  description: string | null
  badge_name: string
  version_year: number
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const verbose = args.includes('--verbose')

  console.log(dryRun ? 'DRY RUN - No changes will be made' : 'LIVE RUN - Changes will be applied')
  console.log('='.repeat(60))

  // Get all BSA requirements with badge info
  console.log('\nFetching BSA requirements...')
  const bsaReqs: BsaRequirement[] = []
  let offset = 0
  const batchSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('bsa_merit_badge_requirements')
      .select(`
        id,
        requirement_number,
        scoutbook_requirement_number,
        description,
        version_year,
        bsa_merit_badges!inner(name)
      `)
      .range(offset, offset + batchSize - 1)
      .order('id')

    if (error) {
      console.error('Error fetching BSA requirements:', error)
      return
    }

    if (!data || data.length === 0) break

    for (const row of data) {
      bsaReqs.push({
        id: row.id,
        requirement_number: row.requirement_number,
        scoutbook_requirement_number: row.scoutbook_requirement_number,
        description: row.description,
        version_year: row.version_year || 0,
        badge_name: (row.bsa_merit_badges as unknown as { name: string })?.name || 'Unknown',
      })
    }

    offset += batchSize
    process.stdout.write(`  Loaded ${bsaReqs.length} BSA requirements...\r`)
  }
  console.log(`  Loaded ${bsaReqs.length} BSA requirements   `)

  // Get all new requirements with badge info
  console.log('Fetching new table requirements...')
  const newReqs: NewRequirement[] = []
  offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('merit_badge_requirements')
      .select(`
        id,
        scoutbook_id,
        description,
        merit_badge_versions!inner(badge_name, version_year)
      `)
      .range(offset, offset + batchSize - 1)
      .order('id')

    if (error) {
      console.error('Error fetching new requirements:', error)
      return
    }

    if (!data || data.length === 0) break

    for (const row of data) {
      const version = row.merit_badge_versions as unknown as { badge_name: string; version_year: number }
      newReqs.push({
        id: row.id,
        scoutbook_id: row.scoutbook_id,
        description: row.description,
        badge_name: version.badge_name,
        version_year: version.version_year,
      })
    }

    offset += batchSize
    process.stdout.write(`  Loaded ${newReqs.length} new requirements...\r`)
  }
  console.log(`  Loaded ${newReqs.length} new requirements   `)

  // Build lookup map for new requirements by badge+year+normalized_id
  // We'll try multiple matching strategies
  const newReqsMap = new Map<string, NewRequirement>()
  for (const nr of newReqs) {
    // Key: exact badge name + year + scoutbook_id
    const key = `${nr.badge_name}|${nr.version_year}|${nr.scoutbook_id}`
    newReqsMap.set(key, nr)
  }

  // Name mapping for badges with different names between tables
  const nameMap: Record<string, string> = {
    'Artificial Intelligence': 'Artificial Intelligence (AI)',
    'Fish & Wildlife Management': 'Fish and Wildlife Management',
    'American Indian Lore': 'American Indian Culture',
  }

  // Track updates
  const updates: Array<{
    bsaId: string
    oldScoutbookNum: string | null
    newScoutbookId: string
    badgeName: string
    versionYear: number
  }> = []

  const unmatched: Array<{ badgeName: string; versionYear: number; reqNum: string }> = []

  console.log('\nMatching requirements...')

  for (const bsaReq of bsaReqs) {
    // Try direct match first
    let newReq = newReqsMap.get(`${bsaReq.badge_name}|${bsaReq.version_year}|${bsaReq.scoutbook_requirement_number}`)

    // Try with mapped name
    if (!newReq && nameMap[bsaReq.badge_name]) {
      const mappedName = nameMap[bsaReq.badge_name]
      newReq = newReqsMap.get(`${mappedName}|${bsaReq.version_year}|${bsaReq.scoutbook_requirement_number}`)
    }

    // Try normalizing the old format to new format
    if (!newReq) {
      // Convert "2a" to "2(a)", "3b" to "3(b)", etc.
      const converted = convertToParenthetical(bsaReq.scoutbook_requirement_number || bsaReq.requirement_number)
      newReq = newReqsMap.get(`${bsaReq.badge_name}|${bsaReq.version_year}|${converted}`)

      if (!newReq && nameMap[bsaReq.badge_name]) {
        newReq = newReqsMap.get(`${nameMap[bsaReq.badge_name]}|${bsaReq.version_year}|${converted}`)
      }
    }

    // Try matching by description when IDs don't match
    // Be more conservative - require longer description match and verify structure similarity
    if (!newReq && bsaReq.description && bsaReq.description.length > 50) {
      const candidates = newReqs.filter(
        (nr) =>
          (nr.badge_name === bsaReq.badge_name || nameMap[bsaReq.badge_name] === nr.badge_name) &&
          nr.version_year === bsaReq.version_year &&
          nr.description &&
          // Require exact match on first 80 chars for high confidence
          nr.description.substring(0, 80) === bsaReq.description.substring(0, 80) &&
          // Verify the main requirement number is the same
          getMainReqNumber(nr.scoutbook_id) === getMainReqNumber(bsaReq.scoutbook_requirement_number || bsaReq.requirement_number)
      )
      if (candidates.length === 1) {
        newReq = candidates[0]
      }
    }

    if (newReq) {
      // Check if update is needed
      if (bsaReq.scoutbook_requirement_number !== newReq.scoutbook_id) {
        // Validate the update is a reasonable format conversion
        // Only apply if it's a simple format conversion (letter -> parenthetical)
        const oldId = bsaReq.scoutbook_requirement_number || bsaReq.requirement_number
        const newId = newReq.scoutbook_id

        // Check if this is a simple format conversion
        if (isSimpleFormatConversion(oldId, newId)) {
          updates.push({
            bsaId: bsaReq.id,
            oldScoutbookNum: bsaReq.scoutbook_requirement_number,
            newScoutbookId: newReq.scoutbook_id,
            badgeName: bsaReq.badge_name,
            versionYear: bsaReq.version_year,
          })
        } else {
          // Structural change - don't update, count as needs review
          unmatched.push({
            badgeName: bsaReq.badge_name,
            versionYear: bsaReq.version_year,
            reqNum: oldId,
          })
        }
      }
    } else {
      unmatched.push({
        badgeName: bsaReq.badge_name,
        versionYear: bsaReq.version_year,
        reqNum: bsaReq.scoutbook_requirement_number || bsaReq.requirement_number,
      })
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('RESULTS')
  console.log('='.repeat(60))
  console.log(`Total BSA requirements: ${bsaReqs.length}`)
  console.log(`Total new requirements: ${newReqs.length}`)
  console.log(`Matched (no update needed): ${bsaReqs.length - updates.length - unmatched.length}`)
  console.log(`Need scoutbook_id update: ${updates.length}`)
  console.log(`Unmatched: ${unmatched.length}`)

  if (verbose && updates.length > 0) {
    console.log('\nSample updates:')
    for (const u of updates.slice(0, 20)) {
      console.log(`  ${u.badgeName} ${u.versionYear}: "${u.oldScoutbookNum}" -> "${u.newScoutbookId}"`)
    }
  }

  if (verbose && unmatched.length > 0) {
    console.log('\nSample unmatched:')
    const uniqueUnmatched = new Set<string>()
    for (const u of unmatched) {
      const key = `${u.badgeName}|${u.versionYear}`
      if (!uniqueUnmatched.has(key)) {
        console.log(`  ${u.badgeName} ${u.versionYear}: ${u.reqNum}`)
        uniqueUnmatched.add(key)
        if (uniqueUnmatched.size >= 20) break
      }
    }
  }

  // Apply updates if not dry run
  if (!dryRun && updates.length > 0) {
    console.log('\nApplying updates...')
    let applied = 0
    let failed = 0

    for (const update of updates) {
      const { error } = await supabase
        .from('bsa_merit_badge_requirements')
        .update({ scoutbook_requirement_number: update.newScoutbookId })
        .eq('id', update.bsaId)

      if (error) {
        failed++
        if (failed <= 5) console.error(`  Error updating ${update.bsaId}:`, error.message)
      } else {
        applied++
      }

      if ((applied + failed) % 100 === 0) {
        process.stdout.write(`  Applied ${applied}/${updates.length}...\r`)
      }
    }

    console.log(`\nApplied ${applied} updates, ${failed} failed   `)
  }
}

/**
 * Extract the main requirement number (first numeric part)
 */
function getMainReqNumber(reqNum: string): string {
  const match = reqNum.match(/^(\d+)/)
  return match ? match[1] : reqNum
}

/**
 * Check if this is a simple format conversion (same structure, different notation)
 * Returns true for conversions like:
 *   - "4a" -> "4(a)"
 *   - "2A(1)" -> "2(a)(1)"
 *   - "3b" -> "3(b)"
 *   - "11" -> "11."
 * Returns false for structural changes like:
 *   - "8F(1)" -> "8 Option B(3)(a)" (different structure)
 *   - "6Aa" -> "6a[1]a Aerobic" (added text)
 *   - "1(13)" -> "1(b)(21)" (different sub-numbering)
 */
function isSimpleFormatConversion(oldId: string, newId: string): boolean {
  // Normalize both IDs for comparison
  const normalizeForComparison = (id: string): string => {
    return id
      .toLowerCase()
      .replace(/\s+/g, '') // Remove spaces
      .replace(/option\s*[a-z]/gi, '') // Remove "Option A/B" text
      .replace(/\.$/g, '') // Remove trailing dots only
      .replace(/\[(\d+)\]/g, '($1)') // Convert [1] to (1)
      .replace(/([a-z])(?=\()/g, '($1)') // Convert "a(" to "(a)("
      .replace(/^(\d+)([a-z])$/g, '$1($2)') // Convert "4a" to "4(a)"
      .replace(/^(\d+)([a-z])(\([^)]+\))/g, '$1($2)$3') // Convert "4a(1)" to "4(a)(1)"
  }

  const normalizedOld = normalizeForComparison(oldId)
  const normalizedNew = normalizeForComparison(newId)

  // If they're the same after normalization, it's a simple format change
  if (normalizedOld === normalizedNew) return true

  // Check if main requirement number matches
  const oldMain = getMainReqNumber(oldId)
  const newMain = getMainReqNumber(newId)
  if (oldMain !== newMain) return false

  // Extract all numbers from both IDs
  const oldNumbers = (oldId.match(/\d+/g) || []).join(',')
  const newNumbers = (newId.match(/\d+/g) || []).join(',')

  // If numbers are completely different (beyond the main req), it's structural
  // e.g., "1(13)" vs "1(b)(21)" - has different numbers
  if (oldNumbers !== newNumbers && oldId.includes('(') && newId.includes('(')) {
    // Check if it's just adding a trailing dot
    if (oldId + '.' === newId || oldId === newId + '.') return true
    // Check if it's just letter case change
    if (oldId.toLowerCase() === newId.toLowerCase()) return true
    return false
  }

  // Check length ratio - if the new ID is much longer, it likely has added text
  if (newId.length > oldId.length * 2) return false

  // Check if new ID contains words (Option, Aerobic, etc.) that old doesn't have
  const hasNewWords = /[a-z]{4,}/i.test(newId.replace(/option/gi, '').replace(/opt/gi, ''))
  const hasOldWords = /[a-z]{4,}/i.test(oldId.replace(/option/gi, '').replace(/opt/gi, ''))
  if (hasNewWords && !hasOldWords) return false

  // Extract letters (excluding option)
  const oldLetters = (oldId.match(/[a-zA-Z]/g) || []).map((l) => l.toLowerCase()).join('')
  const newLetters = (newId.match(/[a-zA-Z]/g) || []).map((l) => l.toLowerCase()).join('')

  // Simple format conversion should have same letters
  // e.g., "4a" -> "4(a)" both have just "a"
  // e.g., "2A(1)" -> "2(a)(1)" both have just "a"
  if (oldLetters === newLetters) return true

  // Allow trailing dot additions
  if (oldId + '.' === newId) return true

  // If letters differ significantly, it's not a simple conversion
  if (Math.abs(oldLetters.length - newLetters.length) > 1) return false

  // Final check: structure pattern should be similar
  const getPattern = (id: string): string => {
    return id
      .replace(/\d+/g, 'N')
      .replace(/[a-zA-Z]+/g, 'L')
      .replace(/[()[\]]/g, 'P')
  }

  const oldPattern = getPattern(oldId)
  const newPattern = getPattern(newId)

  // Patterns like "NL" vs "N(L)" or "NL(N)" vs "N(L)(N)" are okay
  const patternDiff = Math.abs(oldPattern.length - newPattern.length)
  return patternDiff <= 2
}

/**
 * Convert old format like "2a" to parenthetical "2(a)"
 */
function convertToParenthetical(reqNum: string): string {
  // Handle formats like "2a" -> "2(a)", "2a(1)" -> "2(a)(1)"
  // Also handle "2(1)" which might stay as-is

  // Pattern: number followed by letter(s) not in parentheses
  const match = reqNum.match(/^(\d+)([a-zA-Z])(.*)$/)
  if (match) {
    const [, num, letter, rest] = match
    return `${num}(${letter.toLowerCase()})${rest}`
  }

  return reqNum
}

main().catch(console.error)
