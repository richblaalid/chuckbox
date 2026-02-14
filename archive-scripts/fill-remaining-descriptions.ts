#!/usr/bin/env npx tsx
/**
 * Fill Remaining Descriptions - Targeted Piece-by-Piece Matching
 *
 * Handles the remaining missing descriptions with specific strategies:
 * 1. Simple not found (227) - Exact number matching, normalized lookups
 * 2. Bracket notation (57) - Convert between [n] and (n) formats
 * 3. Option format (22) - Parse complex option patterns
 * 4. No scraped badge (68) - Flag for manual scraping
 *
 * Usage:
 *   npx tsx scripts/fill-remaining-descriptions.ts --dry-run
 *   npx tsx scripts/fill-remaining-descriptions.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

interface ScrapedRequirement {
  number: string
  description: string
  parentNumber: string | null
  depth: number
}

interface ScrapedBadge {
  badgeName: string
  versionYear: number
  requirements: ScrapedRequirement[]
}

interface MissingRequirement {
  id: string
  scoutbook_id: string
  badge_version_id: string
  main_req: string | null
  section: string | null
  item: string | null
  option_name: string | null
  option_letter: string | null
}

interface BadgeVersion {
  id: string
  badge_name: string
  version_year: number
}

interface MatchResult {
  reqId: string
  scoutbookId: string
  badgeName: string
  year: number
  strategy: string
  description: string
}

// ============================================
// Matching Strategies
// ============================================

/**
 * Strategy 1: Exact match on normalized number
 * Handles: "9" -> "9", "10b" -> "10b", "2a" -> "2a"
 */
function tryExactMatch(
  scoutbookId: string,
  scrapedMap: Map<string, string>
): string | null {
  // Direct lookup
  if (scrapedMap.has(scoutbookId)) {
    return scrapedMap.get(scoutbookId)!
  }

  // Try without trailing period
  const noPeriod = scoutbookId.replace(/\.$/, '')
  if (scrapedMap.has(noPeriod)) {
    return scrapedMap.get(noPeriod)!
  }

  // Try lowercase
  const lower = scoutbookId.toLowerCase()
  if (scrapedMap.has(lower)) {
    return scrapedMap.get(lower)!
  }

  return null
}

/**
 * Strategy 2: Bracket notation conversion
 * Handles: "7b[4]" -> "7b(4)", "3a[2]" -> "3a(2)"
 */
function tryBracketConversion(
  scoutbookId: string,
  scrapedMap: Map<string, string>
): string | null {
  // Convert [n] to (n)
  const converted = scoutbookId.replace(/\[(\d+)\]/g, '($1)')
  if (scrapedMap.has(converted)) {
    return scrapedMap.get(converted)!
  }

  // Try lowercase
  if (scrapedMap.has(converted.toLowerCase())) {
    return scrapedMap.get(converted.toLowerCase())!
  }

  // Try reverse: (n) to [n]
  const reversed = scoutbookId.replace(/\((\d+)\)/g, '[$1]')
  if (scrapedMap.has(reversed)) {
    return scrapedMap.get(reversed)!
  }

  return null
}

/**
 * Strategy 3: Option format parsing
 * Handles: "6 Option A (1)(d)" -> variations like "6A(1)(d)", "6(A)(1)(d)"
 */
function tryOptionFormat(
  scoutbookId: string,
  scrapedMap: Map<string, string>
): string | null {
  // Pattern: "N Option X (sub)" or "Na Option X" etc.
  const optionMatch = scoutbookId.match(/^(\d+)([a-z]?)?\s*Option\s*([A-Z])\s*(.*)$/i)
  if (!optionMatch) return null

  const [, mainNum, subLetter, optionLetter, rest] = optionMatch

  // Try various formats
  const candidates = [
    `${mainNum}${optionLetter}${rest}`,           // "6A(1)(d)"
    `${mainNum}(${optionLetter})${rest}`,         // "6(A)(1)(d)"
    `${mainNum}${subLetter || ''}${optionLetter}${rest}`, // "6aA(1)(d)"
    `${mainNum}${optionLetter.toLowerCase()}${rest}`,     // "6a(1)(d)"
  ]

  for (const candidate of candidates) {
    if (scrapedMap.has(candidate)) {
      return scrapedMap.get(candidate)!
    }
    if (scrapedMap.has(candidate.toLowerCase())) {
      return scrapedMap.get(candidate.toLowerCase())!
    }
  }

  return null
}

