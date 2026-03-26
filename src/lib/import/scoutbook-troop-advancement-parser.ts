/**
 * Scoutbook Troop Advancement CSV Parser
 *
 * Parses the "Troop Advancement" CSV export from Scoutbook which contains
 * advancement data for all scouts in a unit.
 *
 * Supports multiple CSV formats via dynamic header detection:
 * - Old format (pre-2026): lowercase headers, no spaces (bsamemberid,firstname,...)
 * - New format (2026+): Title Case headers with spaces (BSA Member ID, First Name, ...)
 *
 * Key columns (mapped by alias):
 * - bsaMemberId: Match to scouts.bsa_member_id
 * - advancementType: Type discriminator:
 *   - "Rank" - Rank completion (e.g., advancement="Tenderfoot Rank")
 *   - "Merit Badges" - Badge completion (e.g., advancement="Camping MB")
 *   - "Scout Rank Requirements" - Rank requirement (advancement="1a")
 *   - "[Badge Name] Merit Badge Requirements" - Badge requirement (advancement="7a")
 * - advancement: Item name or requirement number
 * - version: Version year for requirements
 * - dateCompleted / awardedDate: Completion dates
 * - awarded / approved: Booleans (accepts "1", "True", "true", "yes")
 */

import type {
  ParsedAdvancementRow,
  AdvancementCategory,
  ParsedScoutAdvancement,
  ParsedScoutRank,
  ParsedScoutRankRequirement,
  ParsedScoutMeritBadge,
  ParsedScoutMeritBadgeRequirement,
  ParsedTroopAdvancement,
} from './troop-advancement-types'

// ============================================
// Constants
// ============================================

// Map rank names from CSV to rank codes
const RANK_NAME_TO_CODE: Record<string, string> = {
  'scout rank': 'scout',
  'tenderfoot rank': 'tenderfoot',
  'second class rank': 'second_class',
  'first class rank': 'first_class',
  'star scout rank': 'star',
  'life scout rank': 'life',
  'eagle scout rank': 'eagle',
  // Also support without "Scout" suffix
  scout: 'scout',
  tenderfoot: 'tenderfoot',
  'second class': 'second_class',
  'first class': 'first_class',
  star: 'star',
  life: 'life',
  eagle: 'eagle',
}

// Rank requirement type patterns
const RANK_REQUIREMENT_PATTERNS: Array<{ pattern: RegExp; rankCode: string }> = [
  { pattern: /^scout rank requirements$/i, rankCode: 'scout' },
  { pattern: /^tenderfoot rank requirements$/i, rankCode: 'tenderfoot' },
  { pattern: /^second class rank requirements$/i, rankCode: 'second_class' },
  { pattern: /^first class rank requirements$/i, rankCode: 'first_class' },
  { pattern: /^star (scout )?rank requirements$/i, rankCode: 'star' },
  { pattern: /^life (scout )?rank requirements$/i, rankCode: 'life' },
  { pattern: /^eagle (scout )?rank requirements$/i, rankCode: 'eagle' },
]

// Column name aliases for dynamic header detection.
// Each key is a semantic field name; values are possible header strings (lowercase).
// Supports both old Scoutbook format (lowercase, no spaces) and new format (Title Case, spaces).
const COLUMN_ALIASES: Record<string, string[]> = {
  bsaMemberId: ['bsamemberid', 'bsa member id', 'bsa number'],
  firstName: ['firstname', 'first name'],
  middleName: ['middlename', 'middle name'],
  lastName: ['lastname', 'last name'],
  advancementType: ['advancementtype', 'advancement type'],
  advancement: ['advancement'],
  version: ['version'],
  awarded: ['awarded'],
  dateCompleted: ['datecompleted', 'date completed'],
  approved: ['approved'],
  markedCompletedDate: ['markedcompleteddate', 'marked completed date'],
  awardedDate: ['awardeddate', 'awarded date'],
}

