#!/usr/bin/env npx tsx
/**
 * Analyze CSV Coverage
 *
 * Extracts all unique merit badge requirement IDs from the Scoutbook CSV export
 * to determine what canonical data we have available.
 */

import * as fs from 'fs'
import * as path from 'path'

interface RequirementData {
  advancementType: string
  advancement: string  // The requirement ID
  badgeName: string    // Extracted from advancementType
  version: string
}

interface BadgeVersionData {
  version: string
  requirements: Set<string>
  sampleIds: string[]  // First few IDs for reference
}

interface BadgeSummary {
  badgeName: string
  versions: Map<string, BadgeVersionData>
  totalRequirements: number
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())

  return result
}

function extractBadgeName(advancementType: string): string | null {
  // Format: "Badge Name Merit Badge Requirements"
  const match = advancementType.match(/^"?(.+?)\s+Merit Badge Requirements"?$/)
  if (match) {
    return match[1].trim()
  }
  return null
}

async function analyzeCSV(csvPath: string): Promise<void> {
  console.log(`Analyzing: ${csvPath}\n`)

  const content = fs.readFileSync(csvPath, 'utf-8')
  const lines = content.split('\n')

  // Parse header
  const header = parseCSVLine(lines[0])
  console.log('CSV Columns:', header.join(', '))
  console.log('')

  // Find column indices
  const advTypeIdx = header.findIndex(h => h.toLowerCase() === 'advancementtype')
  const advIdx = header.findIndex(h => h.toLowerCase() === 'advancement')
  const versionIdx = header.findIndex(h => h.toLowerCase() === 'version')

  console.log(`Column indices: advancementtype=${advTypeIdx}, advancement=${advIdx}, version=${versionIdx}`)
  console.log('')

  if (advTypeIdx === -1 || advIdx === -1 || versionIdx === -1) {
    console.error('Required columns not found!')
    return
  }

  // Collect all merit badge data
  const badges = new Map<string, BadgeSummary>()
  let totalRows = 0
  let meritBadgeRows = 0
  let skippedRows = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    totalRows++
    const fields = parseCSVLine(line)

    if (fields.length <= Math.max(advTypeIdx, advIdx, versionIdx)) {
      skippedRows++
      continue
    }

    const advType = fields[advTypeIdx]
    const advancement = fields[advIdx]
    const version = fields[versionIdx]

    // Only process merit badges
    if (!advType.includes('Merit Badge Requirements')) continue

    meritBadgeRows++

    const badgeName = extractBadgeName(advType)
    if (!badgeName) continue

    // Skip if no requirement ID (badge completion records)
    if (!advancement || advancement === badgeName) continue

    // Get or create badge summary
    if (!badges.has(badgeName)) {
      badges.set(badgeName, {
        badgeName,
        versions: new Map(),
        totalRequirements: 0
      })
    }

    const badge = badges.get(badgeName)!

    // Get or create version data
    if (!badge.versions.has(version)) {
      badge.versions.set(version, {
        version,
        requirements: new Set(),
        sampleIds: []
      })
    }

    const versionData = badge.versions.get(version)!

    // Add requirement if not seen
    if (!versionData.requirements.has(advancement)) {
      versionData.requirements.add(advancement)
      badge.totalRequirements++

      // Store first 5 as samples
      if (versionData.sampleIds.length < 5) {
        versionData.sampleIds.push(advancement)
      }
    }
  }

  // Summary statistics
  console.log('='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log(`Total CSV rows: ${totalRows}`)
  console.log(`Merit badge rows: ${meritBadgeRows}`)
  console.log(`Skipped rows: ${skippedRows}`)
  console.log(`Unique badges: ${badges.size}`)
  console.log('')

  // Sort badges by name
  const sortedBadges = [...badges.values()].sort((a, b) =>
    a.badgeName.localeCompare(b.badgeName)
  )

  // Detailed badge breakdown
  console.log('='.repeat(70))
  console.log('MERIT BADGE COVERAGE')
  console.log('='.repeat(70))
  console.log('')

  let totalVersions = 0
  let totalRequirements = 0

  for (const badge of sortedBadges) {
    const versionCount = badge.versions.size
    totalVersions += versionCount
    totalRequirements += badge.totalRequirements

    console.log(`${badge.badgeName}`)
    console.log(`  Versions: ${versionCount}`)

    // Sort versions
    const sortedVersions = [...badge.versions.values()].sort((a, b) =>
      a.version.localeCompare(b.version)
    )

    for (const ver of sortedVersions) {
      console.log(`    ${ver.version}: ${ver.requirements.size} requirements`)
      if (ver.sampleIds.length > 0) {
        console.log(`      Sample IDs: ${ver.sampleIds.slice(0, 3).join(', ')}`)
      }
    }
    console.log('')
  }

  console.log('='.repeat(70))
  console.log('TOTALS')
  console.log('='.repeat(70))
  console.log(`Total unique badges: ${badges.size}`)
  console.log(`Total badge-versions: ${totalVersions}`)
  console.log(`Total unique requirements: ${totalRequirements}`)
  console.log('')

  // Find badges with complex structures (multiple ID formats)
  console.log('='.repeat(70))
  console.log('BADGES WITH COMPLEX ID PATTERNS')
  console.log('='.repeat(70))
  console.log('')

  const complexPatterns = [
    { pattern: /Option/, name: 'Option-based' },
    { pattern: /Opt [A-Z]/, name: 'Opt A/B suffix' },
    { pattern: /\([a-z]\)\(\d+\)/, name: 'Nested (a)(1) format' },
    { pattern: /\(\d+\)\([a-z]\)/, name: 'Nested (1)(a) format' },
    { pattern: /\[\d+\]/, name: 'Bracket notation' },
  ]

  for (const badge of sortedBadges) {
    const allIds: string[] = []
    for (const ver of badge.versions.values()) {
      allIds.push(...ver.requirements)
    }

    const matchedPatterns: string[] = []
    for (const { pattern, name } of complexPatterns) {
      if (allIds.some(id => pattern.test(id))) {
        matchedPatterns.push(name)
      }
    }

    if (matchedPatterns.length > 0) {
      console.log(`${badge.badgeName}: ${matchedPatterns.join(', ')}`)
      // Show example IDs
      const examples = allIds.filter(id =>
        complexPatterns.some(p => p.pattern.test(id))
      ).slice(0, 5)
      console.log(`  Examples: ${examples.join(', ')}`)
      console.log('')
    }
  }

  // Export the data for reference
  const exportData: Record<string, Record<string, string[]>> = {}

  for (const badge of sortedBadges) {
    exportData[badge.badgeName] = {}
    for (const [version, data] of badge.versions) {
      exportData[badge.badgeName][version] = [...data.requirements].sort()
    }
  }

  const outputPath = 'data/scoutbook-requirement-ids.json'
  fs.mkdirSync('data', { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2))
  console.log(`\nExported requirement IDs to: ${outputPath}`)
}

// Run
const csvPath = process.argv[2] || 'docs/troop_advancement/Troop9297B_Advancement_20260124.csv'
analyzeCSV(csvPath).catch(console.error)
