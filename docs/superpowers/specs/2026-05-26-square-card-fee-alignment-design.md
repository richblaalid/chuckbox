---
status: approved
last_verified: 2026-05-26
---

# Square Card Fee Alignment — Treasurer Modal Inherits Payment-Link Convention

## Status

Brainstormed and approved on 2026-05-26. Sibling spec to the void/delete-billing UX work; both grew out of post-PR #36 investigation. Closes path #1 of stance B (the only remaining path that can create positive `billing_balance` from a card payment).

## Context

After PR #36 shipped (payment-modal charge-allocation rewrite), we noticed in dev that some scout accounts had positive `billing_balance` values — credits. Stance B (decided 2026-05-25): credits should never exist on `billing_balance`. We enumerated 5 paths that can create them and committed to closing all 5. This spec closes **path #1: card-fee overpayment via the treasurer modal**.

The root cause: today's treasurer-facing card flow (`QuickPaymentForm` → `/api/square/payments`) and the parent-facing payment-link flow (`/api/payment-links/[token]/pay` → `process_payment_link_payment` RPC) use **different journal conventions for card payments**:

| Path | AR credit | Reads `pass_fees_to_payer`? | Creates credit when treasurer types gross > bill? |
|---|---|---|---|
| Treasurer modal | Gross (full amount charged to card) | ❌ No | ✅ Yes (the bug) |
| Parent payment-link | Base (= bill) when fees passed; Total otherwise | ✅ Yes | ❌ No |

The parent route already does the right thing. The treasurer modal is the outlier.

## Decisions locked during brainstorming

| # | Question | Decision |
|---|---|---|
| 1 | Can we offload fee math to Square? | **No.** Square's Card Surcharges feature is in-person-only (Terminal API, Mobile Payments SDK). Web Payments SDK (what chuckbox uses for online card payments) has no auto-surcharge. We must compute and add the fee ourselves. |
| 2 | What's the canonical AR-credit convention? | **AR credited by the bill amount (`base`)**, regardless of fee model. `pass_fees_to_payer` only changes what the customer is charged, not what reduces the scout's AR. |
| 3 | Default for `pass_fees_to_payer`? | **`false`** (unit absorbs fee). Matches existing `|| false` fallback. |
| 4 | Per-payment override in the modal? | **No.** Unit-level policy only. |
| 5 | UX: how is the fee disclosed? | Conditional disclosure beneath the Amount field, copy depends on the setting. |
| 6 | Inline overpayment-to-funds in `process_payment_link_payment`? | **Remove it.** Lines 2311-2327 of the schema migration; a 5th auto-sweep site PR #36 missed. Dead code under stance B. |

## Architecture

```
Today:
  Treasurer modal ─► /api/square/payments ─► AR credit = GROSS, no setting read
                                              Modal types "what to charge card"
                                              Creates credit if treasurer types > bill
  Parent link    ─► /api/payment-links/.../pay ─► process_payment_link_payment RPC
                                                   AR credit = base or total based on setting
                                                   Inline auto-sweep (PR #36 miss)

After:
  Both paths credit AR by the bill amount (`base`).
  Treasurer modal types "the bill amount"; route computes gross from setting.
  Validation: base ≤ outstanding (uniform across cash/check/card).
  No path can produce positive billing_balance from a card payment.
```

Three things change:

1. **`/api/square/payments`** reads `units.pass_fees_to_payer` and applies the same journal logic as the parent route.
2. **`QuickPaymentForm`** semantic shift for card: the Amount field is now "bill amount," not "what to charge the card." Engine validation aligns with cash/check (no card relaxation). Conditional fee disclosure based on the setting.
3. **`process_payment_link_payment` RPC** drops its inline auto-sweep — dead code once base validation is in place.

## Server route changes

### `/api/square/payments/route.ts`

Request body shape changes:

```ts
// Before
{ scoutAccountId, amountCents, sourceId, description?, billingChargeId?, allocations? }

// After
{
  scoutAccountId,
  baseAmountCents,    // RENAMED — semantically "the bill amount"
  sourceId,
  description?,
  billingChargeId?,
  allocations?
}
```

Route logic:

