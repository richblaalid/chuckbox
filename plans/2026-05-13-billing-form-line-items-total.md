---
status: approved
last_verified: 2026-05-13
---

# Create-Billing Modal — Line Items as Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the create-billing form's dual-input pattern (Total Amount field + optional itemized breakdown toggle) with a single line-items section always visible. Total auto-derives from the sum; never separately editable. Single-row submissions stay non-itemized at the DB layer; multi-row submissions persist as itemized.

**Spec:** [docs/superpowers/specs/2026-05-13-billing-form-line-items-total-design.md](../docs/superpowers/specs/2026-05-13-billing-form-line-items-total-design.md)

**Architecture:** State unifies on `lineItems: LineItem[]` (always ≥1 entry). Form initializes with one empty row. A derived `effectiveAmount = sum(lineItems.amount)` replaces all current uses of `parsedAmount`. The `Total Amount` input and `showLineItems` toggle are removed from the JSX. `validateLineItems`'s signature drops the `totalAmount` parameter; the sum-equality branch is gone; the "every row needs a description" rule becomes "rows need descriptions when length >= 2." Persistence at submit time decides between non-itemized (`line_items: null`) and itemized (`line_items: [...]`) based on row count and the first row's description.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Tailwind CSS 4, Vitest 4 + React Testing Library.

**Files involved:**

- **Modify**: `src/lib/billing-validation.ts` — rewrite `validateLineItems` signature and body.
- **Modify**: `tests/unit/billing-form-validation.test.ts` — update for the new signature, delete sum-mismatch tests, update description-rule tests.
- **Modify**: `src/components/billing/billing-form.tsx` — replace `amount`/`showLineItems` state with `lineItems[]`-only; remove Total Amount input and Add-itemized toggle; restructure the items section; rewrite submit-payload branching.
- **Create**: `tests/unit/components/billing-form.test.tsx` — new component tests for the form's new behavior.

No new files in `src/`. No DB schema changes. No changes to the email template, billing-list display, or server actions.

---

## Task 1: Rewrite `validateLineItems`

**Files:**
- Modify: `tests/unit/billing-form-validation.test.ts` (existing — has 8 `validateLineItems` tests today; replace them)
- Modify: `src/lib/billing-validation.ts` (drop `totalAmount` parameter, update body)

This task is TDD: update the tests first (drop the second arg from all calls, delete sum-mismatch cases, update description-rule cases for the new conditional-by-length rule), watch them fail against the old implementation, update the implementation, watch them pass.

### Step 1.1: Replace the `validateLineItems` describe block in the existing test file

Open `tests/unit/billing-form-validation.test.ts`. The file currently has a `describe('validateLineItems', ...)` block with 8 `it` cases. Replace the entire block (lines ~4-61, up to and including the closing `})` of the describe) with this:

```ts
describe('validateLineItems', () => {
  it('returns null when no line items', () => {
    expect(validateLineItems([])).toBeNull()
  })

  it('returns null for a single row with empty description (description is optional in single-row mode)', () => {
    expect(validateLineItems([{ description: '', amount: 100 }])).toBeNull()
  })

  it('returns null for a single row with whitespace-only description', () => {
    expect(validateLineItems([{ description: '   ', amount: 100 }])).toBeNull()
  })

  it('returns null for multiple rows that all have descriptions and positive amounts', () => {
    expect(
      validateLineItems([
        { description: 'Base fee', amount: 390 },
        { description: 'MB fee', amount: 65 },
      ])
    ).toBeNull()
  })

  it('returns error when 2+ rows and the first row has an empty description', () => {
    expect(
      validateLineItems([
        { description: '', amount: 50 },
        { description: 'Food', amount: 30 },
      ])
    ).toContain('Line item 1 needs a description')
  })

  it('returns error when 2+ rows and a later row has an empty description', () => {
    expect(
      validateLineItems([
        { description: 'Tent', amount: 50 },
        { description: '', amount: 30 },
      ])
    ).toContain('Line item 2 needs a description')
  })

  it('returns error when 2+ rows and a row has a whitespace-only description', () => {
    expect(
      validateLineItems([
        { description: 'Tent', amount: 50 },
        { description: '   ', amount: 30 },
      ])
    ).toContain('Line item 2 needs a description')
  })

  it('returns error when any row has amount of zero', () => {
    expect(validateLineItems([{ description: 'Fee', amount: 0 }])).toContain('greater than $0')
  })

  it('returns error when any row has a negative amount', () => {
    expect(validateLineItems([{ description: 'Fee', amount: -5 }])).toContain('greater than $0')
  })

  it('returns error when 2+ rows and one has a zero amount (amount rule fires before description rule)', () => {
    expect(
      validateLineItems([
        { description: 'Tent', amount: 50 },
        { description: 'Food', amount: 0 },
      ])
    ).toContain('greater than $0')
  })
})
```

