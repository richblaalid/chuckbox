#!/usr/bin/env npx tsx
/**
 * Merge Scraped Descriptions into Canonical Data
 *
 * Takes canonical requirement IDs from the database and merges in
 * descriptions from scraped data. Also adds header rows for UI display.
 *
 * Strategy:
 * 1. Direct match: scraped.number === canonical.scoutbook_id
 * 2. Normalized match: strip periods, fix case, normalize options
 * 3. Position-based match: same badge/version, match by sort order
 * 4. Headers: scraped items with no canonical match → insert as is_header=true
 *
 * Usage:
 *   npx tsx scripts/merge-descriptions-to-canonical.ts
 *   npx tsx scripts/merge-descriptions-to-canonical.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// ============================================
// Types
// ============================================

interface ScrapedRequirement {
  number: string
  description: string
  parentNumber: string | null
  depth: number
}

interface ScrapedBadge {
  badgeName: string
  versionYear: number
  versionLabel: string
  requirements: ScrapedRequirement[]
}

interface ScrapedData {
  badges: ScrapedBadge[]
}

interface CanonicalRequirement {
  id: string
  scoutbook_id: string
  display_label: string | null
  description: string | null
  depth: number
  sort_order: number
  is_header: boolean
  main_req: string | null
}

interface MergeStats {
  directMatches: number
  normalizedMatches: number
  positionMatches: number
  headersAdded: number
  unmatched: number
  descriptionsUpdated: number
}

// ============================================
// ID Normalization
// ============================================

/**
 * Normalize an ID for matching purposes
 * Handles: trailing periods, case, spacing, option formats
 */
function normalizeId(id: string): string {
  let normalized = id
    .trim()
    .replace(/\.+$/, '')           // Remove trailing periods
    .replace(/\s+/g, ' ')          // Normalize whitespace

  return normalized
}

/**
 * Create multiple normalized variants of an ID for fuzzy matching
 */
function getIdVariants(id: string): string[] {
  const base = normalizeId(id)
  const variants = new Set<string>([base, base.toLowerCase()])

  // Variant: lowercase
  variants.add(base.toLowerCase())

  // Variant: remove all periods
  variants.add(base.replace(/\./g, ''))
  variants.add(base.replace(/\./g, '').toLowerCase())

  // Variant: parenthetical to letter (1(a) → 1a)
  const parenToLetter = base.replace(/\(([a-z])\)/gi, '$1')
  variants.add(parenToLetter)
  variants.add(parenToLetter.toLowerCase())

  // Variant: letter to parenthetical (1a → 1(a))
  const letterToParen = base.replace(/(\d)([a-z])(?![a-z])/gi, '$1($2)')
  variants.add(letterToParen)
  variants.add(letterToParen.toLowerCase())

  // Variant: bracket to parenthetical (1a[1] → 1a(1))
  const bracketToParen = base.replace(/\[(\d+)\]/g, '($1)')
  variants.add(bracketToParen)

  // Variant: Opt to Option (5a Opt B → 5a Option B)
  const optToOption = base.replace(/ Opt ([A-Z])/g, ' Option $1')
  variants.add(optToOption)

  // Variant: Option to Opt
  const optionToOpt = base.replace(/ Option ([A-Z])/g, ' Opt $1')
  variants.add(optionToOpt)

  // Variant: named option formats
  // "4a1 Triathlon Option" ↔ "4 Option A (a)(1)" style
  const namedOptMatch = base.match(/^(\d+)([a-z])(\d+)\s+(\w+)\s+Option$/i)
  if (namedOptMatch) {
    const [, mainReq, section, item, optName] = namedOptMatch
    // Try different formats
    variants.add(`${mainReq}${section}${item} ${optName}`)
    variants.add(`${mainReq}${section.toLowerCase()}${item} ${optName} Option`)
  }

  // Variant: "6a avian" style ↔ "6Aa" style
  const spaceOptMatch = base.match(/^(\d+)([a-z])\s+(\w+)$/i)
  if (spaceOptMatch) {
    const [, mainReq, section, optName] = spaceOptMatch
    // 6a avian → 6Aa (first letter of option)
    const firstLetter = optName.charAt(0).toUpperCase()
    variants.add(`${mainReq}${section.toUpperCase()}${section.toLowerCase()}`)
    variants.add(`${mainReq}${firstLetter}${section.toLowerCase()}`)
  }

  return [...variants]
}

