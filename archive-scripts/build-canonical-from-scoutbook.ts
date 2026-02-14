#!/usr/bin/env npx tsx
/**
 * Build Canonical BSA Data from Scoutbook
 *
 * Strategy:
 * 1. Start with BSA scraping data for badge/version LIST (authoritative for what exists)
 * 2. Apply Scoutbook requirement IDs to each version (authoritative for completable requirements)
 * 3. Hydrate descriptions and hierarchy from BSA scraping where available
 * 4. Report gaps where Scoutbook has requirements but BSA doesn't have descriptions
 *
 * Output:
 * - data/bsa-data-canonical.json - The canonical source of truth
 * - data/canonical-gaps.json - Report of missing descriptions to be manually filled
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const PAGE_SIZE = 1000

interface CanonicalRequirement {
  requirement_number: string
  scoutbook_id: string
  description: string | null
  is_header: boolean
  display_order: number
  children: CanonicalRequirement[]
}

interface CanonicalVersion {
  version_year: number
  is_estimated: boolean // True if IDs are estimated from BSA data (no Scoutbook verification)
  requirements: CanonicalRequirement[]
}

interface CanonicalBadge {
  code: string
  name: string
  category: string | null
  description: string | null
  is_eagle_required: boolean
  is_active: boolean
  image_url: string | null
  requirement_version_year: number
  versions: CanonicalVersion[]
}

interface Gap {
  badge_name: string
  version_year: number
  scoutbook_id: string
  description: string | null
  note: string
}

/**
 * Convert BSA-format requirement IDs to Scoutbook format
 * BSA uses: 4Aa(1), 4Ab(2), etc.
 * Scoutbook uses: 4a[1], 4b[2], etc.
 *
 * Patterns:
 * - "4Aa(1)" -> "4a[1]" (major letter + sub-letter + index)
 * - "4Ab(2)" -> "4b[2]"
 * - "4a" -> "4a" (no change for simple letters)
 * - "1", "2" -> "1", "2" (no change for numbers)
 */
function convertBsaIdToScoutbookFormat(bsaId: string): string {
  // Pattern: {number}{UpperLetter}{lowerLetter}({index})
  // Example: 4Aa(1) -> 4a[1]
  const complexMatch = bsaId.match(/^(\d+)([A-Z])([a-z])\((\d+)\)$/)
  if (complexMatch) {
    const [, num, , subLetter, index] = complexMatch
    return `${num}${subLetter}[${index}]`
  }

  // Pattern: {number}({index}) without letters
  // Example: 9(1) -> 9[1]
  const simpleParenMatch = bsaId.match(/^(\d+)\((\d+)\)$/)
  if (simpleParenMatch) {
    const [, num, index] = simpleParenMatch
    return `${num}[${index}]`
  }

  // Pattern: {number}{letter}({index})
  // Example: 4a(1) -> 4a[1]
  const letterParenMatch = bsaId.match(/^(\d+)([a-z])\((\d+)\)$/)
  if (letterParenMatch) {
    const [, num, letter, index] = letterParenMatch
    return `${num}${letter}[${index}]`
  }

  // No conversion needed
  return bsaId
}

