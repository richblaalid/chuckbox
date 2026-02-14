#!/usr/bin/env npx tsx
/**
 * Find Missing Badge Versions
 *
 * Compares scraped data (all versions in Scoutbook) against canonical CSV data
 * to identify exactly which badge+version combinations need canonical IDs.
 */

import * as fs from 'fs'

interface ScrapedBadgeVersion {
  badgeName: string
  versionYear: number
  versionLabel: string
  requirements: any[]
}

interface ScrapedData {
  badges: ScrapedBadgeVersion[]
}

interface MissingVersion {
  badgeName: string
  versionYear: number
  versionLabel: string
  requirementCount: number
  status: 'missing_entirely' | 'missing_version'
}

function main() {
  // Load scraped data (all versions that exist in Scoutbook)
  const scrapedPath = 'data/merit-badge-requirements-scraped-fixed.json'
  if (!fs.existsSync(scrapedPath)) {
    console.error(`Scraped data not found: ${scrapedPath}`)
    process.exit(1)
  }
  const scrapedData: ScrapedData = JSON.parse(fs.readFileSync(scrapedPath, 'utf-8'))

  // Load canonical data (what we have IDs for from CSV)
  const canonicalPath = 'data/scoutbook-requirement-ids.json'
  if (!fs.existsSync(canonicalPath)) {
    console.error(`Canonical data not found: ${canonicalPath}`)
    process.exit(1)
  }
  const canonicalData: Record<string, Record<string, string[]>> =
    JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'))

  // Build set of what we have canonical data for
  const canonicalSet = new Set<string>()
  for (const [badgeName, versions] of Object.entries(canonicalData)) {
    for (const year of Object.keys(versions)) {
      canonicalSet.add(`${badgeName}|${year}`)
    }
  }

  // Build set of what exists in Scoutbook (from scrape)
  const scrapedSet = new Set<string>()
  const scrapedMap = new Map<string, ScrapedBadgeVersion>()
  for (const badge of scrapedData.badges) {
    const key = `${badge.badgeName}|${badge.versionYear}`
    scrapedSet.add(key)
    scrapedMap.set(key, badge)
  }

  // Find missing versions
  const missing: MissingVersion[] = []
  const badgesWithMissingVersions = new Set<string>()
  const badgesMissingEntirely = new Set<string>()

  for (const badge of scrapedData.badges) {
    const key = `${badge.badgeName}|${badge.versionYear}`
    if (!canonicalSet.has(key)) {
      // Check if badge has ANY canonical data
      const hasAnyCanonical = canonicalData[badge.badgeName] !== undefined

      missing.push({
        badgeName: badge.badgeName,
        versionYear: badge.versionYear,
        versionLabel: badge.versionLabel,
        requirementCount: badge.requirements.length,
        status: hasAnyCanonical ? 'missing_version' : 'missing_entirely'
      })

      if (hasAnyCanonical) {
        badgesWithMissingVersions.add(badge.badgeName)
      } else {
        badgesMissingEntirely.add(badge.badgeName)
      }
    }
  }

  // Sort by badge name, then version year
  missing.sort((a, b) => {
    if (a.badgeName !== b.badgeName) return a.badgeName.localeCompare(b.badgeName)
    return a.versionYear - b.versionYear
  })

  // Output report
  console.log('='.repeat(80))
  console.log('MISSING CANONICAL DATA REPORT')
  console.log('='.repeat(80))
  console.log('')
  console.log(`Scraped badge-versions: ${scrapedData.badges.length}`)
  console.log(`Canonical badge-versions: ${canonicalSet.size}`)
  console.log(`Missing badge-versions: ${missing.length}`)
  console.log('')

  // Summary
  console.log('SUMMARY')
  console.log('-'.repeat(80))
  console.log(`Badges missing entirely (no canonical data): ${badgesMissingEntirely.size}`)
  console.log(`Badges with some versions missing: ${badgesWithMissingVersions.size}`)
  console.log(`Total missing badge-versions: ${missing.length}`)
  console.log('')

  // Badges missing entirely
  if (badgesMissingEntirely.size > 0) {
    console.log('='.repeat(80))
    console.log('BADGES MISSING ENTIRELY (no canonical data for any version)')
    console.log('='.repeat(80))
    console.log('')

    const entirelyMissing = missing.filter(m => m.status === 'missing_entirely')
    let currentBadge = ''
    for (const m of entirelyMissing) {
      if (m.badgeName !== currentBadge) {
        if (currentBadge) console.log('')
        console.log(`${m.badgeName}`)
        currentBadge = m.badgeName
      }
      console.log(`  • ${m.versionLabel} (${m.requirementCount} requirements)`)
    }
    console.log('')
  }

  // Badges with partial coverage
  if (badgesWithMissingVersions.size > 0) {
    console.log('='.repeat(80))
    console.log('BADGES WITH PARTIAL COVERAGE (some versions missing)')
    console.log('='.repeat(80))
    console.log('')

    const partialMissing = missing.filter(m => m.status === 'missing_version')
    let currentBadge = ''
    for (const m of partialMissing) {
      if (m.badgeName !== currentBadge) {
        if (currentBadge) console.log('')
        // Show what versions we DO have
        const haveVersions = Object.keys(canonicalData[m.badgeName] || {}).sort()
        console.log(`${m.badgeName}`)
        console.log(`  ✓ Have: ${haveVersions.join(', ')}`)
        console.log(`  ✗ Missing:`)
        currentBadge = m.badgeName
      }
      console.log(`    • ${m.versionLabel} (${m.requirementCount} requirements)`)
    }
    console.log('')
  }

  // Export detailed JSON for further processing
  const exportData = {
    generatedAt: new Date().toISOString(),
    summary: {
      scrapedVersions: scrapedData.badges.length,
      canonicalVersions: canonicalSet.size,
      missingVersions: missing.length,
      badgesMissingEntirely: [...badgesMissingEntirely].sort(),
      badgesWithPartialCoverage: [...badgesWithMissingVersions].sort()
    },
    missingVersions: missing
  }

  const exportPath = 'data/missing-canonical-versions.json'
  fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2))
  console.log(`Detailed data exported to: ${exportPath}`)
}

main()