```ts
// 1. Read unit fee settings
const { data: unit } = await supabase
  .from('units')
  .select('processing_fee_percent, processing_fee_fixed, pass_fees_to_payer')
  .eq('id', membership.unit_id)
  .single()

const feePercent = Number(unit?.processing_fee_percent) || 0.026
const feeFixedCents = Math.round((Number(unit?.processing_fee_fixed) || 0.10) * 100)
const feesPassedToPayer = unit?.pass_fees_to_payer || false

// 2. Compute the total to charge the customer's card
let feeAmountCents = 0
let totalAmountCents = baseAmountCents
if (feesPassedToPayer) {
  feeAmountCents = Math.ceil(baseAmountCents * feePercent + feeFixedCents)
  totalAmountCents = baseAmountCents + feeAmountCents
}

// 3. Validate base ≤ outstanding (NOT total). Server-side defense in depth.
if (baseAmountCents > Math.abs(billingBalance) * 100) {
  return NextResponse.json(
    { error: `Payment exceeds outstanding balance of $${(Math.abs(billingBalance)).toFixed(2)}` },
    { status: 400 }
  )
}

// 4. Square fee on the actual transaction (used for bank net)
const squareFeeCents = calculateFee(totalAmountCents)
const netCents = totalAmountCents - squareFeeCents

// 5. Charge Square the total
const squareResponse = await squareClient.payments.create({
  amountMoney: { amount: BigInt(totalAmountCents), currency: 'USD' },
  // ... existing fields
})

// 6. Journal lines — credit AR by base, debit bank by net, fee expense for squareFee
```

Journal table:

| Setting | Customer charged | Bank debit | AR credit (scout) | Fee expense | Net effect |
|---|---|---|---|---|---|
| `pass_fees_to_payer = false` | `base` | `base − squareFee` | `base` | `squareFee` | Scout's bill cleared by `base`; unit absorbs `squareFee` |
| `pass_fees_to_payer = true` | `base + feeAmount` | `base + feeAmount − squareFee` | `base` | `squareFee` | Scout's bill cleared by `base`; customer paid `feeAmount` toward the Square fee; unit nets `base` (or close to it if `feeAmount` ≈ `squareFee`) |

Journals balance because total debits (bank + fee expense) always equal the gross AR + non-AR credits. The exact line shapes mirror `process_payment_link_payment` lines 2267-2289 in the schema migration — adapt those rather than reinvent.

### Backward compatibility

There is one caller of `/api/square/payments` today: `QuickPaymentForm.handleCardPayment`. Both ship together in this PR. **Hard-flip the request shape** (rename `amountCents` → `baseAmountCents`) rather than supporting both.

## Client component changes

### Engine: `src/lib/payment-allocation.ts`

Generalize away the `cardFeeNet` field — it's a stance-A artifact. After this change, `AllocationInput` carries the same uniform semantics for cash/check/card:

```ts
// Before
export interface AllocationInput {
  charges: OutstandingCharge[]
  rows: RowState[]
  cash: number
  funds: number
  outstandingBalance: number
  cardFeeNet?: number   // stance-A: net-of-fee for card relaxation
}

// After
export interface AllocationInput {
  charges: OutstandingCharge[]
  rows: RowState[]
  cash: number          // what hits AR for this payment (the bill amount)
  funds: number
  outstandingBalance: number
  // No more cardFeeNet — `cash` IS the base.
}
```

Validation rule becomes uniform: `cash + funds ≤ outstandingBalance` for **all** methods. No card-specific relaxation. The card-fee math is no longer the engine's concern — it moves into the form's display logic and the server route.

### `QuickPaymentForm` ([src/components/payments/quick-payment-form.tsx](src/components/payments/quick-payment-form.tsx))

**New prop:**

```ts
interface QuickPaymentFormProps {
  unitId: string
  scouts: Scout[]
  squareConfig?: { applicationId, locationId, environment }
  unitFeeSettings?: {
    passFeesToPayer: boolean
    feePercent: number          // e.g., 0.026
    feeFixedDollars: number     // e.g., 0.10
  }
  // ... existing props
}
```

Mounting pages (`finances/billing/page.tsx`, dashboard quick-action card, scout account detail page) fetch unit fee settings alongside the Square config and pass both down.

**Engine call simplifies** (no `cardFeeNet`):

```ts
const allocationResult = useMemo(
  () =>
    computeAllocations({
      charges: outstandingCharges,
      rows,
      cash: parsedAmount,
      funds: parsedFundsToApply,
      outstandingBalance: Math.abs(currentBalance),
      // cardFeeNet removed
    }),
  [outstandingCharges, rows, parsedAmount, parsedFundsToApply, currentBalance]
)
```

**Fee disclosure UI** replaces the existing "Fee: $X | Net: $Y" line (currently `quick-payment-form.tsx:795-799`):

```tsx
{method === 'card' && parsedAmount > 0 && unitFeeSettings && (
  <div className="text-xs text-stone-500 space-y-0.5">
    {unitFeeSettings.passFeesToPayer ? (
      <>
        <p>
          Customer will be charged {formatCurrency(parsedAmount + computedFee)} (
          {formatCurrency(parsedAmount)} + {formatCurrency(computedFee)} processing fee).
        </p>
        <p>Your unit will receive {formatCurrency(parsedAmount)}.</p>
      </>
    ) : (
      <>
        <p>Customer will be charged {formatCurrency(parsedAmount)}.</p>
        <p>
          Your unit will receive {formatCurrency(parsedAmount - squareFee)} after Square&apos;s{' '}
          {formatCurrency(squareFee)} processing fee.
        </p>
      </>
    )}
  </div>
)}
```