Leave the `validateDeposit` describe block below it untouched.

### Step 1.2: Run the tests to verify they fail

Run: `npx vitest run tests/unit/billing-form-validation.test.ts`
Expected: TypeScript compile errors — `validateLineItems` currently takes two arguments and the new tests call it with one. The vitest output will surface these as compile-time errors before any test assertion runs.

Confirm the failures are about the function signature, not about runtime behavior or missing imports.

### Step 1.3: Rewrite `validateLineItems` in the source file

In `src/lib/billing-validation.ts`, find the existing `validateLineItems` function (lines 6-19). Replace the entire function with:

```ts
export function validateLineItems(lineItems: LineItem[]): string | null {
  if (lineItems.length === 0) return null

  for (let i = 0; i < lineItems.length; i++) {
    if (lineItems[i].amount <= 0) {
      return 'Each line item must have an amount greater than $0'
    }
  }

  if (lineItems.length >= 2) {
    for (let i = 0; i < lineItems.length; i++) {
      if (!lineItems[i].description.trim()) {
        return `Line item ${i + 1} needs a description`
      }
    }
  }

  return null
}
```

Key changes vs. the existing body:
- Signature drops `totalAmount: number`.
- The `if (Math.abs(sum - totalAmount) > 0.01) ...` sum-equality branch is gone.
- The amount-must-be-positive check is moved to fire before the description check (so a zero-amount error always wins over a missing-description error — matches test case `'amount rule fires before description rule'`).
- The description check is now gated on `lineItems.length >= 2`.
- The error messages are updated: row-numbered ("Line item 1 needs a description") and "greater than $0" (matches test assertion `.toContain('greater than $0')`).

### Step 1.4: Run the tests to verify they pass

Run: `npx vitest run tests/unit/billing-form-validation.test.ts`
Expected: PASS — 10 `validateLineItems` tests + however many `validateDeposit` tests already existed (unchanged).

### Step 1.5: Update the only caller in `billing-form.tsx` so the file still compiles

The form at `src/components/billing/billing-form.tsx:129` currently calls:

```ts
const lineItemError = validateLineItems(lineItems, parsedAmount)
```

This will fail TypeScript with the new signature. Change to:

```ts
const lineItemError = validateLineItems(lineItems)
```

This is a temporary minimal change. The form's full restructure happens in Task 2; for now we just fix the call site so the project compiles between tasks.

### Step 1.6: Verify the project compiles + full suite passes

Run: `npx tsc --noEmit`
Expected: clean (no output).

Run: `npx vitest run`
Expected: full suite PASS. Note: the form still has the old dual-input UI in this intermediate state; the form's runtime behavior is functionally equivalent to today minus the sum-equality validation. Task 2 then rewrites the form.

Run: `npm run build`
Expected: exit 0.

### Step 1.7: Commit

```bash
git add src/lib/billing-validation.ts tests/unit/billing-form-validation.test.ts src/components/billing/billing-form.tsx
git commit -m "$(cat <<'EOF'
refactor(billing): validateLineItems drops totalAmount param, conditional description rule

Rewrites validateLineItems for the line-items-as-source-of-truth design.
The function no longer takes a totalAmount argument — the sum-equality
check is gone because under the new model the total IS the sum by
construction. The "every line item must have a description" rule
becomes "rows need descriptions when length >= 2" (single-row entries
treat the row description as optional; the record-level description
above carries the bill's purpose).

Test cases updated: drop sum-mismatch tests, add per-row-position
description-error tests with row numbers ("Line item 2 needs a
description"), confirm single-row submissions skip the description rule.

The billing form's call site is updated minimally (drop the second arg)
to keep the project compiling. The form's full restructure lands in the
next commit.
EOF
)"
```

---

## Task 2: Rewrite the billing form

**Files:**
- Modify: `src/components/billing/billing-form.tsx` (state shape, JSX structure, submit branching)
- Create: `tests/unit/components/billing-form.test.tsx` (new component test file)