// Required columns — parser will error if these are missing from the header
const REQUIRED_COLUMNS = ['bsaMemberId', 'advancementType', 'advancement']

type ColumnMap = Record<string, number | undefined>

/**
 * Detect column indices from the CSV header row.
 * Returns a map of semantic field name → column index.
 * Throws if required columns are missing.
 */
export function detectColumns(headerLine: string): ColumnMap {
  const headers = parseCSVLine(headerLine).map(h => h.toLowerCase().trim())
  const columnMap: ColumnMap = {}

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = headers.findIndex(h => aliases.includes(h))
    if (idx !== -1) {
      columnMap[field] = idx
    }
  }

  // Validate required columns
  const missing = REQUIRED_COLUMNS.filter(col => columnMap[col] === undefined)
  if (missing.length > 0) {
    const missingNames = missing.map(col => COLUMN_ALIASES[col]?.[0] || col).join(', ')
    throw new Error(`Missing required columns: ${missingNames}. Check that the CSV has a valid header row.`)
  }

  return columnMap
}

/**
 * Parse a boolean value from CSV — handles both "1"/"0" (old) and "True"/"False" (new) formats
 */
function parseBool(value: string | undefined): boolean {
  if (!value) return false
  const v = value.toLowerCase().trim()
  return v === '1' || v === 'true' || v === 'yes'
}

// ============================================
// Parsing Utilities
// ============================================

/**
 * Parse a CSV line handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
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
        inQuotes = !inQuotes
      }
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

/**
 * Parse date from MM/DD/YYYY format (with possible time suffix) to YYYY-MM-DD
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr === '/  /' || dateStr.includes('__')) return null

  // Match MM/DD/YYYY pattern (may have time suffix like "12:00:00 AM")
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!match) return null

  const [, month, day, year] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/**
 * Normalize badge name to match database format
 * e.g., "Camping MB" -> "camping"
 */
function normalizeBadgeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+mb$/i, '') // Remove " MB" suffix
    .replace(/\s+merit\s+badge$/i, '') // Remove " Merit Badge" suffix
    .replace(/\s*&\s*/g, ' and ') // Normalize & to "and" before other processing
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Extract badge name from requirement type
 * e.g., "Camping Merit Badge Requirements" -> "Camping"
 */
function extractBadgeNameFromRequirementType(advancementType: string): string | null {
  const match = advancementType.match(/^(.+?)\s+Merit\s+Badge\s+Requirements$/i)
  return match ? match[1].trim() : null
}

/**
 * Classify the advancement type from the CSV
 */
function classifyAdvancementType(advancementType: string): {
  category: AdvancementCategory
  rankCode?: string
  badgeName?: string
} {
  const lowerType = advancementType.toLowerCase().trim()

  // Check for rank
  if (lowerType === 'rank') {
    return { category: 'rank' }
  }

  // Check for merit badges
  if (lowerType === 'merit badges') {
    return { category: 'merit_badge' }
  }

  // Check for rank requirements
  for (const { pattern, rankCode } of RANK_REQUIREMENT_PATTERNS) {
    if (pattern.test(advancementType)) {
      return { category: 'rank_requirement', rankCode }
    }
  }

  // Check for merit badge requirements
  const badgeName = extractBadgeNameFromRequirementType(advancementType)
  if (badgeName) {
    return { category: 'merit_badge_requirement', badgeName }
  }

  // Everything else (awards, palms, etc.)
  return { category: 'other' }
}

/**
 * Get a column value by field name, returning empty string if column not mapped
 */
function getCol(parts: string[], columnMap: ColumnMap, field: string): string {
  const idx = columnMap[field]
  return idx !== undefined && idx < parts.length ? (parts[idx] || '') : ''
}

/**
 * Parse a single CSV row into a structured object
 */
