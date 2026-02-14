/**
 * Parse Scoutbook Achievement CSV to extract merit badge requirement IDs
 *
 * This script extracts the authoritative requirement IDs from Scoutbook's
 * Achievement export CSV. These IDs are used to match requirements when
 * building the canonical seed file.
 *
 * Usage:
 *   npx tsx scripts/parse-achievement-csv.ts path/to/achievement-export.csv
 *
 * Output:
 *   data/csv-requirement-ids.json
 */

import * as fs from 'fs'
import * as path from 'path'

// Types
interface CsvRequirement {
  scoutbookId: string // Exact ID from CSV: "1a", "3a[1]", "4a1 Triathlon Option"
  badgeName: string // "Camping", "Multisport"
  versionYear: number // 2025, 2026
}

interface BadgeVersionData {
  badgeName: string
  versionYear: number
  requirementIds: string[] // Unique, sorted requirement IDs
  totalOccurrences: number // How many times this badge+version appeared (across scouts)
}

interface ParseResult {
  generatedAt: string
  csvPath: string
  totalRows: number
  meritBadgeRequirementRows: number
  uniqueBadgeVersions: number
  uniqueBadges: number
  badges: BadgeVersionData[]
}

// Parse a CSV line, handling quoted fields with commas
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"'
        i++
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }

  fields.push(current)
  return fields
}

// Extract badge name from advancementtype
// "Environmental Science Merit Badge Requirements" -> "Environmental Science"
function extractBadgeName(advancementType: string): string | null {
  const suffix = ' Merit Badge Requirements'
  if (!advancementType.endsWith(suffix)) {
    return null
  }
  return advancementType.slice(0, -suffix.length)
}

// Parse the CSV and extract merit badge requirements
function parseAchievementCsv(csvPath: string): ParseResult {
  const content = fs.readFileSync(csvPath, 'utf-8')
  const lines = content.split('\n')

  if (lines.length === 0) {
    throw new Error('CSV file is empty')
  }

  // Parse header line
  const headerLine = lines[0]
  const headers = parseCsvLine(headerLine)

  // Find column indices
  const advancementTypeIdx = headers.indexOf('advancementtype')
  const advancementIdx = headers.indexOf('advancement')
  const versionIdx = headers.indexOf('version')

  if (advancementTypeIdx === -1) {
    throw new Error('Missing required column: advancementtype')
  }
  if (advancementIdx === -1) {
    throw new Error('Missing required column: advancement')
  }
  if (versionIdx === -1) {
    throw new Error('Missing required column: version')
  }

  // Group requirements by badge+version
  const badgeVersionMap = new Map<
    string,
    {
      badgeName: string
      versionYear: number
      requirementIds: Set<string>
      totalOccurrences: number
    }
  >()

  let totalRows = 0
  let meritBadgeRequirementRows = 0

  // Process each data row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    totalRows++

    const fields = parseCsvLine(line)
    const advancementType = fields[advancementTypeIdx] || ''
    const advancement = fields[advancementIdx] || ''
    const version = fields[versionIdx] || ''

    // Only process Merit Badge Requirements
    const badgeName = extractBadgeName(advancementType)
    if (!badgeName) continue

    meritBadgeRequirementRows++

    // Parse version year
    const versionYear = parseInt(version, 10)
    if (isNaN(versionYear)) {
      console.warn(`Invalid version year "${version}" for ${badgeName}, row ${i + 1}`)
      continue
    }

    const key = `${badgeName}:${versionYear}`

    if (!badgeVersionMap.has(key)) {
      badgeVersionMap.set(key, {
        badgeName,
        versionYear,
        requirementIds: new Set(),
        totalOccurrences: 0,
      })
    }

    const data = badgeVersionMap.get(key)!
    data.totalOccurrences++

    // Only add non-empty requirement IDs
    // Empty IDs represent headers in the CSV
    if (advancement.trim()) {
      data.requirementIds.add(advancement.trim())
    }
  }

  // Convert map to sorted array
  const badges: BadgeVersionData[] = []
  for (const [, data] of badgeVersionMap) {
    const sortedIds = Array.from(data.requirementIds).sort((a, b) => {
      // Natural sort for requirement IDs
      return a.localeCompare(b, undefined, { numeric: true })
    })

    badges.push({
      badgeName: data.badgeName,
      versionYear: data.versionYear,
      requirementIds: sortedIds,
      totalOccurrences: data.totalOccurrences,
    })
  }

  // Sort badges by name, then version year
  badges.sort((a, b) => {
    const nameCompare = a.badgeName.localeCompare(b.badgeName)
    if (nameCompare !== 0) return nameCompare
    return a.versionYear - b.versionYear
  })

  // Count unique badges (ignoring versions)
  const uniqueBadges = new Set(badges.map((b) => b.badgeName)).size

  return {
    generatedAt: new Date().toISOString(),
    csvPath: path.basename(csvPath),
    totalRows,
    meritBadgeRequirementRows,
    uniqueBadgeVersions: badges.length,
    uniqueBadges,
    badges,
  }
}

// Main
async function main() {
  const csvPath = process.argv[2]

  if (!csvPath) {
    // Default to the known troop advancement file
    const defaultPath = 'docs/troop_advancement/Troop9297B_Advancement_20260124.csv'
    if (fs.existsSync(defaultPath)) {
      console.log(`Using default CSV: ${defaultPath}`)
      process.argv[2] = defaultPath
      return main()
    }
    console.error('Usage: npx tsx scripts/parse-achievement-csv.ts <path-to-csv>')
    console.error('Example: npx tsx scripts/parse-achievement-csv.ts docs/troop_advancement/Troop9297B_Advancement_20260124.csv')
    process.exit(1)
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`)
    process.exit(1)
  }

  console.log(`Parsing ${csvPath}...`)
  const result = parseAchievementCsv(csvPath)

  // Output summary
  console.log('\n=== Parse Summary ===')
  console.log(`Total CSV rows: ${result.totalRows}`)
  console.log(`Merit badge requirement rows: ${result.meritBadgeRequirementRows}`)
  console.log(`Unique badges: ${result.uniqueBadges}`)
  console.log(`Unique badge+version combinations: ${result.uniqueBadgeVersions}`)

  // Show sample badges
  console.log('\n=== Sample Badge Versions ===')
  const samples = result.badges.slice(0, 5)
  for (const badge of samples) {
    console.log(`\n${badge.badgeName} (${badge.versionYear}):`)
    console.log(`  Requirements: ${badge.requirementIds.length}`)
    console.log(`  Sample IDs: ${badge.requirementIds.slice(0, 8).join(', ')}${badge.requirementIds.length > 8 ? '...' : ''}`)
  }

  // Show complex badges specifically
  console.log('\n=== Complex Badge Samples ===')
  const complexBadges = ['Environmental Science', 'Multisport', 'Archery']
  for (const name of complexBadges) {
    const versions = result.badges.filter((b) => b.badgeName === name)
    if (versions.length === 0) {
      console.log(`\n${name}: Not found in CSV`)
      continue
    }
    for (const v of versions) {
      console.log(`\n${v.badgeName} (${v.versionYear}):`)
      console.log(`  Requirements: ${v.requirementIds.length}`)
      console.log(`  IDs: ${v.requirementIds.join(', ')}`)
    }
  }

  // Write output
  const outputPath = 'data/csv-requirement-ids.json'
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2))
  console.log(`\nOutput written to: ${outputPath}`)
}

main().catch(console.error)
