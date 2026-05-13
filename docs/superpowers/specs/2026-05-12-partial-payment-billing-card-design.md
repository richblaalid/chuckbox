---
status: approved
last_verified: 2026-05-12
---

# Partial Payment Display on Billing Records

## Context

A treasurer can record a partial payment against a billing charge — for example, applying $20 from a scout's funds against a $50 charge, or collecting $15 cash toward a $25 owed amount. The data model already supports this: `billing_charges.paid_amount` is incremented by each payment allocation, and `is_paid` flips to `true` only when `paid_amount >= amount`.

The UI does not surface this state. The billing records page (`/finances/billing`) renders each record as a row with an amount column and a status badge; expanding the row reveals per-scout charges. A charge with $20 of $50 paid renders identically to a charge with $0 paid — both show "Unpaid" and display "$50". The amount column on the row shows the full billed total ($200), not what's still owed ($180).

This spec covers the UI changes to surface partial-payment state on the billing-records page and to widen void-protection so a billing record with any actual collected payments cannot be silently deleted.

The actual rendering happens **inline** inside `src/components/billing/billing-management-view.tsx` (rows + expanded view). A separate file `src/components/billing/billing-record-card.tsx` exists but has zero callers; it is dead code and out of scope for this spec (cleanup can happen separately).

