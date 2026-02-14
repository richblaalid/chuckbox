#!/usr/bin/env npx tsx

/**
 * Export Canonical Merit Badge Data
 *
 * Exports the complete merit badge data from dev database as the
 * canonical source of truth for all environments.
 *
 * Output: data/merit-badges-canonical.json
 *
 * Usage:
 *   npx tsx scripts/export-canonical-merit-badges.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as fs from 'fs'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface MeritBadge {
  id: string
  code: string
  name: string
  is_eagle_required: boolean
  category: string | null
  description: string | null
  image_url: string | null
  pamphlet_url: string | null
  requirement_version_year: number | null
  is_active: boolean
}

interface MeritBadgeVersion {
  id: string
  merit_badge_id: string
  version_year: number
  is_current: boolean
  source: string | null
  scraped_at: string | null
}

interface MeritBadgeRequirement {
  id: string
  merit_badge_id: string
  version_year: number
  requirement_number: string
  scoutbook_requirement_number: string | null
  description: string
  parent_requirement_id: string | null
  is_header: boolean
  is_alternative: boolean | null
  alternatives_group: string | null
  required_count: number | null
  nesting_depth: number
  display_order: number
}

async function fetchAllWithPagination<T>(
  table: string,
  orderBy: string = 'id'
): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderBy)
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error(`Error fetching ${table}:`, error.message)
      break
    }

    if (!data || data.length === 0) break
    all.push(...(data as T[]))

    if (data.length < pageSize) break
    offset += pageSize
    process.stdout.write(`  Fetched ${all.length} ${table}...\r`)
  }

  return all
}

async function main() {
  console.log('=== Exporting Canonical Merit Badge Data ===\n')
  console.log('Source: Dev Database (.env.local)')
  console.log('')

  // Fetch all data with pagination
  console.log('Fetching merit badges...')
  const badges = await fetchAllWithPagination<MeritBadge>('bsa_merit_badges', 'name')
  console.log(`  Fetched ${badges.length} badges`)

  console.log('Fetching badge versions...')
  const versions = await fetchAllWithPagination<MeritBadgeVersion>(
    'bsa_merit_badge_versions',
    'merit_badge_id'
  )
  console.log(`  Fetched ${versions.length} versions`)

  console.log('Fetching requirements...')
  const requirements = await fetchAllWithPagination<MeritBadgeRequirement>(
    'bsa_merit_badge_requirements',
    'merit_badge_id'
  )
  console.log(`  Fetched ${requirements.length} requirements`)

  // Build the canonical export structure
  const canonical = {
    exportedAt: new Date().toISOString(),
    source: 'dev-database',
    description:
      'Canonical merit badge data including all versions and requirements with proper parent/child relationships and header flags.',
    stats: {
      badges: badges.length,
      versions: versions.length,
      requirements: requirements.length,
      headers: requirements.filter((r) => r.is_header).length,
      eagleRequired: badges.filter((b) => b.is_eagle_required).length,
    },
    badges: badges.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      is_eagle_required: b.is_eagle_required,
      category: b.category,
      description: b.description,
      image_url: b.image_url,
      pamphlet_url: b.pamphlet_url,
      requirement_version_year: b.requirement_version_year,
      is_active: b.is_active,
    })),
    versions: versions.map((v) => ({
      id: v.id,
      merit_badge_id: v.merit_badge_id,
      version_year: v.version_year,
      is_current: v.is_current,
      source: v.source,
    })),
    requirements: requirements.map((r) => ({
      id: r.id,
      merit_badge_id: r.merit_badge_id,
      version_year: r.version_year,
      requirement_number: r.requirement_number,
      scoutbook_requirement_number: r.scoutbook_requirement_number,
      description: r.description,
      parent_requirement_id: r.parent_requirement_id,
      is_header: r.is_header,
      is_alternative: r.is_alternative,
      alternatives_group: r.alternatives_group,
      required_count: r.required_count,
      nesting_depth: r.nesting_depth,
      display_order: r.display_order,
    })),
  }

  // Write to file
  const outputPath = 'data/merit-badges-canonical.json'
  fs.writeFileSync(outputPath, JSON.stringify(canonical, null, 2))

  console.log('')
  console.log('=== Export Complete ===')
  console.log(`Output: ${outputPath}`)
  console.log('')
  console.log('Stats:')
  console.log(`  Badges: ${canonical.stats.badges}`)
  console.log(`  Eagle Required: ${canonical.stats.eagleRequired}`)
  console.log(`  Versions: ${canonical.stats.versions}`)
  console.log(`  Requirements: ${canonical.stats.requirements}`)
  console.log(`  Headers: ${canonical.stats.headers}`)
  console.log('')
  console.log(
    'File size:',
    (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2),
    'MB'
  )
}

main().catch(console.error)
