---
status: approved
last_verified: 2026-05-13
---

# Billing Email — Line Item Detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface `billing_records.line_items` in the `charge-notification.ts` parent email — full record-level amounts plus a "Your scout's share: $X (1/N of the total)" footer on multi-scout records — and thread the new data through both notify routes (`billing-records/[id]/notify` and `billing-charges/[id]/notify`).

**Spec:** [docs/superpowers/specs/2026-05-13-billing-email-line-items-design.md](../docs/superpowers/specs/2026-05-13-billing-email-line-items-design.md)

**Architecture:** One `parseLineItems()` runtime type guard alongside the existing `validateLineItems` in `billing-validation.ts` (the JSON-boundary parser). The email template gains two optional fields (`lineItems`, `totalScoutsOnRecord`) and a private `renderBillIncludesSection()` helper that returns empty strings when there's nothing to render. Both notify routes select `line_items` + `total_amount` from `billing_records`, call `parseLineItems()`, count active sibling scouts, and pass through to the template. Pure additive: emails without line items render identically to today.

**Tech Stack:** TypeScript, Next.js 16 App Router, Supabase, Vitest 4.

**Files involved:**

- **Modify** `src/lib/billing-validation.ts` (add `parseLineItems` export)
- **Create** `tests/unit/lib/billing-validation.test.ts` (`parseLineItems` tests)
- **Modify** `src/lib/email/templates/charge-notification.ts` (interface fields, helper, HTML + text interpolation)
- **Create** `tests/unit/lib/email/charge-notification.test.ts` (template render tests)
- **Modify** `src/app/api/billing-records/[id]/notify/route.ts` (query + type + call site)
- **Modify** `src/app/api/billing-charges/[id]/notify/route.ts` (query + type + count + call site)

**Out of scope** (per spec): changes to `payment-reminder.ts`, schema, or how line items are configured.

---

## Task 1: `parseLineItems` type guard

**Files:**
- Create: `tests/unit/lib/billing-validation.test.ts`
- Modify: `src/lib/billing-validation.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `tests/unit/lib/billing-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseLineItems } from '@/lib/billing-validation'

describe('parseLineItems', () => {
  it('returns the array when every entry has description (string) and amount (number)', () => {
    const input = [
      { description: 'Tent rental', amount: 80 },
      { description: 'Food', amount: 100 },
    ]
    expect(parseLineItems(input)).toEqual(input)
  })

  it('accepts entries with extra fields beyond description and amount', () => {
    const input = [{ description: 'Tent rental', amount: 80, foo: 'bar' }]
    expect(parseLineItems(input)).toEqual(input)
  })

  it('returns null for null input', () => {
    expect(parseLineItems(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseLineItems(undefined)).toBeNull()
  })

  it('returns null for non-array inputs (string, number, plain object)', () => {
    expect(parseLineItems('not an array')).toBeNull()
    expect(parseLineItems(42)).toBeNull()
    expect(parseLineItems({ description: 'X', amount: 10 })).toBeNull()
  })

  it('returns null when at least one entry is not a plain object', () => {
    expect(parseLineItems([{ description: 'OK', amount: 10 }, 'bad'])).toBeNull()
    expect(parseLineItems([null])).toBeNull()
  })

  it('returns null when at least one entry has a missing or wrong-typed field', () => {
    expect(parseLineItems([{ description: 'no amount' }])).toBeNull()
    expect(parseLineItems([{ amount: 10 }])).toBeNull()
    expect(parseLineItems([{ description: 'X', amount: 'ten' }])).toBeNull()
    expect(parseLineItems([{ description: 42, amount: 10 }])).toBeNull()
  })

  it('returns an empty array unchanged (no entries to validate)', () => {
    expect(parseLineItems([])).toEqual([])
  })
})
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/billing-validation.test.ts`
Expected: FAIL — "parseLineItems is not exported from '@/lib/billing-validation'". Module-not-export error, not a runtime error.

- [ ] **Step 1.3: Add the implementation**

In `src/lib/billing-validation.ts`, append after the existing exports:

```ts
export function parseLineItems(
  raw: unknown
): Array<{ description: string; amount: number }> | null {
  if (!Array.isArray(raw)) return null
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const obj = item as Record<string, unknown>
    if (typeof obj.description !== 'string') return null
    if (typeof obj.amount !== 'number') return null
  }
  return raw as Array<{ description: string; amount: number }>
}
```

- [ ] **Step 1.4: Run tests + lint + typecheck**

Run: `npx vitest run tests/unit/lib/billing-validation.test.ts`
Expected: PASS — 8 tests pass.

Run: `npx eslint src/lib/billing-validation.ts tests/unit/lib/billing-validation.test.ts`
Expected: no output (clean).

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/billing-validation.ts tests/unit/lib/billing-validation.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): add parseLineItems runtime type guard at the JSON boundary

Pure helper that validates an unknown value as Array<{description, amount}>
and returns null for any malformed input (non-array, missing fields, wrong
field types). Will be consumed by the notify routes when reading
billing_records.line_items (typed as Json | null in the generated schema)
before passing the parsed array to the email template.
EOF
)"
```

