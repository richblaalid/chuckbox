/**
 * Charge CSV Parser
 *
 * Parses CSV files containing billing charge data with flexible column mapping.
 * Reuses CSV parsing utilities from balance-csv-parser patterns.
 */

// ============================================
// Types
// ============================================

export interface ParsedChargeCSV {
  headers: string[]
  rows: string[][]
  errors: string[]
}

export interface ChargeColumnMapping {
  firstNameColumn?: number
  lastNameColumn?: number
  fullNameColumn?: number
  bsaMemberIdColumn?: number
  amountColumn?: number
  descriptionColumn?: number
  dateColumn?: number
  referenceColumn?: number
  memoColumn?: number
  defaultDescription?: string
  defaultDate?: string
}

export interface MappedChargeRow {
  lineNumber: number
  firstName?: string
  lastName?: string
  fullName?: string
  bsaMemberId?: string
  amount?: number
  description?: string
  date?: string
  reference?: string
  memo?: string
  rawValues: string[]
  errors: string[]
}

// ============================================
// CSV Parsing Utilities
// ============================================

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
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

function parseNumericValue(value: string): number | null {
  if (!value || value.trim() === '') return null

  let cleaned = value.trim()

  const isParenthesesNegative = cleaned.startsWith('(') && cleaned.endsWith(')')
  if (isParenthesesNegative) {
    cleaned = cleaned.slice(1, -1)
  }

  cleaned = cleaned.replace(/[$\s]/g, '')
  cleaned = cleaned.replace(/,/g, '')

  const num = parseFloat(cleaned)
  if (isNaN(num)) return null

  return isParenthesesNegative ? -num : num
}

function splitFullName(fullName: string): { firstName?: string; lastName?: string } {
  if (!fullName || fullName.trim() === '') return {}

  const name = fullName.trim()

  if (name.includes(',')) {
    const [lastName, ...rest] = name.split(',').map(s => s.trim())
    const firstName = rest.join(' ').trim()
    return { firstName: firstName || undefined, lastName: lastName || undefined }
  }

  const parts = name.split(/\s+/)
  if (parts.length === 1) {
    return { firstName: parts[0] }
  }

  const lastName = parts.pop()
  const firstName = parts.join(' ')

  return {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
  }
}

// ============================================
// Column Detection
// ============================================

function matchesPatterns(header: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(header.trim()))
}

const CHARGE_COLUMN_PATTERNS = {
  firstName: [
    /^first\s*name$/i,
    /^first$/i,
    /^first_name$/i,
    /^firstname$/i,
    /^given\s*name$/i,
  ],
  lastName: [
    /^last\s*name$/i,
    /^last$/i,
    /^last_name$/i,
    /^lastname$/i,
    /^surname$/i,
    /^family\s*name$/i,
  ],
  fullName: [
    /^name$/i,
    /^full\s*name$/i,
    /^fullname$/i,
    /^scout\s*name$/i,
    /^scout$/i,
  ],
  bsaMemberId: [
    /^bsa\s*id$/i,
    /^bsa\s*member\s*id$/i,
    /^member\s*id$/i,
    /^memberid$/i,
    /^member_id$/i,
    /^bsa\s*number$/i,
  ],
  amount: [
    /^amount$/i,
    /^charge$/i,
    /^fee$/i,
    /^cost$/i,
    /^price$/i,
    /^total$/i,
    /^dues$/i,
  ],
  description: [
    /^description$/i,
    /^reason$/i,
    /^item$/i,
    /^event$/i,
  ],
  date: [
    /^date$/i,
    /^billing\s*date$/i,
    /^charge\s*date$/i,
    /^due\s*date$/i,
  ],
  reference: [
    /^reference$/i,
    /^ref$/i,
    /^invoice$/i,
    /^invoice\s*number$/i,
    /^po$/i,
    /^po\s*number$/i,
  ],
  memo: [
    /^memo$/i,
    /^note$/i,
    /^notes$/i,
    /^comment$/i,
  ],
}

// ============================================
// Main Functions
// ============================================

export function parseChargeCSV(content: string): ParsedChargeCSV {
  if (!content || content.trim() === '') {
    return { headers: [], rows: [], errors: [] }
  }

  let cleanContent = content
  if (cleanContent.charCodeAt(0) === 0xFEFF) {
    cleanContent = cleanContent.slice(1)
  }

  const lines = cleanContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length === 0) {
    return { headers: [], rows: [], errors: [] }
  }

  let headerIndex = 0
  while (headerIndex < lines.length) {
    const parsed = parseCSVLine(lines[headerIndex])
    if (parsed.some(cell => cell.trim().length > 0)) break
    headerIndex++
  }

  if (headerIndex >= lines.length) {
    return { headers: [], rows: [], errors: [] }
  }

  const headers = parseCSVLine(lines[headerIndex])
  const rows = lines.slice(headerIndex + 1)
    .map(line => parseCSVLine(line))
    .filter(row => row.some(cell => cell.trim().length > 0))

  return { headers, rows, errors: [] }
}