Out of scope: changes to how partial payments are *recorded* (that's the `QuickPaymentForm` work already in progress) and changes to email templates / parent notifications (a separate area for a later spec).

## Goals

- A treasurer scanning the billing list sees, per row: how much is still outstanding (not the original billed total), and a status badge that distinguishes "partial" from "unpaid" at the record level whenever any charge has a non-zero `paid_amount`.
- A treasurer expanding the row sees per-scout remaining vs. original billed, with a distinct `Partial` badge for charges that are paid down but not fully paid.
- A treasurer cannot silently delete a billing record once any cash has been collected against it (today's threshold is "any fully-paid charge"; the new threshold is "any charge with a non-zero `paid_amount`").

## Non-goals

- No changes to the underlying schema. `paid_amount` and `is_paid` already exist.
- No changes to how payments are recorded.
- No new payment-allocation logic.
- No changes to the `N/M paid` count column (it stays "fully paid / total", since the expanded view shows partial state per scout).
- No changes to email templates.
- No cleanup of the dead `billing-record-card.tsx` file (do that separately).

## Status state machine

A charge is in exactly one of these states, derived from existing data:

| State | Condition | Badge label | Badge color (Tailwind) |
|---|---|---|---|
| Voided | `is_void = true` | Voided | `border-stone-200 text-stone-400` (existing) |
| Paid | `is_paid = true` (i.e., `paid_amount >= amount`) | Paid | `border-green-200 bg-green-50 text-green-700` (existing) |
| Partial | `is_void = false AND is_paid = false AND paid_amount > 0` | Partial | `border-amber-200 bg-amber-50 text-amber-700` (new) |
| Unpaid | `is_void = false AND is_paid = false AND paid_amount = 0` | Unpaid | `border-stone-200 bg-stone-50 text-stone-600` (**recolored** — see below) |

**Color clash resolution.** Today the charge-level Unpaid badge ([billing-management-view.tsx:670-672](../../src/components/billing/billing-management-view.tsx#L670-L672)) uses amber. Under this spec, Partial takes amber. To avoid two adjacent badges in the same color, charge-level Unpaid is recolored to neutral stone. The record-level Unpaid pill at [line 333-334](../../src/components/billing/billing-management-view.tsx#L333-L334) already uses red and is unchanged.

**Overpayment.** If `paid_amount > amount` ever appears in the data (today's `auto_transfer_overpayment` flow prevents this in normal usage), treat as `Paid`. Remaining = `max(0, amount - paid_amount)`, never negative.

## Record-level partial state

The record-level `getRecordStatus()` helper at [billing-management-view.tsx:317-325](../../src/components/billing/billing-management-view.tsx#L317-L325) already returns `'partial'` when *some* charges are fully paid and others are not. Under this spec, its trigger widens: a record is also `'partial'` when **any** active charge is in state `'partial'` (paid down but not fully paid).

Updated logic (replacing the existing helper body):

```ts
function getRecordStatus(record): 'voided' | 'paid' | 'partial' | 'unpaid' {
  if (record.is_void) return 'voided'
  const activeCharges = record.charges.filter(c => !c.is_void)
  if (activeCharges.length === 0) return 'paid'
  const statuses = activeCharges.map(chargeStatus)
  if (statuses.every(s => s === 'paid')) return 'paid'
  if (statuses.some(s => s === 'paid' || s === 'partial')) return 'partial'
  return 'unpaid'
}
```

The existing record-level `statusBadge()` renderer at [line 327-338](../../src/components/billing/billing-management-view.tsx#L327-L338) is unchanged — it already handles all four states with appropriate colors.

## UI changes

### Row (collapsed)

Today's row at [line 567-625](../../src/components/billing/billing-management-view.tsx#L567-L625):

```
☐  ▸  Summer Camp Deposit       May 8   [Partial]   2/4   $200   [⋯ Actions]
```

Under this spec, the amount column changes (scenario: 4 scouts at $50 each, 1 fully paid + 1 partial @ $20-of-$50 + 2 unpaid; outstanding = $30 + $50 + $50 = $130):

```
☐  ▸  Summer Camp Deposit       May 8   [Partial]   1/4   $130   [⋯ Actions]
                                                            of $200 billed
```

- The primary amount becomes `outstandingTotal` (sum of `amount - paid_amount` across active charges).
- A secondary line "of $X billed" renders **only** when `outstandingTotal !== billedTotal`. Fully-unpaid records still show just `$200` with no subtext (preserves today's behavior).
- Both totals iterate `activeCharges` (non-voided). Voiding a charge alone does not trigger the subtext.
- The `N/M` paid-count column is unchanged.
- The status badge already shows `Partial` for records with partial state — its trigger now also fires for any charge with `paid_amount > 0` (see "Record-level partial state").

### Expanded view (per-charge rows)

Today's expanded row at [line 633-686](../../src/components/billing/billing-management-view.tsx#L633-L686):

```
Jane Smith                                  $50  [Unpaid]  [Record Payment]
John Doe                                    $50  [Paid · Cash]
Casey Park                            ̶$̶5̶0̶    [Voided]
```

Under this spec, partial charges get distinct rendering (same 4-scout scenario as the row mock above):

```
Jane Smith                                  $30  [Partial]   [Record Payment]
                                  of $50 billed
John Doe                                    $50  [Paid · Cash]
Sam Lee                                     $50  [Unpaid]    [Record Payment]
Alex Reed                                   $50  [Unpaid]    [Record Payment]
```

A voided charge (out of this 4-scout scenario) renders unchanged from today — strikethrough on the amount, `Voided` badge. No new logic.

- Partial rows: primary amount = `amount - paid_amount`, "of $X billed" subtext stone-500, `Partial` badge amber.
- Paid / Voided rows: unchanged from today.
- Unpaid rows: badge recolored to neutral stone (see "Color clash resolution"); amount and Record-Payment button unchanged.
- The existing `Record Payment` button still appears on Partial rows (currently shows on rows where `!charge.is_void && !charge.is_paid`, which already includes partial charges — no logic change needed).
- The "line-through on amount when paid" styling at [line 647](../../src/components/billing/billing-management-view.tsx#L647) is unchanged.

### Mobile behavior

The mobile fallback line at [line 591-593](../../src/components/billing/billing-management-view.tsx#L591-L593) ("date · N/M paid") is unchanged. The "of $X billed" subtext in the amount column stacks naturally below the primary amount on narrow screens since it's already inside the same flex column.

## Data flow

### Query changes

The Supabase query that feeds `BillingManagementView.records` lives at [src/app/(dashboard)/finances/billing/page.tsx:50-81](../../src/app/(dashboard)/finances/billing/page.tsx#L50-L81). The `billing_charges` sub-select currently picks:

```
id, amount, is_paid, is_void, scout_account_id, scout_accounts(...), payment_allocations(...)
```

Add `paid_amount`:

```
id, amount, paid_amount, is_paid, is_void, scout_account_id, scout_accounts(...), payment_allocations(...)
```

The inline `BillingRecordWithCharges` type at [line 83-110](../../src/app/(dashboard)/finances/billing/page.tsx#L83-L110) gains `paid_amount: number | null` on the charge entry. The mapping block at [line 122-146](../../src/app/(dashboard)/finances/billing/page.tsx#L122-L146) passes it through to the `ChargeDetail` output.

A grep confirmed `BillingManagementView` is the only consumer of this query shape; no other paths need updating.

### Type changes

`ChargeDetail` interface at [billing-management-view.tsx:32-42](../../src/components/billing/billing-management-view.tsx#L32-L42) gains:

```ts
paid_amount: number | null
```

### Derived helper

A pure function lives in a new file `src/components/billing/billing-charge-status.ts` (co-located with `billing-management-view.tsx`):

```ts
export interface ChargeStatusInput {
  amount: number
  paid_amount: number | null
  is_paid: boolean | null
  is_void: boolean | null
}

export type ChargeStatus = 'voided' | 'paid' | 'partial' | 'unpaid'

export function chargeStatus(c: ChargeStatusInput): ChargeStatus
export function chargeRemaining(c: ChargeStatusInput): number
```

`chargeRemaining` returns `Math.max(0, c.amount - (c.paid_amount ?? 0))`. Both functions are pure, unit-testable without rendering, and consumed by `BillingManagementView`.

### Totals

Inside `BillingManagementView`, where each record renders its row, derive:

```ts
const activeCharges = record.charges.filter(c => !c.is_void)
const billedTotal = activeCharges.reduce((s, c) => s + c.amount, 0)
const outstandingTotal = activeCharges.reduce((s, c) => s + chargeRemaining(c), 0)
```

The amount column renders `outstandingTotal` as the primary number, with "of $X billed" subtext when `outstandingTotal !== billedTotal`.

(Note: the existing `record.total_amount` field on `BillingRecordEntry` reflects the originally-billed total stored in the DB; we still need to compute `billedTotal` from charges because voided charges are excluded.)

### Void protection

`BillingRecordActions` today receives `hasPaidCharges: boolean` at [billing-management-view.tsx:619](../../src/components/billing/billing-management-view.tsx#L619). The prop's semantics widen: any charge with non-zero collected payment (paid OR partial) should block silent deletion. The prop is renamed to `hasCollectedPayments` and computed as:

```ts
const hasCollectedPayments = record.charges.some(c => {
  if (c.is_void) return false
  const status = chargeStatus(c)
  return status === 'paid' || status === 'partial'
})
```

`BillingRecordActions.tsx` is renamed accordingly (`hasPaidCharges` → `hasCollectedPayments` in both the prop type at [line 22](../../src/components/billing/billing-record-actions.tsx#L22) and the destructure at [line 33](../../src/components/billing/billing-record-actions.tsx#L33), and the usage at [line 83](../../src/components/billing/billing-record-actions.tsx#L83)). Internal logic is otherwise unchanged.

## Testing strategy

### Unit (vitest) — pure helpers

New file `tests/unit/components/billing/billing-charge-status.test.ts`. Covers `chargeStatus()` and `chargeRemaining()`:

- `chargeStatus`:
  - `is_void = true` → `'voided'` (regardless of other fields)
  - `is_paid = true, paid_amount = amount` → `'paid'`
  - `is_paid = true, paid_amount > amount` (overpayment edge) → `'paid'`
  - `is_paid = false, paid_amount > 0, paid_amount < amount` → `'partial'`
  - `is_paid = false, paid_amount = 0` → `'unpaid'`
  - `is_paid = false, paid_amount = null` → `'unpaid'`
- `chargeRemaining`:
  - `amount = 50, paid_amount = 20` → `30`
  - `amount = 50, paid_amount = null` → `50`
  - `amount = 50, paid_amount = 60` (overpayment) → `0` (never negative)

### Component (RTL) — BillingManagementView row rendering

New file `tests/unit/components/billing-management-view.test.tsx`. Render `BillingManagementView` with seeded records and assert:

Seeded scenario (matches the row + expanded mocks above): 4 charges of $50 each — 1 fully paid, 1 partial ($20 paid), 2 unpaid. Billed = $200, outstanding = $130, 1/4 paid count.

- Row primary amount = `$130`, secondary subtext = `of $200 billed`.
- Row status badge = `Partial` (record-level trigger widened — fires because at least one charge has `paid_amount > 0`).
- Row with all-unpaid charges (separate seeded case) shows `$200` only, no subtext (regression guard for the equality check).
- Expanding the row reveals the partial scout's per-charge row with `$30` primary, `of $50 billed` subtext, `Partial` badge.
- Per-charge Unpaid badge renders with stone color, not amber (recolor regression guard).
- `BillingRecordActions` receives `hasCollectedPayments = true` for the seeded scenario (both fully-paid and partial charges qualify).
- Separate seeded case: a row with only unpaid + voided charges sets `hasCollectedPayments = false` (regression guard for the threshold).

If RTL rendering of the full `BillingManagementView` proves too heavyweight (it pulls in Next.js router, search params, and several dialogs), an acceptable fallback is to extract the row-rendering body into a sub-component (`BillingRecordRow`) and test that in isolation. Decision deferred to implementation; do whichever is more reliable.

### Manual (in dev)

After implementation, in dev:

1. Seed a billing record across 4 scouts at $50 each.
2. Record a partial payment for one scout ($20 cash) and a full payment for another scout.
3. Open `/finances/billing` and confirm the row shows `$130` outstanding with `of $200 billed` subtext, and a `Partial` status badge.
4. Expand the row and confirm:
   - Partially-paid scout's per-charge row shows `$30` / `of $50 billed` / `Partial` badge.
   - Fully-paid scout's row shows `$50` line-through + `Paid · Cash` badge (unchanged).
   - Unpaid scouts' rows show `$50` + neutral-stone `Unpaid` badge (recolored from amber).
5. Resize browser to mobile breakpoint and confirm the "of $X billed" subtext stacks cleanly under the amount.
6. Try the Actions menu → "Delete" on the record. Confirm it's blocked (because `hasCollectedPayments` is now true), same as it would be if any charge were fully paid.

## Risks

- **Query update miss.** If the `paid_amount` column isn't added to the Supabase select but the `ChargeDetail` type does include it, TypeScript will see the field as `undefined` at runtime. Mitigation: the type addition is `paid_amount: number | null` (not optional), so any caller that fails to provide it will fail at the compile boundary on the page-level data-mapping step.
- **Existing data with stale `is_paid`.** If there are records in prod where `paid_amount >= amount` but `is_paid = false` (or vice versa) due to historical bugs, the badge will reflect the inconsistency. Out of scope for this spec — would need a data audit and possibly a backfill migration.
- **Recoloring Unpaid badge changes a visible color today.** The charge-level Unpaid badge moves from amber to neutral stone. Users familiar with the current amber will see a different look on rows where nothing has been paid. This is the smallest user-visible change needed to avoid a Partial/Unpaid collision.

## Open questions

None at the time of spec sign-off.