This is the larger task. The form's `amount` string state, `showLineItems` boolean, and `lineItems` array state collapse to a single `lineItems` state initialized with one empty row. The Total Amount input, the "Add itemized breakdown" toggle button, and the existing line-items section's close (×) button are all removed. The new items section is always visible.

### Step 2.1: Inspect the current state, JSX, and submit logic for context

Before editing, read the relevant blocks in `src/components/billing/billing-form.tsx`:

- Lines 48-58: existing state declarations (`amount`, `description`, `billingType`, `lineItems`, `showLineItems`, `depositAmount`, etc.).
- Lines 73-89: `parsedAmount` derivation and keyboard-shortcut effect (gates on `parsedAmount > 0`).
- Lines 91-99: per-scout/total amount calculations.
- Lines 120-145: validation block including `validateLineItems(lineItems)` (already updated in Task 1).
- Lines 185-235: submit body — server action call, post-submit line-items persistence at lines 190-200.
- Lines 235-247: form state reset after success.
- Lines 365-465: the Amount input + line-items JSX (current dual-input pattern). This is the block being restructured.
- Lines 609-620: post-form summary (uses `parsedAmount` for the per-scout breakdown text).

Do not edit these yet — just read for understanding.

### Step 2.2: Write the failing component tests

Create `tests/unit/components/billing-form.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BillingForm } from '@/components/billing/billing-form'
import * as billingActions from '@/app/actions/billing'

const mockCreateBilling = vi.fn()

vi.mock('@/app/actions/billing', () => ({
  createBillingWithCharges: (...args: unknown[]) => mockCreateBilling(...args),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}))

const scout = (i: number, first: string, last: string) => ({
  id: `s${i}`,
  first_name: first,
  last_name: last,
  is_active: true,
  scout_accounts: { id: `acct${i}` },
  patrols: null,
})

const baseProps = {
  unitId: 'unit1',
  scouts: [scout(1, 'Alex', 'Reed'), scout(2, 'Jamie', 'Lee')],
  onSuccess: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateBilling.mockResolvedValue({ success: true, billing_record_id: 'br1' })
})

describe('BillingForm — line items as source of truth', () => {
  it('renders one empty line-item row by default with no remove button on it', () => {
    render(<BillingForm {...baseProps} />)
    // Default: one row with an amount input and a description input.
    expect(screen.queryByPlaceholderText(/total amount/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add itemized breakdown/i })).not.toBeInTheDocument()
    // The single row's remove button should not be present.
    expect(screen.queryAllByLabelText('Remove line item')).toHaveLength(0)
  })

  it('shows the read-only Total auto-derived from the line-item amounts', () => {
    render(<BillingForm {...baseProps} />)
    // Total starts at $0.00.
    expect(screen.getByText(/Total:/)).toBeInTheDocument()
    // Type a value into the first row's amount input.
    const amountInputs = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs[0], { target: { value: '50' } })
    // Total updates.
    expect(screen.getByText(/\$50\.00/)).toBeInTheDocument()
  })

  it('reveals a second row with description + amount + remove when "Add another item" is clicked', () => {
    render(<BillingForm {...baseProps} />)
    const addButton = screen.getByRole('button', { name: /add another item/i })
    fireEvent.click(addButton)
    // Two amount inputs now.
    expect(screen.getAllByPlaceholderText('0.00')).toHaveLength(2)
    // Remove buttons appear on rows now that there are 2+.
    expect(screen.getAllByLabelText('Remove line item').length).toBeGreaterThanOrEqual(1)
  })

  it('removes a row when its × is clicked', () => {
    render(<BillingForm {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /add another item/i }))
    expect(screen.getAllByPlaceholderText('0.00')).toHaveLength(2)
    const removeButtons = screen.getAllByLabelText('Remove line item')
    fireEvent.click(removeButtons[0])
    // Back to one row.
    expect(screen.getAllByPlaceholderText('0.00')).toHaveLength(1)
    // Remove button is gone (only one row left).
    expect(screen.queryAllByLabelText('Remove line item')).toHaveLength(0)
  })

  it('submits a single-row entry with blank description as non-itemized (line_items: null)', async () => {
    render(<BillingForm {...baseProps} />)
    // Fill record description.
    fireEvent.change(screen.getByPlaceholderText(/e.g.,? Summer Camp/i), {
      target: { value: 'Single Item Test' },
    })
    // Type amount in the single row.
    const amountInputs = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs[0], { target: { value: '50' } })
    // Leave row description blank.
    // Select a scout.
    const scoutCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(scoutCheckbox)
    // Submit.
    const submitButton = screen.getByRole('button', { name: /create billing/i })
    fireEvent.click(submitButton)
    // Assert the server action was called with line_items: null.
    await vi.waitFor(() => {
      expect(mockCreateBilling).toHaveBeenCalled()
    })
    const callArgs = mockCreateBilling.mock.calls[0]
    // The action signature varies — assert the payload structure that includes line_items: null.
    const payload = callArgs[0] ?? callArgs
    // Walk through any wrapping object to find the line_items field.
    const lineItemsValue = JSON.stringify(payload).includes('"line_items":null')
      || JSON.stringify(payload).includes('line_items":null')
    expect(lineItemsValue).toBe(true)
  })

  it('submits a single-row entry with a filled description as itemized with one item', async () => {
    render(<BillingForm {...baseProps} />)
    fireEvent.change(screen.getByPlaceholderText(/e.g.,? Summer Camp/i), {
      target: { value: 'One-Item Bill' },
    })
    const amountInputs = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs[0], { target: { value: '50' } })
    // Fill the row's description.
    const descInputs = screen.getAllByPlaceholderText(/describe what this bill covers|description/i)
    fireEvent.change(descInputs[0], { target: { value: 'Camp fee' } })
    const scoutCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(scoutCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /create billing/i }))
    await vi.waitFor(() => expect(mockCreateBilling).toHaveBeenCalled())
    const payload = mockCreateBilling.mock.calls[0][0] ?? mockCreateBilling.mock.calls[0]
    const payloadStr = JSON.stringify(payload)
    // line_items should contain the one item with description "Camp fee".
    expect(payloadStr).toContain('"description":"Camp fee"')
    expect(payloadStr).not.toMatch(/"line_items"\s*:\s*null/)
  })

  it('blocks submit when 2+ rows exist and one is missing a description', async () => {
    render(<BillingForm {...baseProps} />)
    fireEvent.change(screen.getByPlaceholderText(/e.g.,? Summer Camp/i), {
      target: { value: 'Missing Desc Test' },
    })
    const amountInputs1 = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs1[0], { target: { value: '50' } })
    // Add a second row.
    fireEvent.click(screen.getByRole('button', { name: /add another item/i }))
    const amountInputs2 = screen.getAllByPlaceholderText('0.00')
    fireEvent.change(amountInputs2[1], { target: { value: '30' } })
    // Don't fill any descriptions.
    const scoutCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(scoutCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /create billing/i }))
    // The server action should NOT be called because validation blocks it.
    // Wait briefly to ensure no async submission fires.
    await new Promise((r) => setTimeout(r, 50))
    expect(mockCreateBilling).not.toHaveBeenCalled()
    // The validation error text should appear.
    expect(screen.getByText(/Line item 1 needs a description/i)).toBeInTheDocument()
  })
})
```