---

## Task 2: `charge-notification.ts` template enhancement

**Files:**
- Modify: `src/lib/email/templates/charge-notification.ts`
- Create: `tests/unit/lib/email/charge-notification.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `tests/unit/lib/email/charge-notification.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  generateChargeNotificationEmail,
  type ChargeNotificationEmailData,
} from '@/lib/email/templates/charge-notification'

const baseData: ChargeNotificationEmailData = {
  guardianName: 'Pat Doe',
  scoutName: 'Alex Doe',
  unitName: 'Troop 42',
  unitLogoUrl: null,
  chargeDescription: 'Summer Camp Deposit',
  chargeAmount: 50,
  chargeDate: '2026-05-13',
  currentBalance: -50,
  availableCredit: 0,
  paymentUrl: 'https://example.com/pay/abc',
}

describe('generateChargeNotificationEmail — line items', () => {
  it('renders no "Bill Includes" section when lineItems is null', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      lineItems: null,
      totalScoutsOnRecord: 4,
    })
    expect(html).not.toContain('Bill Includes')
    expect(text).not.toContain('Bill Includes')
  })

  it('renders no "Bill Includes" section when lineItems is omitted entirely', () => {
    const { html, text } = generateChargeNotificationEmail(baseData)
    expect(html).not.toContain('Bill Includes')
    expect(text).not.toContain('Bill Includes')
  })

  it('renders no "Bill Includes" section when lineItems is an empty array', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      lineItems: [],
      totalScoutsOnRecord: 4,
    })
    expect(html).not.toContain('Bill Includes')
    expect(text).not.toContain('Bill Includes')
  })

  it('renders line items, total, and NO share line for single-scout records', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      chargeAmount: 50,
      lineItems: [
        { description: 'Activity fee', amount: 40 },
        { description: 'T-shirt', amount: 10 },
      ],
      totalScoutsOnRecord: 1,
    })
    // HTML
    expect(html).toContain('Bill Includes')
    expect(html).toContain('Activity fee')
    expect(html).toContain('$40.00')
    expect(html).toContain('T-shirt')
    expect(html).toContain('$10.00')
    expect(html).toContain('$50.00')
    expect(html).not.toContain("Your scout's share")
    // Text
    expect(text).toContain('Bill Includes')
    expect(text).toContain('Activity fee')
    expect(text).toContain('$40.00')
    expect(text).not.toContain("Your scout's share")
  })

  it('renders line items at full amounts AND a share line for multi-scout records', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      chargeAmount: 50,
      lineItems: [
        { description: 'Tent rental', amount: 80 },
        { description: 'Food', amount: 100 },
        { description: 'T-shirt', amount: 20 },
      ],
      totalScoutsOnRecord: 4,
    })
    // HTML — full record-level amounts present
    expect(html).toContain('Tent rental')
    expect(html).toContain('$80.00')
    expect(html).toContain('Food')
    expect(html).toContain('$100.00')
    expect(html).toContain('T-shirt')
    expect(html).toContain('$20.00')
    expect(html).toContain('$200.00') // total
    // Share line present, anchored to the parent's chargeAmount
    expect(html).toContain("Your scout's share")
    expect(html).toContain('$50.00')
    expect(html).toContain('1/4 of the total')
    // Text
    expect(text).toContain('Tent rental')
    expect(text).toContain('$80.00')
    expect(text).toContain("Your scout's share: $50.00")
    expect(text).toContain('1/4 of the total')
  })

  it('renders line items but NO share line when totalScoutsOnRecord is 0 (defensive)', () => {
    const { html, text } = generateChargeNotificationEmail({
      ...baseData,
      lineItems: [{ description: 'Activity fee', amount: 50 }],
      totalScoutsOnRecord: 0,
    })
    expect(html).toContain('Bill Includes')
    expect(html).toContain('Activity fee')
    expect(html).not.toContain("Your scout's share")
    expect(text).toContain('Bill Includes')
    expect(text).not.toContain("Your scout's share")
  })
})
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/email/charge-notification.test.ts`
Expected: 4 of the 6 tests fail. The two "no Bill Includes" tests for null / omitted / empty will pass already (the string is never produced today). The single-scout, multi-scout, and defensive tests fail because the new fields aren't in the interface yet — TypeScript will error on the test file. The "renders no Bill Includes when lineItems is null" test compiles but currently the field doesn't exist on the type, so this test ALSO fails at compile time.

Confirm the failure mode is a TypeScript error citing `lineItems` (or `totalScoutsOnRecord`) is not a valid property of `ChargeNotificationEmailData`. NOT a runtime error.

- [ ] **Step 2.3: Add the new fields to the interface**

In `src/lib/email/templates/charge-notification.ts`, find the `ChargeNotificationEmailData` interface at lines 1-13. Add two new optional fields at the end:

```ts
export interface ChargeNotificationEmailData {
  guardianName: string
  scoutName: string
  unitName: string
  unitLogoUrl?: string | null
  chargeDescription: string
  chargeAmount: number // in dollars
  chargeDate: string
  currentBalance: number // total owed (negative) or credit (positive)
  availableCredit: number // positive balance that can be applied
  paymentUrl: string
  customMessage?: string
  lineItems?: Array<{ description: string; amount: number }> | null
  totalScoutsOnRecord?: number
}
```

- [ ] **Step 2.4: Add the `renderBillIncludesSection` helper**

In the same file, add the helper directly above the `generateChargeNotificationEmail` export (after `formatDate` at line 28):

```ts
function renderBillIncludesSection(
  lineItems: Array<{ description: string; amount: number }> | null | undefined,
  totalScoutsOnRecord: number | undefined,
  chargeAmount: number
): { html: string; text: string } {
  if (!lineItems || lineItems.length === 0) {
    return { html: '', text: '' }
  }

  const total = lineItems.reduce((sum, item) => sum + item.amount, 0)
  const scoutCount = totalScoutsOnRecord ?? 0
  const showShareLine = scoutCount >= 2

  const itemRowsHtml = lineItems
    .map(
      (item) => `
                      <tr>
                        <td style="padding: 4px 0; color: #4b5563;">${item.description}</td>
                        <td style="padding: 4px 0; text-align: right; color: #4b5563;">${formatCurrency(item.amount)}</td>
                      </tr>`
    )
    .join('')

  const html = `
              <!-- Bill Includes Box -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #374151; font-weight: 600;">Bill Includes</p>
                    <table role="presentation" style="width: 100%;">
                      ${itemRowsHtml}
                      <tr style="border-top: 1px solid #e5e7eb;">
                        <td style="padding: 8px 0 4px; font-weight: 700; color: #111827;">Total</td>
                        <td style="padding: 8px 0 4px; text-align: right; font-weight: 700; color: #111827;">${formatCurrency(total)}</td>
                      </tr>
                    </table>
                    ${
                      showShareLine
                        ? `
                    <p style="margin: 16px 0 0; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 13px; color: #6b7280;">
                      Your scout's share: <strong>${formatCurrency(chargeAmount)}</strong><br>
                      (1/${scoutCount} of the total)
                    </p>`
                        : ''
                    }
                  </td>
                </tr>
              </table>
`

  const itemRowsText = lineItems
    .map((item) => `  ${item.description}: ${formatCurrency(item.amount)}`)
    .join('\n')

  const text = `
Bill Includes:
${itemRowsText}
  ----------------------
  Total: ${formatCurrency(total)}${
    showShareLine
      ? `

  Your scout's share: ${formatCurrency(chargeAmount)} (1/${scoutCount} of the total)`
      : ''
  }
