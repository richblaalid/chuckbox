/**
 * Balance CSV Parser
 *
 * Parses CSV files containing scout account balance data with flexible column mapping.
 * Supports various formats: currency symbols, parentheses for negatives, comma separators.
 */

// ============================================
// Types
// ============================================

export interface ParsedBalanceCSV {
  headers: string[]
  rows: string[][]
  errors: string[]
}

export interface ColumnMapping {
  firstNameColumn?: number
  lastNameColumn?: number
  fullNameColumn?: number
  bsaMemberIdColumn?: number
  billingBalanceColumn?: number
  fundsBalanceColumn?: number
  singleBalanceColumn?: number
  positiveBalanceMeaning?: 'credit' | 'owes'
}

export interface MappedBalanceRow {
  lineNumber: number
  firstName?: string
  lastName?: string
  fullName?: string
  bsaMemberId?: string
  billingBalance?: number
  fundsBalance?: number
  rawValues: string[]
  errors: string[]
}

// ============================================
// CSV Parsing Utilities
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
 * Parse a numeric value from various formats:
 * - Currency symbols: $50.00, -$50.00
 * - Parentheses for negative: (50.00)
 * - Comma separators: 1,234.56
 * Returns null if parsing fails
 */
function parseNumericValue(value: string): number | null {
  if (!value || value.trim() === '') return null

  let cleaned = value.trim()

  // Check for parentheses (indicates negative)
  const isParenthesesNegative = cleaned.startsWith('(') && cleaned.endsWith(')')
  if (isParenthesesNegative) {
    cleaned = cleaned.slice(1, -1)
  }

  // Remove currency symbols and whitespace
  cleaned = cleaned.replace(/[$\s]/g, '')

  // Remove comma separators
  cleaned = cleaned.replace(/,/g, '')

  // Parse the number
  const num = parseFloat(cleaned)
  if (isNaN(num)) return null

  // Apply negative from parentheses
  return isParenthesesNegative ? -num : num
}

/**
 * Split a full name into first and last name components.
 * Handles "First Last", "First Middle Last", and "Last, First" formats.
 */
function splitFullName(fullName: string): { firstName?: string; lastName?: string } {
  if (!fullName || fullName.trim() === '') {
    return {}
  }

  const name = fullName.trim()

  // Check for "Last, First" format
  if (name.includes(',')) {
    const [lastName, ...rest] = name.split(',').map(s => s.trim())
    const firstName = rest.join(' ').trim()
    return { firstName: firstName || undefined, lastName: lastName || undefined }
  }

  // Handle "First Last" or "First Middle Last" format
  const parts = name.split(/\s+/)
  if (parts.length === 1) {
    // Single name - treat as first name
    return { firstName: parts[0] }
  }

  // Last part is last name, everything else is first name
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

/**
 * Patterns for detecting column types (case-insensitive)
 */
const COLUMN_PATTERNS = {
  firstName: [
    /^first\s*name$/i,
    /^first$/i,
    /^first_name$/i,
    /^firstname$/i,
  ],
  lastName: [
    /^last\s*name$/i,
    /^last$/i,
    /^last_name$/i,
    /^lastname$/i,
    /^surname$/i,
  ],
  fullName: [
    /^name$/i,
    /^full\s*name$/i,
    /^fullname$/i,
    /^scout\s*name$/i,
    /^student\s*name$/i,
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
  billingBalance: [
    /^billing\s*balance$/i,
    /^amount\s*owed$/i,
    /^owed$/i,
    /^due$/i,
    /^amount\s*due$/i,
    /^charges$/i,
  ],
  fundsBalance: [
    /^funds\s*balance$/i,
    /^credits$/i,
    /^credit$/i,
    /^scout\s*funds$/i,
    /^available\s*funds$/i,
  ],
  singleBalance: [
    /^balance$/i,
    /^amount$/i,
    /^total$/i,
    /^current\s*balance$/i,
  ],
}

/**
 * Check if a header matches any pattern in a list
 */
function matchesPatterns(header: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(header.trim()))
}

// ============================================
// Main Functions
// ============================================

/**
 * Parse raw CSV content into headers and rows
 */
export function parseBalanceCSV(content: string): ParsedBalanceCSV {
  if (!content || content.trim() === '') {
    return { headers: [], rows: [], errors: [] }
  }

  // Remove BOM (Byte Order Mark) if present - common in Excel/Google Sheets exports
  let cleanContent = content
  if (cleanContent.charCodeAt(0) === 0xFEFF) {
    cleanContent = cleanContent.slice(1)
  }

  // Normalize line endings and split
  const lines = cleanContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length === 0) {
    return { headers: [], rows: [], errors: [] }
  }

  // Find the first non-empty row (skip rows with only commas/whitespace)
  let headerIndex = 0
  while (headerIndex < lines.length) {
    const parsed = parseCSVLine(lines[headerIndex])
    // Check if any cell has meaningful content
    const hasMeaningfulContent = parsed.some(cell => cell.trim().length > 0)
    if (hasMeaningfulContent) {
      break
    }
    headerIndex++
  }

  if (headerIndex >= lines.length) {
    return { headers: [], rows: [], errors: [] }
  }

  const headers = parseCSVLine(lines[headerIndex])
  const rows = lines.slice(headerIndex + 1)
    .map(line => parseCSVLine(line))
    // Also filter out empty data rows
    .filter(row => row.some(cell => cell.trim().length > 0))

  return { headers, rows, errors: [] }
}

