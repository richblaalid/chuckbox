#!/usr/bin/env npx tsx
/**
 * Fill Main Requirement Descriptions
 *
 * Populates descriptions for main requirements (1, 2, 3, etc.)
 * that were skipped by the original merge because they have depth 0.
 *
 * Usage:
 *   npx tsx scripts/fill-main-requirement-descriptions.ts --dry-run
 *   npx tsx scripts/fill-main-requirement-descriptions.ts
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

interface ScrapedData {
  badges: ScrapedBadge[]
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE env vars')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Load scraped data
  const scrapedPath = 'data/merit-badge-requirements-scraped-fixed.json'
  const scrapedData: ScrapedData = JSON.parse(fs.readFileSync(scrapedPath, 'utf-8'))

  console.log(dryRun ? 'DRY RUN\n' : 'LIVE RUN\n')
  console.log('Filling main requirement descriptions...')
  console.log('='.repeat(60))

  // Get all requirements missing descriptions that are main-req only
  const { data: missing } = await supabase
    .from('merit_badge_requirements')
    .select('id, scoutbook_id, badge_version_id, main_req, section, item')
    .is('description', null)

  // Filter to main-req only (no section, no item)
  const mainReqsMissing = (missing || []).filter(m =>
    m.main_req && !m.section && !m.item
  )

  console.log(`Found ${mainReqsMissing.length} main requirements missing descriptions\n`)

  // Get version info
  const versionIds = [...new Set(mainReqsMissing.map(m => m.badge_version_id))]
  const { data: versions } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .in('id', versionIds)

  const versionMap = new Map<string, { badge_name: string; version_year: number }>()
  for (const v of versions || []) {
    versionMap.set(v.id, v)
  }

  // Build scraped lookup
  const scrapedLookup = new Map<string, Map<string, string>>()
  for (const badge of scrapedData.badges) {
    const key = `${badge.badgeName}|${badge.versionYear}`
    const reqMap = new Map<string, string>()

    for (const req of badge.requirements) {
      if (req.description && req.description.length > 0) {
        // Normalize the number - remove trailing period, lowercase
        const normalized = req.number.replace(/\.$/, '').toLowerCase()
        reqMap.set(normalized, req.description)
        reqMap.set(req.number, req.description)
        reqMap.set(req.number.toLowerCase(), req.description)
      }
    }

    scrapedLookup.set(key, reqMap)
  }

  let updated = 0
  let notFound = 0

  for (const req of mainReqsMissing) {
    const version = versionMap.get(req.badge_version_id)
    if (!version) continue

    const key = `${version.badge_name}|${version.version_year}`
    const reqMap = scrapedLookup.get(key)

    if (!reqMap) {
      notFound++
      continue
    }

    // Try to find matching description
    const scoutbookId = req.scoutbook_id
    const mainReq = req.main_req

    // Try various formats
    const candidates = [
      scoutbookId,
      scoutbookId.replace(/\.$/, ''),
      mainReq,
      mainReq + '.',
      scoutbookId.toLowerCase(),
      mainReq.toLowerCase(),
    ]

    let description: string | undefined
    for (const candidate of candidates) {
      description = reqMap.get(candidate)
      if (description) break
    }

    if (description) {
      if (!dryRun) {
        await supabase
          .from('merit_badge_requirements')
          .update({ description })
          .eq('id', req.id)
      }
      updated++
    } else {
      notFound++
    }
  }

  console.log(`Updated: ${updated}`)
  console.log(`Not found in scraped data: ${notFound}`)
  console.log(dryRun ? '\n(DRY RUN - no changes made)' : '\nChanges applied!')

  // Verify new totals
  if (!dryRun) {
    const { count: total } = await supabase
      .from('merit_badge_requirements')
      .select('*', { count: 'exact', head: true })

    const { count: withDesc } = await supabase
      .from('merit_badge_requirements')
      .select('*', { count: 'exact', head: true })
      .not('description', 'is', null)

    console.log(`\nNew coverage: ${withDesc}/${total} (${((withDesc!/total!)*100).toFixed(1)}%)`)
  }
}

main().catch(console.error)