`

  return { html, text }
}
```

- [ ] **Step 2.5: Wire the helper into the template body**

In the same file's `generateChargeNotificationEmail` function:

(a) Destructure the new fields. Find the destructure block at lines 34-46:

```ts
  const {
    guardianName,
    scoutName,
    unitName,
    unitLogoUrl,
    chargeDescription,
    chargeAmount,
    chargeDate,
    currentBalance,
    availableCredit,
    paymentUrl,
    customMessage,
  } = data
```

Append two lines after `customMessage,`:

```ts
    lineItems,
    totalScoutsOnRecord,
```

(b) Compute the bill-includes section once. Right after the destructure block, before the `owesAmount` line:

```ts
  const billIncludes = renderBillIncludesSection(lineItems, totalScoutsOnRecord, chargeAmount)
```

(c) Interpolate the HTML. Find the closing `</table>` of the Charge Details box at around line 105 (followed by the credit-balance notice section). Insert `${billIncludes.html}` between the Charge Details box closing tag and the credit-balance section:

Find this pattern:
```tsx
              </table>

              <!-- Credit Balance Notice -->
              ${hasCredit ? `
```

Replace with:
```tsx
              </table>
              ${billIncludes.html}
              <!-- Credit Balance Notice -->
              ${hasCredit ? `
```

(d) Interpolate the plain text. Find the existing plain-text Charge Details block at lines 188-191:

```ts
Charge Details:
  Description: ${chargeDescription}
  Date: ${formatDate(chargeDate)}
  Amount: ${formatCurrency(chargeAmount)}
```

Insert `${billIncludes.text}` directly after it (before the next `\n\n${hasCredit ? ...}` line):

```ts
Charge Details:
  Description: ${chargeDescription}
  Date: ${formatDate(chargeDate)}
  Amount: ${formatCurrency(chargeAmount)}
${billIncludes.text}
${hasCredit ? `Good news! ${scoutName} has ${formatCurrency(availableCredit)} in account credit that can be applied to this charge.\n\n` : ''}Current Account Balance: ${owesAmount > 0 ? formatCurrency(owesAmount) + ' owed' : formatCurrency(Math.abs(currentBalance)) + ' credit'}
```

(Note: `billIncludes.text` starts with `\n` and ends without one, so the surrounding newlines need to flow naturally. If `lineItems` is null, `billIncludes.text === ''` and the empty string produces a single blank line between Charge Details and the rest — acceptable.)

- [ ] **Step 2.6: Run the tests + lint + typecheck**

Run: `npx vitest run tests/unit/lib/email/charge-notification.test.ts`
Expected: PASS — all 6 tests pass.

Run: `npx vitest run`
Expected: full suite PASS. 1183 tests total (was 1174; +8 from Task 1 helper, +6 from Task 2 template — wait, Task 1 was 8 tests, Task 2 is 6, so 1174 + 8 + 6 = 1188. Use whichever count the suite shows; the key is no failures).

Run: `npx eslint src/lib/email/templates/charge-notification.ts tests/unit/lib/email/charge-notification.test.ts`
Expected: clean.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 2.7: Commit**

```bash
git add src/lib/email/templates/charge-notification.ts tests/unit/lib/email/charge-notification.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): render Bill Includes section in charge-notification email

The charge-notification.ts template gains two optional fields (lineItems,
totalScoutsOnRecord) and a private renderBillIncludesSection helper. When
the billing record has line items, the email body now shows a "Bill
Includes" box after Charge Details — items at their full record-level
amounts, a total, and (only for multi-scout records) a "Your scout's
share: $X (1/N of the total)" footer. Single-scout records render line
items + total only; the share line is suppressed because the total equals
the parent's charge. Records without line items render unchanged from
today.

Pure additive change at the template layer. Notify routes still pass
undefined for the new fields after this task; they get the wiring in
Tasks 3 and 4.
EOF
)"
```

---

## Task 3: Wire `billing-records/[id]/notify` route

**Files:**
- Modify: `src/app/api/billing-records/[id]/notify/route.ts`

This is pure plumbing — TypeScript verifies the wiring. No new tests; the template tests from Task 2 cover the rendering, the route is thin glue.

- [ ] **Step 3.1: Add imports and extend the Supabase query**

In `src/app/api/billing-records/[id]/notify/route.ts`, at the top of the file, add the import for `parseLineItems`:

```ts
import { parseLineItems } from '@/lib/billing-validation'
```

Find the Supabase `.from('billing_records').select(...)` at lines 55-83. The current select string is:

```
id,
description,
billing_date,
unit_id,
is_void,
billing_charges (...)
```

Update to include `line_items` and `total_amount`:

```ts
    const { data: recordData, error: recordError } = await supabase
      .from('billing_records')
      .select(`
        id,
        description,
        billing_date,
        unit_id,
        is_void,
        line_items,
        total_amount,
        billing_charges (
          id,
          amount,
          is_paid,
          is_void,
          scout_account_id,
          scout_accounts (
            id,
            scout_id,
            billing_balance,
            scouts (
              id,
              first_name,
              last_name
            )
          )
        )
      `)
      .eq('id', billingRecordId)
      .eq('unit_id', membership.unit_id)
      .single()
```

- [ ] **Step 3.2: Extend the inline `billingRecord` type**

Find the type assertion at lines 89-109. The current type has fields up through `billing_charges`. Add `line_items` and `total_amount`:

```ts
    const billingRecord = recordData as unknown as {
      id: string
      description: string
      billing_date: string
      unit_id: string
      is_void: boolean | null
      line_items: unknown
      total_amount: number
      billing_charges: Array<{
        id: string
        amount: number
        is_paid: boolean | null
        is_void: boolean | null
        scout_account_id: string
        scout_accounts: {
          id: string
          scout_id: string
          billing_balance: number
          scouts: { id: string; first_name: string; last_name: string }
        }
      }>
    }
```

(`line_items` typed as `unknown` because PostgREST returns JSON as `unknown` until the runtime guard validates it. The parsed result becomes `Array<{ description: string; amount: number }> | null`.)

- [ ] **Step 3.3: Pass the new fields to the email template**

Find the `generateChargeNotificationEmail(...)` call site at lines 217-229. The current call passes 11 fields. Add the two new ones:

```ts
        const { html, text } = generateChargeNotificationEmail({
          guardianName: guardian.first_name || guardian.full_name || 'Parent',
          scoutName,
          unitName: unit?.name || 'Scout Unit',
          unitLogoUrl: unit?.logo_url,
          chargeDescription: billingRecord.description,
          chargeAmount: Number(charge.amount),
          chargeDate: billingRecord.billing_date,
          currentBalance: balance,
          availableCredit,
          paymentUrl,
          customMessage,
          lineItems: parseLineItems(billingRecord.line_items),
          totalScoutsOnRecord: activeCharges.length,
        })
```

(`activeCharges` is already in scope from line 123 — it's the filtered `!is_void` charges.)

- [ ] **Step 3.4: Verify typecheck + build**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm run build`
Expected: exit 0.

Run: `npx vitest run`
Expected: full suite PASS (no regressions).

- [ ] **Step 3.5: Commit**

```bash
git add 'src/app/api/billing-records/[id]/notify/route.ts'
git commit -m "$(cat <<'EOF'
feat(billing): thread line_items into billing-records notify route

The "Send Billing Reminder" route now selects line_items + total_amount
from billing_records, parses the JSON via parseLineItems (the runtime type
guard from Task 1), counts active sibling charges, and passes both to the
charge-notification email template. Records without line items continue
to produce the same email as before; records with line items now include
the new "Bill Includes" section per the spec.
EOF
)"
```

---

## Task 4: Wire `billing-charges/[id]/notify` route

**Files:**
- Modify: `src/app/api/billing-charges/[id]/notify/route.ts`

Same pattern as Task 3, but the route fetches a single charge and joins up to `billing_records`, so the line-items selection lives in the nested join. Also needs an extra count query for sibling charges.

- [ ] **Step 4.1: Add imports and extend the nested Supabase select**

In `src/app/api/billing-charges/[id]/notify/route.ts`, add the import:

```ts
import { parseLineItems } from '@/lib/billing-validation'
```

Find the `.from('billing_charges').select(...)` call at lines 64-91. The current nested `billing_records (...)` block selects 5 fields. Add `line_items, total_amount`:

```ts
    const { data: chargeData, error: chargeError } = await supabase
      .from('billing_charges')
      .select(`
        id,
        amount,
        is_paid,
        is_void,
        scout_account_id,
        billing_records (
          id,
          description,
          billing_date,
          unit_id,
          is_void,
          line_items,
          total_amount
        ),
        scout_accounts (
          id,
          scout_id,
          billing_balance,
          scouts (
            id,
            first_name,
            last_name
          )
        )
      `)
      .eq('id', billingChargeId)
      .single()
```

- [ ] **Step 4.2: Extend the inline `billingRecord` types**

Find the two type assertions at lines 97-117 (`charge`) and 119-125 (`billingRecord`). The `billing_records` field in the `charge` type and the `billingRecord` standalone type both need `line_items: unknown` and `total_amount: number`:

```ts
    const charge = chargeData as unknown as {
      id: string
      amount: number
      is_paid: boolean | null
      is_void: boolean | null
      scout_account_id: string
      billing_records: {
        id: string
        description: string
        billing_date: string
        unit_id: string
        is_void: boolean | null
        line_items: unknown
        total_amount: number
      }
      scout_accounts: {
        id: string
        scout_id: string
        billing_balance: number
        scouts: { id: string; first_name: string; last_name: string }
      }
    }
```

And the standalone `billingRecord` variable:

```ts
    const billingRecord = charge.billing_records as {
      id: string
      description: string
      billing_date: string
      unit_id: string
      is_void: boolean | null
      line_items: unknown
      total_amount: number
    }
```

- [ ] **Step 4.3: Add a follow-up count query for active sibling charges**

The per-charge route doesn't pre-fetch all sibling charges (the main query only loads the charge we're notifying about). Add a count query after the existing charge fetch + validations (around line 148, after the `scoutAccount` lookup is verified):

```ts
    // Count active sibling charges on the parent record (for the "1/N of the total" line)
    const { count: activeSiblingCount } = await supabase
      .from('billing_charges')
      .select('id', { count: 'exact', head: true })
      .eq('billing_record_id', billingRecord.id)
      .or('is_void.is.null,is_void.eq.false')
```

- [ ] **Step 4.4: Pass the new fields to the email template**

Find the `generateChargeNotificationEmail(...)` call site at line 236. Append the two new fields:

```ts
    const { html, text } = generateChargeNotificationEmail({
      guardianName: guardian.first_name || guardian.full_name || 'Parent',
      scoutName,
      unitName: unit?.name || 'Scout Unit',
      unitLogoUrl: unit?.logo_url,
      chargeDescription: billingRecord.description,
      chargeAmount: Number(charge.amount),
      chargeDate: billingRecord.billing_date,
      currentBalance: balance,
      availableCredit,
      paymentUrl,
      customMessage,
      lineItems: parseLineItems(billingRecord.line_items),
      totalScoutsOnRecord: activeSiblingCount ?? 0,
    })
```

(The exact field list above is taken from the spec. The actual existing call site may have minor variations — keep all existing fields unchanged and append the two new ones at the end.)

- [ ] **Step 4.5: Verify typecheck + build + tests**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run build`
Expected: exit 0.

Run: `npx vitest run`
Expected: full suite PASS.

- [ ] **Step 4.6: Commit**

```bash
git add 'src/app/api/billing-charges/[id]/notify/route.ts'
git commit -m "$(cat <<'EOF'
feat(billing): thread line_items into billing-charges notify route

The per-charge notify route now selects line_items + total_amount from the
parent billing_records (via the existing nested join), parses via
parseLineItems, runs a follow-up count of active sibling charges on the
same parent record, and passes both to the charge-notification template.

The route is reached when a treasurer notifies about a single scout's
charge (BillingChargeActions, currently orphaned but the API endpoint is
live). Same email enhancement as the record-level route from Task 3.
EOF
)"
```

---

## Task 5: Manual verification in dev

**Files:** none (verification only).

- [ ] **Step 5.1: Reset the dev database**

Run: `npm run db:fresh`
Expected: completes without errors.

- [ ] **Step 5.2: Start the dev server**

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev
```

Wait for `Ready in <N>ms`.

- [ ] **Step 5.3: Log in as treasurer**

Open `http://localhost:3000/login` and sign in:
- Email: `richard.blaalid+treasurer@withcaldera.com`
- Password: `testpassword123`

- [ ] **Step 5.4: Multi-scout billing with line items**

Navigate to `/finances/billing`. Click **Create Billing**. Fill out:
- Description: `Multi-Scout Camp Test`
- Date: today
- Amount: `200`
- Type: fixed
- Assign to: 4 scouts at $50 each
- Expand **Line items** (or similar UI toggle). Add three line items:
  - Tent rental, $80
  - Food, $100
  - T-shirt, $20
- Verify the form's line-items total reads $200 (validation passes).

Submit. Confirm the new row appears with "Multiple Scouts" subtext (shipped in PR #33).

Click the Actions menu on the new record → **Send Billing Reminder**.

Check the test guardian's inbox (whatever email provider the dev environment uses — typically Resend). Verify the email contains:
- The existing "Charge Details" box: Description "Multi-Scout Camp Test", Amount "$50.00"
- A new "Bill Includes" box below it: rows for "Tent rental $80.00", "Food $100.00", "T-shirt $20.00", a Total row "$200.00", and a footer "Your scout's share: $50.00 (1/4 of the total)"

- [ ] **Step 5.5: Single-scout billing with line items**

Repeat **Create Billing** with:
- Description: `Single-Scout Test`
- Amount: `50`
- 1 scout, $50
- Line items: `Activity fee` $40, `T-shirt` $10

Send the reminder. Confirm the email's Bill Includes section shows the two items + Total $50.00, and does **not** show any "Your scout's share" footer line.

- [ ] **Step 5.6: Billing record without line items (regression guard)**

Create a new billing without expanding/adding line items. Send the reminder. Confirm the email is identical to today — no Bill Includes box.

- [ ] **Step 5.7: Report results**

Reply with what you confirmed across the three scenarios, including any deviations from the spec. No commit needed.

---

## Self-review checklist (for the plan author)

After writing this plan, I checked against the spec:

- ✅ Spec section "State machine (what renders)" — Task 2 tests cover all 4 rows (null, single-scout, multi-scout, defensive 0-scouts).
- ✅ Spec section "HTML layout" — Task 2 Step 2.4 has the explicit HTML structure including the `#f9fafb` background and `#e5e7eb` border described in the spec.
- ✅ Spec section "Plain-text version" — Task 2 Step 2.4 helper builds the same structure for text output.
- ✅ Spec section "Template signature" — Task 2 Step 2.3 adds the two optional fields.
- ✅ Spec section "Private helper inside the template" — Task 2 Step 2.4 creates `renderBillIncludesSection`.
- ✅ Spec section "Notify routes" — Task 3 (billing-records/[id]/notify) + Task 4 (billing-charges/[id]/notify) thread the fields with the exact query patterns from the spec.
- ✅ Spec section "Type guard at the JSON boundary" — Task 1 implements `parseLineItems` in `billing-validation.ts` with the same shape as the spec's pseudocode.
- ✅ Spec section "Testing strategy / Unit tests" — Tasks 1 and 2 implement.
- ✅ Spec section "Testing strategy / Manual verification" — Task 5 walks the three scenarios.
- ✅ Spec section "Files touched" — every file listed is covered by a task.
- ✅ No placeholders. Every step has exact code, exact commands, or explicit expected behavior.
- ✅ Type consistency: `parseLineItems`, `ChargeNotificationEmailData.lineItems`, `ChargeNotificationEmailData.totalScoutsOnRecord`, `renderBillIncludesSection` all use the same `Array<{ description: string; amount: number }>` shape end-to-end.
