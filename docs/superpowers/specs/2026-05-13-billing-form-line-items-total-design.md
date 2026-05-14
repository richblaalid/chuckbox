---
status: approved
last_verified: 2026-05-13
---

# Create-Billing Modal — Line Items as Source of Truth

## Context

The Create Billing modal (`src/components/billing/billing-form.tsx`) currently has two amount-entry paths: a top-level `Total Amount` input, and an optional "Add itemized breakdown" toggle that reveals a line-items section. When both are filled, the form validates that `sum(line items) ≈ total` and shows a red error on mismatch — forcing the treasurer to type their billing total twice and keep both in sync manually.

This spec replaces the dual-input pattern with a single line-items-driven model. The form always renders a line-items section starting with one empty row. The amount per row is the only place a treasurer enters monetary values. The `Total` is always derived (read-only) from the sum of line items.

For a single-amount bill (most common case), a treasurer fills one row's amount and submits — same effort as today's "type a number" flow but without the toggle. For an itemized bill, they add more rows. There's no separate mode, no toggle, no two-input synchronization. The "did the sums match?" validation goes away because sums match by construction.

Fourth item of the billing UX queue:
1. ✅ Partial-payment display (PR #32)
2. ✅ Scout name on cards (PR #33)
3. ✅ Line items in parent emails (PR #34)
4. **Create-billing modal: line items ↔ total** ← this spec

## Goals

- A treasurer creating a single-amount bill enters one description (record-level) and one amount, then submits. No more friction than today.
- A treasurer creating an itemized bill adds line-item rows; the total updates automatically. No double-entry of the total, no validation error to chase.
- The persisted shape on `billing_records` matches treasurer intent: non-itemized bills (one row, no row-level description) store `line_items: null`; itemized bills (multi-row, or single-row with a row-level description) store the full array.
- Downstream consumers (the email template's "Bill Includes" section, the billing-list card, the management view) keep working unchanged — they already key off whether `line_items` is null or populated.

## Non-goals

- No DB schema changes.
- No changes to the email templates or the billing-list display layer.
- No changes to the fixed-vs-split billing type logic.
- No changes to the deposit feature (it consumes the derived total via the same `effectiveAmount` path).

## UI structure

The form sections (top-to-bottom) under this spec:

1. **Description** (record-level, required) — unchanged from today. Always at the top. Example: `Summer Camp Deposit`.
2. **Type** toggle — Fixed | Split. Unchanged.
3. **Items** section (NEW unified shape):
   - One or more rows, starting with exactly one row by default.
   - Each row: `[description input] [amount input] [× remove button]`.
   - The first row's `×` button is hidden (always need at least one row).
   - `+ Add another item` button below the rows.
   - `Total: $X` line below the button. Read-only, always visible, lighter background with a lock-icon hint indicating it's auto-calculated.
4. **Deposit** (optional, unchanged) — uses the derived `effectiveAmount` for its validation.
5. **Scouts** selector (unchanged).
6. **Submit** button (unchanged).

The form's current `Total Amount` input is removed entirely. The `Add itemized breakdown` toggle button is removed. The line-items section's `×` close-section button is removed (since the section is always present).

### Mocks

**Single-item bill** (most common case):

```
  Description: [Summer Camp Deposit                    ]
  Type:        [Fixed] [Split]
  Items:
   • [optional: what does this cover?]  [$ 50.00 ]
   [+ Add another item]
   Total: $50.00      🔒 auto-calculated
```

The single row's description input is optional. Placeholder text: `Optional — describe what this bill covers`. The record description above already conveys the bill's purpose; the row description is only useful if the user wants the line item to differ from the record description.

**Multi-item (itemized) bill**:

```
  Description: [Summer Camp Deposit                    ]
  Type:        [Fixed] [Split]
  Items:
   • [Tent rental                  ]  [$ 30.00 ]  [×]
   • [Food                         ]  [$ 15.00 ]  [×]
   • [T-shirt                      ]  [$  5.00 ]  [×]
   [+ Add another item]
   Total: $50.00      🔒 auto-calculated
```

Identical UI to single-item, just more rows. The `×` remove button is visible on rows 2+. Each row's description is now required (see "Validation").

## State and data flow

### State shape

```ts
// Replaces today's `amount` (string) state and the `lineItems`/`showLineItems` state
const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', amount: 0 }])
```

The form initializes with exactly one empty line item. No separate `amount` string, no `showLineItems` toggle.

### Derived total

```ts
const effectiveAmount = lineItems.reduce((sum, li) => sum + li.amount, 0)
```

Used everywhere the form currently uses `parsedAmount`:
- `perScoutAmount` calculation
- `totalAmount` calculation (for split-type bills)
- Deposit validation (`validateDeposit(depositAmount, depositDueDate, effectiveAmount)`)
- The total preview at the bottom of the form
- The submit payload

### Persistence rules

At submit time, decide what to write based on the `lineItems` state:

| `lineItems.length` | First row's description | Persisted shape |
|---|---|---|
| 1 | empty/whitespace | `line_items: null`, `total_amount: items[0].amount` (non-itemized) |
| 1 | non-empty | `line_items: [{description, amount}]`, `total_amount: items[0].amount` |
| 2+ | any | `line_items: [items...]`, `total_amount: sum` |

The first row's description acts as a signal: if blank with a single row, the treasurer treated the form as a "one-amount bill" and the persistence stays clean (no noise in `billing_records.line_items` for records that didn't need itemization). If filled or with extra rows, the line items are persisted in full.

This ensures the downstream email's "Bill Includes" section only fires for records the treasurer actually itemized — preserving its meaning.

## Validation

- **Always required**: Every row's `amount > 0`. Catches both empty rows (user clicked "+ Add another item" but didn't fill it) and rows with descriptions but zero amounts (user typed a description but forgot the price). This matches today's `validateLineItems` behavior.
- **Always required**: Selected scouts (unchanged from today).
- **Always required**: Record-level description (unchanged).
- **Conditional**: When 2+ rows exist, every row must have a non-empty description. This catches the "user added a second item but forgot to label it" case. Single-row submissions don't require a row-level description (the row is treated as just an amount; the record-level description above conveys the bill's purpose).
- **Removed**: The current `validateLineItems` sum-equality check (compared sum to a separate "Total Amount" input). The sum always equals itself now.

The existing `LineItem` interface in `src/lib/billing-validation.ts` stays. The `validateLineItems` function is rewritten:

- **Signature changes** from `(lineItems: LineItem[], totalAmount: number) => string | null` to `(lineItems: LineItem[]) => string | null`. The `totalAmount` parameter is gone.
- **Rule 1 (kept, behavior preserved)**: Every line item must have `amount > 0`. Error: `Each line item must have an amount greater than $0`.
- **Rule 2 (changed)**: When `lineItems.length >= 2`, every row must have a non-empty trimmed description. Error: `Line item N needs a description` (where N is the 1-indexed position of the first violating row). Single-row submissions skip this check.
- **Removed**: The sum-equality branch and the "all line items must have a description" branch.

### Submit button enabled state

```
disabled =
  isLoading ||
  selectedScouts.size === 0 ||
  effectiveAmount <= 0 ||
  description.trim() === ''
```

Same shape as today, swapping `parsedAmount` for `effectiveAmount`. Captures the always-required preconditions; the conditional description rule fires as a runtime error on submit attempt (not a disabled-button signal, because deciding which row needs the description is row-level state that's awkward to express in a button-disabled state).

## Visual treatment

- The first row's `×` (remove) button is hidden via conditional render: only show when `lineItems.length > 1`.
- Total field: lighter background (`bg-stone-50` or similar), read-only, displayed below the rows with a small lock or calculator icon and helper text like `Auto-calculated from line items`.
- "+ Add another item" button: ghost/outline style, left-aligned below the last row.
- Description placeholder for single-row: `Optional — describe what this bill covers` (gray, subtle).
- Description placeholder for additional rows: `Description` (matching today's plain placeholder).

## Edge cases

1. **User opens the form, types only an amount in the single row, submits.** First row description is blank, one row → persisted as non-itemized. Effective total = the amount they entered. Same end state as today's "type a number into Total Amount" flow.

2. **User adds a second row, fills it, then deletes it back to one row.** State returns to exactly one row. If that one row's description is still empty, persistence reverts to non-itemized. If they had filled the first row's description before adding the second, the description stays and persistence is itemized-with-one-item.

3. **User adds a row but doesn't fill it (description and amount both empty), then submits.** Row 2 has `amount: 0` and `description: ''`. Submit validation:
   - With the 2+ row description requirement firing: blocked with error "Line item 2 needs a description".
   - User either fills row 2 or removes it.
   - Acceptable behavior — the form makes the user resolve ambiguity.

4. **User removes the description from row 1 after typing it.** Row 1's description becomes empty. If still only one row, persistence is non-itemized (the description was a transient artifact of editing). If 2+ rows, the validation fires (row 1 needs a description because there are multiple rows).

5. **Deposit interaction.** Deposit validation uses `effectiveAmount` (the derived sum). Deposit amount must not exceed `effectiveAmount`. Today this works against `parsedAmount`; the substitution is mechanical.

6. **Fixed-vs-split interaction.** Both billing types still consume `effectiveAmount` correctly. `perScoutAmount = effectiveAmount / selectedScouts.size` for split; `perScoutAmount = effectiveAmount` for fixed. No change.

7. **Keyboard shortcut (Cmd/Ctrl+Enter) submit.** Today's gate is `selectedScouts.size > 0 && parsedAmount > 0 && !isLoading`. Becomes `selectedScouts.size > 0 && effectiveAmount > 0 && !isLoading`. Same semantics.

## Files involved

- **Modify**: `src/components/billing/billing-form.tsx` — replace `amount`/`showLineItems`/`lineItems` state shape with a single `lineItems` state; remove the Total Amount input; restructure the items section; update derived calculations and submit payload.
- **Modify**: `src/lib/billing-validation.ts` — rewrite `validateLineItems`: drop `totalAmount` parameter, drop sum-equality branch, swap "all rows need description" for "rows need description when length >= 2".
- **Modify**: `tests/unit/billing-form-validation.test.ts` — existing test file. Update all `validateLineItems` calls to drop the `totalAmount` argument. Delete sum-mismatch tests. Add the conditional-description-rule tests.
- **Create/Modify**: `tests/unit/components/billing-form.test.tsx` — new file if it doesn't exist; covers the seven component test cases below.

No new files in `src/`. No schema changes. No changes to billing-management-view, billing-form callers, the email templates, or the server actions.

## Testing strategy

### Component tests (RTL)

In `tests/unit/components/billing-form.test.tsx`:

1. **Default render** — one row visible, no `×` button on it, Total reads `$0.00`, Submit button disabled.
2. **Single-row amount entry** — type `50` into row 1's amount input, Total updates to `$50.00`, Submit becomes enabled (assuming scouts selected and description filled).
3. **Single-row submit (description blank)** — fill description, type amount, select scout, submit. Mock the server action and assert the payload has `line_items: null` and `total_amount: 50`.
4. **Single-row submit with description filled** — fill row 1 description with "Camp fee", amount 50. Submit. Assert payload has `line_items: [{description: 'Camp fee', amount: 50}]`.
5. **Multi-row entry** — click `+ Add another item`, fill row 2 with description "Food" + amount 30. Total updates to `$80.00`. Submit. Assert payload has `line_items: [{description: 'OG description', amount: 50}, {description: 'Food', amount: 30}]`.
6. **Multi-row missing description** — add a second row, fill amount only (description blank). Try to submit. Assert validation error "Line item 2 needs a description" and submit is blocked.
7. **Add and remove a row** — add a row (2 rows shown), click `×` on row 2 (1 row shown). State returns to one row; `×` button on the remaining row is hidden.

### Unit tests for `validateLineItems`

Update the existing `tests/unit/billing-form-validation.test.ts` (the file that today tests `validateLineItems` and `validateDeposit` against the old signature). The new `tests/unit/lib/billing-validation.test.ts` from PR #34 only covers `parseLineItems` and is unaffected.

The existing tests in `billing-form-validation.test.ts` currently pass `(lineItems, totalAmount)` to `validateLineItems`. Under this spec, the signature drops `totalAmount` — every existing test call site must be updated to drop that second argument. Tests that previously covered the sum-equality branch ("sum mismatch returns an error") are deleted; the branch is gone.

Net test coverage after the update:

8. **Empty array → null** (kept, no signature concern).
9. **One row, amount > 0, description blank → null** (NEW behavior — single-row submissions don't require description).
10. **Two rows, both with description and amount > 0 → null** (kept).
11. **Two rows, second one missing description → error referencing "Line item 2"** (replaces today's "All line items must have a description" rule; the new error names the row).
12. **One row, amount = 0 → error containing "positive" or "greater than $0"** (kept).
13. **One row, amount = -5 → error containing "positive"** (kept).
14. **Sum-mismatch test cases — DELETED** (the function no longer takes a `totalAmount` parameter).

`validateDeposit` tests in the same file are unaffected (deposit signature didn't change).

### Manual verification

After implementation:
1. Reset dev DB, log in as treasurer.
2. Create a billing record with one row, amount $50, no row description. Verify it persists and the row description doesn't appear in any consumer (email, billing list).
3. Create a billing record with three line items summing to $100. Verify email shows "Bill Includes" section with all three items.
4. Verify the deposit field still validates correctly against the derived total.
5. Verify fixed-vs-split still calculates per-scout amount correctly.

## Risks

- **Breaks the muscle memory of users who liked typing into "Total Amount" first.** The new UI's amount input lives inside a line-item row instead of being a top-level field. For a quick $5 fee, users now also see a description placeholder they can ignore. Mitigated by the placeholder text making it clearly optional.

- **`validateLineItems` signature change is a breaking change for callers.** The function currently takes `(lineItems: LineItem[], totalAmount: number) => string | null`. The new signature drops `totalAmount`. Grep confirms only two callers exist: `src/components/billing/billing-form.tsx:129` (the form itself, which this spec rewrites) and `tests/unit/billing-form-validation.test.ts` (the test file, which this spec updates). No production code outside the billing form consumes it.

- **Conditional description requirement could surprise users who add a second row then change their minds.** They might fill the second amount, leave it without a description, and hit submit expecting it to work. The form blocks with a clear error message. Acceptable trade-off vs. the alternative of saving unlabeled items into the DB.

- **The first row's `×` being hidden when there's only one row.** If users instinctively try to remove the only row (perhaps wanting to "reset"), they can't. The form requires at least one row. Mitigated by making the row's inputs cleanly clearable.

## Open questions

None at the time of spec sign-off.
