# CSV Balance Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a flexible CSV import wizard that allows treasurers to upload scout account balances with column mapping, preview, and undo capability.

**Architecture:** A 4-step wizard component (Upload → Map → Preview → Confirm) with a new API endpoint for processing imports. Uses a `balance_import_batches` table to track imports for undo functionality. Creates journal entries for audit trail using the existing `journal_entry_type` enum (adding `beginning_balance` type).

**Tech Stack:** Next.js App Router, React Hook Form, Supabase RPC functions, existing CSV parsing patterns from roster import.

---

## Phase 0: Database Schema

### Task 0.1: Add balance_import journal entry type

**Files:**
- Create: `supabase/migrations/20260207000001_balance_import_schema.sql`

**Step 1: Write the migration**

```sql
-- Add new journal entry types for balance imports
ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'beginning_balance';
ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'balance_import_reversal';

-- Balance import batches table
CREATE TABLE balance_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    imported_by UUID NOT NULL REFERENCES profiles(id),
    mode TEXT NOT NULL CHECK (mode IN ('set', 'adjust')),
    row_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'undone')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    undone_at TIMESTAMPTZ,
    undone_by UUID REFERENCES profiles(id)
);

-- Add batch reference to journal_entries
ALTER TABLE journal_entries
ADD COLUMN balance_import_batch_id UUID REFERENCES balance_import_batches(id);

-- Index for finding batch entries
CREATE INDEX idx_journal_entries_balance_import_batch
ON journal_entries(balance_import_batch_id)
WHERE balance_import_batch_id IS NOT NULL;

-- RLS policies for balance_import_batches
ALTER TABLE balance_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their unit's import batches"
ON balance_import_batches FOR SELECT
USING (
    unit_id IN (
        SELECT unit_id FROM unit_memberships
        WHERE profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
        AND status = 'active'
    )
);

CREATE POLICY "Admin and treasurer can insert import batches"
ON balance_import_batches FOR INSERT
WITH CHECK (
    unit_id IN (
        SELECT unit_id FROM unit_memberships
        WHERE profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
        AND status = 'active'
        AND role IN ('admin', 'treasurer')
    )
);

CREATE POLICY "Admin and treasurer can update import batches"
ON balance_import_batches FOR UPDATE
USING (
    unit_id IN (
        SELECT unit_id FROM unit_memberships
        WHERE profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
        AND status = 'active'
        AND role IN ('admin', 'treasurer')
    )
);
```

**Step 2: Push migration to dev**

Run: `supabase link --project-ref feownmcpkfugkcivdoal && supabase db push`
Expected: Migration applied successfully

**Step 3: Regenerate types**

Run: `npx supabase gen types typescript --project-id feownmcpkfugkcivdoal > src/types/database.ts`
Expected: Types file updated with balance_import_batches table

**Step 4: Commit**

```bash
git add supabase/migrations/20260207000001_balance_import_schema.sql src/types/database.ts
git commit -m "feat(db): add balance_import_batches table and journal entry types"
```

---

## Phase 1: CSV Parser & Types

### Task 1.1: Create balance import types

**Files:**
- Create: `src/lib/import/balance-csv-parser.ts`

**Step 1: Write the failing test**

Create: `tests/unit/lib/import/balance-csv-parser.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  parseBalanceCSV,
  type BalanceCSVRow,
  type ColumnMapping
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
  })

  it('handles quoted fields with commas', () => {
    const csv = `Name,Balance
"Smith, John",-100.00`

    const result = parseBalanceCSV(csv)

    expect(result.rows[0][0]).toBe('Smith, John')
  })

  it('returns empty rows for empty file', () => {
    const result = parseBalanceCSV('')

    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `vitest run tests/unit/lib/import/balance-csv-parser.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create: `src/lib/import/balance-csv-parser.ts`

```typescript
/**
 * Balance CSV Parser
 *
 * Parses generic CSV files for balance imports with flexible column mapping.
 */

export interface BalanceCSVRow {
  values: string[]
  lineNumber: number
}

export interface ParsedBalanceCSV {
  headers: string[]
  rows: string[][]
  errors: string[]
}

export interface ColumnMapping {
  // Scout identification (one required)
  firstNameColumn?: number
  lastNameColumn?: number
  fullNameColumn?: number
  bsaMemberIdColumn?: number

  // Balance columns (at least one required)
  billingBalanceColumn?: number
  fundsBalanceColumn?: number
  singleBalanceColumn?: number

  // Sign convention for single balance column
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
 * Parse raw CSV content into headers and rows
 */
export function parseBalanceCSV(content: string): ParsedBalanceCSV {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  if (lines.length === 0) {
    return { headers: [], rows: [], errors: [] }
  }

  const headers = parseCSVLine(lines[0])
  const rows: string[][] = []
  const errors: string[] = []

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i])
      if (values.length > 0 && values.some(v => v.length > 0)) {
        rows.push(values)
      }
    } catch (err) {
      errors.push(`Error parsing line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { headers, rows, errors }
}

/**
 * Auto-detect column mappings based on header names
 */
export function autoDetectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}

  headers.forEach((header, index) => {
    const lower = header.toLowerCase()

    // Scout identification
    if (lower.includes('first') && lower.includes('name')) {
      mapping.firstNameColumn = index
    } else if (lower.includes('last') && lower.includes('name')) {
      mapping.lastNameColumn = index
    } else if (lower === 'name' || lower === 'full name' || lower === 'scout name') {
      mapping.fullNameColumn = index
    } else if (lower.includes('bsa') || lower.includes('member id') || lower.includes('memberid')) {
      mapping.bsaMemberIdColumn = index
    }

    // Balance columns
    if (lower.includes('billing') || lower.includes('owed') || lower.includes('due') || lower.includes('debt')) {
      mapping.billingBalanceColumn = index
    } else if (lower.includes('fund') || lower.includes('saving') || lower.includes('credit')) {
      mapping.fundsBalanceColumn = index
    } else if (lower === 'balance' || lower === 'amount') {
      mapping.singleBalanceColumn = index
    }
  })

  return mapping
}

/**
 * Parse a number from a string, handling currency formats
 */
function parseAmount(value: string): number | null {
  if (!value || value.trim() === '') return null

  // Remove currency symbols and commas
  const cleaned = value.replace(/[$,]/g, '').trim()

  // Handle parentheses for negative numbers: (50.00) -> -50.00
  const parenMatch = cleaned.match(/^\((.+)\)$/)
  if (parenMatch) {
    const num = parseFloat(parenMatch[1])
    return isNaN(num) ? null : -num
  }

  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

/**
 * Parse a full name into first and last name
 */
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' }
  }
  // Last word is last name, rest is first name
  const lastName = parts.pop() || ''
  const firstName = parts.join(' ')
  return { firstName, lastName }
}

/**
 * Apply column mapping to parsed CSV rows
 */
