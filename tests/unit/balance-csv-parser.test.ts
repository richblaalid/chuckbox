import { describe, it, expect } from 'vitest'
import {
  parseBalanceCSV,
  autoDetectColumns,
  applyColumnMapping,
  validateMapping,
  type ColumnMapping,
} from '@/lib/import/balance-csv-parser'

describe('parseBalanceCSV', () => {
  it('parses CSV with headers', () => {
    const csv = `First Name,Last Name,Balance
John,Doe,-50.00
Jane,Smith,25.00`

    const result = parseBalanceCSV(csv)

    expect(result.headers).toEqual(['First Name', 'Last Name', 'Balance'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual(['John', 'Doe', '-50.00'])
    expect(result.rows[1]).toEqual(['Jane', 'Smith', '25.00'])
  })

  it('handles quoted fields with commas', () => {
    const csv = `Name,Balance
"Smith, John",-100.00`

    const result = parseBalanceCSV(csv)
    expect(result.rows[0][0]).toBe('Smith, John')
  })

  it('handles escaped quotes in quoted fields', () => {
    const csv = `Name,Balance
"John ""JJ"" Smith",50.00`

    const result = parseBalanceCSV(csv)
    expect(result.rows[0][0]).toBe('John "JJ" Smith')
  })

  it('returns empty rows for empty file', () => {
    const result = parseBalanceCSV('')
    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('handles header-only file', () => {
    const csv = 'Name,Balance'
    const result = parseBalanceCSV(csv)
    expect(result.headers).toEqual(['Name', 'Balance'])
    expect(result.rows).toEqual([])
  })

  it('handles Windows line endings (CRLF)', () => {
    const csv = 'Name,Balance\r\nJohn,100\r\nJane,200'
    const result = parseBalanceCSV(csv)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual(['John', '100'])
  })

  it('handles mixed content with empty cells', () => {
    const csv = `First,Last,Balance
John,,50
,Smith,25`

    const result = parseBalanceCSV(csv)
    expect(result.rows[0]).toEqual(['John', '', '50'])
    expect(result.rows[1]).toEqual(['', 'Smith', '25'])
  })
})

describe('autoDetectColumns', () => {
  it('detects common first name column names', () => {
    const variants = ['First Name', 'first_name', 'FirstName', 'First', 'FIRST NAME']
    for (const name of variants) {
      const mapping = autoDetectColumns([name, 'Last', 'Balance'])
      expect(mapping.firstNameColumn).toBe(0)
    }
  })

  it('detects common last name column names', () => {
    const variants = ['Last Name', 'last_name', 'LastName', 'Last', 'LAST NAME', 'Surname']
    for (const name of variants) {
      const mapping = autoDetectColumns(['First', name, 'Balance'])
      expect(mapping.lastNameColumn).toBe(1)
    }
  })

  it('detects full name column', () => {
    const variants = ['Name', 'Full Name', 'FullName', 'Scout Name', 'Student Name', 'Scout']
    for (const name of variants) {
      const mapping = autoDetectColumns([name, 'Balance'])
      expect(mapping.fullNameColumn).toBe(0)
    }
  })

  it('detects BSA member ID column', () => {
    const variants = ['BSA ID', 'BSA Member ID', 'Member ID', 'BSA Number', 'MemberID', 'Member_ID']
    for (const name of variants) {
      const mapping = autoDetectColumns(['Name', name, 'Balance'])
      expect(mapping.bsaMemberIdColumn).toBe(1)
    }
  })

  it('detects billing balance column', () => {
    const variants = ['Billing Balance', 'Amount Owed', 'Owed', 'Due', 'Amount Due', 'Charges']
    for (const name of variants) {
      const mapping = autoDetectColumns(['Name', name])
      expect(mapping.billingBalanceColumn).toBe(1)
    }
  })

  it('detects funds balance column', () => {
    const variants = ['Funds Balance', 'Credits', 'Credit', 'Scout Funds', 'Available Funds']
    for (const name of variants) {
      const mapping = autoDetectColumns(['Name', name])
      expect(mapping.fundsBalanceColumn).toBe(1)
    }
  })

  it('detects single generic balance column', () => {
    const variants = ['Balance', 'Amount', 'Total', 'Current Balance']
    for (const name of variants) {
      const mapping = autoDetectColumns(['Name', name])
      expect(mapping.singleBalanceColumn).toBe(1)
    }
  })

  it('auto-detects typical finance workbook format', () => {
    // Test format: Member_ID, Scout, Current Balance
    const mapping = autoDetectColumns(['Member_ID', 'Scout', 'Current Balance'])
    expect(mapping.bsaMemberIdColumn).toBe(0)
    expect(mapping.fullNameColumn).toBe(1)
    expect(mapping.singleBalanceColumn).toBe(2)
  })

  it('prioritizes specific balance columns over generic', () => {
    const mapping = autoDetectColumns(['Name', 'Billing Balance', 'Funds Balance', 'Balance'])
    expect(mapping.billingBalanceColumn).toBe(1)
    expect(mapping.fundsBalanceColumn).toBe(2)
    // Single balance column should not be set when specific ones are detected
    expect(mapping.singleBalanceColumn).toBeUndefined()
  })

  it('returns empty mapping for unrecognized headers', () => {
    const mapping = autoDetectColumns(['Column1', 'Column2', 'Column3'])
    expect(mapping.firstNameColumn).toBeUndefined()
    expect(mapping.lastNameColumn).toBeUndefined()
    expect(mapping.singleBalanceColumn).toBeUndefined()
  })
})

describe('applyColumnMapping', () => {
  it('maps basic columns correctly', () => {
    const csv = {
      headers: ['First Name', 'Last Name', 'Balance'],
      rows: [['John', 'Doe', '-50.00']],
      errors: [],
    }
    const mapping: ColumnMapping = {
      firstNameColumn: 0,
      lastNameColumn: 1,
      singleBalanceColumn: 2,
      positiveBalanceMeaning: 'credit',
    }

    const result = applyColumnMapping(csv, mapping)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].lineNumber).toBe(2) // Line 1 is header
  })

  it('parses currency symbols from amounts', () => {
    const csv = {
      headers: ['Name', 'Balance'],
      rows: [['John Doe', '$-50.00']],
      errors: [],
    }
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const result = applyColumnMapping(csv, mapping)
    expect(result[0].billingBalance).toBe(-50.00)
  })

  it('parses parentheses as negative', () => {
    const csv = {
      headers: ['Name', 'Balance'],
      rows: [['John Doe', '(50.00)']],
      errors: [],
    }
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const result = applyColumnMapping(csv, mapping)
    expect(result[0].billingBalance).toBe(-50.00)
  })

  it('handles comma-separated numbers', () => {
    const csv = {
      headers: ['Name', 'Balance'],
      rows: [['John Doe', '1,234.56']],
      errors: [],
    }
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const result = applyColumnMapping(csv, mapping)
    expect(result[0].fundsBalance).toBe(1234.56)
  })

  it('splits full name into first and last', () => {
    const csv = {
      headers: ['Name', 'Balance'],
      rows: [
        ['John Doe', '50'],
        ['Mary Jane Watson', '25'],
        ['Cher', '100'], // Single name
      ],
      errors: [],
    }
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const result = applyColumnMapping(csv, mapping)

    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[1].firstName).toBe('Mary Jane')
    expect(result[1].lastName).toBe('Watson')
    expect(result[2].firstName).toBe('Cher')
    expect(result[2].lastName).toBeUndefined()
  })

  it('splits "Last, First" format', () => {
    const csv = {
      headers: ['Name', 'Balance'],
      rows: [['Doe, John', '50']],
      errors: [],
    }
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const result = applyColumnMapping(csv, mapping)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
  })

  describe('single balance column with credit/owes convention', () => {
    it('credit convention: positive goes to funds, negative to billing', () => {
      const csv = {
        headers: ['Name', 'Balance'],
        rows: [
          ['John', '100'], // Positive = has credit/funds
          ['Jane', '-50'], // Negative = owes money
        ],
        errors: [],
      }
      const mapping: ColumnMapping = {
        fullNameColumn: 0,
        singleBalanceColumn: 1,
        positiveBalanceMeaning: 'credit',
      }

      const result = applyColumnMapping(csv, mapping)

      expect(result[0].fundsBalance).toBe(100)
      expect(result[0].billingBalance).toBeUndefined()
      expect(result[1].billingBalance).toBe(-50)
      expect(result[1].fundsBalance).toBeUndefined()
    })

    it('owes convention: positive becomes negative billing, negative goes to funds', () => {
      const csv = {
        headers: ['Name', 'Balance'],
        rows: [
          ['John', '100'], // Positive = owes money
          ['Jane', '-50'], // Negative = has credit
        ],
        errors: [],
      }
      const mapping: ColumnMapping = {
        fullNameColumn: 0,
        singleBalanceColumn: 1,
        positiveBalanceMeaning: 'owes',
      }

      const result = applyColumnMapping(csv, mapping)

      expect(result[0].billingBalance).toBe(-100)
      expect(result[0].fundsBalance).toBeUndefined()
      expect(result[1].fundsBalance).toBe(50)
      expect(result[1].billingBalance).toBeUndefined()
    })
  })

  it('maps separate billing and funds columns', () => {
    const csv = {
      headers: ['Name', 'Owed', 'Credit'],
      rows: [['John', '50', '25']],
      errors: [],
    }
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      billingBalanceColumn: 1,
      fundsBalanceColumn: 2,
    }

    const result = applyColumnMapping(csv, mapping)

    // Billing balance should be stored as negative (owes money)
    expect(result[0].billingBalance).toBe(-50)
    expect(result[0].fundsBalance).toBe(25)
  })

  it('maps BSA member ID', () => {
    const csv = {
      headers: ['Name', 'BSA ID', 'Balance'],
      rows: [['John', '123456789', '50']],
      errors: [],
    }
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      bsaMemberIdColumn: 1,
      singleBalanceColumn: 2,
      positiveBalanceMeaning: 'credit',
    }

    const result = applyColumnMapping(csv, mapping)
    expect(result[0].bsaMemberId).toBe('123456789')
  })

  it('adds error for invalid number format', () => {
    const csv = {
      headers: ['Name', 'Balance'],
      rows: [['John', 'not-a-number']],
      errors: [],
    }
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const result = applyColumnMapping(csv, mapping)
    expect(result[0].errors).toContain('Invalid balance format: not-a-number')
  })

  it('preserves raw values', () => {
    const csv = {
      headers: ['Name', 'Balance'],
      rows: [['John Doe', '$50.00']],
      errors: [],
    }
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const result = applyColumnMapping(csv, mapping)
    expect(result[0].rawValues).toEqual(['John Doe', '$50.00'])
  })
})