### Step 2.3: Run the new tests to verify they fail

Run: `npx vitest run tests/unit/components/billing-form.test.tsx`
Expected: Multiple failures. The first test ("renders one empty line-item row by default") may pass partially (today's form has no row by default — there's a Total Amount input until you click the toggle). The "no remove button on it" assertion will likely fail because the form structure doesn't match yet.

Confirm the failures are caused by the form's current UI shape (not by missing imports or framework errors). The mock setup should resolve cleanly.

### Step 2.4: Rewrite the form's state declarations

In `src/components/billing/billing-form.tsx`, find the state block at lines 48-58:

```ts
  const [selectedScouts, setSelectedScouts] = useState<Set<string>>(
    () => new Set(preselectedScoutIds || [])
  )
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [billingType, setBillingType] = useState<BillingType>('fixed')
  const [sendNotifications, setSendNotifications] = useState(false)
  const [scoutSearch, setScoutSearch] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [showLineItems, setShowLineItems] = useState(false)
  const [showDeposit, setShowDeposit] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositDueDate, setDepositDueDate] = useState('')
```

Replace with:

```ts
  const [selectedScouts, setSelectedScouts] = useState<Set<string>>(
    () => new Set(preselectedScoutIds || [])
  )
  const [description, setDescription] = useState('')
  const [billingType, setBillingType] = useState<BillingType>('fixed')
  const [sendNotifications, setSendNotifications] = useState(false)
  const [scoutSearch, setScoutSearch] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', amount: 0 }])
  const [showDeposit, setShowDeposit] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositDueDate, setDepositDueDate] = useState('')
```