/**
 * Strategy 4: Named option suffix matching
 * Handles: "4a1 Triathlon Option" -> "4a(1)" or "4(a)(1)"
 */
function tryNamedOptionMatch(
  scoutbookId: string,
  scrapedMap: Map<string, string>
): string | null {
  // Pattern: "Na1 Name Option" or "Nab Name"
  const namedMatch = scoutbookId.match(/^(\d+)([a-z])(\d+)?\s+\w+/i)
  if (!namedMatch) return null

  const [, mainNum, subLetter, itemNum] = namedMatch

  // Try various formats without the name
  const candidates = itemNum
    ? [
        `${mainNum}${subLetter}(${itemNum})`,      // "4a(1)"
        `${mainNum}(${subLetter})(${itemNum})`,    // "4(a)(1)"
        `${mainNum}${subLetter}${itemNum}`,        // "4a1"
      ]
    : [
        `${mainNum}${subLetter}`,                  // "4a"
        `${mainNum}(${subLetter})`,                // "4(a)"
      ]

  for (const candidate of candidates) {
    if (scrapedMap.has(candidate)) {
      return scrapedMap.get(candidate)!
    }
    if (scrapedMap.has(candidate.toLowerCase())) {
      return scrapedMap.get(candidate.toLowerCase())!
    }
  }

  return null
}

/**
 * Strategy 5: Bracket to uppercase option conversion
 * Handles: "7b[1]a" -> "7Ba", "4g[1]" -> "4G"
 * Only matches if the canonical is a simple structure (not deeply nested)
 */
function tryBracketToUppercase(
  scoutbookId: string,
  scrapedMap: Map<string, string>
): string | null {
  // Pattern: "Nx[n]y" where x is lowercase option, [n] is sub-choice, y is sub-item
  const bracketMatch = scoutbookId.match(/^(\d+)([a-z])\[(\d+)\]([a-z])?$/i)
  if (!bracketMatch) return null

  const [, mainNum, optionLetter, , subItem] = bracketMatch

  // Try converting to uppercase option format
  const candidates = [
    `${mainNum}${optionLetter.toUpperCase()}${subItem || ''}`,  // "7Ba"
    `${mainNum}${optionLetter.toUpperCase()}`,                   // "7B"
    `${mainNum}${optionLetter.toUpperCase()}a`,                  // "7Ba" if no subItem
  ]

  for (const candidate of candidates) {
    if (scrapedMap.has(candidate)) {
      return scrapedMap.get(candidate)!
    }
    if (scrapedMap.has(candidate.toLowerCase())) {
      return scrapedMap.get(candidate.toLowerCase())!
    }
  }

  return null
}

/**
 * Strategy 6: 2026 format conversion
 * Handles: pre-2026 "1a" vs 2026+ "1(a)"
 */
function try2026FormatConversion(
  scoutbookId: string,
  scrapedMap: Map<string, string>,
  year: number
): string | null {
  if (year >= 2026) {
    // Try converting 1(a) to 1a
    const pre2026 = scoutbookId.replace(/\(([a-z])\)/gi, '$1')
    if (scrapedMap.has(pre2026)) {
      return scrapedMap.get(pre2026)!
    }
  } else {
    // Try converting 1a to 1(a)
    const post2026 = scoutbookId.replace(/(\d+)([a-z])/gi, '$1($2)')
    if (scrapedMap.has(post2026)) {
      return scrapedMap.get(post2026)!
    }
  }

  return null
}

