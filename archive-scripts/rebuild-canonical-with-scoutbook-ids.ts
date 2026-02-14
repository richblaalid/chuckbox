#!/usr/bin/env npx tsx
/**
 * Rebuild Canonical Data with Scoutbook IDs
 *
 * Creates a new unified canonical export using Scoutbook's exact requirement IDs
 * as the primary structure. This ensures imports from Scoutbook match 100%.
 *
 * Source:
 * - merit_badge_versions (badge versions with Scoutbook structure)
 * - merit_badge_requirements (requirements with scoutbook_id field)
 * - bsa_merit_badges (badge metadata - UUIDs, categories, etc.)
 * - bsa_ranks / bsa_rank_requirements (rank data - unchanged)
 * - bsa_leadership_positions (leadership data - unchanged)
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const PAGE_SIZE = 1000

interface CanonicalRequirement {
  requirement_number: string
  scoutbook_requirement_number: string
  description: string | null
  is_header: boolean
  display_order: number
  children?: CanonicalRequirement[]
}

interface CanonicalVersion {
  version_year: number
  requirements: CanonicalRequirement[]
}

interface CanonicalBadge {
  id: string
  code: string
  name: string
  is_eagle_required: boolean
  category: string | null
  description: string | null
  image_url: string | null
  is_active: boolean
  requirement_version_year: number
  versions: CanonicalVersion[]
}

async function rebuild() {
  console.log('='.repeat(60))
  console.log('REBUILD CANONICAL DATA WITH SCOUTBOOK IDs')
  console.log('='.repeat(60))
  console.log('')

  // Step 1: Load bsa_merit_badges (metadata source)
  const { data: bsaBadges, error: badgeError } = await supabase
    .from('bsa_merit_badges')
    .select('*')
    .order('name')

  if (badgeError || !bsaBadges) {
    console.error('Failed to load bsa_merit_badges:', badgeError)
    return
  }

  console.log(`Loaded ${bsaBadges.length} badges from bsa_merit_badges`)

  // Create lookup by name (normalized) with aliases for name variations
  const badgeByName = new Map<string, typeof bsaBadges[0]>()
  const NAME_ALIASES: Record<string, string> = {
    'artificial intelligence (ai)': 'artificial intelligence',
    'fish and wildlife management': 'fish & wildlife management',
  }

  for (const badge of bsaBadges) {
    badgeByName.set(badge.name.toLowerCase(), badge)
  }

  // Function to look up badge with alias support
  const findBadge = (name: string) => {
    const normalized = name.toLowerCase()
    let badge = badgeByName.get(normalized)
    if (!badge && NAME_ALIASES[normalized]) {
      badge = badgeByName.get(NAME_ALIASES[normalized])
    }
    return badge
  }

  // Step 2: Load merit_badge_versions (Scoutbook versions)
  const { data: versions, error: versionError } = await supabase
    .from('merit_badge_versions')
    .select('*')
    .order('badge_name')
    .order('version_year')

  if (versionError || !versions) {
    console.error('Failed to load merit_badge_versions:', versionError)
    return
  }

  console.log(`Loaded ${versions.length} versions from merit_badge_versions`)

  // Step 3: Load ALL merit_badge_requirements (paginated)
  const allRequirements: Array<{
    id: string
    badge_version_id: string
    scoutbook_id: string
    display_label: string | null
    description: string | null
    parent_id: string | null
    depth: number
    sort_order: number
    is_header: boolean
  }> = []

  let offset = 0
  while (true) {
    const { data: batch, error } = await supabase
      .from('merit_badge_requirements')
      .select('id, badge_version_id, scoutbook_id, display_label, description, parent_id, depth, sort_order, is_header')
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('Failed to load requirements:', error)
      return
    }

    if (!batch || batch.length === 0) break
    allRequirements.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  console.log(`Loaded ${allRequirements.length} requirements from merit_badge_requirements`)

  // Group requirements by version_id
  const reqsByVersionId = new Map<string, typeof allRequirements>()
  for (const req of allRequirements) {
    if (!reqsByVersionId.has(req.badge_version_id)) {
      reqsByVersionId.set(req.badge_version_id, [])
    }
    reqsByVersionId.get(req.badge_version_id)!.push(req)
  }

  // Step 4: Build canonical structure
  const canonicalBadges: CanonicalBadge[] = []

  // Group versions by badge name
  const versionsByBadge = new Map<string, typeof versions>()
  for (const version of versions) {
    if (!versionsByBadge.has(version.badge_name)) {
      versionsByBadge.set(version.badge_name, [])
    }
    versionsByBadge.get(version.badge_name)!.push(version)
  }

  let totalVersions = 0
  let totalRequirements = 0

  for (const [badgeName, badgeVersions] of versionsByBadge) {
    const bsaBadge = findBadge(badgeName)

    if (!bsaBadge) {
      console.warn(`  WARNING: No bsa_merit_badge found for "${badgeName}"`)
      continue
    }

    // Find the latest version year for this badge
    const latestVersionYear = Math.max(...badgeVersions.map(v => v.version_year))

    const canonicalVersions: CanonicalVersion[] = []

    for (const version of badgeVersions) {
      const versionReqs = reqsByVersionId.get(version.id) || []
      totalVersions++

      // Build hierarchical structure
      // First, sort by sort_order
      const sortedReqs = [...versionReqs].sort((a, b) => a.sort_order - b.sort_order)

      // Build requirement tree
      const reqById = new Map(sortedReqs.map(r => [r.id, r]))
      const rootReqs: CanonicalRequirement[] = []
      const childrenByParentId = new Map<string, CanonicalRequirement[]>()

      for (const req of sortedReqs) {
        const canonicalReq: CanonicalRequirement = {
          requirement_number: req.scoutbook_id,
          scoutbook_requirement_number: req.scoutbook_id,
          description: req.description,
          is_header: req.is_header,
          display_order: req.sort_order,
        }

        if (req.parent_id && reqById.has(req.parent_id)) {
          // This is a child requirement
          if (!childrenByParentId.has(req.parent_id)) {
            childrenByParentId.set(req.parent_id, [])
          }
          childrenByParentId.get(req.parent_id)!.push(canonicalReq)
        } else {
          // This is a root requirement
          rootReqs.push(canonicalReq)
        }

        totalRequirements++
      }

      // Attach children to parents
      function attachChildren(reqs: CanonicalRequirement[], parentIds: Map<string, string>) {
        for (const req of reqs) {
          // Find the original req to get its ID
          const origReq = sortedReqs.find(r => r.scoutbook_id === req.requirement_number)
          if (origReq) {
            const children = childrenByParentId.get(origReq.id)
            if (children && children.length > 0) {
              req.children = children
              // Mark as header if it has children
              req.is_header = true
            }
          }
        }
      }

      attachChildren(rootReqs, new Map())

      canonicalVersions.push({
        version_year: version.version_year,
        requirements: rootReqs,
      })
    }

    canonicalBadges.push({
      id: bsaBadge.id,
      code: bsaBadge.code,
      name: bsaBadge.name,
      is_eagle_required: bsaBadge.is_eagle_required || false,
      category: bsaBadge.category,
      description: bsaBadge.description,
      image_url: bsaBadge.image_url,
      is_active: bsaBadge.is_active ?? true,
      requirement_version_year: latestVersionYear,
      versions: canonicalVersions,
    })
  }

  console.log(`Built ${canonicalBadges.length} badges with ${totalVersions} versions and ${totalRequirements} requirements`)

  // Step 5: Load ranks (unchanged from existing)
  const { data: ranks } = await supabase
    .from('bsa_ranks')
    .select('*')
    .order('display_order')

  const { data: rankReqs } = await supabase
    .from('bsa_rank_requirements')
    .select('*')
    .order('rank_id')
    .order('display_order')

  console.log(`Loaded ${ranks?.length || 0} ranks with ${rankReqs?.length || 0} requirements`)

  // Step 6: Load leadership positions (unchanged)
  const { data: leadership } = await supabase
    .from('bsa_leadership_positions')
    .select('*')
    .order('name')

  console.log(`Loaded ${leadership?.length || 0} leadership positions`)

  // Step 7: Build output structure
  const output = {
    exported_at: new Date().toISOString(),
    source: 'scoutbook-restructure',
    version: '2.0.0',
    stats: {
      merit_badges: canonicalBadges.length,
      badge_versions: totalVersions,
      badge_requirements: totalRequirements,
      ranks: ranks?.length || 0,
      rank_requirements: rankReqs?.length || 0,
      leadership_positions: leadership?.length || 0,
    },
    merit_badges: canonicalBadges,
    ranks: ranks?.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      display_order: r.display_order,
      requirement_version_year: r.requirement_version_year,
      requirements: rankReqs?.filter(rr => rr.rank_id === r.id).map(rr => ({
        requirement_number: rr.requirement_number,
        description: rr.description,
        is_header: false,
        display_order: rr.display_order,
      })) || [],
    })) || [],
    leadership_positions: leadership?.map(l => ({
      id: l.id,
      code: l.code,
      name: l.name,
      min_tenure_months: l.min_tenure_months,
      qualifies_for_star: l.qualifies_for_star,
      qualifies_for_life: l.qualifies_for_life,
      qualifies_for_eagle: l.qualifies_for_eagle,
      is_patrol_level: l.is_patrol_level,
      is_troop_level: l.is_troop_level,
      description: l.description,
    })) || [],
  }

  // Step 8: Write output
  const outputPath = path.join(process.cwd(), 'data/bsa-data-scoutbook.json')
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))

  console.log('')
  console.log('='.repeat(60))
  console.log('EXPORT COMPLETE')
  console.log('='.repeat(60))
  console.log(`Output: ${outputPath}`)
  console.log(`Size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`)
  console.log('')
  console.log('Stats:')
  console.log(`  Merit Badges: ${output.stats.merit_badges}`)
  console.log(`  Badge Versions: ${output.stats.badge_versions}`)
  console.log(`  Badge Requirements: ${output.stats.badge_requirements}`)
  console.log(`  Ranks: ${output.stats.ranks}`)
  console.log(`  Rank Requirements: ${output.stats.rank_requirements}`)
  console.log(`  Leadership Positions: ${output.stats.leadership_positions}`)
}

rebuild().catch(console.error)