export function applyColumnMapping(
  csv: ParsedBalanceCSV,
  mapping: ColumnMapping
): MappedBalanceRow[] {
  return csv.rows.map((row, index) => {
    const result: MappedBalanceRow = {
      lineNumber: index + 2, // +2 because 1-indexed and header row
      rawValues: row,
      errors: [],
    }

    // Extract scout identification
    if (mapping.fullNameColumn !== undefined && row[mapping.fullNameColumn]) {
      const { firstName, lastName } = parseFullName(row[mapping.fullNameColumn])
      result.firstName = firstName
      result.lastName = lastName
      result.fullName = row[mapping.fullNameColumn]
    }
    if (mapping.firstNameColumn !== undefined) {
      result.firstName = row[mapping.firstNameColumn]
    }
    if (mapping.lastNameColumn !== undefined) {
      result.lastName = row[mapping.lastNameColumn]
    }
    if (mapping.bsaMemberIdColumn !== undefined) {
      result.bsaMemberId = row[mapping.bsaMemberIdColumn]
    }

    // Extract balances
    if (mapping.billingBalanceColumn !== undefined) {
      const amount = parseAmount(row[mapping.billingBalanceColumn])
      if (amount !== null) {
        result.billingBalance = amount
      } else if (row[mapping.billingBalanceColumn]?.trim()) {
        result.errors.push(`Invalid billing balance: "${row[mapping.billingBalanceColumn]}"`)
      }
    }

    if (mapping.fundsBalanceColumn !== undefined) {
      const amount = parseAmount(row[mapping.fundsBalanceColumn])
      if (amount !== null) {
        if (amount < 0) {
          result.errors.push('Funds balance cannot be negative')
        } else {
          result.fundsBalance = amount
        }
      } else if (row[mapping.fundsBalanceColumn]?.trim()) {
        result.errors.push(`Invalid funds balance: "${row[mapping.fundsBalanceColumn]}"`)
      }
    }

    // Handle single balance column with sign convention
    if (mapping.singleBalanceColumn !== undefined &&
        mapping.billingBalanceColumn === undefined &&
        mapping.fundsBalanceColumn === undefined) {
      const amount = parseAmount(row[mapping.singleBalanceColumn])
      if (amount !== null) {
        if (mapping.positiveBalanceMeaning === 'credit') {
          // Positive = funds (savings), Negative = billing (owes)
          if (amount >= 0) {
            result.fundsBalance = amount
            result.billingBalance = 0
          } else {
            result.billingBalance = amount
            result.fundsBalance = 0
          }
        } else {
          // Positive = owes (billing as negative), Negative = credit (funds)
          if (amount >= 0) {
            result.billingBalance = -amount
            result.fundsBalance = 0
          } else {
            result.fundsBalance = Math.abs(amount)
            result.billingBalance = 0
          }
        }
      } else if (row[mapping.singleBalanceColumn]?.trim()) {
        result.errors.push(`Invalid balance: "${row[mapping.singleBalanceColumn]}"`)
      }
    }

    return result
  })
}

/**
 * Validate that a mapping has required fields
 */
export function validateMapping(mapping: ColumnMapping): string[] {
  const errors: string[] = []

  // Must have scout identification
  const hasName = (mapping.firstNameColumn !== undefined && mapping.lastNameColumn !== undefined) ||
                  mapping.fullNameColumn !== undefined
  const hasBsaId = mapping.bsaMemberIdColumn !== undefined

  if (!hasName && !hasBsaId) {
    errors.push('Please map scout name columns (First Name + Last Name, or Full Name) or BSA Member ID')
  }

  // Must have at least one balance column
  const hasBalance = mapping.billingBalanceColumn !== undefined ||
                     mapping.fundsBalanceColumn !== undefined ||
                     mapping.singleBalanceColumn !== undefined

  if (!hasBalance) {
    errors.push('Please map at least one balance column')
  }

  // If single balance column, must have sign convention
  if (mapping.singleBalanceColumn !== undefined &&
      mapping.billingBalanceColumn === undefined &&
      mapping.fundsBalanceColumn === undefined &&
      mapping.positiveBalanceMeaning === undefined) {
    errors.push('Please specify what a positive balance means in your spreadsheet')
  }

  return errors
}
```

**Step 4: Run test to verify it passes**

Run: `vitest run tests/unit/lib/import/balance-csv-parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/import/balance-csv-parser.ts tests/unit/lib/import/balance-csv-parser.test.ts
git commit -m "feat: add CSV parser for balance imports with column mapping"
```

---

### Task 1.2: Add more parser tests

**Files:**
- Modify: `tests/unit/lib/import/balance-csv-parser.test.ts`

**Step 1: Add comprehensive tests**

```typescript
import { describe, it, expect } from 'vitest'
import {
  parseBalanceCSV,
  autoDetectColumns,
  applyColumnMapping,
  validateMapping,
  type ColumnMapping
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
  })

  it('handles quoted fields with commas', () => {
    const csv = `Name,Balance
"Smith, John",-100.00`

    const result = parseBalanceCSV(csv)

    expect(result.rows[0][0]).toBe('Smith, John')
  })

  it('returns empty rows for empty file', () => {
    const result = parseBalanceCSV('')

    expect(result.headers).toEqual([])
    expect(result.rows).toEqual([])
  })

  it('handles currency symbols', () => {
    const csv = `Name,Amount
John Doe,"$1,234.56"`

    const result = parseBalanceCSV(csv)
    expect(result.rows[0][1]).toBe('$1,234.56')
  })
})

describe('autoDetectColumns', () => {
  it('detects first/last name columns', () => {
    const headers = ['First Name', 'Last Name', 'Amount Owed']
    const mapping = autoDetectColumns(headers)

    expect(mapping.firstNameColumn).toBe(0)
    expect(mapping.lastNameColumn).toBe(1)
    expect(mapping.billingBalanceColumn).toBe(2)
  })

  it('detects BSA member ID column', () => {
    const headers = ['BSA Member ID', 'Balance']
    const mapping = autoDetectColumns(headers)

    expect(mapping.bsaMemberIdColumn).toBe(0)
    expect(mapping.singleBalanceColumn).toBe(1)
  })

  it('detects funds column', () => {
    const headers = ['Name', 'Scout Funds', 'Amount Due']
    const mapping = autoDetectColumns(headers)

    expect(mapping.fundsBalanceColumn).toBe(1)
    expect(mapping.billingBalanceColumn).toBe(2)
  })
})

describe('applyColumnMapping', () => {
  it('extracts values based on mapping', () => {
    const csv = parseBalanceCSV(`First,Last,Owed
John,Doe,-50.00`)

    const mapping: ColumnMapping = {
      firstNameColumn: 0,
      lastNameColumn: 1,
      billingBalanceColumn: 2,
    }

    const rows = applyColumnMapping(csv, mapping)

    expect(rows[0].firstName).toBe('John')
    expect(rows[0].lastName).toBe('Doe')
    expect(rows[0].billingBalance).toBe(-50)
  })

  it('parses full name into first/last', () => {
    const csv = parseBalanceCSV(`Scout Name,Balance
John Michael Doe,-25.00`)

    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      billingBalanceColumn: 1,
    }

    const rows = applyColumnMapping(csv, mapping)

    expect(rows[0].firstName).toBe('John Michael')
    expect(rows[0].lastName).toBe('Doe')
  })

  it('handles single balance with credit convention', () => {
    const csv = parseBalanceCSV(`Name,Balance
John Doe,50.00
Jane Smith,-25.00`)

    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'credit',
    }

    const rows = applyColumnMapping(csv, mapping)

    // Positive = funds
    expect(rows[0].fundsBalance).toBe(50)
    expect(rows[0].billingBalance).toBe(0)

    // Negative = billing
    expect(rows[1].billingBalance).toBe(-25)
    expect(rows[1].fundsBalance).toBe(0)
  })

  it('handles single balance with owes convention', () => {
    const csv = parseBalanceCSV(`Name,Balance
John Doe,50.00`)

    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      singleBalanceColumn: 1,
      positiveBalanceMeaning: 'owes',
    }

    const rows = applyColumnMapping(csv, mapping)

    // Positive "owes" = negative billing balance
    expect(rows[0].billingBalance).toBe(-50)
    expect(rows[0].fundsBalance).toBe(0)
  })

  it('parses currency formats', () => {
    const csv = parseBalanceCSV(`Name,Balance
Test,"$1,234.56"`)

    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      billingBalanceColumn: 1,
    }

    const rows = applyColumnMapping(csv, mapping)
    expect(rows[0].billingBalance).toBe(1234.56)
  })

  it('parses parentheses as negative', () => {
    const csv = parseBalanceCSV(`Name,Balance
Test,(50.00)`)

    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      billingBalanceColumn: 1,
    }

    const rows = applyColumnMapping(csv, mapping)
    expect(rows[0].billingBalance).toBe(-50)
  })

  it('reports error for negative funds balance', () => {
    const csv = parseBalanceCSV(`Name,Funds
Test,-25.00`)

    const mapping: ColumnMapping = {
      fullNameColumn: 0,
      fundsBalanceColumn: 1,
    }

    const rows = applyColumnMapping(csv, mapping)
    expect(rows[0].errors).toContain('Funds balance cannot be negative')
  })
})