/**
 * Check if a scraped item looks like a header (not a trackable requirement)
 */
function isLikelyHeader(req: ScrapedRequirement): boolean {
  const desc = req.description.toLowerCase()
  const num = req.number

  // Short descriptions that are section labels
  if (desc.length < 30) {
    const headerPatterns = [
      /^swimming\.?$/i,
      /^biking\.?$/i,
      /^running\.?$/i,
      /^cycling\.?$/i,
      /^option\s+[a-h][\s:\-]?$/i,
      /^(triathlon|duathlon|aquathlon|aquabike)(\s+option)?\.?$/i,
      /^(ice|inline)\s*(skating)?\.?$/i,
      /^(alpine|nordic|snowboard|cross-country)\.?$/i,
      /^(avian|beef|dairy|hog|horse|rabbit|sheep|goat)\.?$/i,
    ]
    if (headerPatterns.some(p => p.test(desc))) {
      return true
    }
  }

  // Numbers that look like header markers (often have weird format)
  if (/^\d+[A-Z]\(\d+\)$/.test(num)) {
    // Like "4A(1)" which is typically a section marker
    return true
  }

  // "Do the following:" parent requirements are trackable (main requirements)
  // so we don't mark those as headers

  return false
}

/**
 * Detect the main requirement number from an ID
 */
function getMainReqNumber(id: string): string | null {
  const match = id.match(/^(\d+)/)
  return match ? match[1] : null
}

// ============================================
// Matching Logic
// ============================================

interface MatchResult {
  canonicalId: string
  scrapedNumber: string
  matchType: 'direct' | 'normalized' | 'description' | 'position' | 'none'
  description: string | null
}

/**
 * Calculate text similarity (simple word overlap)
 */
function textSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3))

  if (words1.size === 0 || words2.size === 0) return 0

  let overlap = 0
  for (const word of words1) {
    if (words2.has(word)) overlap++
  }

  return overlap / Math.max(words1.size, words2.size)
}

/**
 * Filter scraped requirements to only trackable items
 * Excludes: depth 0 (main reqs), headers, section labels
 */
function filterToTrackable(scrapedReqs: ScrapedRequirement[]): ScrapedRequirement[] {
  return scrapedReqs.filter(req => {
    // Exclude depth 0 (main requirement headers)
    if (req.depth === 0) return false

    // Exclude items without a number/label
    if (!req.number) return false

    // Exclude short descriptions that are likely section headers
    // (Swimming, Biking, Running, etc.)
    if (req.description.length < 25) {
      const sectionPatterns = [
        /^(swimming|biking|running|cycling)\.?$/i,
        /^option\s+[a-h]\.?$/i,
        /^(triathlon|duathlon|aquathlon|aquabike)\.?$/i,
        /^(ice|inline|alpine|nordic|snowboard)\.?$/i,
        /^(avian|beef|dairy|hog|horse|rabbit|sheep|goat)\.?$/i,
        /^(corn|cotton|forage|small grains?|wheat)\.?$/i,
        /^do the following:?$/i,
        /^complete (one|all|any)/i,
      ]
      if (sectionPatterns.some(p => p.test(req.description))) {
        return false
      }
    }

    return true
  })
}