export function autoDetectChargeColumns(headers: string[]): ChargeColumnMapping {
  const mapping: ChargeColumnMapping = {}

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]

    if (matchesPatterns(header, CHARGE_COLUMN_PATTERNS.firstName)) {
      mapping.firstNameColumn = i
    } else if (matchesPatterns(header, CHARGE_COLUMN_PATTERNS.lastName)) {
      mapping.lastNameColumn = i
    } else if (matchesPatterns(header, CHARGE_COLUMN_PATTERNS.fullName)) {
      mapping.fullNameColumn = i
    } else if (matchesPatterns(header, CHARGE_COLUMN_PATTERNS.bsaMemberId)) {
      mapping.bsaMemberIdColumn = i
    } else if (matchesPatterns(header, CHARGE_COLUMN_PATTERNS.amount)) {
      mapping.amountColumn = i
    } else if (matchesPatterns(header, CHARGE_COLUMN_PATTERNS.description)) {
      mapping.descriptionColumn = i
    } else if (matchesPatterns(header, CHARGE_COLUMN_PATTERNS.date)) {
      mapping.dateColumn = i
    } else if (matchesPatterns(header, CHARGE_COLUMN_PATTERNS.reference)) {
      mapping.referenceColumn = i
    } else if (matchesPatterns(header, CHARGE_COLUMN_PATTERNS.memo)) {
      mapping.memoColumn = i
    }
  }

  return mapping
}

export function applyChargeColumnMapping(
  csv: ParsedChargeCSV,
  mapping: ChargeColumnMapping
): MappedChargeRow[] {
  const results: MappedChargeRow[] = []

  for (let i = 0; i < csv.rows.length; i++) {
    const row = csv.rows[i]
    const errors: string[] = []
    const lineNumber = i + 2

    const mappedRow: MappedChargeRow = {
      lineNumber,
      rawValues: row,
      errors,
    }

    // Extract name fields
    if (mapping.firstNameColumn !== undefined) {
      mappedRow.firstName = row[mapping.firstNameColumn] || undefined
    }
    if (mapping.lastNameColumn !== undefined) {
      mappedRow.lastName = row[mapping.lastNameColumn] || undefined
    }
    if (mapping.fullNameColumn !== undefined) {
      const fullName = row[mapping.fullNameColumn]
      mappedRow.fullName = fullName || undefined
      if (fullName && mapping.firstNameColumn === undefined) {
        const { firstName, lastName } = splitFullName(fullName)
        mappedRow.firstName = firstName
        mappedRow.lastName = lastName
      }
    }

    // BSA Member ID
    if (mapping.bsaMemberIdColumn !== undefined) {
      mappedRow.bsaMemberId = row[mapping.bsaMemberIdColumn] || undefined
    }

    // Amount (required, must be positive)
    if (mapping.amountColumn !== undefined) {
      const rawValue = row[mapping.amountColumn]
      const parsed = parseNumericValue(rawValue)
      if (parsed !== null) {
        if (parsed <= 0) {
          errors.push(`Amount must be greater than zero: ${rawValue}`)
        } else {
          mappedRow.amount = parsed
        }
      } else if (rawValue && rawValue.trim() !== '') {
        errors.push(`Invalid amount format: ${rawValue}`)
      }
    }

    // Description (from column or default)
    if (mapping.descriptionColumn !== undefined) {
      mappedRow.description = row[mapping.descriptionColumn] || undefined
    }
    if (!mappedRow.description && mapping.defaultDescription) {
      mappedRow.description = mapping.defaultDescription
    }

    // Date (from column or default)
    if (mapping.dateColumn !== undefined) {
      mappedRow.date = row[mapping.dateColumn] || undefined
    }
    if (!mappedRow.date && mapping.defaultDate) {
      mappedRow.date = mapping.defaultDate
    }

    // Reference (optional)
    if (mapping.referenceColumn !== undefined) {
      mappedRow.reference = row[mapping.referenceColumn] || undefined
    }

    // Memo (optional)
    if (mapping.memoColumn !== undefined) {
      mappedRow.memo = row[mapping.memoColumn] || undefined
    }

    results.push(mappedRow)
  }

  return results
}

export function validateChargeMapping(mapping: ChargeColumnMapping): string[] {
  const errors: string[] = []

  const hasIdentificationColumn =
    mapping.firstNameColumn !== undefined ||
    mapping.lastNameColumn !== undefined ||
    mapping.fullNameColumn !== undefined ||
    mapping.bsaMemberIdColumn !== undefined

  if (!hasIdentificationColumn) {
    errors.push('A scout identification column is required (name or BSA Member ID)')
  }

  if (mapping.amountColumn === undefined) {
    errors.push('An amount column is required')
  }

  return errors
}