Changes:
- Removed `amount` and `showLineItems` state.
- Initialized `lineItems` with one empty row instead of an empty array.

### Step 2.5: Replace the derived `parsedAmount` with `effectiveAmount`

In the same file, find line 73:

```ts
  const parsedAmount = parseFloat(amount) || 0
```

Replace with:

```ts
  const effectiveAmount = lineItems.reduce((sum, li) => sum + li.amount, 0)
```

Then update **every other occurrence of `parsedAmount` in the file** to use `effectiveAmount` instead. This is a mechanical find-and-replace. As of the spec audit, the occurrences are:

- Line 80 (keyboard shortcut gate): `parsedAmount > 0` → `effectiveAmount > 0`
- Line 89 (effect dependency array): `[selectedScouts.size, parsedAmount, isLoading]` → `[selectedScouts.size, effectiveAmount, isLoading]`
- Lines 93-94 (per-scout split math): `parsedAmount / selectedScouts.size` and `: parsedAmount` → `effectiveAmount / selectedScouts.size` and `: effectiveAmount`
- Lines 97-98 (total math): `? parsedAmount : parsedAmount * selectedScouts.size` → `? effectiveAmount : effectiveAmount * selectedScouts.size`
- Line 121: `if (parsedAmount <= 0)` → `if (effectiveAmount <= 0)`
- Line 139 (deposit validation): `validateDeposit(depositAmount, depositDueDate, parsedAmount)` → `validateDeposit(depositAmount, depositDueDate, effectiveAmount)`
- Lines 609-614 (form summary): `parsedAmount > 0` and the formatCurrency calls → `effectiveAmount > 0`, `formatCurrency(effectiveAmount)`, `formatCurrency(effectiveAmount * selectedScouts.size)`

Use search-replace (`parsedAmount` → `effectiveAmount`) across the file; the symbol doesn't appear in any test files or other locations.

### Step 2.6: Update the submit-payload branching for line items

Find the existing submit block around lines 190-200:

```ts
      // Persist line items and deposit fields if provided
      if ((showLineItems && lineItems.length > 0) || (showDeposit && depositAmount)) {
        const { error: updateError } = await supabase
          .from('billing_records')
          .update({
            line_items: showLineItems && lineItems.length > 0
              ? lineItems.map((li) => ({ description: li.description, amount: li.amount }))
              : null,
            deposit_amount: showDeposit && depositAmount ? parseFloat(depositAmount) : null,
            deposit_due_date: showDeposit && depositDueDate ? depositDueDate : null,
          })
          .eq('id', billingResult.billing_record_id)

        if (updateError) {
          console.error('Failed to save line items/deposit:', updateError)
        }
      }
```

Replace with:

```ts
      // Decide whether to persist line items based on row count and first-row description.
      // - 1 row, blank description: bill is non-itemized; line_items stays null.
      // - 1 row with description, or 2+ rows: persist as itemized.
      const isItemized =
        lineItems.length >= 2 ||
        (lineItems.length === 1 && lineItems[0].description.trim().length > 0)

      const persistedLineItems = isItemized
        ? lineItems.map((li) => ({ description: li.description, amount: li.amount }))
        : null

      // Persist line items and deposit fields if either is non-default
      if (isItemized || (showDeposit && depositAmount)) {
        const { error: updateError } = await supabase
          .from('billing_records')
          .update({
            line_items: persistedLineItems,
            deposit_amount: showDeposit && depositAmount ? parseFloat(depositAmount) : null,
            deposit_due_date: showDeposit && depositDueDate ? depositDueDate : null,
          })
          .eq('id', billingResult.billing_record_id)

        if (updateError) {
          console.error('Failed to save line items/deposit:', updateError)
        }
      }
```

### Step 2.7: Update the form state reset

Find the post-submit reset around lines 235-247. Today it likely includes `setAmount('')` and `setLineItems([])` and `setShowLineItems(false)`. Replace those three lines with:

```ts
      setLineItems([{ description: '', amount: 0 }])
```

(The other reset lines for `description`, `selectedScouts`, deposit fields, etc. stay unchanged.)

### Step 2.8: Replace the JSX for the Amount input + line items section

