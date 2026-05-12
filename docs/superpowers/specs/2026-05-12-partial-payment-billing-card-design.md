---
status: approved
last_verified: 2026-05-12
---

# Partial Payment Display on Billing Cards

## Context

A treasurer can record a partial payment against a billing charge — for example, applying $20 from a scout's funds against a $50 charge, or collecting $15 cash toward a $25 owed amount. The data model already supports this: `billing_charges.paid_amount` is incremented by each payment allocation, and `is_paid` flips to `true` only when `paid_amount >= amount`.

The UI does not surface this state. The billing record card and its expanded per-scout rows show only the original billed amount and a binary `Paid`/`Unpaid` badge. A charge with $20 of $50 paid renders identically to a charge with $0 paid — both say "Unpaid" and show "$50". The treasurer cannot tell from the card which scouts have started paying down a charge versus which have done nothing.

This spec covers the UI changes to surface partial-payment state on `BillingRecordCard` and to widen void-protection so that a billing record with any actual collected payments cannot be silently deleted.

Out of scope: changes to how partial payments are *recorded* (that's the `QuickPaymentForm` work already in progress) and changes to email templates / parent notifications (a separate area for a later spec).

## Goals

- A treasurer scanning the billing list can see, per record: how much is still outstanding, and how many scouts are paid / partial / unpaid.
- A treasurer expanding the record can see per-scout remaining vs. original billed.
- A treasurer cannot accidentally delete a billing record once any cash has been collected against it (today's threshold is "any fully-paid charge"; the new threshold is "any charge with a non-zero `paid_amount`").

## Non-goals

- No changes to the underlying schema. `paid_amount` and `is_paid` already exist.
- No changes to how payments are recorded.
- No new payment-allocation logic.
- No changes to email templates.

## Status state machine

A charge is in exactly one of these states, derived from existing data:

| State | Condition | Badge label | Badge color |
|---|---|---|---|
| Voided | `is_void = true` | Voided | stone-200 / stone-500 (existing) |
| Paid | `is_paid = true` (i.e., `paid_amount >= amount`) | Paid | forest-100 / forest-700 (existing) |
| Partial | `is_void = false AND is_paid = false AND paid_amount > 0` | Partial | amber-100 / amber-700 (new) |
| Unpaid | `is_void = false AND is_paid = false AND paid_amount = 0` | Unpaid | white / stone-600 (existing) |

**Overpayment**: if `paid_amount > amount` ever appears in the data (today's `auto_transfer_overpayment` flow prevents this in normal usage), treat as `Paid`. Remaining = `max(0, amount - paid_amount)`, never negative.

## UI changes

### Card header (collapsed)

Primary number on the right of the header becomes the **outstanding** total (`sum(amount − paid_amount)` across active charges).

A secondary line "of $X billed" renders **only** when `outstandingTotal !== billedTotal` — i.e., at least one active charge has `paid_amount > 0`. A fully-unpaid record still shows just "$200" with no subtext, matching today's behavior. Both totals iterate `activeCharges` (non-voided), so voiding a charge does not by itself cause the subtext to appear.

Status pills now have three possible states. Each pill renders only when its count is greater than zero:

- `[N paid]` — forest-100 / forest-700
- `[N partial]` — amber-100 / amber-700
- `[N unpaid]` — stone-100 / stone-600

Mock:

```
┌────────────────────────────────────────────────────┐
│ ▸  Summer Camp Deposit                $120         │
│    May 8 · 4 scouts @ $50            of $200 billed│
│    [2 paid] [1 partial] [1 unpaid]                 │
└────────────────────────────────────────────────────┘
```

### Card rows (expanded)

Per-scout row layout:

- Partial rows: amount column shows `amount − paid_amount` (primary) with "of $X billed" subtext below, plus `Partial` badge.
- Paid / Unpaid / Voided rows: unchanged from today (no subtext, existing badge).

Mock:

```
   Jane Smith                [Partial]  $30
                                        of $50 billed
   John Doe                  [Paid]     $50
   Sam Lee                   [Unpaid]   $50
   Casey Park                [Voided]   $50
```

Subtext is stone-500 (muted, matches existing header subtext styling).

### Mobile behavior

The "of $X billed" subtext stacks below the amount in both the header and the row on narrow screens. The pill rail already wraps; no change.

## Data flow

### Query changes

`paid_amount` must be selected on every query that feeds `BillingRecordCard.charges`. Audit will happen during implementation; based on initial grep, the relevant query lives in `src/components/billing/billing-management-view.tsx`. Any other consumer of the card (search reveals none today) must be similarly updated.

### Type changes

`BillingCharge` interface in [billing-record-card.tsx:8-20](../../src/components/billing/billing-record-card.tsx#L8-L20) gains:

```ts
paid_amount: number | null
```

### Derived helper

A pure function lives in a co-located `src/components/billing/billing-record-card-utils.ts` to keep `BillingRecordCard` lean and to make the helper unit-testable without rendering:

```ts
type ChargeStatus = 'voided' | 'paid' | 'partial' | 'unpaid'
function chargeStatus(c: BillingCharge): ChargeStatus
```

The `BillingCharge` type used by the helper is exported from `billing-record-card-utils.ts` and imported by `billing-record-card.tsx`.

### Totals

```ts
const billedTotal      = activeCharges.reduce((s, c) => s + c.amount, 0)
const outstandingTotal = activeCharges.reduce(
  (s, c) => s + Math.max(0, c.amount - (c.paid_amount ?? 0)),
  0
)
```

Header renders `outstandingTotal` as the primary number; the "of $X billed" subtext renders when `outstandingTotal !== billedTotal`.

### Counts

```ts
const paidCount    = activeCharges.filter(c => chargeStatus(c) === 'paid').length
const partialCount = activeCharges.filter(c => chargeStatus(c) === 'partial').length
const unpaidCount  = activeCharges.filter(c => chargeStatus(c) === 'unpaid').length
```

### Void protection

`BillingRecordActions` today receives `hasPaidCharges: boolean`. This prop's semantics widen: any charge with non-zero collected payment (paid OR partial) should block silent deletion. The prop is renamed to `hasCollectedPayments` and computed as `paidCount + partialCount > 0`. Internal logic of `BillingRecordActions` and `void-billing-dialog` is unchanged — only the trigger threshold widens.

## Testing strategy

### Unit (vitest)

A pure-function test for `chargeStatus()`. Covers:

- `is_void = true` → `'voided'` (regardless of other fields)
- `is_paid = true, paid_amount = amount` → `'paid'`
- `is_paid = true, paid_amount > amount` (overpayment edge) → `'paid'`
- `is_paid = false, paid_amount > 0, paid_amount < amount` → `'partial'`
- `is_paid = false, paid_amount = 0` → `'unpaid'`
- `is_paid = false, paid_amount = null` → `'unpaid'`

### Component (RTL)

`tests/unit/components/billing-record-card.test.tsx`. Render `BillingRecordCard` with seeded charges and assert:

- Header outstanding total = $120 when one $50 charge has `paid_amount = 20` and three $50 charges are unpaid.
- "of $200 billed" subtext present when at least one charge is partial; absent when all charges are unpaid (i.e., outstanding == billed).
- Three pills render with correct counts: `[1 paid] [1 partial] [2 unpaid]`.
- Expanded row for the partial charge shows "$30" primary, "of $50 billed" subtext, and the `Partial` badge.
- Expanded row for a paid charge shows "$50" with no subtext and the `Paid` badge (regression guard).
- Actions menu receives `hasCollectedPayments = true` when any partial charge exists (without a fully-paid one).

### Manual (in dev)

After implementation, in dev:

1. Seed a billing record across 4 scouts at $50 each.
2. Record a partial payment for one scout ($20 cash) and a full payment for another scout.
3. Open `/finances/billing` and confirm:
   - Header shows `$130` outstanding with `of $200 billed` subtext.
   - Pills show `[1 paid] [1 partial] [2 unpaid]`.
   - Expanded view shows partial scout's row with `$30` / `of $50 billed` / Partial badge.
4. Resize browser to mobile breakpoint and confirm subtext stacks and pills wrap cleanly.

## Risks

- **Query update miss**: if any consumer of `BillingRecordCard` is missed in the query audit, partial state will silently render as "Unpaid" for that path. Mitigation: grep for all callers during implementation; the type change to `BillingCharge` will make TypeScript fail on any caller passing a charge without `paid_amount`.
- **Existing data with stale `is_paid`**: if there are records in prod where `paid_amount >= amount` but `is_paid = false` (or vice versa) due to historical bugs, the badge will reflect the inconsistency. Out of scope for this spec — would need a data audit and possibly a backfill migration.

## Open questions

None at the time of spec sign-off.