describe('validateMapping', () => {
  it('requires scout identification', () => {
    const mapping: ColumnMapping = {
      billingBalanceColumn: 0,
    }

    const errors = validateMapping(mapping)
    expect(errors.some(e => e.includes('scout name'))).toBe(true)
  })

  it('requires at least one balance column', () => {
    const mapping: ColumnMapping = {
      firstNameColumn: 0,
      lastNameColumn: 1,
    }

    const errors = validateMapping(mapping)
    expect(errors.some(e => e.includes('balance column'))).toBe(true)
  })

  it('requires sign convention for single balance', () => {
    const mapping: ColumnMapping = {
      firstNameColumn: 0,
      lastNameColumn: 1,
      singleBalanceColumn: 2,
    }

    const errors = validateMapping(mapping)
    expect(errors.some(e => e.includes('positive balance means'))).toBe(true)
  })

  it('passes valid mapping', () => {
    const mapping: ColumnMapping = {
      firstNameColumn: 0,
      lastNameColumn: 1,
      billingBalanceColumn: 2,
    }

    const errors = validateMapping(mapping)
    expect(errors).toHaveLength(0)
  })
})
```

**Step 2: Run tests**

Run: `vitest run tests/unit/lib/import/balance-csv-parser.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/unit/lib/import/balance-csv-parser.test.ts
git commit -m "test: add comprehensive tests for balance CSV parser"
```

---

## Phase 2: API Endpoint

### Task 2.1: Create balance import API route

**Files:**
- Create: `src/app/api/import/balances/route.ts`

**Step 1: Write the API route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface BalanceImportRow {
  scoutId?: string  // If matched
  scoutAccountId?: string  // If matched
  firstName?: string
  lastName?: string
  bsaMemberId?: string
  billingBalance?: number
  fundsBalance?: number
  action: 'import' | 'skip' | 'manual_match'
  manualMatchScoutId?: string  // For manual matching
}

interface ImportRequest {
  mode: 'set' | 'adjust'
  rows: BalanceImportRow[]
}

interface ImportResult {
  success: boolean
  batchId?: string
  imported: number
  skipped: number
  errors: string[]
}

export async function POST(request: NextRequest): Promise<NextResponse<ImportResult>> {
  const supabase = await createClient()

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, errors: ['Unauthorized'] },
      { status: 401 }
    )
  }

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, errors: ['Profile not found'] },
      { status: 403 }
    )
  }

  // Get user's unit and verify admin/treasurer role
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, errors: ['Only admins and treasurers can import balances'] },
      { status: 403 }
    )
  }

  const unitId = membership.unit_id

  // Parse request body
  let data: ImportRequest
  try {
    data = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, errors: ['Invalid request body'] },
      { status: 400 }
    )
  }

  const { mode, rows } = data
  const importRows = rows.filter(r => r.action === 'import' || r.action === 'manual_match')

  if (importRows.length === 0) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: rows.length, errors: ['No rows to import'] },
      { status: 400 }
    )
  }

  const adminSupabase = createAdminClient()
  const errors: string[] = []
  let imported = 0
  const skipped = rows.filter(r => r.action === 'skip').length

  // Create import batch
  const { data: batch, error: batchError } = await adminSupabase
    .from('balance_import_batches')
    .insert({
      unit_id: unitId,
      imported_by: profile.id,
      mode,
      row_count: importRows.length,
      status: 'active',
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, errors: ['Failed to create import batch'] },
      { status: 500 }
    )
  }

  // Get system accounts for journal entries
  const { data: accounts } = await adminSupabase
    .from('accounts')
    .select('id, code')
    .eq('unit_id', unitId)
    .in('code', ['1100', '2100']) // Receivables and Scout Funds Liability

  const receivablesAccount = accounts?.find(a => a.code === '1100')
  const fundsLiabilityAccount = accounts?.find(a => a.code === '2100')

  if (!receivablesAccount || !fundsLiabilityAccount) {
    return NextResponse.json(
      { success: false, imported: 0, skipped: 0, errors: ['System accounts not found'] },
      { status: 500 }
    )
  }

  // Process each row
  for (const row of importRows) {
    try {
      // Determine scout account ID
      let scoutAccountId = row.scoutAccountId

      if (!scoutAccountId && row.action === 'manual_match' && row.manualMatchScoutId) {
        // Get account for manually matched scout
        const { data: account } = await adminSupabase
          .from('scout_accounts')
          .select('id')
          .eq('scout_id', row.manualMatchScoutId)
          .eq('unit_id', unitId)
          .single()

        scoutAccountId = account?.id
      }

      if (!scoutAccountId) {
        errors.push(`Could not find account for ${row.firstName} ${row.lastName}`)
        continue
      }

      // Get current balances
      const { data: currentAccount } = await adminSupabase
        .from('scout_accounts')
        .select('billing_balance, funds_balance, scout_id, scouts(first_name, last_name)')
        .eq('id', scoutAccountId)
        .single()

      if (!currentAccount) {
        errors.push(`Account not found: ${scoutAccountId}`)
        continue
      }

      const scout = currentAccount.scouts as { first_name: string; last_name: string } | null
      const scoutName = scout ? `${scout.first_name} ${scout.last_name}` : 'Unknown Scout'

      const currentBilling = currentAccount.billing_balance || 0
      const currentFunds = currentAccount.funds_balance || 0

      // Calculate new balances
      let newBilling: number
      let newFunds: number

      if (mode === 'set') {
        newBilling = row.billingBalance ?? currentBilling
        newFunds = row.fundsBalance ?? currentFunds
      } else {
        // Adjust mode
        newBilling = currentBilling + (row.billingBalance ?? 0)
        newFunds = currentFunds + (row.fundsBalance ?? 0)
      }

      // Ensure funds stays non-negative
      if (newFunds < 0) {
        errors.push(`${scoutName}: Funds balance cannot be negative`)
        continue
      }

      // Calculate differences for journal entries
      const billingDiff = newBilling - currentBilling
      const fundsDiff = newFunds - currentFunds

      // Create journal entry if there are changes
      if (billingDiff !== 0 || fundsDiff !== 0) {
        const entryType = mode === 'set' ? 'beginning_balance' : 'adjustment'
        const description = mode === 'set'
          ? `Beginning balance import - ${scoutName}`
          : `Balance adjustment import - ${scoutName}`

        // Create journal entry
        const { data: journalEntry, error: journalError } = await adminSupabase
          .from('journal_entries')
          .insert({
            unit_id: unitId,
            entry_date: new Date().toISOString().split('T')[0],
            description,
            entry_type: entryType,
            balance_import_batch_id: batch.id,
            created_by: profile.id,
            is_posted: true,
            posted_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (journalError || !journalEntry) {
          errors.push(`${scoutName}: Failed to create journal entry`)
          continue
        }

        // Create journal lines
        const journalLines: Array<{
          journal_entry_id: string
          account_id: string
          scout_account_id: string
          debit: number
          credit: number
          memo: string
          target_balance: string
        }> = []

        if (billingDiff !== 0) {
          // Billing balance change
          // If billing goes more negative (more owed), debit receivables
          // If billing goes less negative (less owed), credit receivables
          if (billingDiff < 0) {
            // More owed = debit receivables
            journalLines.push({
              journal_entry_id: journalEntry.id,
              account_id: receivablesAccount.id,
              scout_account_id: scoutAccountId,
              debit: Math.abs(billingDiff),
              credit: 0,
              memo: `Billing balance: ${currentBilling} → ${newBilling}`,
              target_balance: 'billing',
            })
          } else {
            // Less owed = credit receivables
            journalLines.push({
              journal_entry_id: journalEntry.id,
              account_id: receivablesAccount.id,
              scout_account_id: scoutAccountId,
              debit: 0,
              credit: billingDiff,
              memo: `Billing balance: ${currentBilling} → ${newBilling}`,
              target_balance: 'billing',
            })
          }
        }

        if (fundsDiff !== 0) {
          // Funds balance change
          // If funds increase, credit liability (unit owes scout more)
          // If funds decrease, debit liability (unit owes scout less)
          if (fundsDiff > 0) {
            journalLines.push({
              journal_entry_id: journalEntry.id,
              account_id: fundsLiabilityAccount.id,
              scout_account_id: scoutAccountId,
              debit: 0,
              credit: fundsDiff,
              memo: `Funds balance: ${currentFunds} → ${newFunds}`,
              target_balance: 'funds',
            })
          } else {
            journalLines.push({
              journal_entry_id: journalEntry.id,
              account_id: fundsLiabilityAccount.id,
              scout_account_id: scoutAccountId,
              debit: Math.abs(fundsDiff),
              credit: 0,
              memo: `Funds balance: ${currentFunds} → ${newFunds}`,
              target_balance: 'funds',
            })
          }
        }

        if (journalLines.length > 0) {
          await adminSupabase.from('journal_lines').insert(journalLines)
        }

        // Update scout account balances
        await adminSupabase
          .from('scout_accounts')
          .update({
            billing_balance: newBilling,
            funds_balance: newFunds,
            updated_at: new Date().toISOString(),
          })
          .eq('id', scoutAccountId)
      }

      imported++
    } catch (err) {
      errors.push(`Error processing row: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Update batch row count with actual imported count
  await adminSupabase
    .from('balance_import_batches')
    .update({ row_count: imported })
    .eq('id', batch.id)

  return NextResponse.json({
    success: errors.length === 0,
    batchId: batch.id,
    imported,
    skipped,
    errors,
  })
}
```

**Step 2: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/api/import/balances/route.ts
git commit -m "feat: add balance import API endpoint with journal entry creation"
```