Find the JSX block at approximately lines 365-465. This is the Total Amount input followed by the conditional "Add itemized breakdown" / line-items section. Replace the entire block — from the `{/* 3. Amount */}` comment (or equivalent label) through the closing `</div>` of the line-items section — with:

```tsx
      {/* 3. Items (line-item list with read-only auto-calculated total) */}
      <div className="space-y-3 rounded-lg border border-stone-200 dark:border-stone-700 p-4">
        <Label>Items</Label>
        {lineItems.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              placeholder={
                index === 0 && lineItems.length === 1
                  ? 'Optional — describe what this bill covers'
                  : 'Description'
              }
              value={item.description}
              onChange={(e) => {
                const updated = [...lineItems]
                updated[index] = { ...updated[index], description: e.target.value }
                setLineItems(updated)
              }}
              className="flex-1"
            />
            <div className="relative w-28">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 dark:text-stone-400">
                $
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={item.amount || ''}
                onChange={(e) => {
                  const updated = [...lineItems]
                  updated[index] = {
                    ...updated[index],
                    amount: parseFloat(e.target.value) || 0,
                  }
                  setLineItems(updated)
                }}
                onWheel={(e) => e.currentTarget.blur()}
                className="pl-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            {lineItems.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setLineItems(lineItems.filter((_, i) => i !== index))
                }}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                aria-label="Remove line item"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setLineItems([...lineItems, { description: '', amount: 0 }])}
        >
          <Plus className="mr-1 h-4 w-4" />
          Add another item
        </Button>

        <div
          className="mt-2 flex items-center justify-between rounded-md bg-stone-50 dark:bg-stone-800 px-3 py-2"
          aria-label="Auto-calculated total"
        >
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
            Total
          </span>
          <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {formatCurrency(effectiveAmount)}
            <span className="ml-2 text-xs font-normal text-stone-500 dark:text-stone-400">
              auto-calculated
            </span>
          </span>
        </div>
      </div>
```

This block replaces both the old Total Amount input AND the existing line-items section in one shot. Key features:
- One row by default (the initial state has `[{description: '', amount: 0}]`).
- First row's placeholder text changes based on whether it's the only row (`Optional — describe what this bill covers`) vs. a multi-row context (`Description`).
- Remove (`×`) button conditional on `lineItems.length > 1` — first/only row can't be removed.
- "+ Add another item" button always present.
- Total row at the bottom with `auto-calculated` hint text.

### Step 2.9: Verify the form compiles and the new tests pass

Run: `npx tsc --noEmit`
Expected: clean (no output).

Run: `npx vitest run tests/unit/components/billing-form.test.tsx`
Expected: PASS — all 7 component tests pass.

Run: `npx vitest run`
Expected: full suite PASS.

Run: `npm run build`
Expected: exit 0.

### Step 2.10: Commit

```bash
git add src/components/billing/billing-form.tsx tests/unit/components/billing-form.test.tsx
git commit -m "$(cat <<'EOF'
feat(billing): line items as single source of truth in create-billing form

Replaces the dual-input pattern (Total Amount field + "Add itemized
breakdown" toggle) with a single line-items section always visible.
State unifies on lineItems: starts with one empty row, total
auto-derives from the sum, read-only and always visible. Single-row
submissions with a blank description persist as non-itemized
(line_items: null); single-row with description or multi-row persist
as itemized. The conditional persistence keeps the email "Bill
Includes" section meaningful — it only fires for records the
treasurer intentionally itemized.

Removes:
- Top-level "Total Amount" input.
- "Add itemized breakdown" toggle button.
- The line-items section's × close button (section is always present).
- The amount/showLineItems state.
- The sum-equality validation error (impossible to mismatch now).

Adds 7 component tests covering single-row default, total derivation,
add/remove rows, single-row blank-description → non-itemized persist,
single-row with description → itemized persist, and the missing-
description validation block on multi-row submits.
EOF
)"
```

---

## Task 3: Manual verification in dev

**Files:** none (verification only).

- [ ] **Step 3.1: Reset the dev database**

Run: `npm run db:fresh`
Expected: completes without errors.

- [ ] **Step 3.2: Start the dev server**

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev
```

Wait for `Ready in <N>ms`.

- [ ] **Step 3.3: Log in as treasurer**

Open `http://localhost:3000/login`. Sign in:
- Email: `richard.blaalid+treasurer@withcaldera.com`
- Password: `testpassword123`