function matchRequirements(
  canonicalReqs: CanonicalRequirement[],
  scrapedReqs: ScrapedRequirement[]
): { matches: MatchResult[], unmatchedScraped: ScrapedRequirement[] } {
  const matches: MatchResult[] = []
  const matchedScrapedIndices = new Set<number>()

  // Filter scraped to trackable only for matching
  const trackableScraped = filterToTrackable(scrapedReqs)

  // Build lookup maps for scraped requirements
  const scrapedByExactId = new Map<string, { req: ScrapedRequirement, index: number }>()
  const scrapedByNormalizedId = new Map<string, { req: ScrapedRequirement, index: number }[]>()

  trackableScraped.forEach((req, index) => {
    scrapedByExactId.set(req.number, { req, index })

    const variants = getIdVariants(req.number)
    variants.forEach(variant => {
      if (!scrapedByNormalizedId.has(variant)) {
        scrapedByNormalizedId.set(variant, [])
      }
      scrapedByNormalizedId.get(variant)!.push({ req, index })
    })
  })

  // PASS 1: Direct and normalized ID matching
  for (const canonical of canonicalReqs) {
    let matchType: MatchResult['matchType'] = 'none'
    let matchedScraped: ScrapedRequirement | null = null
    let matchedIndex: number = -1

    // 1a. Direct match
    const directMatch = scrapedByExactId.get(canonical.scoutbook_id)
    if (directMatch && !matchedScrapedIndices.has(directMatch.index)) {
      matchType = 'direct'
      matchedScraped = directMatch.req
      matchedIndex = directMatch.index
    }

    // 1b. Normalized match
    if (!matchedScraped) {
      const canonicalVariants = getIdVariants(canonical.scoutbook_id)

      for (const variant of canonicalVariants) {
        const candidates = scrapedByNormalizedId.get(variant) || []
        for (const candidate of candidates) {
          if (!matchedScrapedIndices.has(candidate.index)) {
            matchType = 'normalized'
            matchedScraped = candidate.req
            matchedIndex = candidate.index
            break
          }
        }
        if (matchedScraped) break
      }
    }

    if (matchedScraped && matchedIndex >= 0) {
      matchedScrapedIndices.add(matchedIndex)
      matches.push({
        canonicalId: canonical.id,
        scrapedNumber: matchedScraped.number,
        matchType,
        description: matchedScraped.description
      })
    } else {
      // Placeholder for pass 2
      matches.push({
        canonicalId: canonical.id,
        scrapedNumber: '',
        matchType: 'none',
        description: null
      })
    }
  }

  // PASS 2: Description-based matching for unmatched canonicals
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].matchType !== 'none') continue

    const canonical = canonicalReqs[i]
    const mainReq = canonical.main_req

    // Find best description match among unmatched scraped with same main_req
    let bestMatch: { scraped: ScrapedRequirement, index: number, score: number } | null = null

    for (let j = 0; j < trackableScraped.length; j++) {
      if (matchedScrapedIndices.has(j)) continue

      const scraped = trackableScraped[j]

      // Must have same parent/main requirement
      if (scraped.parentNumber !== mainReq) continue

      // Calculate similarity if we had a description to compare
      // For now, skip description matching since canonical doesn't have descriptions yet
    }

    // PASS 2b: Positional matching as fallback
    // Match unmatched canonical to unmatched scraped in order
    if (!bestMatch) {
      for (let j = 0; j < trackableScraped.length; j++) {
        if (matchedScrapedIndices.has(j)) continue

        const scraped = trackableScraped[j]

        // Same main requirement is a good signal
        if (scraped.parentNumber === mainReq) {
          bestMatch = { scraped, index: j, score: 0.5 }
          break
        }
      }
    }

    if (bestMatch && bestMatch.score >= 0.3) {
      matchedScrapedIndices.add(bestMatch.index)
      matches[i] = {
        canonicalId: canonical.id,
        scrapedNumber: bestMatch.scraped.number,
        matchType: 'position',
        description: bestMatch.scraped.description
      }
    }
  }

  // Collect ALL unmatched scraped requirements (including headers)
  const allScrapedIndices = new Set(scrapedReqs.map((_, i) => i))
  const trackableIndicesInAll = trackableScraped.map(t =>
    scrapedReqs.findIndex(s => s.number === t.number && s.description === t.description)
  )

  // Mark trackable items that were matched
  const matchedInAll = new Set<number>()
  matchedScrapedIndices.forEach(trackableIdx => {
    const allIdx = trackableIndicesInAll[trackableIdx]
    if (allIdx >= 0) matchedInAll.add(allIdx)
  })

  const unmatchedScraped = scrapedReqs.filter((_, index) => !matchedInAll.has(index))

  return { matches, unmatchedScraped }
}

