#!/usr/bin/env npx tsx
/**
 * Merge Scraped Resource Links into Canonical Data
 *
 * Takes the scraped resource URLs from data/requirement-resources-scraped.json
 * and merges them into data/bsa-data-canonical-normalized.json by:
 *
 * 1. Matching scraped resources to canonical requirements by badge name +
 *    version year + requirement number
 * 2. Adding a `resources` array to each matched requirement
 * 3. Stripping the "Resources:" / "Resource:" text from descriptions
 * 4. Updating the stats section with resource counts
 *
 * Usage:
 *   npx tsx scripts/merge-resource-links.ts
 *   npx tsx scripts/merge-resource-links.ts --dry-run   # Preview without writing
 *
 * The script is idempotent — re-running it will overwrite existing resources.
 */

import * as fs from 'fs'
import * as path from 'path'

// ============================================
// Types
// ============================================

interface ResourceLink {
  name: string
  url: string
  type: string
}

interface ScrapedRequirementResources {
  requirementNumber: string
  description: string
  resources: ResourceLink[]
}

interface ScrapedBadgeVersion {
  badgeName: string
  versionYear: number
  versionLabel: string
  requirements: ScrapedRequirementResources[]
  totalResources: number
  scrapedAt: string
}

interface ScrapeProgress {
  totalBadges: number
  completedBadges: number
  skippedBadges: number
  currentBadge: string | null
  badges: ScrapedBadgeVersion[]
  errors: string[]
  startedAt: string
  lastUpdatedAt: string
}

interface CanonicalRequirement {
  requirement_number: string
  scoutbook_id: string
  description: string
  is_header: boolean
  display_order: number
  resources?: ResourceLink[]
  children: CanonicalRequirement[]
  nesting_depth?: number
}

interface CanonicalVersion {
  version_year: number | null
  is_estimated?: boolean
  requirements: CanonicalRequirement[]
}

interface CanonicalBadge {
  code: string
  name: string
  category: string | null
  description: string | null
  is_eagle_required: boolean
  is_active: boolean
  image_url: string
  pamphlet_url?: string
  requirement_version_year: number
  versions: CanonicalVersion[]
}

interface CanonicalData {
  exported_at: string
  source: string
  version: string
  stats: {
    merit_badges: number
    badge_versions: number
    badge_requirements: number
    ranks: number
    rank_requirements: number
    leadership_positions: number
    requirement_resources?: number
  }
  merit_badges: CanonicalBadge[]
  ranks: unknown[]
  leadership_positions?: unknown[]
}

// ============================================
// Resource text parsing
// ============================================

/**
 * Strip "Resources:" / "Resource:" text from a description.
 * Returns { cleanDescription, extractedResourceNames }
 */
function stripResourceText(description: string): {
  cleanDescription: string
  extractedResourceNames: string[]
} {
  // Match "Resource:" or "Resources:" and everything after it
  const resourcePattern = /\s*Resources?:\s*/
  const match = description.match(resourcePattern)

  if (!match || match.index === undefined) {
    return { cleanDescription: description, extractedResourceNames: [] }
  }

  const cleanDescription = description.substring(0, match.index).trim()
  const resourceText = description.substring(match.index + match[0].length)

  // Parse individual resource names from the text
  // They follow pattern: "Name (type)" or "Name (type)  Name2 (type2)"
  const namePattern = /([^()]+?)\s*\((video|website|PDF|pdf)\)/g
  const names: string[] = []
  let nameMatch
  while ((nameMatch = namePattern.exec(resourceText)) !== null) {
    const name = nameMatch[1].trim()
    if (name) names.push(name)
  }

  return { cleanDescription, extractedResourceNames: names }
}

// ============================================
// Matching logic
// ============================================

/**
 * Build a lookup key for matching scraped resources to canonical requirements.
 * Normalizes requirement numbers for matching (e.g., "4a" matches "4a").
 */
function normalizeReqNumber(num: string): string {
  return num.toLowerCase().replace(/[()[\]\s]/g, '')
}

/**
 * Find the best matching version year from scraped data for a canonical version.
 * The canonical data may use null version years for some badges.
 */