---

### Task 2.2: Create undo import API route

**Files:**
- Create: `src/app/api/import/balances/[batchId]/undo/route.ts`

**Step 1: Write the undo API route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface UndoResult {
  success: boolean
  error?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
): Promise<NextResponse<UndoResult>> {
  const { batchId } = await params
  const supabase = await createClient()

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  // Get user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 403 })
  }

  // Get user's unit and verify admin/treasurer role
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return NextResponse.json(
      { success: false, error: 'Only admins and treasurers can undo imports' },
      { status: 403 }
    )
  }

  const adminSupabase = createAdminClient()

  // Get the batch
  const { data: batch, error: batchError } = await adminSupabase
    .from('balance_import_batches')
    .select('id, unit_id, status, created_at')
    .eq('id', batchId)
    .eq('unit_id', membership.unit_id)
    .single()

  if (batchError || !batch) {
    return NextResponse.json({ success: false, error: 'Import batch not found' }, { status: 404 })
  }

  if (batch.status === 'undone') {
    return NextResponse.json({ success: false, error: 'Import has already been undone' }, { status: 400 })
  }

  // Check if this is the most recent batch
  const { data: newerBatches } = await adminSupabase
    .from('balance_import_batches')
    .select('id')
    .eq('unit_id', membership.unit_id)
    .eq('status', 'active')
    .gt('created_at', batch.created_at)
    .limit(1)

  if (newerBatches && newerBatches.length > 0) {
    return NextResponse.json(
      { success: false, error: 'Can only undo the most recent import' },
      { status: 400 }
    )
  }

  // Check for subsequent activity on affected accounts
  const { data: batchEntries } = await adminSupabase
    .from('journal_entries')
    .select('id')
    .eq('balance_import_batch_id', batchId)

  if (!batchEntries || batchEntries.length === 0) {
    return NextResponse.json({ success: false, error: 'No entries found for this import' }, { status: 400 })
  }

  // Get affected scout account IDs
  const { data: affectedLines } = await adminSupabase
    .from('journal_lines')
    .select('scout_account_id')
    .in('journal_entry_id', batchEntries.map(e => e.id))

  const affectedAccountIds = [...new Set(affectedLines?.map(l => l.scout_account_id).filter(Boolean))]

  if (affectedAccountIds.length > 0) {
    // Check for newer journal entries on these accounts
    const { data: newerEntries } = await adminSupabase
      .from('journal_lines')
      .select('journal_entry_id, journal_entries!inner(created_at, balance_import_batch_id)')
      .in('scout_account_id', affectedAccountIds)
      .gt('journal_entries.created_at', batch.created_at)
      .is('journal_entries.balance_import_batch_id', null) // Not part of this batch
      .limit(1)

    if (newerEntries && newerEntries.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Cannot undo: subsequent activity on affected accounts' },
        { status: 400 }
      )
    }
  }

  // Get all journal entries and lines for reversal
  const { data: entriesToReverse } = await adminSupabase
    .from('journal_entries')
    .select(`
      id,
      unit_id,
      description,
      entry_type,
      journal_lines (
        id,
        account_id,
        scout_account_id,
        debit,
        credit,
        memo,
        target_balance
      )
    `)
    .eq('balance_import_batch_id', batchId)

  if (!entriesToReverse) {
    return NextResponse.json({ success: false, error: 'Failed to get entries to reverse' }, { status: 500 })
  }

  // Create reversing entries
  for (const entry of entriesToReverse) {
    const lines = entry.journal_lines as Array<{
      id: string
      account_id: string
      scout_account_id: string | null
      debit: number
      credit: number
      memo: string | null
      target_balance: string | null
    }>

    // Create reversal journal entry
    const { data: reversalEntry, error: reversalError } = await adminSupabase
      .from('journal_entries')
      .insert({
        unit_id: entry.unit_id,
        entry_date: new Date().toISOString().split('T')[0],
        description: `Reversal: ${entry.description}`,
        entry_type: 'balance_import_reversal',
        created_by: profile.id,
        is_posted: true,
        posted_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (reversalError || !reversalEntry) continue

    // Create reversed lines (swap debits and credits)
    const reversedLines = lines.map(line => ({
      journal_entry_id: reversalEntry.id,
      account_id: line.account_id,
      scout_account_id: line.scout_account_id,
      debit: line.credit, // Swap
      credit: line.debit, // Swap
      memo: `Reversal: ${line.memo || ''}`,
      target_balance: line.target_balance,
    }))

    await adminSupabase.from('journal_lines').insert(reversedLines)

    // Update scout account balances
    for (const line of lines) {
      if (!line.scout_account_id) continue

      const { data: account } = await adminSupabase
        .from('scout_accounts')
        .select('billing_balance, funds_balance')
        .eq('id', line.scout_account_id)
        .single()

      if (!account) continue

      // Reverse the balance change
      const balanceChange = line.debit - line.credit // Original change

      if (line.target_balance === 'billing') {
        // Reverse billing: if original was debit (more owed), now less owed
        // Original debit increased receivables = billing went more negative
        // Reversal should undo that
        const newBilling = (account.billing_balance || 0) + balanceChange
        await adminSupabase
          .from('scout_accounts')
          .update({ billing_balance: newBilling })
          .eq('id', line.scout_account_id)
      } else if (line.target_balance === 'funds') {
        // Reverse funds: if original was credit (more funds), now less funds
        const newFunds = (account.funds_balance || 0) - balanceChange
        await adminSupabase
          .from('scout_accounts')
          .update({ funds_balance: Math.max(0, newFunds) })
          .eq('id', line.scout_account_id)
      }
    }
  }

  // Mark batch as undone
  await adminSupabase
    .from('balance_import_batches')
    .update({
      status: 'undone',
      undone_at: new Date().toISOString(),
      undone_by: profile.id,
    })
    .eq('id', batchId)

  return NextResponse.json({ success: true })
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/api/import/balances/[batchId]/undo/route.ts
git commit -m "feat: add undo API for balance imports with reversal entries"
```

---

## Phase 3: UI Components

### Task 3.1: Create file upload component

**Files:**
- Create: `src/components/import/balance-upload.tsx`

**Step 1: Write the component**

```typescript
'use client'

import { useState, useCallback } from 'react'
import { Upload, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseBalanceCSV, type ParsedBalanceCSV } from '@/lib/import/balance-csv-parser'

interface BalanceUploadProps {
  onParsed: (csv: ParsedBalanceCSV, fileName: string) => void
  onError: (error: string) => void
}

export function BalanceUpload({ onParsed, onError }: BalanceUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [isParsing, setIsParsing] = useState(false)

  const processFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      onError('Please upload a CSV file')
      return
    }

    setFile(file)
    setIsParsing(true)

    try {
      const content = await file.text()
      const csv = parseBalanceCSV(content)

      if (csv.rows.length === 0) {
        onError('No data found in CSV file')
        setFile(null)
      } else {
        onParsed(csv, file.name)
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to parse file')
      setFile(null)
    } finally {
      setIsParsing(false)
    }
  }, [onParsed, onError])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      processFile(droppedFile)
    }
  }, [processFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      processFile(selectedFile)
    }
  }, [processFile])

  const clearFile = useCallback(() => {
    setFile(null)
  }, [])

  if (file) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-forest-600" />
          <div>
            <p className="font-medium text-stone-900">{file.name}</p>
            <p className="text-sm text-stone-500">
              {isParsing ? 'Parsing...' : 'Ready to map columns'}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={clearFile} disabled={isParsing}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
        isDragging
          ? 'border-forest-500 bg-forest-50'
          : 'border-stone-300 bg-stone-50 hover:border-stone-400'
      }`}
    >
      <Upload className={`h-12 w-12 ${isDragging ? 'text-forest-500' : 'text-stone-400'}`} />
      <p className="mt-4 text-center text-stone-600">
        Drag and drop your balance CSV file here, or
      </p>
      <label className="mt-2 cursor-pointer">
        <span className="text-forest-600 hover:text-forest-700 font-medium">browse to select</span>
        <input
          type="file"
          accept=".csv"
          className="sr-only"
          onChange={handleFileSelect}
        />
      </label>
      <p className="mt-4 text-xs text-stone-500">
        Export your balance data as a CSV file from your spreadsheet
      </p>
    </div>
  )
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/import/balance-upload.tsx
git commit -m "feat: add balance CSV file upload component"
```