- [ ] **Step 3.4: Single-row bill, blank row description (non-itemized path)**

Navigate to `/finances/billing`. Click **Create Billing**. Fill:
- Description: `Single Item Test`
- Type: Fixed
- Items: leave the row description blank, enter `50` in the amount field
- Total should read `$50.00` (auto-calculated)
- Pick a scout
- Submit

After success, expand the new record on `/finances/billing`. Confirm:
- The record exists with description "Single Item Test" and total $50
- The "Send Billing Reminder" email (sent to the test guardian) does NOT show a "Bill Includes" section — line_items was stored as null

- [ ] **Step 3.5: Single-row bill with row description (itemized-with-one-item path)**

Click **Create Billing** again. Fill:
- Description: `Single Item with Detail`
- Items: row 1 description `Camp registration`, amount `40`
- Total: `$40.00`
- Pick a scout
- Submit

Send the billing reminder. The email should now show the "Bill Includes" section with a single row: `Camp registration $40.00`, Total $40.00, and no "Your scout's share" footer (single scout).

- [ ] **Step 3.6: Multi-row itemized bill**

Click **Create Billing** again. Fill:
- Description: `Itemized Camp`
- Items:
  - Row 1: `Tent rental`, `$30`
  - Click + Add another item
  - Row 2: `Food`, `$15`
  - Click + Add another item
  - Row 3: `T-shirt`, `$5`
- Total: `$50.00`
- Pick 4 scouts (split mode)
- Submit

Send the billing reminder. Email should show all three items at their full amounts, Total $50, and `Your scout's share: $12.50 (1/4 of the total)` (or similar — depends on per-scout math for split mode).

- [ ] **Step 3.7: Missing-description validation block**

Click **Create Billing**. Fill description, type amount $50 in row 1, click + Add another item, type amount $30 in row 2 but leave both descriptions blank. Try to submit.

Confirm:
- The form blocks submission with an error message naming the first violating row ("Line item 1 needs a description").
- After filling row 1's description (leaving row 2 blank), the error updates to "Line item 2 needs a description".
- After filling both, the form submits successfully as an itemized bill.

- [ ] **Step 3.8: Row removal**

Click **Create Billing**. Add 3 rows. Click `×` on the middle row. Confirm:
- Now 2 rows remain.
- Total auto-recalculates excluding the removed row.

- [ ] **Step 3.9: Zero-amount blocking**

In any open Create Billing dialog, leave row 1's amount at $0 (or clear it) and try to submit. Confirm the form blocks with the "amount greater than $0" error.

- [ ] **Step 3.10: Report results**

Reply with what you confirmed, including any deviations from the spec or unexpected UI behavior. No commit needed.

---

## Self-review checklist (for the plan author)

After writing this plan, I checked against the spec:

- ✅ Spec section "State and data flow" → Task 2 Step 2.4 unifies state on `lineItems[]`; Step 2.5 derives `effectiveAmount` from it.
- ✅ Spec section "Persistence rules" → Task 2 Step 2.6 has the exact branching (1 row blank desc → null; 1 row with desc → itemized; 2+ rows → itemized).
- ✅ Spec section "Validation" → Task 1 rewrites `validateLineItems` with the new rules; Task 2 component test 7 ("blocks submit when 2+ rows exist and one is missing a description") exercises the conditional rule.
- ✅ Spec section "UI structure" → Task 2 Step 2.8 has the new JSX with the always-visible items section, the conditional `×` button on rows 2+, the "+ Add another item" button, and the auto-calculated Total row.
- ✅ Spec section "Visual treatment" → covered in the JSX of Step 2.8 (placeholder text varies, `×` conditional, Total has `auto-calculated` hint).
- ✅ Spec section "Edge cases" → Tasks 2 and 3 cover them. Edge case 4 (user removes description from row 1 after typing) is exercised by the manual flow in Task 3.5 → 3.6 sequence.
- ✅ Spec section "Files involved" → all four files have task coverage.
- ✅ Spec section "Testing strategy" → Task 1 covers `validateLineItems` tests; Task 2 covers component tests; Task 3 covers manual.
- ✅ No placeholders. Every step has exact code or exact commands.
- ✅ Type consistency: `LineItem`, `lineItems`, `effectiveAmount`, `validateLineItems(lineItems: LineItem[])` all used consistently across tasks.
