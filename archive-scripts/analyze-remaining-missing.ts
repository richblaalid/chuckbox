#!/usr/bin/env npx tsx
/**
 * Deep analysis of remaining missing descriptions
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

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get all missing
  const { data: missing } = await supabase
    .from('merit_badge_requirements')
    .select('id, scoutbook_id, badge_version_id, main_req, section, item, option_name, option_letter')
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

  // Load scraped data
  const scrapedData = JSON.parse(fs.readFileSync('data/merit-badge-requirements-scraped-fixed.json', 'utf-8'))
  const scrapedLookup = new Map<string, ScrapedRequirement[]>()
  for (const badge of scrapedData.badges as ScrapedBadge[]) {
    const key = `${badge.badgeName}|${badge.versionYear}`
    scrapedLookup.set(key, badge.requirements)
  }

  // Categorize missing
  const categories: {
    noScrapedBadge: Array<{ badge: string; year: number; id: string }>
    bracketNotation: Array<{ badge: string; year: number; id: string }>
    optionFormat: Array<{ badge: string; year: number; id: string }>
    simpleNotFound: Array<{ badge: string; year: number; id: string }>
  } = {
    noScrapedBadge: [],
    bracketNotation: [],
    optionFormat: [],
    simpleNotFound: []
  }

  for (const m of missing || []) {
    const v = versionMap.get(m.badge_version_id)
    if (!v) continue

    const key = `${v.badge_name}|${v.version_year}`
    const scrapedReqs = scrapedLookup.get(key)

    const info = {
      badge: v.badge_name,
      year: v.version_year,
      id: m.scoutbook_id
    }

    if (!scrapedReqs) {
      categories.noScrapedBadge.push(info)
    } else if (m.scoutbook_id.includes('[')) {
      categories.bracketNotation.push(info)
    } else if (m.option_name || m.option_letter) {
      categories.optionFormat.push(info)
    } else {
      categories.simpleNotFound.push(info)
    }
  }

  console.log('DEEP ANALYSIS OF REMAINING MISSING')
  console.log('='.repeat(60))
  console.log('')
  console.log('Total missing:', missing?.length || 0)
  console.log('')
  console.log('By category:')
  console.log('  No scraped badge version:', categories.noScrapedBadge.length)
  console.log('  Bracket notation [n]:', categories.bracketNotation.length)
  console.log('  Option format:', categories.optionFormat.length)
  console.log('  Simple not found:', categories.simpleNotFound.length)
  console.log('')

  // Show samples from each
  if (categories.noScrapedBadge.length > 0) {
    console.log('NO SCRAPED BADGE (need to scrape these versions):')
    const unique = [...new Set(categories.noScrapedBadge.map(i => `${i.badge} ${i.year}`))]
    for (const u of unique.slice(0, 15)) console.log('  ' + u)
    if (unique.length > 15) console.log(`  ... and ${unique.length - 15} more`)
    console.log('')
  }

  if (categories.bracketNotation.length > 0) {
    console.log('BRACKET NOTATION samples:')
    for (const i of categories.bracketNotation.slice(0, 10)) {
      console.log(`  ${i.badge} ${i.year}: ${i.id}`)
    }
    if (categories.bracketNotation.length > 10) {
      console.log(`  ... and ${categories.bracketNotation.length - 10} more`)
    }
    console.log('')
  }

  if (categories.optionFormat.length > 0) {
    console.log('OPTION FORMAT samples:')
    for (const i of categories.optionFormat.slice(0, 10)) {
      console.log(`  ${i.badge} ${i.year}: ${i.id}`)
    }
    if (categories.optionFormat.length > 10) {
      console.log(`  ... and ${categories.optionFormat.length - 10} more`)
    }
    console.log('')
  }

  if (categories.simpleNotFound.length > 0) {
    console.log('SIMPLE NOT FOUND samples:')
    for (const i of categories.simpleNotFound.slice(0, 15)) {
      console.log(`  ${i.badge} ${i.year}: ${i.id}`)
    }
    if (categories.simpleNotFound.length > 15) {
      console.log(`  ... and ${categories.simpleNotFound.length - 15} more`)
    }
  }

  // For simpleNotFound, let's see what the scraped data has
  console.log('')
  console.log('='.repeat(60))
  console.log('INVESTIGATING SIMPLE NOT FOUND')
  console.log('='.repeat(60))

  // Group by badge
  const simpleByBadge = new Map<string, string[]>()
  for (const i of categories.simpleNotFound) {
    const key = `${i.badge}|${i.year}`
    const existing = simpleByBadge.get(key) || []
    existing.push(i.id)
    simpleByBadge.set(key, existing)
  }

  // For each badge, compare canonical vs scraped
  for (const [key, canonicalIds] of [...simpleByBadge.entries()].slice(0, 5)) {
    const [badge, yearStr] = key.split('|')
    const scrapedReqs = scrapedLookup.get(key)

    console.log('')
    console.log(`${badge} ${yearStr}:`)
    console.log('  Canonical missing:', canonicalIds.join(', '))

    if (scrapedReqs) {
      // Find close matches in scraped
      const scrapedIds = scrapedReqs.map(r => r.number)
      console.log('  Scraped IDs available:', scrapedIds.slice(0, 20).join(', '))

      // Try to find what might match
      for (const canId of canonicalIds.slice(0, 3)) {
        const normalized = canId.replace(/\./g, '').toLowerCase()
        const possibleMatches = scrapedReqs.filter(r => {
          const scrNorm = r.number.replace(/\./g, '').toLowerCase()
          return scrNorm === normalized ||
            scrNorm.includes(normalized) ||
            normalized.includes(scrNorm)
        })

        if (possibleMatches.length > 0) {
          console.log(`  "${canId}" might match:`)
          for (const pm of possibleMatches.slice(0, 2)) {
            console.log(`    "${pm.number}": ${pm.description.substring(0, 50)}...`)
          }
        }
      }
    }
  }
}

main().catch(console.error)
