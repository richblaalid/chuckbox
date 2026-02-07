# CSV Balance Import for Treasurers

**Date:** 2026-02-07
**Status:** Approved
**Author:** Design collaboration

## Overview

A flexible CSV import feature allowing treasurers to upload scout account balances during initial unit setup. Supports flexible column mapping, multiple scout identification methods, and maintains full audit trail through journal entries.

## Use Case

**Primary scenario:** Initial migration when first setting up Chuckbox for a unit. Treasurers bring in historical balances from their existing spreadsheets.

## User Flow

### Step 1: Upload & Configure

- Drag-and-drop or browse for CSV file
- Global settings:
  - **Import mode toggle:** "Set balances" (overwrite) vs "Adjust balances" (add/subtract)
  - Clear explanation of what each mode does

### Step 2: Map Columns

**Scout Identification (required - pick one):**
- Option A: Map "First Name" + "Last Name" columns
- Option B: Map "Full Name" column (parsed into first/last)
- Option C: Map "BSA Member ID" column

**Balance Fields (at least one required):**
- "Billing Balance" → `billing_balance` (what scout owes)
- "Funds Balance" → `funds_balance` (scout savings)

**Single Balance Column Handling:**

When treasurer maps a single "Balance" column with mixed positive/negative values, prompt:

> "What does a positive number mean in your spreadsheet?"
> - "Scout has credit/savings" → Positive → funds, Negative → billing
> - "Scout owes money" → Positive → billing (as negative), Negative → funds

**Smart Defaults:**
- Auto-detect common column names ("First", "Last", "Name", "Balance", "Owed", "Due", "Funds")
- Treasurer can override any auto-detection

**Live Preview:**
- Show first 5 rows with mapped data
- For single balance column, show the split: CSV Balance → Billing → Funds

### Step 3: Preview & Resolve

**Table Columns:**
| Status | Scout Name | BSA ID | Current Balance | Imported Balance | Action |

**Row States:**

| Status | Indicator | Description |
|--------|-----------|-------------|
| Matched (zero balance) | ✓ Green | Ready to import |
| Matched (has balance) | ✓ Yellow | Shows current vs imported, mode determines behavior |
| Unmatched | ? Orange | Action dropdown: Skip / Manual match |
| Error | ⚠ Red | Validation issue, auto-skipped |

**Unmatched Scout Resolution:**
- **Skip:** Ignore this row
- **Manual match:** Dropdown to select from existing scouts (handles name variations like "Bobby" vs "Robert")
- **No scout creation** - scouts must exist or be skipped

**Top Summary Bar:**
- "Ready to import: 24 scouts"
- "Will skip: 3 unmatched, 1 error"

**Bulk Actions:**
- "Set all unmatched to: Skip"

**Duplicate Detection:**
- If multiple CSV rows match the same scout, show warning: "Row 5 and Row 12 both match 'John Smith' - please resolve"

### Step 4: Confirm & Import

- Final summary of actions
- Import button
- Results screen with counts and skipped row details

## Data Model

### New Table: `balance_import_batches`

```sql
CREATE TABLE balance_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id),
  imported_by UUID NOT NULL REFERENCES profiles(id),
  mode TEXT NOT NULL CHECK (mode IN ('set', 'adjust')),
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'undone')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Journal Entry Integration

Each imported balance creates a journal entry:
- **Type:** `beginning_balance` (set mode) or `balance_adjustment` (adjust mode)
- **Description:** "Balance import - [scout name]"
- **Metadata:** Links to `balance_import_batch_id`
- **Lines:** Proper debit/credit per double-entry rules

## Undo Functionality

**Mechanism:** Reversing journal entries (standard accounting practice)

**Availability:**
- Only for the most recent balance import
- Disabled once any subsequent financial activity occurs on affected accounts (payments, charges, adjustments)

**Flow:**
1. Treasurer clicks "Undo" on the import banner
2. System creates reversing journal entries for all entries in that batch
3. Balances return to pre-import state
4. Original entries remain visible (audit trail preserved)
5. Batch status updated to "undone"

## Error Handling

### Upload Errors
- Invalid file type → "Please upload a CSV file"
- Empty file → "The file appears to be empty"
- No data rows → "No data found after header row"

### Mapping Errors
- No scout identifier mapped → "Please map a scout name or BSA ID column"
- No balance columns mapped → "Please map at least one balance column"
- Non-numeric values → Warning icon on affected cells in preview

### Import Errors
- All rows invalid → "No valid rows to import. Please review and fix issues."

### Results Screen
| Result | Count |
|--------|-------|
| ✓ Balances updated | 24 |
| ⊘ Skipped (unmatched) | 3 |
| ⊘ Skipped (errors) | 1 |

- List skipped rows with reasons
- "Download skipped rows as CSV" for retry
- Undo banner for successful imports

## UI Location

### Entry Points

1. **Finances > Accounts page**
   - "Import Balances" button in page header
   - Primary entry point for treasurers

2. **Settings > Data tab**
   - New card: "Account Balances - Import scout account balances from CSV"
   - Consistent with roster and advancement imports

Both open the same import wizard component.

### Undo Visibility

- Dismissible banner on Finances > Accounts after import:
  - "Imported 24 balances on Feb 7, 2026. [Undo] [Dismiss]"
- Also visible in Settings > Data tab
- Banner disappears when undo unavailable

### Import History

- Settings > Data tab: "Import History" section
- Shows: date, user, row count, status (active/undone)

## Access Control

| Role | Access |
|------|--------|
| Admin | Full access |
| Treasurer | Full access |
| Leader | No access |
| Parent | No access |
| Scout | No access |

Both UI buttons hidden and API endpoints protected for unauthorized roles.

## Technical Notes

### Existing Patterns to Follow
- File upload: `src/components/import/roster-upload.tsx`
- CSV parsing: `src/lib/import/bsa-roster-parser.ts`
- API structure: `src/app/api/import/roster/route.ts`
- Journal entries: RPC function pattern from billing

### Scout Matching Logic
1. If BSA Member ID mapped → exact match on `scouts.bsa_member_id`
2. If name columns mapped → match on `scouts.first_name` + `scouts.last_name` (case-insensitive, trimmed)
3. For manual matching → show dropdown of all active scouts in unit

### Balance Update Logic
```typescript
// Set mode
newBillingBalance = importedBilling
newFundsBalance = importedFunds

// Adjust mode
newBillingBalance = currentBilling + importedBilling
newFundsBalance = currentFunds + importedFunds
```

### Undo Eligibility Check
```sql
-- Check if any activity after import
SELECT EXISTS (
  SELECT 1 FROM journal_entries je
  JOIN journal_lines jl ON jl.journal_entry_id = je.id
  WHERE jl.scout_account_id IN (
    SELECT DISTINCT jl2.scout_account_id
    FROM journal_lines jl2
    JOIN journal_entries je2 ON je2.id = jl2.journal_entry_id
    WHERE je2.balance_import_batch_id = $batch_id
  )
  AND je.created_at > (SELECT created_at FROM balance_import_batches WHERE id = $batch_id)
  AND je.balance_import_batch_id IS DISTINCT FROM $batch_id
);
```