describe('validateMapping', () => {
  it('returns error if no name column is mapped', () => {
    const mapping: ColumnMapping = {
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const errors = validateMapping(mapping)
    expect(errors).toContain('A name column is required (first/last name or full name)')
  })

  it('returns error if no balance column is mapped', () => {
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
    }

    const errors = validateMapping(mapping)
    expect(errors).toContain('At least one balance column is required')
  })

  it('returns error if single balance without sign convention', () => {
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      // Missing positiveBalanceMeaning
    }

    const errors = validateMapping(mapping)
    expect(errors).toContain('Sign convention is required when using a single balance column')
  })

  it('returns no errors for valid mapping with first/last name', () => {
    const mapping: ColumnMapping = {
      firstNameColumn: 0,
      lastNameColumn: 1,
      billingBalanceColumn: 2,
    }

    const errors = validateMapping(mapping)
    expect(errors).toEqual([])
  })

  it('returns no errors for valid mapping with full name', () => {
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const errors = validateMapping(mapping)
    expect(errors).toEqual([])
  })

  it('returns no errors for valid mapping with both balance columns', () => {
    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      billingBalanceColumn: 1,
      fundsBalanceColumn: 2,
    }

    const errors = validateMapping(mapping)
    expect(errors).toEqual([])
  })
})