function parseRow(parts: string[], columnMap: ColumnMap): ParsedAdvancementRow | null {
  const bsaMemberId = getCol(parts, columnMap, 'bsaMemberId')
  if (!bsaMemberId || !/^\d+$/.test(bsaMemberId)) return null

  return {
    bsaMemberId,
    firstName: getCol(parts, columnMap, 'firstName'),
    middleName: getCol(parts, columnMap, 'middleName'),
    lastName: getCol(parts, columnMap, 'lastName'),
    advancementType: getCol(parts, columnMap, 'advancementType'),
    advancement: getCol(parts, columnMap, 'advancement'),
    version: getCol(parts, columnMap, 'version'),
    awarded: parseBool(getCol(parts, columnMap, 'awarded')),
    dateCompleted: parseDate(getCol(parts, columnMap, 'dateCompleted')),
    approved: parseBool(getCol(parts, columnMap, 'approved')),
    markedCompletedDate: parseDate(getCol(parts, columnMap, 'markedCompletedDate')),
    awardedDate: parseDate(getCol(parts, columnMap, 'awardedDate')),
  }
}

// ============================================
// Main Parser
// ============================================

/**
 * Parse Scoutbook Troop Advancement CSV content
 */
export function parseTroopAdvancementCSV(content: string): ParsedTroopAdvancement {
  const lines = content.split('\n')
  const errors: string[] = []
  const scouts = new Map<string, ParsedScoutAdvancement>()

  let totalRows = 0
  let skippedRows = 0
  let rankCount = 0
  let rankRequirementCount = 0
  let badgeCount = 0
  let badgeRequirementCount = 0

  // Detect columns from header row
  const headerLine = lines[0]?.trim()
  if (!headerLine) {
    return { scouts, summary: { totalRows: 0, scoutCount: 0, rankCount: 0, rankRequirementCount: 0, badgeCount: 0, badgeRequirementCount: 0, skippedRows: 0 }, errors: ['Empty file — no header row found'] }
  }

  let columnMap: ColumnMap
  try {
    columnMap = detectColumns(headerLine)
  } catch (err) {
    return { scouts, summary: { totalRows: 0, scoutCount: 0, rankCount: 0, rankRequirementCount: 0, badgeCount: 0, badgeRequirementCount: 0, skippedRows: 0 }, errors: [err instanceof Error ? err.message : String(err)] }
  }

  // Process data rows (skip header)
  const dataLines = lines.slice(1)

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim()
    if (!line) continue

    totalRows++

    try {
      const parts = parseCSVLine(line)
      const row = parseRow(parts, columnMap)

      if (!row) {
        skippedRows++
        continue
      }

      // Get or create scout entry
      let scout = scouts.get(row.bsaMemberId)
      if (!scout) {
        scout = {
          bsaMemberId: row.bsaMemberId,
          firstName: row.firstName,
          middleName: row.middleName,
          lastName: row.lastName,
          ranks: [],
          rankRequirements: [],
          meritBadges: [],
          meritBadgeRequirements: [],
        }
        scouts.set(row.bsaMemberId, scout)
      }

      // Classify and process the row
      const classification = classifyAdvancementType(row.advancementType)

      switch (classification.category) {
        case 'rank': {
          // Only process if awarded or has a date
          if (row.awarded || row.awardedDate) {
            const rankName = row.advancement
            const rankCode = RANK_NAME_TO_CODE[rankName.toLowerCase().trim()]
            if (rankCode) {
              // Check for duplicates
              const existing = scout.ranks.find((r) => r.rankCode === rankCode)
              if (!existing) {
                scout.ranks.push({
                  rankName,
                  rankCode,
                  version: row.version,
                  awarded: row.awarded,
                  awardedDate: row.awardedDate || row.dateCompleted,
                })
                rankCount++
              }
            }
          }
          break
        }

        case 'merit_badge': {
          // Only process if awarded or has a date
          if (row.awarded || row.awardedDate) {
            const normalizedName = normalizeBadgeName(row.advancement)
            // Check for duplicates
            const existing = scout.meritBadges.find((b) => b.normalizedName === normalizedName)
            if (!existing) {
              scout.meritBadges.push({
                badgeName: row.advancement,
                normalizedName,
                version: row.version,
                awarded: row.awarded,
                awardedDate: row.awardedDate || row.dateCompleted,
              })
              badgeCount++
            }
          }
          break
        }

        case 'rank_requirement': {
          // Only process if has a completion date or is approved
          if (row.dateCompleted || row.approved) {
            const reqNumber = row.advancement
            // Skip empty requirement numbers (header rows)
            if (!reqNumber) {
              skippedRows++
              break
            }
            const rankCode = classification.rankCode!
            // Check for duplicates
            const existing = scout.rankRequirements.find(
              (r) => r.rankCode === rankCode && r.requirementNumber === reqNumber
            )
            if (!existing) {
              scout.rankRequirements.push({
                rankCode,
                requirementNumber: reqNumber,
                version: row.version,
                completed: true,
                completedDate: row.dateCompleted || row.markedCompletedDate,
              })
              rankRequirementCount++
            }
          } else {
            skippedRows++
          }
          break
        }

        case 'merit_badge_requirement': {
          // Only process if has a completion date or is approved
          if (row.dateCompleted || row.approved) {
            const reqNumber = row.advancement
            // Skip empty requirement numbers (header rows)
            if (!reqNumber) {
              skippedRows++
              break
            }
            const badgeName = classification.badgeName!
            const normalizedName = normalizeBadgeName(badgeName)
            // Check for duplicates
            const existing = scout.meritBadgeRequirements.find(
              (r) => r.normalizedName === normalizedName && r.requirementNumber === reqNumber
            )
            if (!existing) {
              scout.meritBadgeRequirements.push({
                badgeName,
                normalizedName,
                requirementNumber: reqNumber,
                version: row.version,
                completed: true,
                completedDate: row.dateCompleted || row.markedCompletedDate,
              })
              badgeRequirementCount++
            }
          } else {
            skippedRows++
          }
          break
        }

        case 'other':
          // Skip awards, palms, etc.
          skippedRows++
          break
      }
    } catch (err) {
      errors.push(`Error parsing line ${i + 2}: ${err instanceof Error ? err.message : String(err)}`)
      skippedRows++
    }
  }

  return {
    scouts,
    summary: {
      totalRows,
      scoutCount: scouts.size,
      rankCount,
      rankRequirementCount,
      badgeCount,
      badgeRequirementCount,
      skippedRows,
    },
    errors,
  }
}

