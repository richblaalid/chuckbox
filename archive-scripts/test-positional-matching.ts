#!/usr/bin/env npx tsx
/**
 * Test Positional Matching Strategy
 *
 * Tests the positional matching approach using existing scraped data
 * against canonical IDs to see if the order-based strategy works.
 *
 * Usage:
 *   npx tsx scripts/test-positional-matching.ts
 *   npx tsx scripts/test-positional-matching.ts "Multisport" 2025
 */

import * as fs from 'fs'

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

interface CanonicalData {
  [badgeName: string]: {
    [year: string]: string[]
  }
}

// Test badges that had issues
const TEST_BADGES = [
  { name: 'Multisport', year: 2025 },
  { name: 'Snow Sports', year: 2026 },
  { name: 'Rifle Shooting', year: 2025 },
  { name: 'Archery', year: 2025 },
  { name: 'Golf', year: 2024 },
  { name: 'Animal Science', year: 2025 },
  { name: 'Skating', year: 2024 },
  { name: 'Plant Science', year: 2023 },
]

function extractIdShape(id: string): string {
  let shape = id
    .replace(/ (Triathlon|Duathlon|Aquathlon|Aquabike|Ice|Inline|Alpine|Snowboard|Nordic|Board|Roll|Line|avian|beef|dairy|hog|horse|rabbit|sheep|goat)( Option)?/gi, '')
    .replace(/ Option [A-H]/gi, '')
    .replace(/ Opt [A-H]/gi, '')

  const match = shape.match(/(\d+)([a-z])?(\d+)?/i)
  if (match) {
    return (match[1] + (match[2] || '') + (match[3] || '')).toLowerCase()
  }
  return id.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function testPositionalMatching(
  scrapedBadge: ScrapedBadge,
  canonicalIds: string[]
): void {
  console.log('='.repeat(80))
  console.log(`${scrapedBadge.badgeName} ${scrapedBadge.versionYear}`)
  console.log('='.repeat(80))

  // Filter scraped to trackable only (exclude depth 0 and headers)
  const trackable = scrapedBadge.requirements.filter(r =>
    r.depth > 0 && r.number && !r.number.startsWith('_')
  )

  console.log(`Scraped trackable: ${trackable.length}`)
  console.log(`Canonical IDs: ${canonicalIds.length}`)
  console.log('')

  // Test positional matching
  let positionalMatches = 0
  let shapeMatches = 0
  let noMatch = 0
  const usedCanonical = new Set<number>()

  console.log('POSITIONAL MATCHING RESULTS:')
  console.log('-'.repeat(80))

  const matchResults: { scraped: string, canonical: string | null, matchType: string }[] = []

  for (let i = 0; i < trackable.length; i++) {
    const scraped = trackable[i]
    let matchedCanonical: string | null = null
    let matchType = 'none'

    // Try positional first
    if (i < canonicalIds.length && !usedCanonical.has(i)) {
      matchedCanonical = canonicalIds[i]
      matchType = 'positional'
      usedCanonical.add(i)
      positionalMatches++
    }

    // Try shape matching if positional failed
    if (!matchedCanonical) {
      const scrapedShape = extractIdShape(scraped.number)
      for (let j = 0; j < canonicalIds.length; j++) {
        if (usedCanonical.has(j)) continue
        const canonicalShape = extractIdShape(canonicalIds[j])
        if (scrapedShape === canonicalShape) {
          matchedCanonical = canonicalIds[j]
          matchType = 'shape'
          usedCanonical.add(j)
          shapeMatches++
          break
        }
      }
    }

    if (!matchedCanonical) {
      noMatch++
    }

    matchResults.push({
      scraped: scraped.number,
      canonical: matchedCanonical,
      matchType
    })
  }

  // Show first 15 matches
  for (let i = 0; i < Math.min(15, matchResults.length); i++) {
    const r = matchResults[i]
    const status = r.matchType === 'positional' ? '✓' : r.matchType === 'shape' ? '~' : '✗'
    const canonicalDisplay = r.canonical || '(none)'
    console.log(`  ${status} "${r.scraped}" → "${canonicalDisplay}" [${r.matchType}]`)
  }
  if (matchResults.length > 15) {
    console.log(`  ... and ${matchResults.length - 15} more`)
  }

  console.log('')
  console.log('SUMMARY:')
  console.log(`  Positional matches: ${positionalMatches}`)
  console.log(`  Shape matches:      ${shapeMatches}`)
  console.log(`  No match:           ${noMatch}`)
  console.log(`  Total trackable:    ${trackable.length}`)

  const matchRate = trackable.length > 0
    ? (((positionalMatches + shapeMatches) / trackable.length) * 100).toFixed(1)
    : '0'
  console.log(`  Match rate:         ${matchRate}%`)

  // Check if counts match
  if (trackable.length !== canonicalIds.length) {
    console.log('')
    console.log(`  ⚠️  COUNT MISMATCH: ${trackable.length} scraped vs ${canonicalIds.length} canonical`)

    // This is the real issue - the scraper includes items that aren't in canonical
    // Let's see what the extras are
    if (trackable.length > canonicalIds.length) {
      console.log('  Extra scraped items (not in canonical):')
      for (let i = canonicalIds.length; i < Math.min(canonicalIds.length + 5, trackable.length); i++) {
        console.log(`    + "${trackable[i].number}" - "${trackable[i].description.substring(0, 40)}..."`)
      }
    }
  }

  console.log('')
}

async function main() {
  // Load data
  const scrapedPath = 'data/merit-badge-requirements-scraped-fixed.json'
  const canonicalPath = 'data/scoutbook-requirement-ids.json'

  const scrapedData: ScrapedData = JSON.parse(fs.readFileSync(scrapedPath, 'utf-8'))
  const canonicalData: CanonicalData = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'))

  // Check for specific badge argument
  const args = process.argv.slice(2)
  if (args.length >= 2) {
    const badgeName = args[0]
    const year = parseInt(args[1], 10)

    const scrapedBadge = scrapedData.badges.find(
      b => b.badgeName === badgeName && b.versionYear === year
    )
    const canonicalIds = canonicalData[badgeName]?.[String(year)] || []

    if (scrapedBadge) {
      testPositionalMatching(scrapedBadge, canonicalIds)
    } else {
      console.log(`Badge not found: ${badgeName} ${year}`)
    }
    return
  }

  // Test all problem badges
  console.log('Testing Positional Matching Strategy')
  console.log('='.repeat(80))
  console.log('')

  let totalPositional = 0
  let totalShape = 0
  let totalNoMatch = 0
  let totalTrackable = 0

  for (const badge of TEST_BADGES) {
    const scrapedBadge = scrapedData.badges.find(
      b => b.badgeName === badge.name && b.versionYear === badge.year
    )
    const canonicalIds = canonicalData[badge.name]?.[String(badge.year)] || []

    if (!scrapedBadge) {
      console.log(`Skipping ${badge.name} ${badge.year} - not in scraped data`)
      continue
    }

    testPositionalMatching(scrapedBadge, canonicalIds)

    // Accumulate stats (simplified)
    const trackable = scrapedBadge.requirements.filter(r => r.depth > 0 && r.number)
    totalTrackable += trackable.length
  }

  console.log('')
  console.log('='.repeat(80))
  console.log('OVERALL ANALYSIS')
  console.log('='.repeat(80))
  console.log('')
  console.log('The positional matching strategy assumes scraped and canonical')
  console.log('requirements are in the same order. When counts differ, it means')
  console.log('the scraper is capturing items that Scoutbook CSV does not export.')
  console.log('')
  console.log('Common causes of count mismatches:')
  console.log('  1. Main requirements (depth 0) not in CSV')
  console.log('  2. Option/section headers not in CSV')
  console.log('  3. Scraper duplicating items')
  console.log('')
  console.log('Solution: Filter scraped items to match what CSV contains,')
  console.log('then positional matching should achieve near 100%.')
}

main().catch(console.error)