---

### Task 3.2: Create column mapping component

**Files:**
- Create: `src/components/import/balance-column-mapper.tsx`

**Step 1: Write the component**

```typescript
'use client'

import { useState, useEffect } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import {
  autoDetectColumns,
  validateMapping,
  applyColumnMapping,
  type ParsedBalanceCSV,
  type ColumnMapping,
  type MappedBalanceRow
} from '@/lib/import/balance-csv-parser'

interface BalanceColumnMapperProps {
  csv: ParsedBalanceCSV
  onMappingChange: (mapping: ColumnMapping, isValid: boolean, previewRows: MappedBalanceRow[]) => void
}

const UNMAPPED = '__unmapped__'

export function BalanceColumnMapper({ csv, onMappingChange }: BalanceColumnMapperProps) {
  const [mapping, setMapping] = useState<ColumnMapping>(() => autoDetectColumns(csv.headers))
  const [errors, setErrors] = useState<string[]>([])

  // Update parent whenever mapping changes
  useEffect(() => {
    const validationErrors = validateMapping(mapping)
    setErrors(validationErrors)

    const previewRows = applyColumnMapping(csv, mapping).slice(0, 5)
    onMappingChange(mapping, validationErrors.length === 0, previewRows)
  }, [mapping, csv, onMappingChange])

  const updateMapping = (field: keyof ColumnMapping, value: string | number | undefined) => {
    setMapping(prev => {
      const next = { ...prev }
      if (value === UNMAPPED || value === undefined) {
        delete next[field]
      } else {
        (next as Record<string, unknown>)[field] = value
      }
      return next
    })
  }

  const columnOptions = csv.headers.map((header, index) => ({
    label: header,
    value: index.toString(),
  }))

  const getSelectedValue = (columnIndex: number | undefined): string => {
    return columnIndex !== undefined ? columnIndex.toString() : UNMAPPED
  }

  const hasSingleBalanceColumn =
    mapping.singleBalanceColumn !== undefined &&
    mapping.billingBalanceColumn === undefined &&
    mapping.fundsBalanceColumn === undefined

  return (
    <div className="space-y-6">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc pl-4">
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Scout Identification */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Scout Identification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-stone-600">
            Map columns to identify scouts. Use either name columns or BSA Member ID.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>First Name Column</Label>
              <Select
                value={getSelectedValue(mapping.firstNameColumn)}
                onValueChange={(v) => updateMapping('firstNameColumn', v === UNMAPPED ? undefined : parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select column..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>-- Not mapped --</SelectItem>
                  {columnOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Last Name Column</Label>
              <Select
                value={getSelectedValue(mapping.lastNameColumn)}
                onValueChange={(v) => updateMapping('lastNameColumn', v === UNMAPPED ? undefined : parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select column..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>-- Not mapped --</SelectItem>
                  {columnOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-center text-sm text-stone-500">— or —</div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Full Name Column</Label>
              <Select
                value={getSelectedValue(mapping.fullNameColumn)}
                onValueChange={(v) => updateMapping('fullNameColumn', v === UNMAPPED ? undefined : parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select column..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>-- Not mapped --</SelectItem>
                  {columnOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>BSA Member ID Column</Label>
              <Select
                value={getSelectedValue(mapping.bsaMemberIdColumn)}
                onValueChange={(v) => updateMapping('bsaMemberIdColumn', v === UNMAPPED ? undefined : parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select column..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>-- Not mapped --</SelectItem>
                  {columnOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Balance Columns */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Balance Columns</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-stone-600">
            Map columns for balance amounts. You can map separate billing/funds columns, or a single balance column.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Billing Balance (Amount Owed)</Label>
              <Select
                value={getSelectedValue(mapping.billingBalanceColumn)}
                onValueChange={(v) => updateMapping('billingBalanceColumn', v === UNMAPPED ? undefined : parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select column..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>-- Not mapped --</SelectItem>
                  {columnOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Funds Balance (Scout Savings)</Label>
              <Select
                value={getSelectedValue(mapping.fundsBalanceColumn)}
                onValueChange={(v) => updateMapping('fundsBalanceColumn', v === UNMAPPED ? undefined : parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select column..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>-- Not mapped --</SelectItem>
                  {columnOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-center text-sm text-stone-500">— or —</div>

          <div className="space-y-2">
            <Label>Single Balance Column</Label>
            <Select
              value={getSelectedValue(mapping.singleBalanceColumn)}
              onValueChange={(v) => updateMapping('singleBalanceColumn', v === UNMAPPED ? undefined : parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select column..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNMAPPED}>-- Not mapped --</SelectItem>
                {columnOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasSingleBalanceColumn && (
            <div className="rounded-lg bg-stone-50 p-4 space-y-3">
              <Label>What does a positive number mean in your spreadsheet?</Label>
              <RadioGroup
                value={mapping.positiveBalanceMeaning || ''}
                onValueChange={(v) => updateMapping('positiveBalanceMeaning', v as 'credit' | 'owes')}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="credit" id="credit" />
                  <Label htmlFor="credit" className="font-normal">
                    Scout has credit/savings (positive → funds, negative → billing)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="owes" id="owes" />
                  <Label htmlFor="owes" className="font-normal">
                    Scout owes money (positive → billing owed, negative → funds)
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preview (First 5 Rows)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1 text-left">Scout Name</th>
                  <th className="px-2 py-1 text-left">BSA ID</th>
                  <th className="px-2 py-1 text-right">Billing</th>
                  <th className="px-2 py-1 text-right">Funds</th>
                </tr>
              </thead>
              <tbody>
                {applyColumnMapping(csv, mapping).slice(0, 5).map((row, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1">
                      {row.fullName || `${row.firstName || ''} ${row.lastName || ''}`.trim() || '—'}
                    </td>
                    <td className="px-2 py-1">{row.bsaMemberId || '—'}</td>
                    <td className="px-2 py-1 text-right">
                      {row.billingBalance !== undefined ? `$${row.billingBalance.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {row.fundsBalance !== undefined ? `$${row.fundsBalance.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/import/balance-column-mapper.tsx
git commit -m "feat: add column mapping component for balance imports"
```

---

### Task 3.3: Create preview/resolution component

**Files:**
- Create: `src/components/import/balance-preview.tsx`

**Step 1: Write the component**

```typescript
'use client'

import { useState, useEffect } from 'react'
import { Check, AlertCircle, HelpCircle, X } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import type { MappedBalanceRow } from '@/lib/import/balance-csv-parser'

interface Scout {
  id: string
  first_name: string
  last_name: string
  bsa_member_id: string | null
  scout_accounts: {
    id: string
    billing_balance: number | null
    funds_balance: number
  } | null
}

interface PreviewRow extends MappedBalanceRow {
  matchStatus: 'matched' | 'unmatched' | 'error'
  matchedScout?: Scout
  action: 'import' | 'skip' | 'manual_match'
  manualMatchScoutId?: string
}

interface BalancePreviewProps {
  rows: MappedBalanceRow[]
  scouts: Scout[]
  mode: 'set' | 'adjust'
  onRowsChange: (rows: PreviewRow[]) => void
}

export function BalancePreview({ rows, scouts, mode, onRowsChange }: BalancePreviewProps) {
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])

  // Match rows to scouts on initial load
  useEffect(() => {
    const matched = rows.map(row => {
      const previewRow: PreviewRow = {
        ...row,
        matchStatus: 'unmatched',
        action: 'skip',
      }

      // Check for errors first
      if (row.errors.length > 0) {
        previewRow.matchStatus = 'error'
        previewRow.action = 'skip'
        return previewRow
      }

      // Try to match by BSA ID first
      if (row.bsaMemberId) {
        const match = scouts.find(s => s.bsa_member_id === row.bsaMemberId)
        if (match) {
          previewRow.matchStatus = 'matched'
          previewRow.matchedScout = match
          previewRow.action = 'import'
          return previewRow
        }
      }

      // Try to match by name
      const firstName = (row.firstName || '').toLowerCase().trim()
      const lastName = (row.lastName || '').toLowerCase().trim()

      if (firstName || lastName) {
        const match = scouts.find(s =>
          s.first_name.toLowerCase().trim() === firstName &&
          s.last_name.toLowerCase().trim() === lastName
        )
        if (match) {
          previewRow.matchStatus = 'matched'
          previewRow.matchedScout = match
          previewRow.action = 'import'
          return previewRow
        }
      }

      // No match found
      previewRow.matchStatus = 'unmatched'
      previewRow.action = 'skip'
      return previewRow
    })

    setPreviewRows(matched)
    onRowsChange(matched)
  }, [rows, scouts, onRowsChange])

  const updateRowAction = (index: number, action: 'import' | 'skip' | 'manual_match', manualMatchScoutId?: string) => {
    setPreviewRows(prev => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        action,
        manualMatchScoutId,
        matchedScout: manualMatchScoutId
          ? scouts.find(s => s.id === manualMatchScoutId)
          : next[index].matchedScout,
      }
      onRowsChange(next)
      return next
    })
  }

  const setAllUnmatchedTo = (action: 'skip') => {
    setPreviewRows(prev => {
      const next = prev.map(row => {
        if (row.matchStatus === 'unmatched') {
          return { ...row, action }
        }
        return row
      })
      onRowsChange(next)
      return next
    })
  }

  // Summary counts
  const matchedCount = previewRows.filter(r => r.matchStatus === 'matched').length
  const unmatchedCount = previewRows.filter(r => r.matchStatus === 'unmatched').length
  const errorCount = previewRows.filter(r => r.matchStatus === 'error').length
  const importCount = previewRows.filter(r => r.action === 'import' || r.action === 'manual_match').length

  const getStatusIcon = (status: PreviewRow['matchStatus']) => {
    switch (status) {
      case 'matched':
        return <Check className="h-4 w-4 text-success" />
      case 'unmatched':
        return <HelpCircle className="h-4 w-4 text-warning" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-error" />
    }
  }

  const calculateNewBalance = (row: PreviewRow, type: 'billing' | 'funds'): number | null => {
    if (!row.matchedScout?.scout_accounts) return null

    const current = type === 'billing'
      ? row.matchedScout.scout_accounts.billing_balance || 0
      : row.matchedScout.scout_accounts.funds_balance || 0

    const imported = type === 'billing' ? row.billingBalance : row.fundsBalance
    if (imported === undefined) return null

    if (mode === 'set') {
      return imported
    } else {
      return current + imported
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="bg-success/10">
          {matchedCount} matched
        </Badge>
        <Badge variant="outline" className="bg-warning/10">
          {unmatchedCount} unmatched
        </Badge>
        {errorCount > 0 && (
          <Badge variant="outline" className="bg-error/10">
            {errorCount} errors
          </Badge>
        )}
        <Badge variant="default">
          {importCount} will be imported
        </Badge>
      </div>

      {/* Bulk actions for unmatched */}
      {unmatchedCount > 0 && (
        <Card className="bg-warning/5 border-warning/20">
          <CardContent className="flex items-center justify-between py-3">
            <span className="text-sm">
              {unmatchedCount} unmatched row{unmatchedCount !== 1 ? 's' : ''} will be skipped
            </span>
            <button
              className="text-sm text-stone-600 hover:text-stone-900 underline"
              onClick={() => setAllUnmatchedTo('skip')}
            >
              Skip all unmatched
            </button>
          </CardContent>
        </Card>
      )}

      {/* Preview table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preview</CardTitle>
          <CardDescription>
            Review matches and resolve unmatched rows
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-stone-50">
                  <th className="px-2 py-2 text-left w-8"></th>
                  <th className="px-2 py-2 text-left">CSV Name</th>
                  <th className="px-2 py-2 text-left">Matched Scout</th>
                  <th className="px-2 py-2 text-right">Current → New Billing</th>
                  <th className="px-2 py-2 text-right">Current → New Funds</th>
                  <th className="px-2 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, index) => (
                  <tr
                    key={index}
                    className={`border-b ${row.action === 'skip' ? 'opacity-50' : ''}`}
                  >
                    <td className="px-2 py-2">
                      {getStatusIcon(row.matchStatus)}
                    </td>
                    <td className="px-2 py-2">
                      <div>{row.fullName || `${row.firstName || ''} ${row.lastName || ''}`.trim()}</div>
                      {row.bsaMemberId && (
                        <div className="text-xs text-stone-500">ID: {row.bsaMemberId}</div>
                      )}
                      {row.errors.length > 0 && (
                        <div className="text-xs text-error">{row.errors.join(', ')}</div>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {row.matchStatus === 'matched' && row.matchedScout ? (
                        <span>{row.matchedScout.first_name} {row.matchedScout.last_name}</span>
                      ) : row.matchStatus === 'unmatched' ? (
                        <Select
                          value={row.manualMatchScoutId || ''}
                          onValueChange={(v) => {
                            if (v) {
                              updateRowAction(index, 'manual_match', v)
                            } else {
                              updateRowAction(index, 'skip')
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 w-48">
                            <SelectValue placeholder="Select scout..." />
                          </SelectTrigger>
                          <SelectContent>
                            {scouts.map(scout => (
                              <SelectItem key={scout.id} value={scout.id}>
                                {scout.first_name} {scout.last_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs">
                      {row.matchedScout?.scout_accounts && row.billingBalance !== undefined ? (
                        <>
                          {formatCurrency(row.matchedScout.scout_accounts.billing_balance || 0)}
                          {' → '}
                          <span className={mode === 'set' ? 'text-forest-600' : ''}>
                            {formatCurrency(calculateNewBalance(row, 'billing') || 0)}
                          </span>
                        </>
                      ) : row.billingBalance !== undefined ? (
                        formatCurrency(row.billingBalance)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs">
                      {row.matchedScout?.scout_accounts && row.fundsBalance !== undefined ? (
                        <>
                          {formatCurrency(row.matchedScout.scout_accounts.funds_balance || 0)}
                          {' → '}
                          <span className={mode === 'set' ? 'text-forest-600' : ''}>
                            {formatCurrency(calculateNewBalance(row, 'funds') || 0)}
                          </span>
                        </>
                      ) : row.fundsBalance !== undefined ? (
                        formatCurrency(row.fundsBalance)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {row.matchStatus === 'error' ? (
                        <Badge variant="destructive" className="text-xs">Skip</Badge>
                      ) : row.matchStatus === 'matched' ? (
                        <button
                          className="text-xs underline"
                          onClick={() => updateRowAction(index, row.action === 'import' ? 'skip' : 'import')}
                        >
                          {row.action === 'import' ? 'Will import' : 'Skipped'}
                        </button>
                      ) : (
                        <span className="text-xs text-stone-500">
                          {row.action === 'manual_match' ? 'Will import' : 'Skipped'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/import/balance-preview.tsx
git commit -m "feat: add preview component for balance imports with matching"
```

---

### Task 3.4: Create main wizard component

**Files:**
- Create: `src/components/import/balance-import-wizard.tsx`

**Step 1: Write the wizard component**

```typescript
'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, CheckCircle, AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react'
import { BalanceUpload } from './balance-upload'
import { BalanceColumnMapper } from './balance-column-mapper'
import { BalancePreview } from './balance-preview'
import type { ParsedBalanceCSV, ColumnMapping, MappedBalanceRow } from '@/lib/import/balance-csv-parser'

interface Scout {
  id: string
  first_name: string
  last_name: string
  bsa_member_id: string | null
  scout_accounts: {
    id: string
    billing_balance: number | null
    funds_balance: number
  } | null
}

interface PreviewRow extends MappedBalanceRow {
  matchStatus: 'matched' | 'unmatched' | 'error'
  matchedScout?: Scout
  action: 'import' | 'skip' | 'manual_match'
  manualMatchScoutId?: string
}

interface ImportResult {
  success: boolean
  batchId?: string
  imported: number
  skipped: number
  errors: string[]
}

interface BalanceImportWizardProps {
  scouts: Scout[]
  onComplete?: () => void
}

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'complete'

export function BalanceImportWizard({ scouts, onComplete }: BalanceImportWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)

  // Upload state
  const [csv, setCsv] = useState<ParsedBalanceCSV | null>(null)
  const [fileName, setFileName] = useState<string>('')

  // Config state
  const [mode, setMode] = useState<'set' | 'adjust'>('set')

  // Mapping state
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [isMappingValid, setIsMappingValid] = useState(false)
  const [mappedRows, setMappedRows] = useState<MappedBalanceRow[]>([])

  // Preview state
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])

  // Result state
  const [result, setResult] = useState<ImportResult | null>(null)

  const handleParsed = useCallback((parsedCsv: ParsedBalanceCSV, name: string) => {
    setCsv(parsedCsv)
    setFileName(name)
    setError(null)
    setStep('map')
  }, [])

  const handleMappingChange = useCallback((
    newMapping: ColumnMapping,
    isValid: boolean,
    preview: MappedBalanceRow[]
  ) => {
    setMapping(newMapping)
    setIsMappingValid(isValid)
    setMappedRows(preview)
  }, [])

  const handlePreviewRowsChange = useCallback((rows: PreviewRow[]) => {
    setPreviewRows(rows)
  }, [])

  const handleImport = async () => {
    setStep('importing')
    setError(null)

    const rowsToImport = previewRows
      .filter(r => r.action === 'import' || r.action === 'manual_match')
      .map(row => ({
        scoutId: row.matchedScout?.id,
        scoutAccountId: row.matchedScout?.scout_accounts?.id,
        firstName: row.firstName,
        lastName: row.lastName,
        bsaMemberId: row.bsaMemberId,
        billingBalance: row.billingBalance,
        fundsBalance: row.fundsBalance,
        action: row.action,
        manualMatchScoutId: row.manualMatchScoutId,
      }))

    try {
      const response = await fetch('/api/import/balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          rows: rowsToImport,
        }),
      })

      const data: ImportResult = await response.json()
      setResult(data)
      setStep('complete')

      if (data.success && onComplete) {
        onComplete()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('preview')
    }
  }

  const handleDone = () => {
    router.push('/finances/accounts')
    router.refresh()
  }

  const canProceedToPreview = isMappingValid && csv && mappedRows.length > 0
  const importableCount = previewRows.filter(r => r.action === 'import' || r.action === 'manual_match').length

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 text-sm">
        <span className={step === 'upload' ? 'font-medium text-forest-600' : 'text-stone-500'}>
          1. Upload
        </span>
        <ArrowRight className="h-4 w-4 text-stone-300" />
        <span className={step === 'map' ? 'font-medium text-forest-600' : 'text-stone-500'}>
          2. Map Columns
        </span>
        <ArrowRight className="h-4 w-4 text-stone-300" />
        <span className={step === 'preview' ? 'font-medium text-forest-600' : 'text-stone-500'}>
          3. Preview
        </span>
        <ArrowRight className="h-4 w-4 text-stone-300" />
        <span className={step === 'complete' ? 'font-medium text-forest-600' : 'text-stone-500'}>
          4. Complete
        </span>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Import Mode</CardTitle>
              <CardDescription>
                Choose how imported balances should be applied
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'set' | 'adjust')}>
                <div className="flex items-start space-x-2">
                  <RadioGroupItem value="set" id="mode-set" className="mt-1" />
                  <div>
                    <Label htmlFor="mode-set" className="font-medium">Set balances</Label>
                    <p className="text-sm text-stone-500">
                      Replace existing balances with imported values
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-2">
                  <RadioGroupItem value="adjust" id="mode-adjust" className="mt-1" />
                  <div>
                    <Label htmlFor="mode-adjust" className="font-medium">Adjust balances</Label>
                    <p className="text-sm text-stone-500">
                      Add imported values to existing balances
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          <BalanceUpload
            onParsed={handleParsed}
            onError={(err) => setError(err)}
          />
        </div>
      )}

      {/* Step 2: Map Columns */}
      {step === 'map' && csv && (
        <div className="space-y-4">
          <BalanceColumnMapper
            csv={csv}
            onMappingChange={handleMappingChange}
          />

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('upload')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={() => setStep('preview')}
              disabled={!canProceedToPreview}
            >
              Continue to Preview
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && csv && (
        <div className="space-y-4">
          <BalancePreview
            rows={mappedRows.length > 0 ? mappedRows : []}
            scouts={scouts}
            mode={mode}
            onRowsChange={handlePreviewRowsChange}
          />

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('map')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Mapping
            </Button>
            <Button
              onClick={handleImport}
              disabled={importableCount === 0}
            >
              Import {importableCount} Balance{importableCount !== 1 ? 's' : ''}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Importing */}
      {step === 'importing' && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-forest-600" />
            <p className="mt-4 text-lg font-medium">Importing balances...</p>
            <p className="text-sm text-stone-500">This may take a moment</p>
          </CardContent>
        </Card>
      )}

      {/* Complete */}
      {step === 'complete' && result && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center text-center">
              {result.success ? (
                <CheckCircle className="h-12 w-12 text-success" />
              ) : (
                <AlertCircle className="h-12 w-12 text-warning" />
              )}

              <h3 className="mt-4 text-xl font-semibold">
                {result.success ? 'Import Complete' : 'Import Completed with Errors'}
              </h3>

              <div className="mt-4 space-y-1 text-sm">
                <p className="text-success">
                  {result.imported} balance{result.imported !== 1 ? 's' : ''} imported
                </p>
                {result.skipped > 0 && (
                  <p className="text-stone-500">
                    {result.skipped} row{result.skipped !== 1 ? 's' : ''} skipped
                  </p>
                )}
              </div>

              {result.errors.length > 0 && (
                <div className="mt-4 w-full max-w-md text-left">
                  <p className="font-medium text-error">Errors:</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-error">
                    {result.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {result.errors.length > 5 && (
                      <li>...and {result.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}

              <Button className="mt-6" onClick={handleDone}>
                Done
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/import/balance-import-wizard.tsx
git commit -m "feat: add balance import wizard with 4-step flow"
```

---

## Phase 4: Integration

### Task 4.1: Create Settings > Data tab import section

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Create: `src/app/(dashboard)/settings/import/balances/page.tsx`

**Step 1: Create the balance import page**

Create: `src/app/(dashboard)/settings/import/balances/page.tsx`

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isFinancialRole } from '@/lib/roles'
import { BalanceImportWizard } from '@/components/import/balance-import-wizard'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default async function BalanceImportPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) redirect('/login')

  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('unit_id, role')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  if (!membership || !isFinancialRole(membership.role)) {
    redirect('/profile')
  }

  // Get all active scouts with their accounts
  const { data: scoutsData } = await supabase
    .from('scouts')
    .select(`
      id,
      first_name,
      last_name,
      bsa_member_id,
      scout_accounts (
        id,
        billing_balance,
        funds_balance
      )
    `)
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .order('last_name')
    .order('first_name')

  interface Scout {
    id: string
    first_name: string
    last_name: string
    bsa_member_id: string | null
    scout_accounts: {
      id: string
      billing_balance: number | null
      funds_balance: number
    } | null
  }

  const scouts = (scoutsData || []) as Scout[]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/settings?tab=data"
          className="flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Settings
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-stone-900">Import Account Balances</h1>
        <p className="mt-1 text-stone-600">
          Upload a CSV file to import scout account balances
        </p>
      </div>

      {scouts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No Scouts Found</CardTitle>
            <CardDescription>
              You need to import your roster before importing balances.
              Balances can only be applied to existing scouts.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <BalanceImportWizard scouts={scouts} />
      )}
    </div>
  )
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/\(dashboard\)/settings/import/balances/page.tsx
git commit -m "feat: add balance import page in settings"
```

---

### Task 4.2: Add link from Settings Data tab

**Files:**
- Modify: `src/components/settings/scoutbook-sync-card.tsx` or create new card

**Step 1: Create balance import card component**

Create: `src/components/settings/balance-import-card.tsx`

```typescript
import Link from 'next/link'
import { DollarSign, Upload } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function BalanceImportCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Account Balances
        </CardTitle>
        <CardDescription>
          Import scout account balances from a CSV file
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-stone-600 mb-4">
          Upload a CSV with scout names or BSA IDs and their current balances.
          Great for initial setup or syncing from external spreadsheets.
        </p>
        <Link href="/settings/import/balances">
          <Button variant="outline" className="w-full">
            <Upload className="mr-2 h-4 w-4" />
            Import Balances
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Add to Settings page Data tab**

