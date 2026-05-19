---
status: approved
last_verified: 2026-05-19
---

# Payment Modal — Charge Allocation Fixes

## Status

Brainstormed and approved on 2026-05-18 (session followup to the initial findings dated 2026-05-12). Open questions from the original draft are resolved in the [Decisions](#decisions) section below. Original findings are preserved verbatim in the [Original findings](#original-findings) section for context. Ready for the writing-plans skill to produce a step-by-step implementation plan.

## Context

While testing the partial-payment display work (spec `2026-05-12-partial-payment-billing-card-design.md`, shipped as commits `67c992a`..`5b71499` on branch `phase-6-smoke-runbook-and-cleanup`), the user discovered five related bugs in the **payment recording modal** (`QuickPaymentForm` + `ChargeAllocationList`). These bugs predate the billing-card work — they exist in `main` and ship in prod today — but they undermine the trust signal the new partial-payment UI is trying to provide.

The user wanted to ship the billing-card display work first, then return to this. This document captures both the original findings (preserved for traceability) and the approved design for the fix.

## Bugs in scope

1. **Pre-selected charge not visible in allocation list** — `initialChargeId` is passed but `ChargeAllocationList` ignores it and runs FIFO auto-allocation.
2. **"Amount to Collect" pre-populated with full charge amount** — `initialAmount={paymentCharge.amount}` forces treasurer to clear the field for partial payments.
3. **Payment credited to wrong charge** — FIFO ignores user intent; cash gets applied to oldest charges rather than the one the user clicked from.
4. **Allocation reports full owed instead of actual cash** — [`charge-allocation-list.tsx:53-61`](../../src/components/payments/charge-allocation-list.tsx#L53-L61) maps each checked charge to its `owed` value, so per-charge `paid_amount` increments by the full amount even when cash is smaller.
5. **Scout-funds transfers don't update charge state at all** — `transfer_funds_to_billing` RPC only writes journal lines; `billing_charges.paid_amount` is never touched.

Full root-cause analysis for each bug is in the [Original findings](#original-findings) section.

## Decisions

The original draft enumerated six open questions with non-obvious trade-offs. Resolved as follows:

| # | Question | Decision |
|---|---|---|
| 1 | Initial selection semantics | **Pre-check the initial charge, leave amount blank, treasurer can still toggle anything.** Pre-selection is initial state only, not a lock. |
| 2 | Distribution when cash < sum(checked owed) | **User-checked rows fill first (FIFO by date among them), then auto-extended rows fill last (FIFO by date among them).** Treasurer can override any row directly (see Q5) to bias differently. |
| 3 | Distribution when cash > sum(owed) | **Validation blocks overpayment** for cash/check (`cash + funds ≤ outstanding`). **Card path is allowed to exceed** for Square fee math (validation operates on net-of-fee). **No path auto-transfers perceived overpayment to scout funds** — small card-fee credits ride on `billing_balance`. |
| 4 | Funds-transfer charge attribution | **Extend `transfer_funds_to_billing` RPC** with an optional `p_allocations` parameter; increment `paid_amount` when allocations are provided. Drain-in-order: funds RPC consumes the front of the per-charge allocation list, cash action consumes the rest. |
| 5 | Per-charge partial-pay input | **Add per-row dollar inputs.** Defaults to FIFO auto-fill (simple cases feel identical to today), but treasurer can override any row. Manual rows stay sticky across cash changes. Sum of row inputs must equal cash + funds. |
| 6 | Backward compat with dashboard quick-payment | **Same engine; no special-casing.** Dashboard flow opens with no pre-selection, treasurer picks scout, FIFO fills as they type cash. Works because pre-selection is just an initial-state convenience. |

### Card-fee handling

Per user decision: Square fees are a pass-through cost. They do NOT increase scout funds and do NOT get applied as payment to another charge.

- Customer is charged the gross amount displayed in the Amount field; Square deducts the fee; the unit receives net.
- Validation rule for card path: **net-of-fee applied to billing ≤ outstanding balance** (gross can exceed outstanding by the fee amount; net cannot).
- **Open implementation detail:** whether `billing_balance` is reduced by gross (customer-pays-the-fee model) or by net (unit-eats-the-fee model) depends on what the existing `/api/square/payments` endpoint writes to the journal. The writing-plans step must read that route, confirm the convention, and either:
  - Keep the existing convention as-is and ensure no auto-sweep fires (the principle the user locked).
  - If the existing convention causes `billing_balance` to land slightly positive (gross convention), explicitly tolerate the small positive credit — do NOT call `auto_transfer_overpayment`, do NOT apply it to other charges, leave it as a balance credit available for the next billing record.

### Historical data: fix forward only, no backfill

Per explicit user decision (2026-05-19): historical Bug 4, Bug 5, and `auto_transfer_overpayment` artifacts will **not** be backfilled or corrected. The fix is forward-only — new transactions write correct data from the cutover; pre-existing rows stay as they are.

The rationale:

- The journal is authoritative for total balances. Scout `billing_balance` and `funds_balance` already reflect the actual cash flows, even when per-charge `paid_amount` attribution is wrong.
- Bug 4 historical victims (`paid_amount >= amount AND is_paid = false`) display as "Paid" today via the May 12 display-layer mitigation, so treasurers don't see misleading information in the common case.
- Bug 5 historical victims are rare (funds-only transfers are uncommon) and only affect per-charge display of charges that did receive funds; the scout's balance is still correct.
- Backfill scripts would necessarily be lossy (they have to guess at attribution intent the original code didn't record). The complexity of a careful dry-run + approval workflow is not justified by the observed user impact.

**Observable consequence — the "ghost balance" edge case:** In the rare scenario where a scout's `billing_balance` exceeds the sum of allocatable outstanding charges (because real balance is "hidden" behind Bug 4 ghost charges), the new validation will block over-cap allocation, and the treasurer will need to either:

- Reduce cash to the visible outstanding total, or
- Use the inline-billing-creation flow to record the remainder as a new billing item.

This is acceptable. Treasurer-facing tooling to void or correct individual damaged charges is a separate concern, addressed in the parallel void/delete-billing UX work ([`project_void_delete_billing_ux.md`](../../.claude/projects/-Users-richblaalid-Projects-chuckbox/memory/project_void_delete_billing_ux.md)), but is **not a dependency** of this work and is not required to make this work valuable.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  src/lib/payment-allocation.ts  (pure functions, no I/O)        │
│  ─────────────────────────────                                  │
│  • allocatePayment(charges, cash, opts)  — FIFO baseline        │
│  • computeAllocations(state)             — full engine          │
│      handles: pre-checks, manual overrides, auto-extend,        │
│      drain-in-order between funds/cash, FIFO defaults           │
│  • validateAllocations(state)            — invariants           │
│      sum=cash, ≤outstanding, etc. Returns issues[] not throw.   │
└─────────────────────────────────────────────────────────────────┘
                    ▲                       ▲
                    │ imports               │ imports
                    │                       │
┌───────────────────┴────────────┐   ┌──────┴─────────────────────┐
│  ChargeAllocationList (UI)     │   │  recordQuickPayment (srv)  │
│  ──────────────────────────    │   │  ─────────────────────     │
│  • Per-row checkbox + $-input  │   │  • Validates allocations   │
│  • Real-time re-allocate       │   │  • Splits funds vs cash    │
│  • Surfaces validation issues  │   │    portions                │
│  • Manual rows stay sticky     │   │  • Calls funds RPC w/      │
│                                │   │    its allocation slice    │
└────────────────────────────────┘   │  • Writes payment +        │
                                     │    payment_allocations +   │
                                     │    paid_amount increments  │
                                     └────────────────────────────┘
                                                ▲
                                                │ calls
                                     ┌──────────┴─────────────────┐
                                     │  transfer_funds_to_billing │
                                     │  RPC (Postgres)            │
                                     │  ────────────────────────  │
                                     │  • New optional            │
                                     │    p_allocations jsonb     │
                                     │  • Increments paid_amount  │
                                     │    when allocations given  │
                                     └────────────────────────────┘
```

**Implementation-structure choices:**

- **(S1) Allocation engine lives in [`src/lib/payment-allocation.ts`](../../src/lib/payment-allocation.ts)** as pure functions. Both the React component (per-keystroke) and `recordQuickPayment` (final validation) import the same module. Single source of truth.
- **(S2) Extend `transfer_funds_to_billing` in place** with an optional `p_allocations jsonb DEFAULT NULL` parameter. Existing callers unaffected.
- **(S3) Funds transfers do NOT write `payment_allocations` rows** in v1. Bug 5 needs `paid_amount` correct; audit-trail symmetry between cash and funds is independent value, deferred.

## Allocation engine (the core contract)

Pure-function module. State in / state out. No React, no Supabase.

### Types

```ts
// Existing in payment-allocation.ts
export interface OutstandingCharge {
  id: string
  billingRecordId: string
  description: string
  amount: number
  paidAmount: number
  billingDate: string
  createdAt: string
}

// NEW — per-row state owned by the parent component
export interface RowState {
  chargeId: string
  checked: boolean
  manualAmount: number | null  // null = auto-fill, number = user-typed
}

// NEW — engine input
export interface AllocationInput {
  charges: OutstandingCharge[]        // all outstanding for this scout
  rows: RowState[]                    // one entry per charge
  cash: number                        // amount field
  funds: number                       // funds-applied field
  outstandingBalance: number          // Math.abs(scout.billing_balance)
  cardFeeNet?: number                 // for card path: net-of-fee that hits billing
}

// NEW — engine output
export interface AllocationResult {
  rowAmounts: Record<string, number>     // chargeId → dollars
  autoExtendedIds: Set<string>           // engine-checked rows for spillover
  fundsAllocations: Allocation[]         // split for transfer_funds_to_billing
  cashAllocations: Allocation[]          // split for recordQuickPayment
  issues: ValidationIssue[]
  isValid: boolean
}

export type ValidationIssue =
  | { kind: 'sum_mismatch'; expected: number; actual: number }
  | { kind: 'exceeds_outstanding'; total: number; outstanding: number }
  | { kind: 'funds_exceeds_available'; requested: number; available: number }
  | { kind: 'no_money' }
  | { kind: 'no_charges_checked' }
```

### Engine behavior — `computeAllocations(input): AllocationResult`

In this order:

1. **Determine effective check set.** Start with `rows.filter(r => r.checked)`. If `cash + funds > sum(checked owed)`, auto-extend: walk FIFO through unchecked rows until cumulative owed ≥ cash+funds. Track new picks in `autoExtendedIds`. Cap at `outstandingBalance`.

2. **Compute per-row amounts.** Two pools, filled in order:
   - **Manual rows** (`manualAmount !== null`, regardless of checked vs auto-extended): use the typed value as-is. Sticky across cash changes.
   - Compute `remaining = cash + funds − sum(manual rows)`.
   - **Pool A — user-checked non-manual rows** (rows the user explicitly checked, including the initial pre-check): walk in date order oldest-first; each gets `min(remaining, charge.owed)`; decrement `remaining`.
   - **Pool B — auto-extended non-manual rows** (engine-added to absorb spillover): walk in date order oldest-first; each gets `min(remaining, charge.owed)`; decrement `remaining`.
   - This ordering ensures user intent is honored: pre-checked or manually-checked charges get paid before engine-added auto-extensions, regardless of date.

3. **Validate.** Collect issues; `isValid = issues.length === 0`:
   - `|sum(rowAmounts) − (cash + funds)| > 0.01` → `sum_mismatch`.
   - `cash + funds > outstandingBalance` (or `cardFeeNet > outstandingBalance` for card) → `exceeds_outstanding`.
   - `funds > scout.funds_balance` (passed in) → `funds_exceeds_available`.
   - `cash + funds <= 0` → `no_money`.
   - No row has a positive amount → `no_charges_checked`.

4. **Split per-row amounts into funds vs cash slices.** Iterate `rowAmounts` in date order. Drain funds first (`fundsRemaining = funds`); whatever's left of the per-row list goes to `cashAllocations`. Each slice's sum equals its source amount exactly.

### Worked example (drain-in-order)

Scout owes A($30, older, unchecked at modal open) and B($25, newer, pre-checked via `initialChargeId`). Treasurer enters $5 funds + $30 cash = $35.

1. **Effective check set.** Initial check set = {B}. Sum(checked owed) = $25 < $35 cash+funds → auto-extend; engine walks unchecked FIFO and adds A. `autoExtendedIds = {A}`. Effective set = {A, B}.

2. **Per-row amounts.** No manual rows. `remaining = $35`.
   - **Pool A (user-checked non-manual):** {B}. B gets $25 → `remaining = $10`.
   - **Pool B (auto-extended non-manual):** {A}. A gets $10 → `remaining = $0`.
   - Result: `rowAmounts = { B: 25, A: 10 }`.

3. **Validation.** Sum = $35 = cash + funds ✓. Cash+funds = $35 ≤ outstanding $55 ✓. `isValid = true`.

4. **Split into funds vs cash slices.** Walk per-row amounts in date order: working list = `[{A: 10}, {B: 25}]`. Funds = $5 drains from front: take $5 from A → `fundsAllocations = [{A: 5}]`, list head becomes `{A: 5}`. Cash = $30 drains rest: take $5 from A → `cashAllocations = [{A: 5}]`, take $25 from B → `cashAllocations = [{A: 5}, {B: 25}]`.

5. **Server writes.** Funds RPC: `paid_amount[A] += 5`. recordQuickPayment: `paid_amount[A] += 5`, `paid_amount[B] += 25`. Net result: A.paid_amount = 10 (partial), B.paid_amount = 25 (trigger flips is_paid = true).

The treasurer's intent (B should be paid because they clicked "Record Payment" on B) is honored: B gets fully paid first, and the overflow goes to A as expected.

## Client component changes

### `ChargeAllocationList` ([`src/components/payments/charge-allocation-list.tsx`](../../src/components/payments/charge-allocation-list.tsx))

Becomes a controlled component. Drops its own `checkedIds` / `manualOverride` state.

**Props:**
```ts
interface Props {
  charges: OutstandingCharge[]
  rows: RowState[]
  result: AllocationResult
  onRowChange: (chargeId: string, change: Partial<RowState>) => void
}
```

**Per-row UI:** checkbox + description + `$`-input (disabled when unchecked, placeholder `0.00`) + owed display + "auto-added" subtext when row is in `result.autoExtendedIds`.

**Events:**
- Toggle checkbox → `onRowChange(id, { checked, manualAmount: null })` (uncheck clears manual)
- Type in input → `onRowChange(id, { manualAmount: parseFloat(value) })`
- Clear input → `onRowChange(id, { manualAmount: null })` (returns to auto-fill)

### `QuickPaymentForm` ([`src/components/payments/quick-payment-form.tsx`](../../src/components/payments/quick-payment-form.tsx))

1. **Drop `initialAmount` pre-fill.** Line 70's default value becomes `''`. The `initialAmount` prop stays for back-compat but is ignored. Cleanup pass can remove it later.
2. **Replace `allocations` state with `rows` state.** When charges load, initialize `rows`: one entry per charge, all unchecked. If `initialChargeId` matches, mark that row `checked: true`.
3. **Compute `result` via `useMemo`** on each render; pass to `ChargeAllocationList` along with `rows`.
4. **Surface `result.issues`** in the existing error display block (replaces ad-hoc strings at lines 416-435).
5. **Submit logic** uses `result.fundsAllocations` and `result.cashAllocations`:
   - Refuse if `!result.isValid`.
   - Step 1: if `parsedFundsToApply > 0`, call funds RPC with `result.fundsAllocations`.
   - Step 2: if `parsedAmount > 0`, call `recordQuickPayment` (cash/check) or card POST with `result.cashAllocations`.
6. **Submit-button disabled rule** simplifies to `!selectedScoutId || !result.isValid || isSubmitting || (cardPath && !cardReady)`.

### Unchanged

- Scout selector, balance display, method toggle, notes, success/error UX framing, Square card initialization.
- Inline billing creation (the "no outstanding charges → describe what this is" path).
- "Pay Full Balance" button — still sets `amount = outstanding − fundsApplied`.

## Server action + RPC changes

### `recordQuickPayment` ([`src/app/actions/payments.ts`](../../src/app/actions/payments.ts))

1. **Server-side validation** as a final guard:
   - `|sum(allocations) − amountDollars| ≤ 0.01`. Reject otherwise.
   - Each `chargeId` must belong to `scoutAccountId` and not be voided/paid. Reject otherwise.
   - For non-card paths: `amountDollars + 0 ≤ Math.abs(billing_balance)` (re-fetched after funds-transfer step). Reject if exceeded.
   - Card path: skip the cap (fees can push gross over).
2. **Remove `auto_transfer_overpayment` call** at lines 234-252. The invariant above makes overpayment impossible on the cash/check path; the card path is allowed to overpay but no auto-sweep per Q3.
3. **Existing `paid_amount` update loop** (lines 217-231) stays — it's already correct once allocations carry actual cash.
4. **Existing `payment_allocations` insert** (lines 200-215) stays.

### `transfer_funds_to_billing` RPC migration

`supabase/migrations/YYYYMMDDHHMMSS_funds_transfer_allocations.sql`:

```sql
CREATE OR REPLACE FUNCTION public.transfer_funds_to_billing(
  p_scout_account_id uuid,
  p_amount numeric,
  p_description text,
  p_allocations jsonb DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_alloc jsonb;
  v_alloc_sum numeric := 0;
  v_charge_id uuid;
  v_alloc_amount numeric;
BEGIN
  -- (existing journal-writing logic unchanged)

  IF p_allocations IS NOT NULL THEN
    SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
      INTO v_alloc_sum
      FROM jsonb_array_elements(p_allocations) AS elem;

    IF ABS(v_alloc_sum - p_amount) > 0.01 THEN
      RAISE EXCEPTION 'Allocation sum (%) does not match amount (%)', v_alloc_sum, p_amount;
    END IF;

    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
      v_charge_id := (v_alloc->>'charge_id')::uuid;
      v_alloc_amount := (v_alloc->>'amount')::numeric;

      IF NOT EXISTS (
        SELECT 1 FROM billing_charges
        WHERE id = v_charge_id
          AND scout_account_id = p_scout_account_id
          AND (is_void IS NULL OR is_void = false)
      ) THEN
        RAISE EXCEPTION 'Charge % not found or not owned by scout account %',
          v_charge_id, p_scout_account_id;
      END IF;

      UPDATE billing_charges
        SET paid_amount = COALESCE(paid_amount, 0) + v_alloc_amount
        WHERE id = v_charge_id;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

The `reconcile_billing_charges` trigger handles `is_paid` flipping when `paid_amount >= amount`. No trigger change required.

### `auto_transfer_overpayment` RPC

Stays in the database. The only known live caller is the line being removed from `recordQuickPayment`. Implementation must `git grep auto_transfer_overpayment` and confirm no other callers; if any exist, they get separate review.

## Validation matrix

| Rule | Client engine | Server action | RPC |
|---|:-:|:-:|:-:|
| `sum(rowAmounts) === cash + funds` | live | n/a (split before send) | n/a |
| `sum(cashAllocations) === amountDollars` | live | enforced | n/a |
| `sum(fundsAllocations) === fundsApplied` | live | n/a | enforced |
| `cash + funds ≤ outstanding` (non-card) | live | re-fetch + enforce | n/a |
| `cardFeeNet ≤ outstanding` (card) | live | enforced | n/a |
| `funds ≤ funds_balance` | live | n/a | enforced |
| `charges belong to scout` | implicit | enforced | enforced |
| `charges not voided/paid` | live (filter) | enforced | enforced |
| auto-transfer of overpayment | never | removed | not added |

## Testing strategy

### Unit tests — allocation engine

Extend [`tests/unit/lib/payment-allocation.test.ts`](../../tests/unit/lib/payment-allocation.test.ts) with a `describe('computeAllocations')` block. ~20 cases covering each Q1-Q6 decision and the validation matrix. Listed in the brainstorming summary (table covers pre-checks, FIFO defaults, auto-extend, manual stickiness, drain-in-order, card-fee, partial-paid charges, floating-point edges, empty charges, etc.).

### Component tests — `ChargeAllocationList`

New file [`tests/unit/components/charge-allocation-list.test.tsx`](../../tests/unit/components/charge-allocation-list.test.tsx). ~6 cases via React Testing Library: render per-row UI, disabled input when unchecked, manual amount fires `onRowChange`, clearing returns to auto-fill, toggle behavior, auto-added subtext.

### Component tests — `QuickPaymentForm`

New or extended [`tests/unit/components/quick-payment-form.test.tsx`](../../tests/unit/components/quick-payment-form.test.tsx). ~5 integration-flavored cases: open with `initialChargeId`, open without, typing cash auto-populates rows, exceeds-outstanding error surfaces, funds+cash split calls correct slices.

### Action test — `recordQuickPayment`

Extend [`tests/unit/actions/payments.test.ts`](../../tests/unit/actions/payments.test.ts) with ~3 cases: allocations sum ≠ amount rejected, charge-not-owned-by-scout rejected, `auto_transfer_overpayment` no longer called (mock RPC, assert call count = 0).

### RPC migration verification

Smoke-test only for v1, via `npm run db:fresh` + the multi-unit smoke-test runbook. A pg-test harness (`tests/unit/db/transfer_funds_to_billing.test.ts`) is optional and deferred — the function change is small, well-bounded, and the integration surface is exercised end-to-end through component tests.

### Coverage of original bugs

| Bug | Covered by |
|---|---|
| 1 — Pre-selected charge not visible | engine test (pre-check), component test "open with initialChargeId" |
| 2 — Amount pre-filled with full owed | component test "amount blank on open" |
| 3 — Payment credited to wrong charge | engine tests (allocation order), action test on allocation correctness |
| 4 — Full-owed allocation regardless of cash | engine tests (manual, sum_mismatch, partial-paid) |
| 5 — Funds transfer doesn't write paid_amount | engine test (funds-only, drain-in-order), migration smoke-test |

## Migration / rollout

**Migration scope:** one `CREATE OR REPLACE FUNCTION` for `transfer_funds_to_billing`. Additive only. No tables touched. No data migrated.

**Backward compatibility:** existing callers pass no `p_allocations` parameter; they get the default `NULL` and today's behavior path. Rollback is trivial (re-deploy old function definition).

**Effect on existing records:**

| Pre-existing state | After ship | Treasurer-visible? |
|---|---|---|
| Bug 5 historical: funds applied, `paid_amount = 0` | Stays at 0; display still shows "Unpaid" | Yes — these charges look wrong |
| Bug 4 historical: `paid_amount = amount`, `is_paid = true` | No change; correctly shown as Paid | No |
| Bug 4 historical: `paid_amount >= amount`, `is_paid = false` | Hidden from modal's outstanding list | Edge case: ghost balance (see [Decisions](#decisions)) |
| Existing scout funds balances | Unchanged; available for new payments | No change |
| New cash/check/funds payments | Write `paid_amount` correctly | Yes — billing cards reflect partial/paid correctly |
| New card payments with fee-inflated gross | `billing_balance` may sit slightly positive as account credit (not swept to funds) | Yes — new "credit on balance" state |

**Rollout steps:**

1. Apply migration in dev (`supabase db push` after linking to `feownmcpkfugkcivdoal`).
2. Run `npm run db:fresh` and the multi-unit smoke-test runbook covering funds-only and split-payment flows.
3. `npm run build && npm test` — verify all tests pass.
4. Push to PROD only with explicit approval (per CLAUDE.md guidance), low-activity window.
5. Reload PostgREST schema cache in the Supabase dashboard after migration.
6. No coordinated downtime needed; existing prod data untouched; new transactions correct from cutover.

## Files involved

- [`src/lib/payment-allocation.ts`](../../src/lib/payment-allocation.ts) — extend with `computeAllocations`, `RowState`, `AllocationInput`, `AllocationResult`, `ValidationIssue`
- [`src/components/payments/charge-allocation-list.tsx`](../../src/components/payments/charge-allocation-list.tsx) — controlled component refactor; per-row `$`-input
- [`src/components/payments/quick-payment-form.tsx`](../../src/components/payments/quick-payment-form.tsx) — drop `initialAmount` pre-fill; switch from `allocations` to `rows`; use engine result for validation + submit
- [`src/app/actions/payments.ts`](../../src/app/actions/payments.ts) — server-side allocation validation; remove `auto_transfer_overpayment` call
- `supabase/migrations/YYYYMMDDHHMMSS_funds_transfer_allocations.sql` — new migration extending `transfer_funds_to_billing`
- [`tests/unit/lib/payment-allocation.test.ts`](../../tests/unit/lib/payment-allocation.test.ts) — extend with `computeAllocations` cases
- [`tests/unit/components/charge-allocation-list.test.tsx`](../../tests/unit/components/charge-allocation-list.test.tsx) — new
- [`tests/unit/components/quick-payment-form.test.tsx`](../../tests/unit/components/quick-payment-form.test.tsx) — new or extend
- [`tests/unit/actions/payments.test.ts`](../../tests/unit/actions/payments.test.ts) — extend

## Out of scope

- Anything in the billing-card display layer (already shipped on `phase-6-smoke-runbook-and-cleanup`).
- Refactor or migration of `auto_transfer_overpayment` RPC (stays in DB; only its caller in `recordQuickPayment` is removed).
- Historical data backfill for Bug 4 or Bug 5 victims (defer to void/delete-billing follow-up).
- Audit-table symmetry for funds transfers (new `payment_allocations`-equivalent rows). Deferred.
- A pg-test harness for the RPC migration. Deferred.
- Per-charge negative allocations or "data correction" affordances inside the payment modal.

## Follow-up work

Explicitly **not** follow-ups to this work:

- Backfill of Bug 4 historical `paid_amount` over-counts. Decision: fix forward only.
- Backfill of Bug 5 historical funds-transfer attribution gaps. Decision: fix forward only.
- Reversal of historical `auto_transfer_overpayment` artifacts in `funds_balance`. Decision: fix forward only.

Independent improvements that may follow:

- **Void/delete-billing + per-charge actions UX** ([`project_void_delete_billing_ux.md`](../../.claude/projects/-Users-richblaalid-Projects-chuckbox/memory/project_void_delete_billing_ux.md), spec `2026-05-12-void-delete-billing-ux-design.md`) — separate UX work for voiding/correcting individual damaged charges. Not a dependency of this work.
- Optional pg-test harness for SQL functions (deferred; smoke-test is enough for v1).
- Optional audit-trail symmetry for funds-transfer attribution (new audit rows linking funds-transfers to charges). Deferred — Bug 5's `paid_amount` fix is sufficient for the display layer.

## Original findings

The following section preserves the original findings document (dated 2026-05-12) verbatim for traceability. The decisions above supersede the "Proposed approach" and "Open questions" sections of the original.

### Findings (from manual test against `/finances/billing`)

The test flow:

1. Scout has multiple outstanding billing charges across different records.
2. Treasurer expands a billing row on `/finances/billing` and clicks **Record Payment** on a specific scout's row.
3. The QuickPaymentForm dialog opens.

What was observed:

#### Bug 1 — Pre-selected charge not visible in the allocation list

The "Record Payment" button passes `initialChargeId` to the modal at [src/components/billing/billing-management-view.tsx:742](../../src/components/billing/billing-management-view.tsx#L742). The user expects this specific charge to appear pre-checked in the modal's "Outstanding Charges" list. It doesn't. The checkbox state of the list is driven by FIFO auto-allocation based on `paymentAmount`, which has no knowledge of `initialChargeId`.

#### Bug 2 — "Amount to Collect" field pre-populated with the full charge amount

`initialAmount={paymentCharge.amount}` is passed to the modal and used directly as the default for the `amount` state at [src/components/payments/quick-payment-form.tsx:70](../../src/components/payments/quick-payment-form.tsx#L70). For partial or split payments, the user has to manually clear this value first — extra friction. User's stated preference: do not pre-populate; require the treasurer to enter the cash collected explicitly.

#### Bug 3 — Payment credited to the wrong charge

Downstream of Bug 1. Because the modal's auto-allocation runs FIFO (oldest charge first), the cash gets credited against `billing_charges.paid_amount` for charges other than the one the user started from. The scout's overall billing balance nets correctly via the AR journal entry, but the per-charge `is_paid` / `paid_amount` state drifts from the user's intent.

#### Bug 4 (bonus, spotted in code during root-cause tracing)

In [src/components/payments/charge-allocation-list.tsx:53-61](../../src/components/payments/charge-allocation-list.tsx#L53-L61), the allocation amount reported to the parent for each checked charge is the **full remaining owed**, regardless of how much cash was actually collected:

```ts
.map((c) => {
  const owed = c.amount - c.paidAmount
  return { chargeId: c.id, amount: owed }
})
```

Combined with the server logic at [src/app/actions/payments.ts:218-231](../../src/app/actions/payments.ts#L218-L231), this means `paid_amount` increments by the full owed amount of every checked charge, even when the cash payment is smaller. A $30 cash payment against checked charges A($30) + B($50) marks both charges fully paid in the per-charge state, while only $30 hits the journal. Accounting drifts silently.

#### Bug 5 — Scout-funds transfers don't update charge-level state at all

Discovered May 12, 2026 during continued manual testing on `phase-6-smoke-runbook-and-cleanup`. Scenario: user creates a single-scout $25 billing record, applies $5 from the scout's funds balance, and expects the billing card to show partial state (e.g., "$20 of $25 billed, Partial"). Observed: row still shows "$25, Unpaid."

Root cause: [`transfer_funds_to_billing` RPC](../../supabase/migrations/00000000000000_schema.sql#L1740-L1801) only writes journal lines (debit funds, credit AR). It does NOT touch `billing_charges.paid_amount` or `is_paid`. The closest mechanism — the [`reconcile_billing_charges` trigger](../../supabase/migrations/20260326000002_reconcile_billing_charges.sql) — only flips `is_paid = true` for charges **fully covered** by the balance improvement (greedy FIFO). A partial improvement ($5 against a $25 charge) walks the loop, sees the first charge ($25) exceeds the coverage ($5), and exits without marking anything.

So funds transfers are entirely invisible at the charge level. The display correctly reflects what `billing_charges.paid_amount` says (= 0), so renders as Unpaid. This is a real data-attribution gap, not a display bug.

### Display-layer mitigation already applied (May 12, 2026)

Committed as part of the billing-card display branch to prevent the worst visible symptom of Bug 4 from leaking through:

**`chargeStatus()` treats `paid_amount >= amount` as `'paid'` even when `is_paid = false`**, so an inconsistent-data scenario (cash payment of $5 with allocation set to $25 → `paid_amount = 25`, `is_paid = false` because billing_balance is still negative) displays as "Paid" instead of "Partial — $0 of $25 billed."

This is purely a display-side defensive guard. It does NOT fix the underlying data inconsistency — `billing_charges.paid_amount` still over-counts what was actually collected, the scout's `billing_balance` still reflects the smaller cash amount, and Bug 5 (funds transfers writing nothing at the charge level) is still completely unaddressed. The mitigation buys us a less-confusing display while the data-layer fix is parked.

When the data-layer work eventually lands and correctly writes `paid_amount = actual cash collected`, the mitigation becomes a no-op (its precondition `paid_amount >= amount` will only fire on truly paid charges, which `is_paid` will already have flipped on). Safe to leave in place as a defensive guard.

### Why this work matters

The billing-card display work shipped on `phase-6-smoke-runbook-and-cleanup` accurately reflects whatever state `billing_charges.paid_amount` is in. But that data is currently being written incorrectly by the modal (Bugs 1+3+4). So a treasurer who uses the modal sees the partial-payment UI light up correctly, but it's lighting up against the wrong charges. The display fix gets full value only after the modal write path is fixed.