/**
 * Validate parsed data
 */
export function validateParsedData(data: ParsedTroopAdvancement): string[] {
  const errors: string[] = [...data.errors]

  if (data.scouts.size === 0) {
    errors.push('No scouts found in the file')
  }

  const totalItems =
    data.summary.rankCount +
    data.summary.rankRequirementCount +
    data.summary.badgeCount +
    data.summary.badgeRequirementCount

  if (totalItems === 0) {
    errors.push('No advancement data found in the file')
  }

  return errors
}

/**
 * Get a summary of parsed data for display
 */
export function getParsedDataSummary(data: ParsedTroopAdvancement): {
  scoutCount: number
  totalAdvancement: number
  ranks: number
  rankRequirements: number
  meritBadges: number
  meritBadgeRequirements: number
  errors: string[]
} {
  return {
    scoutCount: data.scouts.size,
    totalAdvancement:
      data.summary.rankCount +
      data.summary.rankRequirementCount +
      data.summary.badgeCount +
      data.summary.badgeRequirementCount,
    ranks: data.summary.rankCount,
    rankRequirements: data.summary.rankRequirementCount,
    meritBadges: data.summary.badgeCount,
    meritBadgeRequirements: data.summary.badgeRequirementCount,
    errors: data.errors,
  }
}