// ============================================
// Main Merge Logic
// ============================================

async function mergeDescriptionsToCanonical(dryRun: boolean = false) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE env vars')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Load scraped data
  const scrapedPath = 'data/merit-badge-requirements-scraped-fixed.json'
  if (!fs.existsSync(scrapedPath)) {
    console.error(`Scraped data not found: ${scrapedPath}`)
    process.exit(1)
  }

  const scrapedData: ScrapedData = JSON.parse(fs.readFileSync(scrapedPath, 'utf-8'))
  console.log(`Loaded ${scrapedData.badges.length} scraped badge-versions`)

  // Build scraped lookup by badge name + year
  const scrapedMap = new Map<string, ScrapedBadge>()
  for (const badge of scrapedData.badges) {
    const key = `${badge.badgeName}|${badge.versionYear}`
    scrapedMap.set(key, badge)
  }

  // Load all badge versions from database
  const { data: versions, error: versionError } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .eq('has_canonical_data', true)

  if (versionError) {
    console.error('Error loading versions:', versionError)
    process.exit(1)
  }

  console.log(`Found ${versions?.length || 0} canonical badge-versions in database`)
  console.log('')

  if (dryRun) {
    console.log('='.repeat(70))
    console.log('DRY RUN - No changes will be made')
    console.log('='.repeat(70))
    console.log('')
  }

  const totalStats: MergeStats = {
    directMatches: 0,
    normalizedMatches: 0,
    positionMatches: 0,
    headersAdded: 0,
    unmatched: 0,
    descriptionsUpdated: 0
  }

  const problemBadges: { name: string, year: number, unmatchedCount: number }[] = []

  for (const version of versions || []) {
    const key = `${version.badge_name}|${version.version_year}`
    const scrapedBadge = scrapedMap.get(key)

    if (!scrapedBadge) {
      // No scraped data for this version
      continue
    }

    // Get canonical requirements for this version
    const { data: canonicalReqs } = await supabase
      .from('merit_badge_requirements')
      .select('id, scoutbook_id, display_label, description, depth, sort_order, is_header, main_req')
      .eq('badge_version_id', version.id)
      .order('sort_order')

    if (!canonicalReqs || canonicalReqs.length === 0) continue

    // Match requirements
    const { matches, unmatchedScraped } = matchRequirements(
      canonicalReqs as CanonicalRequirement[],
      scrapedBadge.requirements
    )

    // Count match types
    const stats: MergeStats = {
      directMatches: matches.filter(m => m.matchType === 'direct').length,
      normalizedMatches: matches.filter(m => m.matchType === 'normalized').length,
      positionMatches: matches.filter(m => m.matchType === 'position').length,
      headersAdded: 0,
      unmatched: matches.filter(m => m.matchType === 'none').length,
      descriptionsUpdated: 0
    }

    // Update descriptions for matched requirements
    if (!dryRun) {
      for (const match of matches) {
        if (match.matchType !== 'none' && match.description) {
          const { error } = await supabase
            .from('merit_badge_requirements')
            .update({
              description: match.description,
              display_label: match.scrapedNumber || undefined
            })
            .eq('id', match.canonicalId)

          if (!error) {
            stats.descriptionsUpdated++
          }
        }
      }
    } else {
      stats.descriptionsUpdated = matches.filter(m => m.matchType !== 'none' && m.description).length
    }

    // Identify and add headers from unmatched scraped items
    const headers = unmatchedScraped.filter(req => {
      // Include items that look like headers OR main requirements (depth 0)
      return isLikelyHeader(req) || req.depth === 0
    })

    if (!dryRun && headers.length > 0) {
      // Get max sort_order for this version
      const maxSortOrder = Math.max(...canonicalReqs.map(r => r.sort_order), 0)

      for (let i = 0; i < headers.length; i++) {
        const header = headers[i]
        const mainReq = getMainReqNumber(header.number)

        // Find appropriate sort_order (before first item with same main_req)
        let insertSortOrder = maxSortOrder + 1 + i

        // Try to find the right position based on main requirement
        if (mainReq) {
          const firstWithMainReq = canonicalReqs.find(r => r.main_req === mainReq)
          if (firstWithMainReq) {
            insertSortOrder = firstWithMainReq.sort_order - 0.5
          }
        }

        const { error } = await supabase
          .from('merit_badge_requirements')
          .insert({
            badge_version_id: version.id,
            scoutbook_id: `_header_${header.number}`, // Prefix to indicate non-trackable
            display_label: header.number,
            description: header.description,
            depth: header.depth,
            sort_order: insertSortOrder,
            is_header: true,
            main_req: mainReq
          })

        if (!error) {
          stats.headersAdded++
        }
      }
    } else if (dryRun) {
      stats.headersAdded = headers.length
    }

    // Update totals
    totalStats.directMatches += stats.directMatches
    totalStats.normalizedMatches += stats.normalizedMatches
    totalStats.positionMatches += stats.positionMatches
    totalStats.headersAdded += stats.headersAdded
    totalStats.unmatched += stats.unmatched
    totalStats.descriptionsUpdated += stats.descriptionsUpdated

    // Track problem badges
    if (stats.unmatched > 3) {
      problemBadges.push({
        name: version.badge_name,
        year: version.version_year,
        unmatchedCount: stats.unmatched
      })
    }

    // Progress indicator
    const totalMatched = stats.directMatches + stats.normalizedMatches
    const matchRate = canonicalReqs.length > 0
      ? ((totalMatched / canonicalReqs.length) * 100).toFixed(0)
      : '0'

    if (stats.unmatched > 0 || stats.headersAdded > 0) {
      console.log(`${version.badge_name} ${version.version_year}: ${matchRate}% matched, ${stats.headersAdded} headers, ${stats.unmatched} unmatched`)
    }
  }

  // Summary
  console.log('')
  console.log('='.repeat(70))
  console.log('MERGE SUMMARY')
  console.log('='.repeat(70))
  console.log('')
  console.log(`Direct matches:      ${totalStats.directMatches}`)
  console.log(`Normalized matches:  ${totalStats.normalizedMatches}`)
  console.log(`Position matches:    ${totalStats.positionMatches}`)
  console.log(`Total matched:       ${totalStats.directMatches + totalStats.normalizedMatches + totalStats.positionMatches}`)
  console.log('')
  console.log(`Headers added:       ${totalStats.headersAdded}`)
  console.log(`Unmatched:           ${totalStats.unmatched}`)
  console.log('')
  console.log(`Descriptions updated: ${totalStats.descriptionsUpdated}`)

  if (problemBadges.length > 0) {
    console.log('')
    console.log('='.repeat(70))
    console.log('BADGES WITH HIGH UNMATCHED COUNT (>3)')
    console.log('='.repeat(70))
    console.log('')
    problemBadges
      .sort((a, b) => b.unmatchedCount - a.unmatchedCount)
      .slice(0, 20)
      .forEach(b => console.log(`  ${b.name} ${b.year}: ${b.unmatchedCount} unmatched`))
  }

  if (dryRun) {
    console.log('')
    console.log('This was a DRY RUN. Run without --dry-run to apply changes.')
  }
}

// ============================================
// CLI Entry
// ============================================

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

mergeDescriptionsToCanonical(dryRun).catch(console.error)