async function build() {
  console.log('='.repeat(60))
  console.log('BUILD CANONICAL BSA DATA FROM SCOUTBOOK')
  console.log('='.repeat(60))
  console.log('')

  const gaps: Gap[] = []

  // Step 1: Load BSA scraping data (source of badge list and descriptions)
  console.log('Step 1: Loading BSA scraping data...')
  const bsaPath = path.join(process.cwd(), 'data/bsa-data-unified.json')
  const bsaData = JSON.parse(fs.readFileSync(bsaPath, 'utf-8'))
  console.log(`  Loaded ${bsaData.merit_badges.length} badges from BSA scraping`)

  // Build lookup for BSA descriptions: badge_name:version_year:req_number -> description
  const bsaDescriptions = new Map<string, { description: string; is_header: boolean }>()
  const bsaHierarchy = new Map<string, any[]>() // badge:version -> requirements array

  for (const badge of bsaData.merit_badges) {
    for (const version of badge.versions) {
      const versionKey = `${badge.name.toLowerCase()}:${version.version_year}`
      bsaHierarchy.set(versionKey, version.requirements)

      function indexRequirements(reqs: any[], parentKey: string = '') {
        for (const req of reqs) {
          const key = `${badge.name.toLowerCase()}:${version.version_year}:${req.requirement_number}`
          bsaDescriptions.set(key, {
            description: req.description || null,
            is_header: req.is_header || (req.children && req.children.length > 0) || false,
          })

          // Also index by normalized key (without trailing period)
          const normalizedKey = `${badge.name.toLowerCase()}:${version.version_year}:${req.requirement_number.replace(/\.$/, '')}`
          if (normalizedKey !== key) {
            bsaDescriptions.set(normalizedKey, {
              description: req.description || null,
              is_header: req.is_header || (req.children && req.children.length > 0) || false,
            })
          }

          if (req.children && req.children.length > 0) {
            indexRequirements(req.children)
          }
        }
      }
      indexRequirements(version.requirements)
    }
  }
  console.log(`  Indexed ${bsaDescriptions.size} requirement descriptions`)

  // Step 2: Load Scoutbook versions and requirements
  console.log('\nStep 2: Loading Scoutbook data...')

  const { data: scoutbookVersions } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .order('badge_name')
    .order('version_year')

  console.log(`  Loaded ${scoutbookVersions?.length || 0} versions from Scoutbook`)

  // Load all requirements
  const allScoutbookReqs: Array<{
    id: string
    badge_version_id: string
    scoutbook_id: string
    description: string | null
    sort_order: number
  }> = []

  let offset = 0
  while (true) {
    const { data: batch } = await supabase
      .from('merit_badge_requirements')
      .select('id, badge_version_id, scoutbook_id, description, sort_order')
      .range(offset, offset + PAGE_SIZE - 1)

    if (!batch || batch.length === 0) break
    allScoutbookReqs.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  console.log(`  Loaded ${allScoutbookReqs.length} requirements from Scoutbook`)

  // Group by version_id
  const scoutbookReqsByVersion = new Map<string, typeof allScoutbookReqs>()
  for (const req of allScoutbookReqs) {
    if (!scoutbookReqsByVersion.has(req.badge_version_id)) {
      scoutbookReqsByVersion.set(req.badge_version_id, [])
    }
    scoutbookReqsByVersion.get(req.badge_version_id)!.push(req)
  }

  // Create version lookup
  const scoutbookVersionLookup = new Map<string, string>()
  for (const v of scoutbookVersions || []) {
    scoutbookVersionLookup.set(`${v.badge_name.toLowerCase()}:${v.version_year}`, v.id)
  }

  // Step 3: Build canonical structure
  console.log('\nStep 3: Building canonical structure...')

  const canonicalBadges: CanonicalBadge[] = []
  let totalRequirements = 0
  let descriptionsFound = 0
  let descriptionsMissing = 0

  // Badge name mapping for matching
  const BADGE_NAME_MAP: Record<string, string> = {
    'fish & wildlife management': 'fish and wildlife management',
    'artificial intelligence': 'artificial intelligence (ai)',
  }

  // Get all Scoutbook versions grouped by badge name
  const scoutbookVersionsByBadge = new Map<string, Array<{ id: string; version_year: number }>>()
  for (const v of scoutbookVersions || []) {
    const key = v.badge_name.toLowerCase()
    if (!scoutbookVersionsByBadge.has(key)) {
      scoutbookVersionsByBadge.set(key, [])
    }
    scoutbookVersionsByBadge.get(key)!.push({ id: v.id, version_year: v.version_year })
  }

  for (const bsaBadge of bsaData.merit_badges) {
    const canonicalVersions: CanonicalVersion[] = []
    const normalizedBadgeName = BADGE_NAME_MAP[bsaBadge.name.toLowerCase()] || bsaBadge.name.toLowerCase()

    // Collect all version years from both BSA and Scoutbook
    const bsaVersionYears = new Set<number>(bsaBadge.versions.map((v: any) => v.version_year as number))
    const scoutbookVersionsForBadge = scoutbookVersionsByBadge.get(normalizedBadgeName) ||
                                      scoutbookVersionsByBadge.get(bsaBadge.name.toLowerCase()) || []
    const scoutbookVersionYears = new Set<number>(scoutbookVersionsForBadge.map(v => v.version_year))

    // Union of all version years
    const allVersionYears = Array.from(new Set<number>([...bsaVersionYears, ...scoutbookVersionYears])).sort((a, b) => a - b)

    for (const versionYear of allVersionYears) {
      const bsaVersion = bsaBadge.versions.find((v: any) => v.version_year === versionYear)

      // Find corresponding Scoutbook version
      let versionId = scoutbookVersionLookup.get(`${normalizedBadgeName}:${versionYear}`)
      if (!versionId) {
        versionId = scoutbookVersionLookup.get(`${bsaBadge.name.toLowerCase()}:${versionYear}`)
      }

      const scoutbookReqs = versionId ? scoutbookReqsByVersion.get(versionId) || [] : []

      if (scoutbookReqs.length === 0) {
        // No Scoutbook data for this version - use BSA data as-is if available
        if (bsaVersion) {
          gaps.push({
            badge_name: bsaBadge.name,
            version_year: versionYear,
            scoutbook_id: '*',
            description: null,
            note: 'No Scoutbook data for this version - using BSA data only',
          })

          // Convert BSA requirements to canonical format with Scoutbook-style IDs
          function convertBsaReqs(reqs: any[]): CanonicalRequirement[] {
            return reqs.map((req, idx) => {
              const scoutbookStyleId = convertBsaIdToScoutbookFormat(req.requirement_number)
              return {
                requirement_number: req.requirement_number,
                scoutbook_id: scoutbookStyleId, // Convert to Scoutbook format for matching
                description: req.description || null,
                is_header: req.is_header || (req.children && req.children.length > 0) || false,
                display_order: req.display_order || idx + 1,
                children: req.children ? convertBsaReqs(req.children) : [],
              }
            })
          }

          canonicalVersions.push({
            version_year: versionYear,
            is_estimated: true, // BSA-only version with estimated Scoutbook-style IDs
            requirements: convertBsaReqs(bsaVersion.requirements),
          })
        } else {
          // No BSA data and no Scoutbook data - skip this version
          console.warn(`  WARNING: Version ${versionYear} for ${bsaBadge.name} has no data from either source`)
        }
        continue
      }

      // Sort Scoutbook requirements by sort_order
      scoutbookReqs.sort((a, b) => a.sort_order - b.sort_order)

      // Build canonical requirements from Scoutbook IDs
      const canonicalReqs: CanonicalRequirement[] = []

      for (let i = 0; i < scoutbookReqs.length; i++) {
        const sbReq = scoutbookReqs[i]
        totalRequirements++

        // Try to find description from BSA data
        let description: string | null = null
        let isHeader = false

        // Try exact match (using versionYear since bsaVersion might be undefined)
        const exactKey = `${normalizedBadgeName}:${versionYear}:${sbReq.scoutbook_id}`
        let bsaMatch = bsaDescriptions.get(exactKey)

        // Try without trailing period
        if (!bsaMatch) {
          const normalizedKey = `${normalizedBadgeName}:${versionYear}:${sbReq.scoutbook_id.replace(/\.$/, '')}`
          bsaMatch = bsaDescriptions.get(normalizedKey)
        }

        // Try converting Scoutbook format to BSA format
        // Scoutbook: 9b[1] -> BSA: 9(1) or 9b(1)
        if (!bsaMatch) {
          const bracketMatch = sbReq.scoutbook_id.match(/^(\d+)([a-z]?)\[(\d+)\]$/)
          if (bracketMatch) {
            const [, num, , index] = bracketMatch
            // Try parenthesis format
            const parenKey = `${normalizedBadgeName}:${versionYear}:${num}(${index})`
            bsaMatch = bsaDescriptions.get(parenKey)
          }
        }

        // Try the badge's original name too
        if (!bsaMatch && normalizedBadgeName !== bsaBadge.name.toLowerCase()) {
          const altKey = `${bsaBadge.name.toLowerCase()}:${versionYear}:${sbReq.scoutbook_id}`
          bsaMatch = bsaDescriptions.get(altKey)
        }

        // For Scoutbook-only versions, also try to find descriptions from nearby versions
        if (!bsaMatch && !bsaVersion) {
          // Try to find description from closest BSA version
          for (const bv of bsaBadge.versions) {
            const altKey = `${normalizedBadgeName}:${bv.version_year}:${sbReq.scoutbook_id}`
            bsaMatch = bsaDescriptions.get(altKey)
            if (bsaMatch) break
            // Also try normalized key
            const normAltKey = `${normalizedBadgeName}:${bv.version_year}:${sbReq.scoutbook_id.replace(/\.$/, '')}`
            bsaMatch = bsaDescriptions.get(normAltKey)
            if (bsaMatch) break
          }
        }

        if (bsaMatch) {
          description = bsaMatch.description
          isHeader = bsaMatch.is_header
          descriptionsFound++
        } else {
          // Use Scoutbook description if available, otherwise mark as gap
          if (sbReq.description) {
            description = sbReq.description
            descriptionsFound++
          } else {
            descriptionsMissing++
            gaps.push({
              badge_name: bsaBadge.name,
              version_year: versionYear,
              scoutbook_id: sbReq.scoutbook_id,
              description: null,
              note: 'No description found in BSA scraping or Scoutbook data',
            })
          }
        }

        canonicalReqs.push({
          requirement_number: sbReq.scoutbook_id,
          scoutbook_id: sbReq.scoutbook_id,
          description,
          is_header: isHeader,
          display_order: i + 1,
          children: [], // Flat structure - hierarchy will be added in Step 4
        })
      }

      canonicalVersions.push({
        version_year: versionYear,
        is_estimated: false, // Scoutbook-verified IDs
        requirements: canonicalReqs,
      })
    }

    // Determine the active version year
    const latestVersion = Math.max(...canonicalVersions.map(v => v.version_year))

    canonicalBadges.push({
      code: bsaBadge.code,
      name: bsaBadge.name,
      category: bsaBadge.category,
      description: bsaBadge.description,
      is_eagle_required: bsaBadge.is_eagle_required || false,
      is_active: bsaBadge.is_active ?? true,
      image_url: bsaBadge.image_url,
      requirement_version_year: latestVersion,
      versions: canonicalVersions,
    })
  }

  console.log(`  Built ${canonicalBadges.length} badges`)
  console.log(`  Total requirements: ${totalRequirements}`)
  console.log(`  Descriptions found: ${descriptionsFound}`)
  console.log(`  Descriptions missing: ${descriptionsMissing}`)

  // Step 4: Add hierarchy from BSA data where possible
  console.log('\nStep 4: Adding hierarchy from BSA data...')

  let hierarchyAdded = 0

  for (const badge of canonicalBadges) {
    const normalizedName = BADGE_NAME_MAP[badge.name.toLowerCase()] || badge.name.toLowerCase()

    for (const version of badge.versions) {
      const bsaReqs = bsaHierarchy.get(`${normalizedName}:${version.version_year}`) ||
                      bsaHierarchy.get(`${badge.name.toLowerCase()}:${version.version_year}`)

      if (!bsaReqs) continue

      // Build a map of BSA requirements by their normalized IDs
      const bsaReqMap = new Map<string, any>()
      function indexBsa(reqs: any[]) {
        for (const req of reqs) {
          bsaReqMap.set(req.requirement_number, req)
          bsaReqMap.set(req.requirement_number.replace(/\.$/, ''), req)
          if (req.children) indexBsa(req.children)
        }
      }
      indexBsa(bsaReqs)

      // Find headers in BSA data and add them to canonical
      const headersToAdd: CanonicalRequirement[] = []

      function findHeaders(reqs: any[]) {
        for (const req of reqs) {
          if (req.is_header || (req.children && req.children.length > 0)) {
            // Check if this header exists in canonical
            const existsInCanonical = version.requirements.some(
              cr => cr.scoutbook_id === req.requirement_number ||
                    cr.scoutbook_id === req.requirement_number.replace(/\.$/, '')
            )

            if (!existsInCanonical) {
              headersToAdd.push({
                requirement_number: req.requirement_number,
                scoutbook_id: req.requirement_number, // Headers use their own number
                description: req.description || null,
                is_header: true,
                display_order: req.display_order || 0,
                children: [],
              })
              hierarchyAdded++
            }
          }
          if (req.children) findHeaders(req.children)
        }
      }
      findHeaders(bsaReqs)

      // Add headers and re-sort
      if (headersToAdd.length > 0) {
        version.requirements.push(...headersToAdd)
        version.requirements.sort((a, b) => {
          // Sort by display_order, then by requirement number
          if (a.display_order !== b.display_order) {
            return a.display_order - b.display_order
          }
          return a.requirement_number.localeCompare(b.requirement_number, undefined, { numeric: true })
        })
      }
    }
  }

  console.log(`  Added ${hierarchyAdded} header requirements from BSA data`)

  // Step 4b: Build parent-child hierarchy by nesting children into parents
  console.log('\nStep 4b: Building parent-child hierarchy...')

  let childrenNested = 0

  /**
   * Determine if childId is a direct child of parentId based on requirement number patterns.
   *
   * Rules:
   * - "1a" is child of "1" (letter suffix)
   * - "1a[1]" is child of "1a" (bracket suffix)
   * - "1a[1][a]" is child of "1a[1]" (nested bracket)
   * - "4 Option A" is child of "4" (option suffix)
   */
  function isDirectChild(parentId: string, childId: string): boolean {
    // Child must start with parent ID
    if (!childId.startsWith(parentId)) {
      return false
    }

    // Get the suffix (part after parent ID)
    const suffix = childId.slice(parentId.length)

    // Empty suffix means same ID, not a child
    if (suffix === '') {
      return false
    }

    // Direct child patterns:
    // 1. Single lowercase letter: "a", "b", etc.
    if (/^[a-z]$/.test(suffix)) {
      return true
    }

    // 2. Bracket with number or letter: "[1]", "[a]", etc.
    if (/^\[\d+\]$/.test(suffix) || /^\[[a-z]\]$/.test(suffix)) {
      return true
    }

    // 3. Option suffix: " Option A", " Option B", etc.
    if (/^ Option [A-Z]$/.test(suffix)) {
      return true
    }

    // Not a direct child (might be grandchild or unrelated)
    return false
  }

  for (const badge of canonicalBadges) {
    for (const version of badge.versions) {
      // Build a map of all requirements by their scoutbook_id
      const reqMap = new Map<string, CanonicalRequirement>()
      for (const req of version.requirements) {
        reqMap.set(req.scoutbook_id, req)
      }

      // Find parent-child relationships
      const childrenToRemove = new Set<string>()

      for (const req of version.requirements) {
        // Look for potential parents (requirements whose ID is a prefix of this one)
        for (const potentialParent of version.requirements) {
          if (potentialParent.scoutbook_id === req.scoutbook_id) {
            continue // Skip self
          }

          if (isDirectChild(potentialParent.scoutbook_id, req.scoutbook_id)) {
            // Found parent - add this requirement to parent's children
            potentialParent.children.push(req)
            childrenToRemove.add(req.scoutbook_id)
            childrenNested++
            break // Each requirement has at most one parent
          }
        }
      }

      // Remove nested children from top-level array
      version.requirements = version.requirements.filter(
        req => !childrenToRemove.has(req.scoutbook_id)
      )

      // Sort children within each parent by display_order
      function sortChildren(reqs: CanonicalRequirement[]) {
        for (const req of reqs) {
          if (req.children.length > 0) {
            req.children.sort((a, b) => {
              if (a.display_order !== b.display_order) {
                return a.display_order - b.display_order
              }
              return a.scoutbook_id.localeCompare(b.scoutbook_id, undefined, { numeric: true })
            })
            sortChildren(req.children)
          }
        }
      }
      sortChildren(version.requirements)
    }
  }

  console.log(`  Nested ${childrenNested} child requirements into parents`)

  // Step 5: Add ranks
  console.log('\nStep 5: Adding ranks...')
  const ranks = bsaData.ranks || []
  console.log(`  Found ${ranks.length} ranks`)

  // Step 6: Add leadership positions
  console.log('\nStep 6: Adding leadership positions...')
  const leadership = bsaData.leadership_positions || []
  console.log(`  Found ${leadership.length} leadership positions`)

  // Step 7: Write output files
  console.log('\nStep 7: Writing output files...')

  // Count all requirements recursively (including nested children)
  function countRequirements(reqs: CanonicalRequirement[]): number {
    let count = 0
    for (const req of reqs) {
      count++
      if (req.children.length > 0) {
        count += countRequirements(req.children)
      }
    }
    return count
  }

  const totalReqCount = canonicalBadges.reduce(
    (sum, b) => sum + b.versions.reduce((vsum, v) => vsum + countRequirements(v.requirements), 0),
    0
  )

  const output = {
    exported_at: new Date().toISOString(),
    source: 'scoutbook-canonical',
    version: '3.0.0',
    stats: {
      merit_badges: canonicalBadges.length,
      badge_versions: canonicalBadges.reduce((sum, b) => sum + b.versions.length, 0),
      badge_requirements: totalReqCount,
      ranks: ranks.length,
      rank_requirements: ranks.reduce((sum: number, r: any) => sum + (r.requirements?.length || 0), 0),
      leadership_positions: leadership.length,
    },
    merit_badges: canonicalBadges,
    ranks,
    leadership_positions: leadership,
  }

  const outputPath = path.join(process.cwd(), 'data/bsa-data-canonical.json')
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(`  Wrote: ${outputPath}`)
  console.log(`  Size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`)

  // Write gaps report
  const gapsPath = path.join(process.cwd(), 'data/canonical-gaps.json')
  fs.writeFileSync(gapsPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_gaps: gaps.length,
    gaps: gaps,
  }, null, 2))
  console.log(`  Wrote: ${gapsPath}`)
  console.log(`  Total gaps: ${gaps.length}`)

  // Summary
  console.log('')
  console.log('='.repeat(60))
  console.log('BUILD COMPLETE')
  console.log('='.repeat(60))
  console.log('')
  console.log('Stats:')
  console.log(`  Merit Badges: ${output.stats.merit_badges}`)
  console.log(`  Badge Versions: ${output.stats.badge_versions}`)
  console.log(`  Badge Requirements: ${output.stats.badge_requirements}`)
  console.log(`  Ranks: ${output.stats.ranks}`)
  console.log(`  Rank Requirements: ${output.stats.rank_requirements}`)
  console.log(`  Leadership Positions: ${output.stats.leadership_positions}`)
  console.log('')
  console.log(`  Descriptions found: ${descriptionsFound}`)
  console.log(`  Descriptions missing: ${descriptionsMissing}`)
  console.log(`  Headers added from BSA: ${hierarchyAdded}`)
  console.log(`  Children nested into parents: ${childrenNested}`)
  console.log('')

  if (gaps.length > 0) {
    console.log('Sample gaps (first 10):')
    gaps.slice(0, 10).forEach(g => {
      console.log(`  - ${g.badge_name} v${g.version_year}: ${g.scoutbook_id} - ${g.note}`)
    })
    if (gaps.length > 10) {
      console.log(`  ... and ${gaps.length - 10} more (see data/canonical-gaps.json)`)
    }
  }
}

build().catch(console.error)