Modify: `src/app/(dashboard)/settings/page.tsx`

Add import at top:
```typescript
import { BalanceImportCard } from '@/components/settings/balance-import-card'
```

Add card to the Data tab section (find where ScoutbookSyncCardLazy is rendered):
```typescript
{/* After ScoutbookSyncCardLazy */}
<BalanceImportCard />
```

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/settings/balance-import-card.tsx src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat: add balance import card to Settings Data tab"
```

---

### Task 4.3: Add Import button to Finances Accounts page

**Files:**
- Modify: `src/app/(dashboard)/finances/accounts/page.tsx`

**Step 1: Add Import Balances button**

Add import at top:
```typescript
import Link from 'next/link'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
```

Find the header section and add button for financial roles:
```typescript
<div className="flex items-center justify-between">
  <div>
    <h1 className="text-3xl font-bold text-stone-900">
      {isScout ? 'My Account' : isParent ? 'Family Accounts' : 'Scout Accounts'}
    </h1>
    <p className="mt-1 text-stone-600">
      {isScout
        ? 'View your account balance and transactions'
        : isParent
          ? 'View your scouts\' account balances'
          : 'View and manage scout financial accounts'}
    </p>
  </div>
  {isFinancialRole(role) && (
    <Link href="/settings/import/balances">
      <Button variant="outline">
        <Upload className="mr-2 h-4 w-4" />
        Import Balances
      </Button>
    </Link>
  )}