function findMatchingScrapedVersion(
  scrapedVersions: ScrapedBadgeVersion[],
  canonicalYear: number | null,
  badgeName: string,
): ScrapedBadgeVersion | null {
  // Direct year match
  if (canonicalYear !== null) {
    const exact = scrapedVersions.find(
      sv => sv.badgeName === badgeName && sv.versionYear === canonicalYear
    )
    if (exact) return exact
  }

  // If only one scraped version for this badge, use it
  const badgeVersions = scrapedVersions.filter(sv => sv.badgeName === badgeName)
  if (badgeVersions.length === 1) return badgeVersions[0]

  // Use the most recent (active) version
  if (badgeVersions.length > 0) {
    const active = badgeVersions.find(sv => sv.versionLabel.includes('Active'))
    if (active) return active
    // Fallback to highest year
    return badgeVersions.sort((a, b) => b.versionYear - a.versionYear)[0]
  }

  return null
}

/**
 * Normalize a resource name for fuzzy matching.
 * Strips (video)/(website)/(pdf) suffixes, extra whitespace, and lowercases.
 */
function normalizeResourceName(name: string): string {
  return name
    .replace(/\s*\((video|website|pdf|PDF)\)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Extract the parent requirement number from a sub-requirement.
 * e.g., "1a" -> "1", "4b" -> "4", "3a(1)" -> "3"
 */
function getParentReqNumber(reqNum: string): string | null {
  const match = reqNum.match(/^(\d+)/)
  return match ? match[1] : null
}

/**
 * Match scraped resources to a canonical requirement by requirement number.
 *
 * Strategy:
 * 1. Direct match by requirement number (e.g., scraped "1a" matches canonical "1a")
 * 2. If no direct match, look at the parent panel (e.g., scraped "1" for canonical "1a")
 *    and match individual resources by name against the extracted resource names
 */
function findResourcesForRequirement(
  scrapedReqs: ScrapedRequirementResources[],
  canonicalReqNum: string,
  extractedResourceNames: string[],
): ResourceLink[] | null {
  const normalized = normalizeReqNumber(canonicalReqNum)

  // Strategy 1: Direct match by requirement number
  const direct = scrapedReqs.find(
    sr => normalizeReqNumber(sr.requirementNumber) === normalized
  )
  if (direct && direct.resources.length > 0) {
    return direct.resources
  }

  // Strategy 2: Match against parent panel's resources by resource name
  if (extractedResourceNames.length > 0) {
    const normalizedNames = extractedResourceNames.map(normalizeResourceName)

    const matchByName = (resources: ResourceLink[]): ResourceLink[] => {
      return resources.filter(r => {
        const rName = normalizeResourceName(r.name)
        return normalizedNames.some(n =>
          rName.includes(n) || n.includes(rName) ||
          // Handle partial matches (first 20 chars)
          (n.length > 15 && rName.substring(0, 20) === n.substring(0, 20))
        )
      })
    }

    // 2a: Check the parent panel first (most common case)
    const parentNum = getParentReqNumber(canonicalReqNum)
    if (parentNum && parentNum !== canonicalReqNum) {
      const parentScraped = scrapedReqs.find(
        sr => normalizeReqNumber(sr.requirementNumber) === parentNum
      )
      if (parentScraped && parentScraped.resources.length > 0) {
        const matched = matchByName(parentScraped.resources)
        if (matched.length > 0) return matched
      }
    }

    // 2b: Search ALL panels for this badge (resources may be under a different panel)
    const allResources = scrapedReqs.flatMap(sr => sr.resources)
    if (allResources.length > 0) {
      const matched = matchByName(allResources)
      if (matched.length > 0) return matched
    }
  }

  return null
}

// ============================================
// Main merge logic
// ============================================

function mergeResources(
  canonical: CanonicalData,
  scraped: ScrapeProgress,
  dryRun: boolean,
): {
  totalMatched: number
  totalResources: number
  descriptionsClean: number
  unmatched: string[]
} {
  let totalMatched = 0
  let totalResources = 0
  let descriptionsClean = 0
  const unmatched: string[] = []

  for (const badge of canonical.merit_badges) {
    for (const version of badge.versions) {
      const scrapedVersion = findMatchingScrapedVersion(
        scraped.badges,
        version.version_year,
        badge.name,
      )

      // Process each requirement (and its children recursively)
      const processRequirement = (req: CanonicalRequirement): void => {
        // Strip Resource(s): text from description regardless of whether we have URLs
        const { cleanDescription, extractedResourceNames } = stripResourceText(req.description)
        const hasResourceText = cleanDescription !== req.description

        if (hasResourceText && !dryRun) {
          req.description = cleanDescription
          descriptionsClean++
        } else if (hasResourceText) {
          descriptionsClean++
        }

        // Try to match scraped resources
        if (scrapedVersion) {
          const resources = findResourcesForRequirement(
            scrapedVersion.requirements,
            req.requirement_number,
            extractedResourceNames,
          )

          if (resources && resources.length > 0) {
            if (!dryRun) {
              req.resources = resources
            }
            totalMatched++
            totalResources += resources.length
          } else if (hasResourceText && extractedResourceNames.length > 0) {
            // Has resource text but no scraped URLs — log as unmatched
            unmatched.push(
              `${badge.name} v${version.version_year} req ${req.requirement_number}: ` +
              `${extractedResourceNames.length} resource(s) without URLs`
            )
          }
        } else if (hasResourceText && extractedResourceNames.length > 0) {
          unmatched.push(
            `${badge.name} v${version.version_year} req ${req.requirement_number}: ` +
            `no scraped version found`
          )
        }

        // Process children
        for (const child of req.children || []) {
          processRequirement(child)
        }
      }

      for (const req of version.requirements) {
        processRequirement(req)
      }
    }
  }

  return { totalMatched, totalResources, descriptionsClean, unmatched }
}

// ============================================
// Main
// ============================================

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const canonicalPath = path.join(process.cwd(), 'data/bsa-data-canonical-normalized.json')
  const scrapedPath = path.join(process.cwd(), 'data/requirement-resources-scraped.json')

  console.log('='.repeat(60))
  console.log('Merge Resource Links into Canonical Data')
  console.log('='.repeat(60))
  if (dryRun) console.log('  [DRY RUN - no files will be modified]')
  console.log('')

  // Load files
  if (!fs.existsSync(scrapedPath)) {
    console.error(`Scraped data not found: ${scrapedPath}`)
    console.error('Run the scraper first: npx tsx scripts/scrape-requirement-resources.ts')
    process.exit(1)
  }

  console.log('Loading canonical data...')
  const canonical: CanonicalData = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'))
  console.log(`  ${canonical.stats.merit_badges} badges, ${canonical.stats.badge_requirements} requirements`)

  console.log('Loading scraped data...')
  const scraped: ScrapeProgress = JSON.parse(fs.readFileSync(scrapedPath, 'utf-8'))
  console.log(`  ${scraped.badges.length} badge versions with resources`)
  const totalScrapedResources = scraped.badges.reduce((sum, b) => sum + b.totalResources, 0)
  console.log(`  ${totalScrapedResources} total resource links scraped`)

  console.log('')
  console.log('Merging...')

  const result = mergeResources(canonical, scraped, dryRun)

  console.log('')
  console.log('Results:')
  console.log(`  Requirements matched with URLs: ${result.totalMatched}`)
  console.log(`  Total resource links added: ${result.totalResources}`)
  console.log(`  Descriptions cleaned (Resources: text stripped): ${result.descriptionsClean}`)
  console.log(`  Unmatched (have text but no URLs): ${result.unmatched.length}`)

  if (result.unmatched.length > 0) {
    console.log('')
    console.log('Unmatched requirements (first 20):')
    result.unmatched.slice(0, 20).forEach(u => console.log(`  - ${u}`))
    if (result.unmatched.length > 20) {
      console.log(`  ... and ${result.unmatched.length - 20} more`)
    }
  }

  // Update stats
  if (!dryRun) {
    canonical.stats.requirement_resources = result.totalResources
    canonical.exported_at = new Date().toISOString()

    console.log('')
    console.log(`Writing updated canonical data to: ${canonicalPath}`)
    fs.writeFileSync(canonicalPath, JSON.stringify(canonical, null, 2))
    console.log('Done!')
  } else {
    console.log('')
    console.log('[DRY RUN] No files written. Remove --dry-run to apply changes.')
  }
}

main().catch(console.error)
