#!/usr/bin/env npx tsx
/**
 * Report on remaining missing descriptions
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  )

  // Load scraped data to check availability
  const scrapedData = JSON.parse(fs.readFileSync('data/merit-badge-requirements-scraped-fixed.json', 'utf-8'))
  const scrapedBadges = new Set<string>()
  for (const badge of scrapedData.badges) {
    scrapedBadges.add(`${badge.badgeName}|${badge.versionYear}`)
  }

  // Get all missing
  const { data: missing } = await supabase
    .from('merit_badge_requirements')
    .select('id, scoutbook_id, badge_version_id')
    .is('description', null)

  // Get version info
  const versionIds = [...new Set(missing?.map(m => m.badge_version_id) || [])]
  const { data: versions } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year')
    .in('id', versionIds)

  const versionMap = new Map<string, { badge_name: string; version_year: number }>()
  for (const v of versions || []) {
    versionMap.set(v.id, v)
  }

  // Categorize
  const noScrapedData: Array<{ badge: string; year: number; ids: string[] }> = []
  const hasScrapedData: Array<{ badge: string; year: number; ids: string[] }> = []

  // Group by badge version
  const byVersion = new Map<string, string[]>()
  for (const m of missing || []) {
    const v = versionMap.get(m.badge_version_id)
    if (!v) continue
    const key = `${v.badge_name}|${v.version_year}`
    const existing = byVersion.get(key) || []
    existing.push(m.scoutbook_id)
    byVersion.set(key, existing)
  }

  // Classify each version
  for (const [key, ids] of byVersion) {
    const [badge, yearStr] = key.split('|')
    const year = parseInt(yearStr, 10)
    const entry = { badge, year, ids }

    if (scrapedBadges.has(key)) {
      hasScrapedData.push(entry)
    } else {
      noScrapedData.push(entry)
    }
  }

  console.log('REMAINING MISSING DESCRIPTIONS REPORT')
  console.log('='.repeat(60))
  console.log(`Total missing: ${missing?.length || 0}`)
  console.log('')

  console.log('NO SCRAPED DATA AVAILABLE (need to scrape these versions):')
  console.log('-'.repeat(60))
  let noScrapedCount = 0
  for (const entry of noScrapedData.sort((a, b) => a.badge.localeCompare(b.badge))) {
    console.log(`  ${entry.badge} ${entry.year}: ${entry.ids.length} missing`)
    noScrapedCount += entry.ids.length
  }
  console.log(`  Subtotal: ${noScrapedCount}`)
  console.log('')

  console.log('HAS SCRAPED DATA BUT NO MATCH (format/structure mismatch):')
  console.log('-'.repeat(60))
  let hasScrapedCount = 0
  for (const entry of hasScrapedData.sort((a, b) => a.badge.localeCompare(b.badge))) {
    console.log(`  ${entry.badge} ${entry.year}:`)
    for (const id of entry.ids.slice(0, 5)) {
      console.log(`    - ${id}`)
    }
    if (entry.ids.length > 5) {
      console.log(`    ... and ${entry.ids.length - 5} more`)
    }
    hasScrapedCount += entry.ids.length
  }
  console.log(`  Subtotal: ${hasScrapedCount}`)
  console.log('')

  console.log('SUMMARY')
  console.log('='.repeat(60))
  const { count: total } = await supabase
    .from('merit_badge_requirements')
    .select('*', { count: 'exact', head: true })

  const { count: withDesc } = await supabase
    .from('merit_badge_requirements')
    .select('*', { count: 'exact', head: true })
    .not('description', 'is', null)

  console.log(`Total requirements: ${total}`)
  console.log(`With descriptions: ${withDesc} (${((withDesc || 0)/(total || 1)*100).toFixed(1)}%)`)
  console.log(`Missing descriptions: ${(total || 0) - (withDesc || 0)}`)
  console.log(`  - No scraped data: ${noScrapedCount}`)
  console.log(`  - Format mismatch: ${hasScrapedCount}`)
}

main().catch(console.error)
