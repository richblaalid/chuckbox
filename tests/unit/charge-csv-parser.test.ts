import { describe, it, expect } from 'vitest'
import {
  parseChargeCSV,
  autoDetectChargeColumns,
  applyChargeColumnMapping,
  validateChargeMapping,
  type ChargeColumnMapping,
} from '@/lib/import/charge-csv-parser'

describe('parseChargeCSV', () => {
  it('parses CSV with headers and data rows', () => {
    const csv = `First Name,Last Name,Amount,Description,Date
John,Doe,350.00,Summer Camp 2026,2026-06-15
Jane,Smith,275.00,Summer Camp Early Bird,2026-06-15`

    const result = parseChargeCSV(csv)

    expect(result.headers).toEqual(['First Name', 'Last Name', 'Amount', 'Description', 'Date'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual(['John', 'Doe', '350.00', 'Summer Camp 2026', '2026-06-15'])
  })

  it('handles empty content', () => {
    const result = parseChargeCSV('')
    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
  })

  it('handles quoted fields with commas', () => {
    const csv = `Name,Amount,Description
"Smith, John",350.00,"Camp fee, includes meals"`

    const result = parseChargeCSV(csv)
    expect(result.rows[0][0]).toBe('Smith, John')
    expect(result.rows[0][2]).toBe('Camp fee, includes meals')
  })

  it('handles BOM character', () => {
    const csv = '\uFEFFFirst Name,Last Name,Amount\nJohn,Doe,100'
    const result = parseChargeCSV(csv)
    expect(result.headers[0]).toBe('First Name')
  })

  it('handles Windows line endings', () => {
    const csv = 'Name,Amount\r\nJohn,100\r\nJane,200'
    const result = parseChargeCSV(csv)
    expect(result.rows).toHaveLength(2)
  })

  it('skips empty rows', () => {
    const csv = `Name,Amount
John,100

Jane,200
`
    const result = parseChargeCSV(csv)
    expect(result.rows).toHaveLength(2)
  })
})

describe('autoDetectChargeColumns', () => {
  it('detects standard column names', () => {
    const mapping = autoDetectChargeColumns([
      'First Name', 'Last Name', 'Amount', 'Description', 'Date',
    ])

    expect(mapping.firstNameColumn).toBe(0)
    expect(mapping.lastNameColumn).toBe(1)
    expect(mapping.amountColumn).toBe(2)
    expect(mapping.descriptionColumn).toBe(3)
    expect(mapping.dateColumn).toBe(4)
  })

  it('detects alternate column names', () => {
    const mapping = autoDetectChargeColumns([
      'Scout Name', 'Fee', 'Memo', 'Billing Date',
    ])

    expect(mapping.fullNameColumn).toBe(0)
    expect(mapping.amountColumn).toBe(1)
    expect(mapping.memoColumn).toBe(2)
    expect(mapping.dateColumn).toBe(3)
  })

  it('detects BSA ID column', () => {
    const mapping = autoDetectChargeColumns([
      'BSA Member ID', 'Amount',
    ])

    expect(mapping.bsaMemberIdColumn).toBe(0)
    expect(mapping.amountColumn).toBe(1)
  })

  it('detects reference column', () => {
    const mapping = autoDetectChargeColumns([
      'Name', 'Amount', 'Invoice Number',
    ])

    expect(mapping.referenceColumn).toBe(2)
  })

  it('detects cost/price/dues as amount', () => {
    expect(autoDetectChargeColumns(['Name', 'Cost']).amountColumn).toBe(1)
    expect(autoDetectChargeColumns(['Name', 'Price']).amountColumn).toBe(1)
    expect(autoDetectChargeColumns(['Name', 'Dues']).amountColumn).toBe(1)
    expect(autoDetectChargeColumns(['Name', 'Total']).amountColumn).toBe(1)
    expect(autoDetectChargeColumns(['Name', 'Charge']).amountColumn).toBe(1)
  })

  it('returns empty mapping for unrecognized headers', () => {
    const mapping = autoDetectChargeColumns(['Column A', 'Column B'])
    expect(mapping.firstNameColumn).toBeUndefined()
    expect(mapping.amountColumn).toBeUndefined()
  })
})

describe('applyChargeColumnMapping', () => {
  it('maps columns to charge rows', () => {
    const csv = {
      headers: ['First Name', 'Last Name', 'Amount', 'Description', 'Date'],
      rows: [['John', 'Doe', '350.00', 'Summer Camp', '2026-06-15']],
      errors: [],
    }
    const mapping: ChargeColumnMapping = {
      firstNameColumn: 0,
      lastNameColumn: 1,
      amountColumn: 2,
      descriptionColumn: 3,
      dateColumn: 4,
    }

    const result = applyChargeColumnMapping(csv, mapping)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].amount).toBe(350)
    expect(result[0].description).toBe('Summer Camp')
    expect(result[0].date).toBe('2026-06-15')
  })

  it('handles currency symbols in amounts', () => {
    const csv = {
      headers: ['Name', 'Amount'],
      rows: [['John Doe', '$1,234.56']],
      errors: [],
    }
    const mapping: ChargeColumnMapping = {
      fullNameColumn: 0,
      amountColumn: 1,
    }

    const result = applyChargeColumnMapping(csv, mapping)
    expect(result[0].amount).toBe(1234.56)
  })

  it('splits full name into first and last', () => {
    const csv = {
      headers: ['Name', 'Amount'],
      rows: [['John Doe', '100']],
      errors: [],
    }
    const mapping: ChargeColumnMapping = {
      fullNameColumn: 0,
      amountColumn: 1,
    }

    const result = applyChargeColumnMapping(csv, mapping)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
  })

  it('handles "Last, First" name format', () => {
    const csv = {
      headers: ['Name', 'Amount'],
      rows: [['Doe, John', '100']],
      errors: [],
    }
    const mapping: ChargeColumnMapping = {
      fullNameColumn: 0,
      amountColumn: 1,
    }

    const result = applyChargeColumnMapping(csv, mapping)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
  })

  it('records errors for invalid amounts', () => {
    const csv = {
      headers: ['Name', 'Amount'],
      rows: [['John Doe', 'not-a-number']],
      errors: [],
    }
    const mapping: ChargeColumnMapping = {
      fullNameColumn: 0,
      amountColumn: 1,
    }

    const result = applyChargeColumnMapping(csv, mapping)
    expect(result[0].errors).toHaveLength(1)
    expect(result[0].errors[0]).toContain('Invalid amount')
  })

  it('records errors for zero or negative amounts', () => {
    const csv = {
      headers: ['Name', 'Amount'],
      rows: [
        ['John Doe', '0'],
        ['Jane Doe', '-50'],
      ],
      errors: [],
    }
    const mapping: ChargeColumnMapping = {
      fullNameColumn: 0,
      amountColumn: 1,
    }

    const result = applyChargeColumnMapping(csv, mapping)
    expect(result[0].errors).toHaveLength(1)
    expect(result[0].errors[0]).toContain('must be greater than zero')
    expect(result[1].errors).toHaveLength(1)
    expect(result[1].errors[0]).toContain('must be greater than zero')
  })

  it('maps optional fields: reference and memo', () => {
    const csv = {
      headers: ['Name', 'Amount', 'Reference', 'Memo'],
      rows: [['John Doe', '100', 'INV-001', 'Early bird']],
      errors: [],
    }
    const mapping: ChargeColumnMapping = {
      fullNameColumn: 0,
      amountColumn: 1,
      referenceColumn: 2,
      memoColumn: 3,
    }

    const result = applyChargeColumnMapping(csv, mapping)
    expect(result[0].reference).toBe('INV-001')
    expect(result[0].memo).toBe('Early bird')
  })

  it('uses default description and date when not mapped', () => {
    const csv = {
      headers: ['Name', 'Amount'],
      rows: [['John Doe', '100']],
      errors: [],
    }
    const mapping: ChargeColumnMapping = {
      fullNameColumn: 0,
      amountColumn: 1,
      defaultDescription: 'Summer Camp 2026',
      defaultDate: '2026-06-15',
    }

    const result = applyChargeColumnMapping(csv, mapping)
    expect(result[0].description).toBe('Summer Camp 2026')
    expect(result[0].date).toBe('2026-06-15')
  })

  it('assigns line numbers starting at 2', () => {
    const csv = {
      headers: ['Name', 'Amount'],
      rows: [['John', '100'], ['Jane', '200']],
      errors: [],
    }
    const mapping: ChargeColumnMapping = {
      fullNameColumn: 0,
      amountColumn: 1,
    }

    const result = applyChargeColumnMapping(csv, mapping)
    expect(result[0].lineNumber).toBe(2)
    expect(result[1].lineNumber).toBe(3)
  })
})

describe('validateChargeMapping', () => {
  it('passes with name and amount columns', () => {
    const errors = validateChargeMapping({
      firstNameColumn: 0,
      lastNameColumn: 1,
      amountColumn: 2,
    })
    expect(errors).toEqual([])
  })

  it('passes with full name and amount', () => {
    const errors = validateChargeMapping({
      fullNameColumn: 0,
      amountColumn: 1,
    })
    expect(errors).toEqual([])
  })

  it('passes with BSA ID and amount (no name column)', () => {
    const errors = validateChargeMapping({
      bsaMemberIdColumn: 0,
      amountColumn: 1,
    })
    expect(errors).toEqual([])
  })

  it('fails without any identification column', () => {
    const errors = validateChargeMapping({
      amountColumn: 0,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('identification column')
  })

  it('fails without amount column', () => {
    const errors = validateChargeMapping({
      fullNameColumn: 0,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('amount column')
  })

  it('fails with no columns mapped', () => {
    const errors = validateChargeMapping({})
    expect(errors).toHaveLength(2)
  })
})