</div>
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/app/\(dashboard\)/finances/accounts/page.tsx
git commit -m "feat: add Import Balances button to Finances Accounts page"
```

---

### Task 4.4: Add undo banner component

**Files:**
- Create: `src/components/finances/import-undo-banner.tsx`
- Modify: `src/app/(dashboard)/finances/accounts/page.tsx`

**Step 1: Create the undo banner component**

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Undo2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'

interface ImportUndoBannerProps {
  batchId: string
  importedAt: string
  rowCount: number
}

export function ImportUndoBanner({ batchId, importedAt, rowCount }: ImportUndoBannerProps) {
  const router = useRouter()
  const [isUndoing, setIsUndoing] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (isDismissed) return null

  const handleUndo = async () => {
    setIsUndoing(true)
    setError(null)

    try {
      const response = await fetch(`/api/import/balances/${batchId}/undo`, {
        method: 'POST',
      })

      const data = await response.json()

      if (data.success) {
        router.refresh()
        setIsDismissed(true)
      } else {
        setError(data.error || 'Failed to undo import')
      }
    } catch (err) {
      setError('Failed to undo import')
    } finally {
      setIsUndoing(false)
    }
  }

  const timeAgo = formatDistanceToNow(new Date(importedAt), { addSuffix: true })

  return (
    <div className="rounded-lg border border-forest-200 bg-forest-50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-forest-800">
            Imported {rowCount} balance{rowCount !== 1 ? 's' : ''} {timeAgo}
          </span>
          {error && (
            <span className="text-sm text-error">{error}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUndo}
            disabled={isUndoing}
            className="text-forest-700 hover:text-forest-900"
          >
            {isUndoing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Undo2 className="mr-1 h-4 w-4" />
            )}
            Undo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDismissed(true)}
            className="text-stone-500 hover:text-stone-700"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Add banner to Accounts page**

Modify `src/app/(dashboard)/finances/accounts/page.tsx`:

Add import:
```typescript
import { ImportUndoBanner } from '@/components/finances/import-undo-banner'
```

Add query to fetch latest active import batch (after membership check):
```typescript
// Get most recent import batch for undo banner
const { data: latestBatch } = await supabase
  .from('balance_import_batches')
  .select('id, created_at, row_count')
  .eq('unit_id', membership.unit_id)
  .eq('status', 'active')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle()