/**
 * Strategy 7: Strip all formatting and compare normalized
 */
function tryNormalizedMatch(
  scoutbookId: string,
  scrapedMap: Map<string, string>,
  allScraped: ScrapedRequirement[]
): string | null {
  // Normalize canonical: remove all non-alphanumeric
  const normalizedCanonical = scoutbookId.replace(/[^a-z0-9]/gi, '').toLowerCase()

  for (const scraped of allScraped) {
    const normalizedScraped = scraped.number.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (normalizedScraped === normalizedCanonical && scraped.description) {
      return scraped.description
    }
  }

  return null
}

// ============================================
// Main
// ============================================

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const verbose = process.argv.includes('--verbose')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE env vars')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Load scraped data
  const scrapedPath = 'data/merit-badge-requirements-scraped-fixed.json'
  const scrapedData = JSON.parse(fs.readFileSync(scrapedPath, 'utf-8'))

  console.log(dryRun ? 'DRY RUN\n' : 'LIVE RUN\n')
  console.log('Fill Remaining Descriptions - Targeted Matching')
  console.log('='.repeat(60))

  // Build scraped lookup by badge+year
  const scrapedLookup = new Map<string, { map: Map<string, string>; all: ScrapedRequirement[] }>()
  for (const badge of scrapedData.badges as ScrapedBadge[]) {
    const key = `${badge.badgeName}|${badge.versionYear}`
    const reqMap = new Map<string, string>()

    for (const req of badge.requirements) {
      if (req.description && req.description.length > 0) {
        // Store with multiple key variations
        reqMap.set(req.number, req.description)
        reqMap.set(req.number.toLowerCase(), req.description)
        reqMap.set(req.number.replace(/\.$/, ''), req.description)
        reqMap.set(req.number.replace(/\.$/, '').toLowerCase(), req.description)
      }
    }

    scrapedLookup.set(key, { map: reqMap, all: badge.requirements })
  }

  // Get all requirements missing descriptions
  const { data: missing } = await supabase
    .from('merit_badge_requirements')
    .select('id, scoutbook_id, badge_version_id, main_req, section, item, option_name, option_letter')
    .is('description', null)

  if (!missing || missing.length === 0) {
    console.log('No missing descriptions found!')
    return
  }

  console.log(`Found ${missing.length} requirements missing descriptions\n`)

  // Get version info
  const versionIds = [...new Set(missing.map(m => m.badge_version_id))]
  const { data: versions } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .in('id', versionIds)

  const versionMap = new Map<string, BadgeVersion>()
  for (const v of versions || []) {
    versionMap.set(v.id, v)
  }

  // Track results
  const matches: MatchResult[] = []
  const noScrapedBadge: MissingRequirement[] = []
  const stillMissing: Array<{ req: MissingRequirement; badge: string; year: number }> = []

  // Process each missing requirement
  for (const req of missing as MissingRequirement[]) {
    const version = versionMap.get(req.badge_version_id)
    if (!version) continue

    const key = `${version.badge_name}|${version.version_year}`
    const scraped = scrapedLookup.get(key)

    if (!scraped) {
      noScrapedBadge.push(req)
      continue
    }

    const { map: scrapedMap, all: allScraped } = scraped
    let description: string | null = null
    let strategy = ''

    // Try strategies in order of specificity
    description = tryExactMatch(req.scoutbook_id, scrapedMap)
    if (description) strategy = 'exact'

    if (!description) {
      description = tryBracketConversion(req.scoutbook_id, scrapedMap)
      if (description) strategy = 'bracket'
    }

    if (!description) {
      description = tryOptionFormat(req.scoutbook_id, scrapedMap)
      if (description) strategy = 'option-format'
    }

    if (!description) {
      description = tryNamedOptionMatch(req.scoutbook_id, scrapedMap)
      if (description) strategy = 'named-option'
    }

    if (!description) {
      description = try2026FormatConversion(req.scoutbook_id, scrapedMap, version.version_year)
      if (description) strategy = '2026-format'
    }

    if (!description) {
      description = tryNormalizedMatch(req.scoutbook_id, scrapedMap, allScraped)
      if (description) strategy = 'normalized'
    }

    if (!description) {
      description = tryBracketToUppercase(req.scoutbook_id, scrapedMap)
      if (description) strategy = 'bracket-uppercase'
    }

    if (description) {
      matches.push({
        reqId: req.id,
        scoutbookId: req.scoutbook_id,
        badgeName: version.badge_name,
        year: version.version_year,
        strategy,
        description
      })
    } else {
      stillMissing.push({ req, badge: version.badge_name, year: version.version_year })
    }
  }

  // Report results
  console.log('MATCHING RESULTS')
  console.log('='.repeat(60))
  console.log(`Total missing: ${missing.length}`)
  console.log(`Matched: ${matches.length}`)
  console.log(`No scraped badge version: ${noScrapedBadge.length}`)
  console.log(`Still missing: ${stillMissing.length}`)
  console.log('')

  // Strategy breakdown
  const byStrategy = new Map<string, number>()
  for (const m of matches) {
    byStrategy.set(m.strategy, (byStrategy.get(m.strategy) || 0) + 1)
  }

  console.log('By strategy:')
  for (const [strategy, count] of byStrategy.entries()) {
    console.log(`  ${strategy}: ${count}`)
  }
  console.log('')

  // Show sample matches if verbose
  if (verbose) {
    console.log('SAMPLE MATCHES')
    console.log('='.repeat(60))
    for (const m of matches.slice(0, 10)) {
      console.log(`${m.badgeName} ${m.year}: "${m.scoutbookId}" [${m.strategy}]`)
      console.log(`  → ${m.description.substring(0, 80)}...`)
    }
    console.log('')
  }

  // Show still missing
  if (stillMissing.length > 0) {
    console.log('STILL MISSING (sample)')
    console.log('='.repeat(60))
    for (const { req, badge, year } of stillMissing.slice(0, 15)) {
      console.log(`  ${badge} ${year}: "${req.scoutbook_id}"`)
    }
    if (stillMissing.length > 15) {
      console.log(`  ... and ${stillMissing.length - 15} more`)
    }
    console.log('')
  }

  // Show badges needing manual scraping
  if (noScrapedBadge.length > 0) {
    console.log('BADGES NEEDING MANUAL SCRAPING')
    console.log('='.repeat(60))
    const badgeYears = new Set<string>()
    for (const req of noScrapedBadge) {
      const version = versionMap.get(req.badge_version_id)
      if (version) {
        badgeYears.add(`${version.badge_name} ${version.version_year}`)
      }
    }
    for (const by of [...badgeYears].slice(0, 20)) {
      console.log(`  ${by}`)
    }
    if (badgeYears.size > 20) {
      console.log(`  ... and ${badgeYears.size - 20} more versions`)
    }
    console.log('')
  }

  // Apply updates
  if (!dryRun && matches.length > 0) {
    console.log('Applying updates...')
    let updated = 0
    for (const match of matches) {
      const { error } = await supabase
        .from('merit_badge_requirements')
        .update({ description: match.description })
        .eq('id', match.reqId)

      if (!error) {
        updated++
      }
    }
    console.log(`Updated ${updated} descriptions`)
    console.log('')

    // Verify new totals
    const { count: total } = await supabase
      .from('merit_badge_requirements')
      .select('*', { count: 'exact', head: true })

    const { count: withDesc } = await supabase
      .from('merit_badge_requirements')
      .select('*', { count: 'exact', head: true })
      .not('description', 'is', null)

    console.log(`New coverage: ${withDesc}/${total} (${((withDesc!/total!)*100).toFixed(1)}%)`)
  } else if (dryRun) {
    console.log('(DRY RUN - no changes made)')
  }
}

main().catch(console.error)