/**
 * Auto-detect column mappings from header names
 */
export function autoDetectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]

    if (matchesPatterns(header, COLUMN_PATTERNS.firstName)) {
      mapping.firstNameColumn = i
    } else if (matchesPatterns(header, COLUMN_PATTERNS.lastName)) {
      mapping.lastNameColumn = i
    } else if (matchesPatterns(header, COLUMN_PATTERNS.fullName)) {
      mapping.fullNameColumn = i
    } else if (matchesPatterns(header, COLUMN_PATTERNS.bsaMemberId)) {
      mapping.bsaMemberIdColumn = i
    } else if (matchesPatterns(header, COLUMN_PATTERNS.billingBalance)) {
      mapping.billingBalanceColumn = i
    } else if (matchesPatterns(header, COLUMN_PATTERNS.fundsBalance)) {
      mapping.fundsBalanceColumn = i
    } else if (matchesPatterns(header, COLUMN_PATTERNS.singleBalance)) {
      // Only set single balance if no specific balance columns are detected
      if (mapping.billingBalanceColumn === undefined && mapping.fundsBalanceColumn === undefined) {
        mapping.singleBalanceColumn = i
      }
    }
  }

  // If specific balance columns were detected, clear the single balance column
  if (mapping.billingBalanceColumn !== undefined || mapping.fundsBalanceColumn !== undefined) {
    delete mapping.singleBalanceColumn
  }

  return mapping
}

/**
 * Apply column mapping to parsed CSV data to produce mapped rows
 */
export function applyColumnMapping(
  csv: ParsedBalanceCSV,
  mapping: ColumnMapping
): MappedBalanceRow[] {
  const results: MappedBalanceRow[] = []

  for (let i = 0; i < csv.rows.length; i++) {
    const row = csv.rows[i]
    const errors: string[] = []
    const lineNumber = i + 2 // +1 for header, +1 for 1-based indexing

    const mappedRow: MappedBalanceRow = {
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
      // Also split into first/last if not separately provided
      if (fullName && mapping.firstNameColumn === undefined) {
        const { firstName, lastName } = splitFullName(fullName)
        mappedRow.firstName = firstName
        mappedRow.lastName = lastName
      }
    }

    // Extract BSA member ID
    if (mapping.bsaMemberIdColumn !== undefined) {
      mappedRow.bsaMemberId = row[mapping.bsaMemberIdColumn] || undefined
    }

    // Handle balance columns
    if (mapping.billingBalanceColumn !== undefined) {
      const rawValue = row[mapping.billingBalanceColumn]
      const parsed = parseNumericValue(rawValue)
      if (parsed !== null) {
        // Billing balance should be stored as negative (owes money)
        mappedRow.billingBalance = parsed > 0 ? -parsed : parsed
      } else if (rawValue && rawValue.trim() !== '') {
        errors.push(`Invalid billing balance format: ${rawValue}`)
      }
    }

    if (mapping.fundsBalanceColumn !== undefined) {
      const rawValue = row[mapping.fundsBalanceColumn]
      const parsed = parseNumericValue(rawValue)
      if (parsed !== null) {
        mappedRow.fundsBalance = parsed
      } else if (rawValue && rawValue.trim() !== '') {
        errors.push(`Invalid funds balance format: ${rawValue}`)
      }
    }

    if (mapping.singleBalanceColumn !== undefined) {
      const rawValue = row[mapping.singleBalanceColumn]
      const parsed = parseNumericValue(rawValue)

      if (parsed !== null) {
        // Apply sign convention
        if (mapping.positiveBalanceMeaning === 'credit') {
          // Positive = has credit/funds, negative = owes money
          if (parsed >= 0) {
            mappedRow.fundsBalance = parsed
          } else {
            mappedRow.billingBalance = parsed
          }
        } else if (mapping.positiveBalanceMeaning === 'owes') {
          // Positive = owes money (store as negative billing), negative = has credit
          if (parsed >= 0) {
            mappedRow.billingBalance = -parsed
          } else {
            mappedRow.fundsBalance = -parsed
          }
        }
      } else if (rawValue && rawValue.trim() !== '') {
        errors.push(`Invalid balance format: ${rawValue}`)
      }
    }

    results.push(mappedRow)
  }

  return results
}

/**
 * Validate a column mapping configuration
 * Returns array of error messages (empty if valid)
 */
export function validateMapping(mapping: ColumnMapping): string[] {
  const errors: string[] = []

  // Check for name column
  const hasNameColumn =
    mapping.firstNameColumn !== undefined ||
    mapping.lastNameColumn !== undefined ||
    mapping.fullNameColumn !== undefined

  if (!hasNameColumn) {
    errors.push('A name column is required (first/last name or full name)')
  }

  // Check for balance column
  const hasBalanceColumn =
    mapping.billingBalanceColumn !== undefined ||
    mapping.fundsBalanceColumn !== undefined ||
    mapping.singleBalanceColumn !== undefined

  if (!hasBalanceColumn) {
    errors.push('At least one balance column is required')
  }

  // Check sign convention for single balance column
  if (mapping.singleBalanceColumn !== undefined && !mapping.positiveBalanceMeaning) {
    errors.push('Sign convention is required when using a single balance column')
  }

  return errors
}