Where:
```ts
const computedFee = parsedAmount * unitFeeSettings.feePercent + unitFeeSettings.feeFixedDollars
const squareFee = computedFee  // same formula; the unit's configured rate is expected to match Square
```

**Submit logic** sends `baseAmountCents`:

```ts
const response = await fetch('/api/square/payments', {
  method: 'POST',
  body: JSON.stringify({
    scoutAccountId: selectedScout.scout_accounts.id,
    baseAmountCents: Math.round(parsedAmount * 100),  // RENAMED
    sourceId: tokenResult.token,
    description: ...,
    allocations: allocations.length > 0 ? allocations.map(...) : undefined,
  }),
})
```

### Unchanged

- The Amount field UX, the per-row allocation inputs, the cash/check/funds flows.
- The scout selector, inline billing creation, success/error UX.
- The card SDK initialization, Square credential lookup.
- The settings UI for `pass_fees_to_payer` (already exists at `payment-fee-settings-card.tsx`).

## Migration

Single migration: `supabase/migrations/YYYYMMDDHHMMSS_remove_inline_overpayment_sweep.sql`

Replaces `process_payment_link_payment` with a version identical to today minus lines 2311-2327 (the inline overpayment-to-funds block). Under stance B (after this spec's other changes land), `billing_balance` cannot go positive from a card payment, so the block is dead code. Removing it ensures consistency with the no-auto-sweep principle from PR #36.

The migration is additive-only (`CREATE OR REPLACE FUNCTION`, no schema changes). Existing data is untouched. Rollback is trivial.

## Tests

### Engine unit tests ([tests/unit/charge-allocation.test.ts](tests/unit/charge-allocation.test.ts) — extend)

- Remove stance-A `cardFeeNet` test cases (3 cases).
- Add ~3 cases asserting uniform validation across cash/check/card.

### Form component tests ([tests/unit/components/quick-payment-form.test.tsx](tests/unit/components/quick-payment-form.test.tsx) — extend)

~3 new cases:
1. `passFeesToPayer = false` + card method → disclosure shows "Customer will be charged $X. Unit will receive $X minus fee."
2. `passFeesToPayer = true` + card method → disclosure shows "Customer will be charged $X + fee. Unit will receive $X."
3. Card POST body uses `baseAmountCents` field name (not `amountCents`).

### Server action tests ([tests/unit/actions/payments.test.ts](tests/unit/actions/payments.test.ts) — no change)

`recordQuickPayment` (cash/check) doesn't touch the Square route. No new tests.

### Manual smoke (full Square route coverage deferred to integration-tests spec)

For each fee model:
- Card payment via modal with `pass_fees_to_payer = false` → verify Square charged base, AR credited base, journal balanced, `billing_balance` ends at 0.
- Card payment via modal with `pass_fees_to_payer = true` → verify Square charged base + fee, AR credited base, fee expense recorded, `billing_balance` ends at 0.
- Bypass attempt: type `outstanding + 1` → submit disabled, server-side error if request gets through.

## Rollout

1. Apply migration in dev. Run `npm test` + manual smoke through both fee models.
2. Push to PROD with explicit approval (same pattern as PR #36).
3. Reload PROD schema cache after migration.
4. No data backfill — forward-fix only.

## Out of scope

- The parent payment-link route's journal mechanics (already correct; only its underlying RPC's inline auto-sweep is being removed).
- Settings UI for `pass_fees_to_payer` (already exists; not changing).
- Square Surcharge integration (not supported for online payments).
- Paths #2-#5 of stance B (in the void/delete-billing spec).
- Integration tests against the Square route (deferred to the integration-tests spec at `2026-05-25-finance-integration-tests-design.md`).
- Real-time Square fee reconciliation (using actual fees from Square's payment response instead of our estimate). Small accuracy improvement; not necessary for stance B.

## Why this work matters

The treasurer modal's card path is the last surface that can create a positive `billing_balance` (a credit). Closing it requires aligning the modal route's journal convention with the parent payment-link route's already-correct convention. Once aligned, both paths read the same `units.pass_fees_to_payer` setting and produce the same accounting result — a scout's bill is cleared by exactly the bill amount, and the fee is paid by whichever party the unit's policy designates. After this PR, **no path in the codebase can produce a credit on `billing_balance` from a card payment**, which closes stance B's path #1. Paths #2-#5 are handled in the sibling void/delete-billing spec.
