#!/usr/bin/env npx tsx
/**
 * Validate Scraped vs Canonical Data
 *
 * Compares scraped requirement IDs against canonical database data
 * to measure match accuracy and identify problematic badges.
 *
 * Usage:
 *   npx tsx scripts/validate-scraped-vs-canonical.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

interface ScrapedBadge {
  badgeName: string
  versionYear: number
  versionLabel: string
  requirements: Array<{
    number: string
    description: string
    parentNumber: string | null
    depth: number
  }>
}

interface ScrapedData {
  badges: ScrapedBadge[]
}

interface ValidationResult {
  badgeName: string
  versionYear: number
  scrapedCount: number
  canonicalCount: number
  matchedCount: number
  matchRate: number
  missingFromScrape: string[]
  extraInScrape: string[]
  status: 'perfect' | 'good' | 'partial' | 'poor' | 'no_canonical'
}

async function main() {
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

  // Load all canonical data from database
  const { data: versions, error: versionError } = await supabase
    .from('merit_badge_versions')
    .select('id, badge_name, version_year, requirement_count')
    .eq('has_canonical_data', true)

  if (versionError) {
    console.error('Error loading versions:', versionError)
    process.exit(1)
  }

  console.log(`Loaded ${versions?.length || 0} canonical badge-versions from database`)

  // Build canonical lookup
  const canonicalMap = new Map<string, { versionId: string, count: number }>()
  for (const v of versions || []) {
    const key = `${v.badge_name}|${v.version_year}`
    canonicalMap.set(key, { versionId: v.id, count: v.requirement_count })
  }

  const results: ValidationResult[] = []
  let perfectCount = 0
  let goodCount = 0
  let partialCount = 0
  let poorCount = 0
  let noCanonicalCount = 0

  console.log('')
  console.log('Validating scraped data against canonical database...')
  console.log('='.repeat(70))

  for (const badge of scrapedData.badges) {
    const key = `${badge.badgeName}|${badge.versionYear}`
    const canonical = canonicalMap.get(key)

    if (!canonical) {
      results.push({
        badgeName: badge.badgeName,
        versionYear: badge.versionYear,
        scrapedCount: badge.requirements.length,
        canonicalCount: 0,
        matchedCount: 0,
        matchRate: 0,
        missingFromScrape: [],
        extraInScrape: [],
        status: 'no_canonical'
      })
      noCanonicalCount++
      continue
    }

    // Get canonical requirement IDs
    const { data: reqs } = await supabase
      .from('merit_badge_requirements')
      .select('scoutbook_id')
      .eq('badge_version_id', canonical.versionId)

    const canonicalIds = new Set((reqs || []).map(r => r.scoutbook_id))
    const scrapedIds = new Set(badge.requirements.map(r => r.number))

    const matched = [...scrapedIds].filter(id => canonicalIds.has(id))
    const extraInScrape = [...scrapedIds].filter(id => !canonicalIds.has(id))
    const missingFromScrape = [...canonicalIds].filter(id => !scrapedIds.has(id))

    const matchRate = canonicalIds.size > 0
      ? (matched.length / canonicalIds.size) * 100
      : 0

    let status: ValidationResult['status']
    if (matchRate === 100 && extraInScrape.length === 0) {
      status = 'perfect'
      perfectCount++
    } else if (matchRate >= 90) {
      status = 'good'
      goodCount++
    } else if (matchRate >= 50) {
      status = 'partial'
      partialCount++
    } else {
      status = 'poor'
      poorCount++
    }

    results.push({
      badgeName: badge.badgeName,
      versionYear: badge.versionYear,
      scrapedCount: scrapedIds.size,
      canonicalCount: canonicalIds.size,
      matchedCount: matched.length,
      matchRate,
      missingFromScrape,
      extraInScrape,
      status
    })
  }

  // Summary
  console.log('')
  console.log('='.repeat(70))
  console.log('VALIDATION SUMMARY')
  console.log('='.repeat(70))
  console.log('')
  console.log(`Total badge-versions validated: ${results.length}`)
  console.log('')
  console.log(`  ✅ Perfect (100% match, no extras): ${perfectCount}`)
  console.log(`  🟢 Good (≥90% match): ${goodCount}`)
  console.log(`  🟡 Partial (≥50% match): ${partialCount}`)
  console.log(`  🔴 Poor (<50% match): ${poorCount}`)
  console.log(`  ⚪ No canonical data: ${noCanonicalCount}`)

  // Show problematic badges
  const problematic = results.filter(r => r.status === 'partial' || r.status === 'poor')
  if (problematic.length > 0) {
    console.log('')
    console.log('='.repeat(70))
    console.log('PROBLEMATIC BADGES (need scraper fixes)')
    console.log('='.repeat(70))
    console.log('')

    for (const r of problematic) {
      console.log(`${r.badgeName} ${r.versionYear}`)
      console.log(`  Match rate: ${r.matchRate.toFixed(1)}% (${r.matchedCount}/${r.canonicalCount})`)

      if (r.missingFromScrape.length > 0) {
        console.log(`  Missing (${r.missingFromScrape.length}):`)
        r.missingFromScrape.slice(0, 5).forEach(id => console.log(`    - ${id}`))
        if (r.missingFromScrape.length > 5) {
          console.log(`    ... and ${r.missingFromScrape.length - 5} more`)
        }
      }

      if (r.extraInScrape.length > 0) {
        console.log(`  Extra (${r.extraInScrape.length}):`)
        r.extraInScrape.slice(0, 5).forEach(id => console.log(`    + ${id}`))
        if (r.extraInScrape.length > 5) {
          console.log(`    ... and ${r.extraInScrape.length - 5} more`)
        }
      }
      console.log('')
    }
  }

  // Show a few good matches as examples
  const goodMatches = results.filter(r => r.status === 'good' && r.matchRate < 100)
  if (goodMatches.length > 0) {
    console.log('')
    console.log('='.repeat(70))
    console.log('GOOD MATCHES (minor discrepancies)')
    console.log('='.repeat(70))
    console.log('')

    for (const r of goodMatches.slice(0, 5)) {
      console.log(`${r.badgeName} ${r.versionYear}: ${r.matchRate.toFixed(1)}%`)
      if (r.extraInScrape.length > 0) {
        console.log(`  Extra: ${r.extraInScrape.slice(0, 3).join(', ')}`)
      }
      if (r.missingFromScrape.length > 0) {
        console.log(`  Missing: ${r.missingFromScrape.slice(0, 3).join(', ')}`)
      }
    }
  }

  // Calculate overall stats
  const withCanonical = results.filter(r => r.status !== 'no_canonical')
  const avgMatchRate = withCanonical.length > 0
    ? withCanonical.reduce((sum, r) => sum + r.matchRate, 0) / withCanonical.length
    : 0

  console.log('')
  console.log('='.repeat(70))
  console.log('OVERALL STATISTICS')
  console.log('='.repeat(70))
  console.log('')
  console.log(`Average match rate: ${avgMatchRate.toFixed(1)}%`)
  console.log(`Perfect match rate: ${((perfectCount / withCanonical.length) * 100).toFixed(1)}%`)

  // Export detailed results
  const exportData = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      perfect: perfectCount,
      good: goodCount,
      partial: partialCount,
      poor: poorCount,
      noCanonical: noCanonicalCount,
      avgMatchRate
    },
    problematic: problematic.map(r => ({
      badge: r.badgeName,
      version: r.versionYear,
      matchRate: r.matchRate,
      missing: r.missingFromScrape,
      extra: r.extraInScrape
    }))
  }

  fs.writeFileSync('data/scraper-validation-results.json', JSON.stringify(exportData, null, 2))
  console.log('')
  console.log(`Detailed results exported to: data/scraper-validation-results.json`)
}

main().catch(console.error)