// Check if there's subsequent activity (would disable undo)
let canUndo = false
if (latestBatch) {
  const { data: newerEntries } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('unit_id', membership.unit_id)
    .gt('created_at', latestBatch.created_at)
    .is('balance_import_batch_id', null)
    .limit(1)

  canUndo = !newerEntries || newerEntries.length === 0
}
```

Add banner before summary cards (for financial roles):
```typescript
{isFinancialRole(role) && latestBatch && canUndo && (
  <ImportUndoBanner
    batchId={latestBatch.id}
    importedAt={latestBatch.created_at}
    rowCount={latestBatch.row_count}
  />
)}
```

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/finances/import-undo-banner.tsx src/app/\(dashboard\)/finances/accounts/page.tsx
git commit -m "feat: add undo banner for recent balance imports"
```

---

## Phase 5: Testing & Polish

### Task 5.1: Add E2E test for balance import

**Files:**
- Create: `tests/e2e/balance-import.spec.ts`

**Step 1: Write E2E test**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Balance Import', () => {
  test.beforeEach(async ({ page }) => {
    // Login as treasurer
    await page.goto('/login')
    await page.fill('[name="email"]', 'richard.blaalid+treasurer@withcaldera.com')
    await page.fill('[name="password"]', 'testpassword123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(dashboard|finances)/)
  })

  test('can access balance import from Settings', async ({ page }) => {
    await page.goto('/settings?tab=data')

    // Find and click Import Balances button
    const importButton = page.getByRole('link', { name: /import balances/i })
    await expect(importButton).toBeVisible()
    await importButton.click()

    await expect(page).toHaveURL('/settings/import/balances')
    await expect(page.getByRole('heading', { name: /import account balances/i })).toBeVisible()
  })

  test('can access balance import from Finances Accounts', async ({ page }) => {
    await page.goto('/finances/accounts')

    const importButton = page.getByRole('link', { name: /import balances/i })
    await expect(importButton).toBeVisible()
    await importButton.click()

    await expect(page).toHaveURL('/settings/import/balances')
  })

  test('shows import mode selection', async ({ page }) => {
    await page.goto('/settings/import/balances')

    await expect(page.getByText('Set balances')).toBeVisible()
    await expect(page.getByText('Adjust balances')).toBeVisible()
  })

  test('shows file upload area', async ({ page }) => {
    await page.goto('/settings/import/balances')

    await expect(page.getByText(/drag and drop/i)).toBeVisible()
    await expect(page.getByText(/browse to select/i)).toBeVisible()
  })
})
```

**Step 2: Run test**

Run: `npx playwright test tests/e2e/balance-import.spec.ts`
Expected: Tests pass (or skip if db not seeded)

**Step 3: Commit**

```bash
git add tests/e2e/balance-import.spec.ts
git commit -m "test: add E2E tests for balance import flow"
```

---

### Task 5.2: Final integration test

**Step 1: Run full build and tests**

Run: `npm run build && npm test`
Expected: All tests pass, build succeeds

**Step 2: Manual testing checklist**

1. [ ] Login as treasurer
2. [ ] Navigate to Settings > Data tab
3. [ ] Click "Import Balances"
4. [ ] Upload test CSV
5. [ ] Map columns
6. [ ] Preview matches
7. [ ] Complete import
8. [ ] Verify balances updated
9. [ ] Test undo functionality

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete CSV balance import feature for treasurers"
```

---

## Summary

This plan creates a complete CSV balance import feature with:

1. **Database schema** - `balance_import_batches` table, new journal entry types
2. **CSV parser** - Flexible column mapping, sign convention handling
3. **API endpoints** - Import and undo with journal entry creation
4. **UI components** - 4-step wizard (Upload → Map → Preview → Confirm)
5. **Integration** - Links from Settings and Finances pages, undo banner
6. **Testing** - Unit tests for parser, E2E tests for flow

Total tasks: 15
Estimated implementation: Multiple focused sessions
