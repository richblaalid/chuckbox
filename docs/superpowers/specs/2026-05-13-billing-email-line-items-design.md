---
status: approved
last_verified: 2026-05-13
---

# Billing Email — Line Item Detail

## Context

A treasurer creating a billing record can attach optional **line items** — a JSON array of `{description, amount}` pairs that sum to the record's total — to describe what the bill covers (e.g., "Tent rental: $80, Food: $100, T-shirt: $20" for a $200 Summer Camp record). The billing form validates this sum equality at creation time.

These line items are stored on `billing_records.line_items` but never surface in the parent-facing emails today. When a parent receives a billing notification (the "Send Billing Reminder" action on a billing record, or the per-charge notify path), the email shows only the record's description ("Summer Camp Deposit"), the charge amount, and the account balance. The parent has no way to see what the bill is actually for unless they happen to ask the treasurer.

This spec adds a "Bill Includes" section to the `charge-notification.ts` email template, showing line items at their full record-level amounts plus a per-scout share line for multi-scout records.

Third item of the billing UX queue:
1. ✅ Partial-payment display (shipped PR #32)
2. ✅ Scout name on cards (shipped PR #33)
3. **Line items in parent emails** ← this spec
4. Create-billing modal: line items ↔ total interaction

## Goals

- A parent receiving a billing notification can see exactly what the bill is for, item by item.
- For multi-scout records, the email makes clear that the parent's charge is a portion of a larger total — line items show the full bill, then a clarifying "Your scout's share" line ties the parent's charge back to the total.
- For single-scout records, the line items sum to the parent's full charge (no share calculation needed). No "share" language appears.
- When a billing record has no line items, the email is unchanged from today — no empty section, no visual artifact.

## Non-goals

- No changes to `payment-reminder.ts` (the aggregate-balance reminder from the Collection flow). That email aggregates across multiple records and is its own design problem; out of scope.
- No changes to how line items are *configured* in the billing form. The form already validates that line items sum to the total.
- No changes to schema. `billing_records.line_items` already exists as a JSON column.
- No changes to other email templates (`expense-approved`, `expense-rejected`, `payment-request`).

## State machine (what renders)

Whether the new "Bill Includes" section renders, and whether the "Your scout's share" footer appears within it, depends on two inputs:

| `lineItems` (from `billing_records.line_items`) | `totalScoutsOnRecord` (active charges on the record) | "Bill Includes" section | "Your scout's share" footer |
|---|---|---|---|
| `null` or `[]` | any | not rendered | not rendered |
| non-empty | 0 (defensive — should not occur in practice) | rendered with line items + total | not rendered |
| non-empty | 1 (single-scout record) | rendered with line items + total | **not rendered** (redundant — total equals the charge) |
| non-empty | 2+ (multi-scout record) | rendered with line items + total | rendered: `Your scout's share: $X (1/N of the total)` |

### Why suppress the share line for single-scout

When `totalScoutsOnRecord === 1`, the line items sum to the total, which equals the parent's charge. The Charge Details box already shows `Amount: $X`, and the Bill Includes total reads `$X`. A "share" line saying `$X (1/1 of the total)` adds noise — there's no sharing happening, just one scout's full bill itemized.

For multi-scout records, the share line is meaningful: line items sum to the full record total (e.g., $200), the parent's charge is a fraction of that (e.g., $50), and the share line bridges the two.

### Defensive `totalScoutsOnRecord === 0`

The notify route already errors out if all charges are voided or none exist, so this state isn't reachable in normal flow. The template handles it defensively anyway: render the line items + total, but suppress the share line. Better than dividing by zero or rendering "1/0".

## UI changes

### HTML layout

The existing email body has these sections in order: greeting → optional custom message → "A new charge has been added…" intro paragraph → Charge Details box → optional Credit Balance Notice → Current Account Balance → CTA button.

Under this spec, a new "Bill Includes" box is inserted **directly after the Charge Details box** (and before the optional Credit Balance Notice). Styling:

- Container: same outer table-cell wrapper pattern used by Charge Details and Current Account Balance.
- Background: light neutral (`#f9fafb` — same as the Current Account Balance box, distinct from the red `#fef2f2` Charge Details box). The Bill Includes section is informational, not "money owed," so it shouldn't share the red urgency styling.
- Border: `1px solid #e5e7eb`.
- Border-radius: `8px`.
- Padding: `20px`.
- Heading: `Bill Includes` in `font-size: 14px; color: #374151; font-weight: 600`.
- Line items: rendered as a two-column table — description left, amount right-aligned. Each row `padding: 4px 0; color: #4b5563`.
- Separator above total: `border-top: 1px solid #e5e7eb`.
- Total row: `font-weight: 700; color: #111827`.
- Share line (when present): below the total, padding-top, color `#6b7280`, font-size `13px`. Two lines:
  ```
  Your scout's share: $50.00
  (1/4 of the total)
  ```

Mock for a multi-scout billing (the 4-scout, $200 Summer Camp example):

```
┌─ Bill Includes ──────────────────┐
│ Tent rental              $80.00  │
│ Food                    $100.00  │
│ T-shirt                  $20.00  │
│ ─────────────────────────────    │
│ Total                   $200.00  │
│                                  │
│ Your scout's share: $50.00       │
│ (1/4 of the total)               │
└──────────────────────────────────┘
```

Single-scout mock:

```
┌─ Bill Includes ──────────────────┐
│ Activity fee             $40.00  │
│ T-shirt                  $10.00  │
│ ─────────────────────────────    │
│ Total                    $50.00  │
└──────────────────────────────────┘
```

### Plain-text version

The email template also generates a plain-text fallback. Under this spec, the same conditional section is added there, after the existing Charge Details block:

Multi-scout:
```
Bill Includes:
  Tent rental:    $80.00
  Food:          $100.00
  T-shirt:        $20.00
  ----------------------
  Total:         $200.00

  Your scout's share: $50.00 (1/4 of the total)
```

Single-scout:
```
Bill Includes:
  Activity fee:   $40.00
  T-shirt:        $10.00
  ----------------------
  Total:          $50.00
```

When no line items: no section, no separator. Existing plain text identical to today.

## Data flow

### Template signature

`generateChargeNotificationEmail()` in `src/lib/email/templates/charge-notification.ts` gains two new optional fields on `ChargeNotificationEmailData`:

```ts
export interface ChargeNotificationEmailData {
  // ... existing fields ...
  lineItems?: Array<{ description: string; amount: number }> | null
  totalScoutsOnRecord?: number  // active (non-voided) charge count on the billing record
}
```

Both are optional with `null` / `undefined` defaults, so existing callers that don't pass them produce the same email as today.

### Private helper inside the template

To keep `charge-notification.ts` readable, a private helper function inside the file builds the new section:

```ts
function renderBillIncludesSection(
  lineItems: Array<{ description: string; amount: number }> | null | undefined,
  totalScoutsOnRecord: number | undefined,
  chargeAmount: number
): { html: string; text: string }
```

The helper returns `{ html: '', text: '' }` (empty strings) when `lineItems` is null/undefined/empty. The main template interpolates the outputs into the existing HTML and text bodies; when both are empty, no visual artifact appears.

### Notify routes

Two routes call `generateChargeNotificationEmail`:

1. `src/app/api/billing-records/[id]/notify/route.ts` — "Send Billing Reminder" on a record. This route's Supabase query at lines 55-83 currently selects:
   ```
   id, description, billing_date, unit_id, is_void, billing_charges(...)
   ```
   Add `line_items` and `total_amount` to the select. The inline type for `billingRecord` gains `line_items: Json | null` and `total_amount: number`. The call site at lines 217-229 passes the parsed line items and the active-scout count:
   ```ts
   lineItems: parseLineItems(billingRecord.line_items),
   totalScoutsOnRecord: activeCharges.length,
   ```

2. `src/app/api/billing-charges/[id]/notify/route.ts` — per-charge notification (called from `BillingChargeActions`, currently orphaned but the route is live). Two concrete changes:
   - **Existing nested select on `billing_records`** at lines 72-78 gains `line_items, total_amount`:
     ```ts
     billing_records (
       id,
       description,
       billing_date,
       unit_id,
       is_void,
       line_items,
       total_amount
     )
     ```
   - **Inline type for `billingRecord`** gains `line_items: Json | null` and `total_amount: number`.
   - **New follow-up query** after the existing charge fetch, to count active sibling charges on the same parent record:
     ```ts
     const { count: totalScoutsOnRecord } = await supabase
       .from('billing_charges')
       .select('id', { count: 'exact', head: true })
       .eq('billing_record_id', billingRecord.id)
       .or('is_void.is.null,is_void.eq.false')
     ```
     Pass `totalScoutsOnRecord ?? 0` to the template. Defensive `?? 0` because Supabase returns `count: number | null`.
   - **Call site** to `generateChargeNotificationEmail` passes:
     ```ts
     lineItems: parseLineItems(billingRecord.line_items),
     totalScoutsOnRecord: totalScoutsOnRecord ?? 0,
     ```

Both routes need the same field threading. Same change pattern.

### Type guard at the JSON boundary

`billing_records.line_items` is typed in `database.ts` as `Json | null`. The notify routes cast the value to `Array<{ description: string; amount: number }> | null` based on a runtime check that it's an array and each entry has `description` (string) and `amount` (number).

```ts
function parseLineItems(raw: unknown): Array<{ description: string; amount: number }> | null {
  if (!Array.isArray(raw)) return null
  const valid = raw.every(
    item => typeof item === 'object' && item !== null
      && typeof (item as { description: unknown }).description === 'string'
      && typeof (item as { amount: unknown }).amount === 'number'
  )
  return valid ? (raw as Array<{ description: string; amount: number }>) : null
}
```

This guard lives in `src/lib/billing-validation.ts` next to the existing `LineItem` interface and the `validateLineItems` function. Both notify routes call it on the fetched `line_items` value before passing to the email template.

## Testing strategy

### Unit tests (vitest)

New file: `tests/unit/lib/email/charge-notification.test.ts` (flat under `tests/unit/lib/email/` to match the existing `expense-templates.test.ts` convention — no `templates/` subdirectory).

Four test cases covering the state-machine table above:

1. **No line items renders no "Bill Includes" section.**
   - Input: `lineItems: null`, `totalScoutsOnRecord: 4`
   - Assert: HTML and text outputs do not contain the string `Bill Includes`.

2. **Single-scout record with line items renders line items + total, no share line.**
   - Input: `lineItems: [{ description: 'Activity fee', amount: 40 }, { description: 'T-shirt', amount: 10 }]`, `totalScoutsOnRecord: 1`, `chargeAmount: 50`
   - Assert HTML: contains `Bill Includes`, `Activity fee`, `T-shirt`, `$40.00`, `$10.00`, `Total`, `$50.00`. Does NOT contain `Your scout's share`.
   - Assert text: same as HTML.

3. **Multi-scout record renders line items at full amounts + share line.**
   - Input: `lineItems: [{ description: 'Tent rental', amount: 80 }, { description: 'Food', amount: 100 }, { description: 'T-shirt', amount: 20 }]`, `totalScoutsOnRecord: 4`, `chargeAmount: 50`
   - Assert HTML: contains all three descriptions and their full amounts ($80.00, $100.00, $20.00), `Total`, `$200.00`, `Your scout's share: $50.00`, `(1/4 of the total)`.
   - Assert text: same.

4. **Defensive: `totalScoutsOnRecord === 0` renders line items but no share line.**
   - Input: `lineItems` non-empty, `totalScoutsOnRecord: 0`
   - Assert: line items render, share line absent.

A 5th test for `parseLineItems` lives in `tests/unit/lib/billing-validation.test.ts` (new file). Covers: valid array of `{description, amount}` pairs; `null` input; non-array input (string, number, object); array with at least one malformed entry (missing description, wrong type for amount).

### Manual verification

In dev (Task 2 of the plan):
1. `npm run db:fresh`; log in as treasurer.
2. Create a multi-scout billing record (4 scouts, $200 total) with line items "Tent rental: $80, Food: $100, T-shirt: $20".
3. From `/finances/billing`, click the Actions menu → **Send Billing Reminder**.
4. Check the test guardian's inbox (Resend or whatever email provider the dev environment uses).
5. Verify the email has a "Bill Includes" section with the three line items, total $200, and "Your scout's share: $50.00 (1/4 of the total)" footer.
6. Repeat with a single-scout billing with line items — verify the section renders but the share line is absent.
7. Repeat with a billing record that has *no* line items — verify the email is identical to before this change (no Bill Includes section, no visual artifact).

## Files touched

- **Modify** `src/lib/email/templates/charge-notification.ts` (add `lineItems` + `totalScoutsOnRecord` fields to interface, add `renderBillIncludesSection` private helper, interpolate into HTML + text).
- **Modify** `src/app/api/billing-records/[id]/notify/route.ts` (extend Supabase query and inline type, pass new fields to template).
- **Modify** `src/app/api/billing-charges/[id]/notify/route.ts` (same threading).
- **Modify** `src/lib/billing-validation.ts` (add `parseLineItems` type guard alongside existing `LineItem` interface).
- **Create** `tests/unit/lib/email/charge-notification.test.ts` (4 template-render tests).
- **Create** `tests/unit/lib/billing-validation.test.ts` (`parseLineItems` tests; new file).

No schema changes. No new dependencies.

## Risks

- **Line items don't sum to total on existing prod records.** The billing form validates the sum at creation time, but historical records pre-validation could in principle have malformed `line_items`. Mitigation: the template renders the items and their stored amounts as-is; the displayed `Total` is the sum of `lineItems[].amount`, not `billing_record.total_amount`. If the two diverge, the email is internally consistent (line items + total all show the line-item sum). The "Your scout's share" calculation uses the parent's actual `chargeAmount`, not derived from the line-item sum, so the share number is always correct relative to what the parent actually owes.

- **`parseLineItems` rejects malformed JSON.** If the type guard fails, the email falls back to "no line items" rendering — same as records without line items. No crash, no broken email.

- **Long line-item descriptions wrap or overflow.** The email table cells use the same patterns as existing rows in Charge Details, which already handle wrapping for long descriptions. Low risk; mitigated by visual inspection during manual verification.

- **Per-charge notify route fetches a charge, not a record.** The implementation needs to navigate up to the parent record to get `line_items` and count sibling active charges. This adds a join, which is fine — the route already joins to `billing_records` for the description.

## Open questions

None at the time of spec sign-off.
