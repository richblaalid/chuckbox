---
status: approved
last_verified: 2026-05-19
---

# Payment Modal — Charge Allocation Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 bugs in `QuickPaymentForm` + `ChargeAllocationList` that cause incorrect per-charge `paid_amount` writes and silent overpayments. After this work: pre-selected charges honor user intent, per-row dollar inputs replace checkbox-only allocation, validation prevents overpayment from creating scout-funds artifacts, and funds-transfers correctly attribute to charges.

**Spec:** [docs/superpowers/specs/2026-05-12-payment-modal-charge-allocation-design.md](../docs/superpowers/specs/2026-05-12-payment-modal-charge-allocation-design.md)

**Architecture:** A pure-function allocation engine (`computeAllocations`) in [src/lib/payment-allocation.ts](../src/lib/payment-allocation.ts) becomes the single source of truth for both the UI (real-time per-keystroke) and the server action (final validation). `ChargeAllocationList` becomes a controlled component owned by the form; it renders one checkbox + `$`-input per outstanding charge. `recordQuickPayment` adds server-side validation and stops calling `auto_transfer_overpayment`. `transfer_funds_to_billing` RPC gains an optional `p_allocations jsonb` parameter so funds transfers can increment per-charge `paid_amount` alongside the journal entries. The work is forward-fixing only — no historical-data backfill.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Supabase (PostgreSQL), Tailwind CSS 4, Vitest 4 + React Testing Library.

**Files involved:**

- **Create**: `supabase/migrations/20260519000001_funds_transfer_allocations.sql` — extend `transfer_funds_to_billing` RPC.
- **Modify**: `src/lib/payment-allocation.ts` — add engine types (`RowState`, `AllocationInput`, `AllocationResult`, `ValidationIssue`) and `computeAllocations` function.
- **Modify**: `tests/unit/charge-allocation.test.ts` — extend with `computeAllocations` cases (~20 new tests).
- **Modify**: `src/components/payments/charge-allocation-list.tsx` — refactor to controlled component with per-row `$`-input.
- **Create**: `tests/unit/components/charge-allocation-list.test.tsx` — new component tests (~6 cases).
- **Modify**: `src/components/payments/quick-payment-form.tsx` — drop `initialAmount` pre-fill; replace `allocations` state with `rows`; wire engine result; update submit logic.
- **Create**: `tests/unit/components/quick-payment-form.test.tsx` — new component tests (~5 cases).
- **Modify**: `src/app/actions/payments.ts` — server-side allocation validation; remove `auto_transfer_overpayment` call.
- **Modify**: `tests/unit/actions/payments.test.ts` — extend with ~3 validation tests.

No new files outside of these. No changes to: scout selector, balance display, method toggle, notes field, Square card SDK integration, inline-billing-creation flow, billing-card display layer, `auto_transfer_overpayment` RPC definition (the function stays; only its caller in `recordQuickPayment` is removed), `reconcile_billing_charges` trigger.

**Branch:** Create `feat/payment-modal-charge-allocation` from `main` before starting. Each task commits separately.

---

## Phase 0 — Foundation

Two prep tasks. The first answers an open question in the spec (card-fee journal convention) so we don't trip over it later. The second lands the migration so the funds RPC can accept allocations.

### Task 0.1: Verify card-payment journal convention in `/api/square/payments`

**Goal:** The spec flags an open implementation detail: whether `billing_balance` is reduced by gross or net for card payments. This task reads the existing Square API route, confirms the convention, and documents it in a code comment so the implementer of Phase 1's validation rule knows which value to compare against `outstanding`.

**Files:**
- Read: `src/app/api/square/payments/route.ts`
- Read: `supabase/migrations/00000000000000_schema.sql` (if a Square-related RPC exists)

- [ ] **Step 0.1.1: Read the Square payments route**

Run: `cat src/app/api/square/payments/route.ts`

Identify: when a card payment succeeds, what value is debited from cash account and credited to AR (which reduces `billing_balance`)? Is it `amountCents / 100` (gross — the full amount charged to the card), or `amountCents / 100 − fee` (net — what the unit receives)?

- [ ] **Step 0.1.2: Document the convention**

Open `docs/superpowers/specs/2026-05-12-payment-modal-charge-allocation-design.md`. Locate the "Card-fee handling" section. Replace the "Open implementation detail" bullet with a single line stating the actual convention you found, e.g.:

> **Convention (verified 2026-05-19 in `src/app/api/square/payments/route.ts`):** `billing_balance` is reduced by [gross | net]. The validation rule for the card path is: `[gross | net]_amount ≤ outstanding`.

Commit:

```bash
git add docs/superpowers/specs/2026-05-12-payment-modal-charge-allocation-design.md
git commit -m "docs(billing): record verified card-payment journal convention"
```

- [ ] **Step 0.1.3: Note any auto-sweep in the Square route**

Search the same route for `auto_transfer_overpayment`. If present, that's a second call site we'll need to remove in Phase 4. Note its line numbers as a TODO for Task 4.3. If absent, nothing to do.

Run: `grep -n auto_transfer_overpayment src/app/api/square/payments/route.ts`

---

### Task 0.2: Migration — funds-transfer accepts allocations

**Files:**
- Create: `supabase/migrations/20260519000001_funds_transfer_allocations.sql`

- [ ] **Step 0.2.1: Confirm linked to dev database**

Run: `supabase projects list`

Expected: `feownmcpkfugkcivdoal` (DEV) shown as linked. If not linked or linked to PROD, run:

```bash
supabase link --project-ref feownmcpkfugkcivdoal
```

- [ ] **Step 0.2.2: Create the migration file**

Create `supabase/migrations/20260519000001_funds_transfer_allocations.sql` with this content:

```sql
-- Extend transfer_funds_to_billing RPC to optionally accept per-charge allocations.
-- When p_allocations is provided, increments billing_charges.paid_amount alongside
-- the journal entries. Existing callers passing no p_allocations get current behavior
-- (NULL default, allocation block skipped).

CREATE OR REPLACE FUNCTION transfer_funds_to_billing(
    p_scout_account_id UUID,
    p_amount DECIMAL(10,2),
    p_description TEXT DEFAULT 'Transfer from Scout Funds',
    p_allocations JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_account RECORD;
    v_unit_id UUID;
    v_journal_entry_id UUID;
    v_funds_account_id UUID;
    v_billing_account_id UUID;
    v_scout_name TEXT;
    v_alloc JSONB;
    v_alloc_sum NUMERIC := 0;
    v_charge_id UUID;
    v_alloc_amount NUMERIC;
BEGIN
    SELECT sa.*, s.first_name, s.last_name, s.unit_id
    INTO v_account
    FROM scout_accounts sa
    JOIN scouts s ON s.id = sa.scout_id
    WHERE sa.id = p_scout_account_id
    FOR UPDATE;

    IF v_account IS NULL THEN
        RAISE EXCEPTION 'Scout account not found';
    END IF;

    v_unit_id := v_account.unit_id;
    v_scout_name := v_account.first_name || ' ' || v_account.last_name;

    IF v_account.funds_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient funds. Available: $%, Requested: $%',
            v_account.funds_balance, p_amount;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    -- If allocations supplied, validate them before doing any work
    IF p_allocations IS NOT NULL THEN
        SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
          INTO v_alloc_sum
          FROM jsonb_array_elements(p_allocations) AS elem;

        IF ABS(v_alloc_sum - p_amount) > 0.01 THEN
            RAISE EXCEPTION 'Allocation sum (%) does not match transfer amount (%)',
                v_alloc_sum, p_amount;
        END IF;

        -- Verify every allocation references a charge owned by this scout account
        FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
        LOOP
            v_charge_id := (v_alloc->>'charge_id')::UUID;
            IF NOT EXISTS (
                SELECT 1 FROM billing_charges
                WHERE id = v_charge_id
                  AND scout_account_id = p_scout_account_id
                  AND (is_void IS NULL OR is_void = false)
            ) THEN
                RAISE EXCEPTION 'Charge % not found or not owned by scout account %',
                    v_charge_id, p_scout_account_id;
            END IF;
        END LOOP;
    END IF;

    SELECT id INTO v_funds_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1210';
    SELECT id INTO v_billing_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1200';

    IF v_funds_account_id IS NULL OR v_billing_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts not found for unit';
    END IF;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted, created_by)
    VALUES (v_unit_id, CURRENT_DATE, p_description || ' - ' || v_scout_name, 'funds_transfer', true, get_current_profile_id())
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_funds_account_id, p_scout_account_id, p_amount, 0, 'Transfer to billing', 'funds');

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_billing_account_id, p_scout_account_id, 0, p_amount, 'Transfer from scout funds', 'billing');

    -- Apply per-charge paid_amount increments
    IF p_allocations IS NOT NULL THEN
        FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
        LOOP
            v_charge_id := (v_alloc->>'charge_id')::UUID;
            v_alloc_amount := (v_alloc->>'amount')::NUMERIC;

            UPDATE billing_charges
                SET paid_amount = COALESCE(paid_amount, 0) + v_alloc_amount
                WHERE id = v_charge_id;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'journal_entry_id', v_journal_entry_id,
        'amount_transferred', p_amount,
        'new_funds_balance', v_account.funds_balance - p_amount,
        'new_billing_balance', v_account.billing_balance + p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;
```

- [ ] **Step 0.2.3: Apply migration to dev**

Run: `supabase db push`

Expected: `Applying migration 20260519000001_funds_transfer_allocations.sql` followed by success.

- [ ] **Step 0.2.4: Reload schema cache**

Open the Supabase Dashboard for project `feownmcpkfugkcivdoal` → Settings → API → click "Reload schema cache". This makes the new parameter callable from supabase-js.

- [ ] **Step 0.2.5: Smoke-verify the migration**

Run this in the Supabase SQL editor (or via `psql`) to confirm the function signature now has 4 parameters:

```sql
SELECT proname, pg_get_function_arguments(oid)
FROM pg_proc
WHERE proname = 'transfer_funds_to_billing';
```

Expected output includes `p_allocations jsonb DEFAULT NULL`.

- [ ] **Step 0.2.6: Verify backward compatibility — call without p_allocations**

In the SQL editor, find a test scout account with funds (or create one) and run:

```sql
-- Replace UUID with an actual scout_accounts.id that has funds_balance > 0
SELECT transfer_funds_to_billing(
    'REPLACE_WITH_SCOUT_ACCOUNT_ID'::uuid,
    1.00,
    'Migration smoke test'
);
```

Expected: returns `{"success": true, ...}`. No error about missing parameter.

Roll back this test transfer in the SQL editor afterwards (delete the journal_entry and reset balances), or just leave as a $1 cosmetic transfer.

- [ ] **Step 0.2.7: Commit the migration**

```bash
git add supabase/migrations/20260519000001_funds_transfer_allocations.sql
git commit -m "feat(billing): extend transfer_funds_to_billing with p_allocations parameter"
```

---

## Phase 1 — Allocation Engine

Pure-function module. TDD throughout. Each task writes failing tests first, then minimum implementation to pass.

### Task 1.1: Add engine types

**Files:**
- Modify: `src/lib/payment-allocation.ts` — add types at the top of the file (after existing imports/exports).

- [ ] **Step 1.1.1: Add types to payment-allocation.ts**

Open `src/lib/payment-allocation.ts`. The file currently exports `OutstandingCharge`, `Allocation`, and `allocatePayment`. After the existing `Allocation` interface (around line 14), insert:

```ts
/** Per-row state owned by the parent component. */
export interface RowState {
  chargeId: string
  checked: boolean
  /** null = auto-fill from the engine; number = user-typed override (sticky across cash changes). */
  manualAmount: number | null
}

/** Input to the allocation engine. */
export interface AllocationInput {
  /** All outstanding charges for the scout (after filtering out paid/voided). */
  charges: OutstandingCharge[]
  /** One entry per charge, same length as `charges`. */
  rows: RowState[]
  /** External cash/check/card amount the treasurer is collecting. */
  cash: number
  /** Funds transfer amount (from scout's funds_balance). */
  funds: number
  /** Math.abs(scout.billing_balance). Used for the non-card outstanding cap. */
  outstandingBalance: number
  /**
   * For card-payment path only: the net-of-fee amount that will reduce billing_balance.
   * If provided, replaces `cash` in the exceeds-outstanding validation rule.
   * The actual `rowAmounts` distribution still uses `cash + funds`.
   */
  cardFeeNet?: number
}

/** Validation issues surfaced by the engine. */
export type ValidationIssue =
  | { kind: 'sum_mismatch'; expected: number; actual: number }
  | { kind: 'exceeds_outstanding'; total: number; outstanding: number }
  | { kind: 'funds_exceeds_available'; requested: number; available: number }
  | { kind: 'no_money' }
  | { kind: 'no_charges_checked' }

/** Output of the allocation engine — UI and server both consume this. */
export interface AllocationResult {
  /** Per-row resolved amount (what each row's $-input should display). chargeId → dollars. */
  rowAmounts: Record<string, number>
  /** Charge IDs the engine auto-checked to absorb spillover (UI badge hint). */
  autoExtendedIds: Set<string>
  /** Slice of per-row amounts to send via the funds RPC (drained first, FIFO across rows). */
  fundsAllocations: Allocation[]
  /** Slice of per-row amounts to send via recordQuickPayment (cash/check) or the card route. */
  cashAllocations: Allocation[]
  /** Collected validation problems; empty when isValid is true. */
  issues: ValidationIssue[]
  /** True when issues is empty. */
  isValid: boolean
}

/** Penny tolerance for sum-equality and floating-point comparisons. */
export const ALLOCATION_TOLERANCE = 0.01
```

Save the file.

- [ ] **Step 1.1.2: Verify file still compiles**

Run: `npx tsc --noEmit`

Expected: no errors. (If you see "unused export" warnings, ignore — types are consumed in later tasks.)

- [ ] **Step 1.1.3: Commit**

```bash
git add src/lib/payment-allocation.ts
git commit -m "feat(billing): add allocation engine types"
```

---

### Task 1.2: TDD — baseline cases (pre-check + simple FIFO)

**Files:**
- Modify: `tests/unit/charge-allocation.test.ts` — add a new `describe('computeAllocations')` block at the bottom.
- Modify: `src/lib/payment-allocation.ts` — add `computeAllocations` stub.

- [ ] **Step 1.2.1: Add a test-helper to the existing test file**

Open `tests/unit/charge-allocation.test.ts`. After the existing `makeCharge` helper near the top (around line 12), insert a `makeInput` helper:

```ts
import { computeAllocations, type RowState, type AllocationInput, type OutstandingCharge as _OC } from '@/lib/payment-allocation'

/**
 * Build an AllocationInput from a charges array and partial overrides.
 * rows default to all unchecked / non-manual unless `rowOverrides` flips them.
 */
function makeInput(
  charges: OutstandingCharge[],
  overrides: Partial<Omit<AllocationInput, 'charges' | 'rows'>> & {
    rowOverrides?: Array<Partial<RowState> & { chargeId: string }>
  } = {}
): AllocationInput {
  const rows: RowState[] = charges.map((c) => {
    const override = overrides.rowOverrides?.find((r) => r.chargeId === c.id)
    return {
      chargeId: c.id,
      checked: override?.checked ?? false,
      manualAmount: override?.manualAmount ?? null,
    }
  })
  return {
    charges,
    rows,
    cash: overrides.cash ?? 0,
    funds: overrides.funds ?? 0,
    outstandingBalance: overrides.outstandingBalance ?? charges.reduce((s, c) => s + (c.amount - c.paidAmount), 0),
    cardFeeNet: overrides.cardFeeNet,
  }
}
```

Make sure to also update the existing import at the top of the file to include `OutstandingCharge` if it's not already there. The existing file already imports `allocatePayment, type OutstandingCharge` — just confirm.

- [ ] **Step 1.2.2: Write failing tests for baseline behavior**

At the bottom of `tests/unit/charge-allocation.test.ts`, after the existing `describe('allocatePayment')` block's closing `})`, add:

```ts
describe('computeAllocations — baseline', () => {
  it('returns no_money issue when cash and funds are both zero', () => {
    const charges = [makeCharge('1', 50, '2026-06-01')]
    const result = computeAllocations(makeInput(charges))
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({ kind: 'no_money' })
    expect(result.rowAmounts).toEqual({})
  })

  it('honors a pre-checked charge with cash equal to its owed', () => {
    const charges = [makeCharge('B', 25, '2026-06-15')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 25,
        rowOverrides: [{ chargeId: 'B', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.rowAmounts).toEqual({ B: 25 })
    expect(result.autoExtendedIds.size).toBe(0)
    expect(result.cashAllocations).toEqual([{ chargeId: 'B', amount: 25 }])
    expect(result.fundsAllocations).toEqual([])
  })

  it('dashboard flow with no pre-check: auto-extends FIFO by date as cash grows', () => {
    const charges = [
      makeCharge('older', 30, '2026-06-01'),
      makeCharge('newer', 25, '2026-06-15'),
    ]
    const result = computeAllocations(makeInput(charges, { cash: 50 }))
    expect(result.isValid).toBe(true)
    // Auto-extended both rows; FIFO by date — older fills first ($30), newer gets $20
    expect(result.rowAmounts).toEqual({ older: 30, newer: 20 })
    expect(result.autoExtendedIds).toEqual(new Set(['older', 'newer']))
  })

  it('user-checked rows fill before auto-extended rows (Bug 3 fix)', () => {
    const charges = [
      makeCharge('older', 30, '2026-06-01'),
      makeCharge('newer', 25, '2026-06-15'),
    ]
    // Treasurer clicked "Record Payment" on the newer charge → pre-checked = 'newer'
    const result = computeAllocations(
      makeInput(charges, {
        cash: 40,
        rowOverrides: [{ chargeId: 'newer', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    // 'newer' fills first ($25 — user intent), then auto-extended 'older' gets $15
    expect(result.rowAmounts).toEqual({ newer: 25, older: 15 })
    expect(result.autoExtendedIds).toEqual(new Set(['older']))
  })
})
```

- [ ] **Step 1.2.3: Run tests and confirm they fail**

Run: `vitest run tests/unit/charge-allocation.test.ts`

Expected: 4 failures, all of the form `computeAllocations is not a function` (or "is not defined") because we haven't added it yet.

- [ ] **Step 1.2.4: Implement `computeAllocations` minimally to pass these 4 tests**

Open `src/lib/payment-allocation.ts`. Append a new function at the bottom:

```ts
/**
 * Compute per-row payment allocations and validation issues from form state.
 *
 * Order of operations:
 *   1. Determine effective check set (user-checked + auto-extended for spillover).
 *   2. Fill per-row amounts: manual rows first (sticky), then user-checked non-manual
 *      (FIFO by date), then auto-extended non-manual (FIFO by date).
 *   3. Validate invariants.
 *   4. Split per-row amounts into funds vs cash slices (drain funds first, then cash).
 */
export function computeAllocations(input: AllocationInput): AllocationResult {
  const { charges, rows, cash, funds, outstandingBalance, cardFeeNet } = input

  const total = cash + funds
  const issues: ValidationIssue[] = []
  const rowAmounts: Record<string, number> = {}
  const autoExtendedIds = new Set<string>()

  // No money → no work
  if (total <= 0) {
    issues.push({ kind: 'no_money' })
    return {
      rowAmounts,
      autoExtendedIds,
      fundsAllocations: [],
      cashAllocations: [],
      issues,
      isValid: false,
    }
  }

  // Build a chargeId → owed lookup (amount − already-paid)
  const chargeById = new Map<string, OutstandingCharge>(charges.map((c) => [c.id, c]))
  const owedOf = (id: string) => {
    const c = chargeById.get(id)
    return c ? Math.max(0, c.amount - (c.paidAmount || 0)) : 0
  }

  // Date-sort helper (oldest first, then createdAt for stable ties)
  const byDate = (a: OutstandingCharge, b: OutstandingCharge) => {
    const d = a.billingDate.localeCompare(b.billingDate)
    return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt)
  }
  const sortedCharges = [...charges].sort(byDate)

  // Separate manual vs non-manual rows
  const manualRows = rows.filter((r) => r.manualAmount !== null)
  for (const r of manualRows) {
    rowAmounts[r.chargeId] = r.manualAmount as number
  }
  const manualSum = manualRows.reduce((s, r) => s + (r.manualAmount as number), 0)

  // Effective check set: explicitly-checked rows (user intent)
  const userCheckedIds = new Set(rows.filter((r) => r.checked).map((r) => r.chargeId))
  // Sum of user-checked owed (used for auto-extend decision)
  const userCheckedOwedSum = [...userCheckedIds].reduce((s, id) => s + owedOf(id), 0)

  // Auto-extend: if total cash+funds exceeds user-checked owed, walk unchecked FIFO to absorb
  if (total > userCheckedOwedSum) {
    let toAbsorb = total - userCheckedOwedSum
    for (const c of sortedCharges) {
      if (toAbsorb <= 0) break
      if (userCheckedIds.has(c.id)) continue
      const o = owedOf(c.id)
      if (o <= 0) continue
      autoExtendedIds.add(c.id)
      toAbsorb -= Math.min(o, toAbsorb)
    }
  }

  // Fill order: user-checked non-manual rows (FIFO by date) then auto-extended non-manual (FIFO by date)
  let remaining = Math.max(0, total - manualSum)

  const fillPool = (poolIds: Set<string>) => {
    if (remaining <= 0) return
    const poolCharges = sortedCharges.filter((c) => poolIds.has(c.id) && !(c.id in rowAmounts))
    for (const c of poolCharges) {
      if (remaining <= 0) break
      const o = owedOf(c.id)
      if (o <= 0) continue
      const alloc = Math.min(o, remaining)
      rowAmounts[c.id] = alloc
      remaining -= alloc
    }
  }

  fillPool(userCheckedIds)
  fillPool(autoExtendedIds)

  // Validation
  const rowSum = Object.values(rowAmounts).reduce((s, n) => s + n, 0)
  if (Math.abs(rowSum - total) > ALLOCATION_TOLERANCE) {
    issues.push({ kind: 'sum_mismatch', expected: total, actual: rowSum })
  }

  const billingApplied = cardFeeNet !== undefined ? cardFeeNet : total
  if (billingApplied > outstandingBalance + ALLOCATION_TOLERANCE) {
    issues.push({ kind: 'exceeds_outstanding', total: billingApplied, outstanding: outstandingBalance })
  }

  const positiveRows = Object.values(rowAmounts).filter((n) => n > 0).length
  if (positiveRows === 0) {
    issues.push({ kind: 'no_charges_checked' })
  }

  // Funds vs cash split: drain funds first across rowAmounts in date order
  const fundsAllocations: Allocation[] = []
  const cashAllocations: Allocation[] = []
  let fundsRemaining = funds
  let cashRemaining = cash

  for (const c of sortedCharges) {
    let rowRemaining = rowAmounts[c.id] || 0
    if (rowRemaining <= 0) continue
    if (fundsRemaining > 0) {
      const take = Math.min(fundsRemaining, rowRemaining)
      fundsAllocations.push({ chargeId: c.id, amount: take })
      fundsRemaining -= take
      rowRemaining -= take
    }
    if (rowRemaining > 0 && cashRemaining > 0) {
      const take = Math.min(cashRemaining, rowRemaining)
      cashAllocations.push({ chargeId: c.id, amount: take })
      cashRemaining -= take
    }
  }

  return {
    rowAmounts,
    autoExtendedIds,
    fundsAllocations,
    cashAllocations,
    issues,
    isValid: issues.length === 0,
  }
}
```

- [ ] **Step 1.2.5: Run tests; confirm 4 baseline tests pass**

Run: `vitest run tests/unit/charge-allocation.test.ts`

Expected: existing `allocatePayment` tests still pass; the 4 new `computeAllocations — baseline` tests now pass. Total: all green.

- [ ] **Step 1.2.6: Commit**

```bash
git add src/lib/payment-allocation.ts tests/unit/charge-allocation.test.ts
git commit -m "feat(billing): add computeAllocations engine with baseline tests"
```

---

### Task 1.3: TDD — manual override stickiness

**Files:**
- Modify: `tests/unit/charge-allocation.test.ts`

- [ ] **Step 1.3.1: Write failing tests**

Append to the test file, after the baseline describe block:

```ts
describe('computeAllocations — manual override', () => {
  it('respects a manual row amount and distributes remainder FIFO to other checked rows', () => {
    const charges = [
      makeCharge('A', 30, '2026-06-01'),
      makeCharge('B', 50, '2026-06-15'),
    ]
    // Treasurer types $10 on B; total cash $40; A and B both checked.
    const result = computeAllocations(
      makeInput(charges, {
        cash: 40,
        rowOverrides: [
          { chargeId: 'A', checked: true },
          { chargeId: 'B', checked: true, manualAmount: 10 },
        ],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.rowAmounts).toEqual({ B: 10, A: 30 })
  })

  it('manual rows stay sticky when cash decreases (does not auto-clear)', () => {
    const charges = [makeCharge('A', 30, '2026-06-01'), makeCharge('B', 50, '2026-06-15')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 30, // decreased from a previous higher value
        rowOverrides: [
          { chargeId: 'A', checked: true, manualAmount: 20 },
          { chargeId: 'B', checked: true },
        ],
      })
    )
    // A holds $20 (manual); remaining $10 fills B
    expect(result.rowAmounts).toEqual({ A: 20, B: 10 })
    expect(result.isValid).toBe(true)
  })

  it('manual rows summing more than cash produce sum_mismatch', () => {
    const charges = [makeCharge('A', 50, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 20,
        rowOverrides: [{ chargeId: 'A', checked: true, manualAmount: 50 }],
      })
    )
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({ kind: 'sum_mismatch', expected: 20, actual: 50 })
  })
})
```

- [ ] **Step 1.3.2: Run tests**

Run: `vitest run tests/unit/charge-allocation.test.ts`

Expected: 3 new tests pass (the engine already handles manualAmount; if any fail, fix the engine before continuing).

If any fail: re-read the engine's manualRows handling. The first 2 tests should pass with the current implementation; the third should also pass because manualSum > total triggers sum_mismatch.

- [ ] **Step 1.3.3: Commit**

```bash
git add tests/unit/charge-allocation.test.ts
git commit -m "test(billing): cover manual override stickiness in computeAllocations"
```

---

### Task 1.4: TDD — funds vs cash drain-in-order split

**Files:**
- Modify: `tests/unit/charge-allocation.test.ts`

- [ ] **Step 1.4.1: Write failing tests**

Append:

```ts
describe('computeAllocations — funds/cash drain split', () => {
  it('drains funds across rows in date order before cash', () => {
    // Scout owes A($30, older) and B($25, newer, pre-checked). Treasurer enters $5 funds + $30 cash.
    const charges = [
      makeCharge('A', 30, '2026-06-01'),
      makeCharge('B', 25, '2026-06-15'),
    ]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 30,
        funds: 5,
        rowOverrides: [{ chargeId: 'B', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    // User-checked B fills first ($25). Auto-extended A gets $10. Total = $35.
    expect(result.rowAmounts).toEqual({ B: 25, A: 10 })
    expect(result.autoExtendedIds).toEqual(new Set(['A']))

    // Split: walking rowAmounts in date order: A ($10) then B ($25).
    // Funds=$5 takes from front (A): fundsAllocations=[{A:5}], A.remaining=$5.
    // Cash=$30 takes rest: cashAllocations=[{A:5},{B:25}].
    expect(result.fundsAllocations).toEqual([{ chargeId: 'A', amount: 5 }])
    expect(result.cashAllocations).toEqual([
      { chargeId: 'A', amount: 5 },
      { chargeId: 'B', amount: 25 },
    ])
  })

  it('funds-only payment (no cash) puts everything in fundsAllocations', () => {
    const charges = [makeCharge('A', 25, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        funds: 25,
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.fundsAllocations).toEqual([{ chargeId: 'A', amount: 25 }])
    expect(result.cashAllocations).toEqual([])
  })

  it('partial funds-only payment ($5 against $25 charge — Bug 5 scenario)', () => {
    const charges = [makeCharge('A', 25, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        funds: 5,
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.rowAmounts).toEqual({ A: 5 })
    expect(result.fundsAllocations).toEqual([{ chargeId: 'A', amount: 5 }])
    expect(result.cashAllocations).toEqual([])
  })

  it('cash-only payment puts everything in cashAllocations', () => {
    const charges = [makeCharge('A', 25, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 25,
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.fundsAllocations).toEqual([])
    expect(result.cashAllocations).toEqual([{ chargeId: 'A', amount: 25 }])
  })
})
```

- [ ] **Step 1.4.2: Run tests**

Run: `vitest run tests/unit/charge-allocation.test.ts`

Expected: all 4 new tests pass with the existing engine implementation. If any fail, the engine's split logic needs fixing.

- [ ] **Step 1.4.3: Commit**

```bash
git add tests/unit/charge-allocation.test.ts
git commit -m "test(billing): cover funds/cash drain-in-order split"
```

---

### Task 1.5: TDD — validation issues + edge cases

**Files:**
- Modify: `tests/unit/charge-allocation.test.ts`

- [ ] **Step 1.5.1: Write failing tests**

Append:

```ts
describe('computeAllocations — validation', () => {
  it('cash + funds exceeds outstanding (non-card) → exceeds_outstanding', () => {
    const charges = [makeCharge('A', 25, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 50, // outstandingBalance defaults to sum of owed = 25
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({
      kind: 'exceeds_outstanding',
      total: 50,
      outstanding: 25,
    })
  })

  it('card path: gross > outstanding but net <= outstanding → valid', () => {
    const charges = [makeCharge('A', 100, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 103.20, // gross
        cardFeeNet: 100, // net = gross - fee
        outstandingBalance: 100,
        rowOverrides: [{ chargeId: 'A', checked: true, manualAmount: 103.20 }],
      })
    )
    expect(result.isValid).toBe(true)
  })

  it('card path: net > outstanding → exceeds_outstanding', () => {
    const charges = [makeCharge('A', 50, '2026-06-01')]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 100,
        cardFeeNet: 96.80,
        outstandingBalance: 50,
        rowOverrides: [{ chargeId: 'A', checked: true, manualAmount: 100 }],
      })
    )
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({
      kind: 'exceeds_outstanding',
      total: 96.80,
      outstanding: 50,
    })
  })

  it('all rows unchecked + no manual amounts → no_charges_checked is not raised when auto-extend covers', () => {
    // Dashboard flow: treasurer hasn't manually picked anything, but types cash.
    // Engine auto-extends FIFO; row gets a positive amount; no no_charges_checked issue.
    const charges = [makeCharge('A', 30, '2026-06-01')]
    const result = computeAllocations(makeInput(charges, { cash: 30 }))
    expect(result.isValid).toBe(true)
    expect(result.issues).not.toContainEqual({ kind: 'no_charges_checked' })
  })

  it('floating-point penny tolerance: sum equals cash within $0.01', () => {
    const charges = [
      makeCharge('A', 10, '2026-06-01'),
      makeCharge('B', 20, '2026-06-15'),
    ]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 30.005, // off by half a penny
        rowOverrides: [
          { chargeId: 'A', checked: true },
          { chargeId: 'B', checked: true },
        ],
      })
    )
    // Tolerance allows it; isValid = true
    expect(result.isValid).toBe(true)
  })

  it('partial-paid charge respects existing paid_amount in owed calculation', () => {
    const charges: OutstandingCharge[] = [
      {
        id: 'A',
        billingRecordId: 'br-A',
        description: 'Charge A',
        amount: 50,
        paidAmount: 30, // already paid $30, owes $20
        billingDate: '2026-06-01',
        createdAt: '2026-06-01',
      },
    ]
    const result = computeAllocations(
      makeInput(charges, {
        cash: 20,
        outstandingBalance: 20,
        rowOverrides: [{ chargeId: 'A', checked: true }],
      })
    )
    expect(result.isValid).toBe(true)
    expect(result.rowAmounts).toEqual({ A: 20 })
  })

  it('empty charges list with positive cash → no_charges_checked', () => {
    const result = computeAllocations(makeInput([], { cash: 30 }))
    expect(result.isValid).toBe(false)
    expect(result.issues).toContainEqual({ kind: 'no_charges_checked' })
  })
})
```

- [ ] **Step 1.5.2: Run tests**

Run: `vitest run tests/unit/charge-allocation.test.ts`

Expected: all 7 new tests pass.

- [ ] **Step 1.5.3: Commit**

```bash
git add tests/unit/charge-allocation.test.ts
git commit -m "test(billing): cover validation + edge cases in computeAllocations"
```

---

## Phase 2 — `ChargeAllocationList` Component Refactor

Refactor to a controlled component driven by the parent. Per-row `$`-input replaces checkbox-only.

### Task 2.1: Write component tests for new controlled behavior

**Files:**
- Create: `tests/unit/components/charge-allocation-list.test.tsx`

- [ ] **Step 2.1.1: Create the test file**

Create `tests/unit/components/charge-allocation-list.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChargeAllocationList } from '@/components/payments/charge-allocation-list'
import type { OutstandingCharge, RowState, AllocationResult } from '@/lib/payment-allocation'

const charges: OutstandingCharge[] = [
  { id: 'A', billingRecordId: 'br-A', description: 'Charge A', amount: 30, paidAmount: 0, billingDate: '2026-06-01', createdAt: '2026-06-01' },
  { id: 'B', billingRecordId: 'br-B', description: 'Charge B', amount: 25, paidAmount: 0, billingDate: '2026-06-15', createdAt: '2026-06-15' },
]

const baseRows: RowState[] = [
  { chargeId: 'A', checked: false, manualAmount: null },
  { chargeId: 'B', checked: false, manualAmount: null },
]

const baseResult: AllocationResult = {
  rowAmounts: {},
  autoExtendedIds: new Set(),
  fundsAllocations: [],
  cashAllocations: [],
  issues: [],
  isValid: true,
}

describe('ChargeAllocationList', () => {
  it('renders one row per outstanding charge', () => {
    render(
      <ChargeAllocationList
        charges={charges}
        rows={baseRows}
        result={baseResult}
        onRowChange={() => {}}
      />
    )
    expect(screen.getByText('Charge A')).toBeInTheDocument()
    expect(screen.getByText('Charge B')).toBeInTheDocument()
  })

  it('disables the $-input for unchecked rows', () => {
    render(
      <ChargeAllocationList
        charges={charges}
        rows={baseRows}
        result={baseResult}
        onRowChange={() => {}}
      />
    )
    const inputs = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    inputs.forEach((i) => expect(i).toBeDisabled())
  })

  it('typing in a row input fires onRowChange with manualAmount set', () => {
    const onRowChange = vi.fn()
    const rows: RowState[] = [
      { chargeId: 'A', checked: true, manualAmount: null },
      { chargeId: 'B', checked: false, manualAmount: null },
    ]
    render(
      <ChargeAllocationList
        charges={charges}
        rows={rows}
        result={{ ...baseResult, rowAmounts: { A: 25 } }}
        onRowChange={onRowChange}
      />
    )
    const inputs = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
    fireEvent.change(inputs[0], { target: { value: '15.50' } })
    expect(onRowChange).toHaveBeenCalledWith('A', { manualAmount: 15.5 })
  })

  it('clearing a row input fires onRowChange with manualAmount: null', () => {
    const onRowChange = vi.fn()
    const rows: RowState[] = [
      { chargeId: 'A', checked: true, manualAmount: 20 },
      { chargeId: 'B', checked: false, manualAmount: null },
    ]
    render(
      <ChargeAllocationList
        charges={charges}
        rows={rows}
        result={{ ...baseResult, rowAmounts: { A: 20 } }}
        onRowChange={onRowChange}
      />
    )
    const inputs = screen.getAllByDisplayValue('20') as HTMLInputElement[]
    fireEvent.change(inputs[0], { target: { value: '' } })
    expect(onRowChange).toHaveBeenCalledWith('A', { manualAmount: null })
  })

  it('toggling checkbox fires onRowChange with checked and clears manualAmount', () => {
    const onRowChange = vi.fn()
    const rows: RowState[] = [
      { chargeId: 'A', checked: true, manualAmount: 20 },
      { chargeId: 'B', checked: false, manualAmount: null },
    ]
    render(
      <ChargeAllocationList
        charges={charges}
        rows={rows}
        result={{ ...baseResult, rowAmounts: { A: 20 } }}
        onRowChange={onRowChange}
      />
    )
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]) // uncheck A
    expect(onRowChange).toHaveBeenCalledWith('A', { checked: false, manualAmount: null })
  })

  it('shows "auto-added" subtext for rows in autoExtendedIds', () => {
    const rows: RowState[] = [
      { chargeId: 'A', checked: false, manualAmount: null },
      { chargeId: 'B', checked: true, manualAmount: null },
    ]
    render(
      <ChargeAllocationList
        charges={charges}
        rows={rows}
        result={{
          ...baseResult,
          rowAmounts: { A: 5, B: 25 },
          autoExtendedIds: new Set(['A']),
        }}
        onRowChange={() => {}}
      />
    )
    expect(screen.getByText('auto-added')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2.1.2: Run tests; confirm they fail**

Run: `vitest run tests/unit/components/charge-allocation-list.test.tsx`

Expected: all 6 fail because `ChargeAllocationList` still has its old props shape (`paymentAmount`, `onAllocationsChange`) — the tests use the new shape (`rows`, `result`, `onRowChange`).

---

### Task 2.2: Refactor `ChargeAllocationList` to controlled component

**Files:**
- Modify: `src/components/payments/charge-allocation-list.tsx` (full rewrite — small file)

- [ ] **Step 2.2.1: Replace the component**

Open `src/components/payments/charge-allocation-list.tsx`. Replace the entire file with:

```tsx
'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import type { OutstandingCharge, RowState, AllocationResult } from '@/lib/payment-allocation'

interface Props {
  charges: OutstandingCharge[]
  rows: RowState[]
  result: AllocationResult
  onRowChange: (chargeId: string, change: Partial<RowState>) => void
}

function sortCharges(charges: OutstandingCharge[]): OutstandingCharge[] {
  return [...charges].sort((a, b) => {
    const d = a.billingDate.localeCompare(b.billingDate)
    return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt)
  })
}

export function ChargeAllocationList({ charges, rows, result, onRowChange }: Props) {
  const sorted = sortCharges(charges)

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No outstanding charges.</p>
  }

  const rowByCharge = new Map(rows.map((r) => [r.chargeId, r]))

  return (
    <div className="rounded-md border divide-y">
      {sorted.map((charge) => {
        const row = rowByCharge.get(charge.id)
        if (!row) return null

        const owed = Math.max(0, charge.amount - (charge.paidAmount || 0))
        const isAutoExtended = result.autoExtendedIds.has(charge.id)
        const isEffectivelyChecked = row.checked || isAutoExtended
        const isPartiallyPaid = (charge.paidAmount || 0) > 0
        const allocatedAmount = result.rowAmounts[charge.id] ?? 0

        // Input shows: manual value (if any), engine-computed amount otherwise.
        const inputValue = row.manualAmount !== null
          ? String(row.manualAmount)
          : (allocatedAmount > 0 ? allocatedAmount.toFixed(2) : '')

        return (
          <div key={charge.id} className="flex items-start gap-3 px-4 py-3">
            <Checkbox
              id={`charge-${charge.id}`}
              checked={row.checked}
              onCheckedChange={(checked) =>
                onRowChange(charge.id, { checked: Boolean(checked), manualAmount: null })
              }
              className="mt-0.5"
            />
            <label
              htmlFor={`charge-${charge.id}`}
              className="flex-1 cursor-pointer space-y-0.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{charge.description}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatCurrency(owed)}
                </span>
              </div>
              {isPartiallyPaid && (
                <p className="text-xs text-muted-foreground">
                  Partially paid — {formatCurrency(charge.paidAmount)} of {formatCurrency(charge.amount)} paid
                </p>
              )}
              {isAutoExtended && !row.checked && (
                <p className="text-xs text-amber-700">auto-added</p>
              )}
            </label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-500 text-sm">$</span>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={inputValue}
                disabled={!isEffectivelyChecked}
                onChange={(e) => {
                  const v = e.target.value
                  onRowChange(charge.id, {
                    manualAmount: v === '' ? null : parseFloat(v),
                  })
                }}
                className="w-24 pl-6 text-right"
                onWheel={(e) => e.currentTarget.blur()}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2.2.2: Run component tests; confirm they pass**

Run: `vitest run tests/unit/components/charge-allocation-list.test.tsx`

Expected: all 6 tests pass.

- [ ] **Step 2.2.3: Verify the codebase still type-checks**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: errors will appear in `quick-payment-form.tsx` because it still uses the old `ChargeAllocationList` props. That's OK — Phase 3 fixes it. Note the errors mentally; they should disappear in Phase 3.

If errors appear in any OTHER file (e.g., another callsite of `ChargeAllocationList`), stop and search:

```bash
grep -rn "ChargeAllocationList" src/ --include="*.tsx"
```

Address any other callers; the only known caller is `quick-payment-form.tsx`.

- [ ] **Step 2.2.4: Commit**

```bash
git add src/components/payments/charge-allocation-list.tsx tests/unit/components/charge-allocation-list.test.tsx
git commit -m "feat(billing): refactor ChargeAllocationList to controlled component with per-row inputs"
```

---

## Phase 3 — `QuickPaymentForm` Integration

Wire the engine into the form, drop the `initialAmount` pre-fill, surface validation issues.

### Task 3.1: Replace state, wire engine, drop initialAmount pre-fill

**Files:**
- Modify: `src/components/payments/quick-payment-form.tsx`

- [ ] **Step 3.1.1: Update imports and state**

Open `src/components/payments/quick-payment-form.tsx`. Replace the line:

```ts
import type { OutstandingCharge, Allocation } from '@/lib/payment-allocation'
```

with:

```ts
import type { OutstandingCharge, Allocation, RowState } from '@/lib/payment-allocation'
import { computeAllocations } from '@/lib/payment-allocation'
import { useMemo } from 'react'
```

Note: `useMemo` may already be imported via the existing `useState, useEffect, useRef, useCallback` line — extend that import if so, e.g.:

```ts
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
```

- [ ] **Step 3.1.2: Drop initialAmount pre-fill (line 70)**

Find this line:

```ts
const [amount, setAmount] = useState(initialAmount ? initialAmount.toFixed(2) : '')
```

Replace with:

```ts
const [amount, setAmount] = useState('')
```

(The `initialAmount` prop stays in the props interface for backward compatibility but is no longer consumed.)

- [ ] **Step 3.1.3: Replace `allocations` state with `rows` state**

Find this line (around line 82):

```ts
const [allocations, setAllocations] = useState<Allocation[]>([])
```

Replace with:

```ts
const [rows, setRows] = useState<RowState[]>([])
```

- [ ] **Step 3.1.4: Update charges-loading useEffect to initialize rows**

Find the block inside the `fetchCharges` function (around line 183) where it sets `outstandingCharges` and the pre-selection logic. Replace this block:

```ts
setOutstandingCharges(charges)

// Pre-select initial charge if provided
if (initialChargeId) {
  const matchingCharge = charges.find(c => c.id === initialChargeId)
  if (matchingCharge) {
    const remaining = matchingCharge.amount - matchingCharge.paidAmount
    setAllocations([{
      chargeId: matchingCharge.id,
      amount: remaining,
    }])
  }
}
```

with:

```ts
setOutstandingCharges(charges)

// Initialize rows: one entry per charge; pre-check the initial charge if provided.
const initialRows: RowState[] = charges.map((c) => ({
  chargeId: c.id,
  checked: initialChargeId === c.id,
  manualAmount: null,
}))
setRows(initialRows)
```

- [ ] **Step 3.1.5: Also clear rows when scout changes (top of the same useEffect)**

Earlier in the same useEffect (around line 137), find the block where it resets state when `selectedScoutId` is empty:

```ts
if (!selectedScoutId) {
  setOutstandingCharges([])
  setAllocations([])
  setChargesLoaded(false)
  ...
}
```

Replace `setAllocations([])` with `setRows([])`.

- [ ] **Step 3.1.6: Add the engine `useMemo` after the existing balance computations**

After the line `const newBalance = currentBalance + totalPayment` (around line 131), insert:

```ts
// Engine: compute per-row allocations + validation on every render
const allocationResult = useMemo(
  () =>
    computeAllocations({
      charges: outstandingCharges,
      rows,
      cash: parsedAmount,
      funds: parsedFundsToApply,
      outstandingBalance: Math.abs(currentBalance),
      cardFeeNet: method === 'card' ? netAmount : undefined,
    }),
  [outstandingCharges, rows, parsedAmount, parsedFundsToApply, currentBalance, method, netAmount]
)

const handleRowChange = useCallback((chargeId: string, change: Partial<RowState>) => {
  setRows((prev) => prev.map((r) => (r.chargeId === chargeId ? { ...r, ...change } : r)))
}, [])
```

- [ ] **Step 3.1.7: Update `ChargeAllocationList` callsite**

Find the existing usage (around line 596):

```tsx
<ChargeAllocationList
  charges={outstandingCharges}
  paymentAmount={totalPayment}
  onAllocationsChange={setAllocations}
  onAmountChange={(newTotal) => {
    const cashPortion = Math.max(0, newTotal - parsedFundsToApply)
    setAmount(cashPortion.toFixed(2))
  }}
/>
```

Replace with:

```tsx
<ChargeAllocationList
  charges={outstandingCharges}
  rows={rows}
  result={allocationResult}
  onRowChange={handleRowChange}
/>
```

- [ ] **Step 3.1.8: Verify the file compiles**

Run: `npx tsc --noEmit 2>&1 | grep quick-payment-form | head -20`

Expected: errors only about lingering references to `allocations` and `setAllocations` (we'll fix those in 3.2). No errors about the new `rows`, `allocationResult`, or `handleRowChange`.

If you see unrelated errors, fix them before continuing.

- [ ] **Step 3.1.9: Commit (work-in-progress checkpoint)**

```bash
git add src/components/payments/quick-payment-form.tsx
git commit -m "wip(billing): wire computeAllocations engine into QuickPaymentForm state"
```

---

### Task 3.2: Update submit logic + validation surfacing

**Files:**
- Modify: `src/components/payments/quick-payment-form.tsx`

- [ ] **Step 3.2.1: Replace the inline validation block with engine issues**

Find the validation block in `handleSubmit` (around lines 412-435):

```ts
if (!selectedScout?.scout_accounts?.id) {
  setError('Please select a scout')
  return
}
if (totalPayment <= 0) {
  setError('Please enter a payment amount')
  return
}
if (parsedFundsToApply > fundsBalance) {
  setError(`Insufficient funds. Maximum available: ${formatCurrency(fundsBalance)}`)
  return
}
if (parsedFundsToApply > Math.abs(currentBalance)) {
  setError(`Funds amount exceeds balance owed: ${formatCurrency(Math.abs(currentBalance))}`)
  return
}
if (method === 'card' && parsedAmount > 0 && parsedAmount < 1) {
  setError('Minimum card payment is $1.00')
  return
}
if (chargesLoaded && outstandingCharges.length === 0 && !inlineBillingDescription.trim()) {
  setError('Please create a billing record for this payment')
  return
}
```

Replace with:

```ts
if (!selectedScout?.scout_accounts?.id) {
  setError('Please select a scout')
  return
}
if (method === 'card' && parsedAmount > 0 && parsedAmount < 1) {
  setError('Minimum card payment is $1.00')
  return
}
if (chargesLoaded && outstandingCharges.length === 0 && !inlineBillingDescription.trim()) {
  setError('Please create a billing record for this payment')
  return
}
// Engine validation (covers no_money, sum_mismatch, exceeds_outstanding, funds_exceeds_available, no_charges_checked)
if (outstandingCharges.length > 0 && !allocationResult.isValid) {
  setError(formatValidationIssue(allocationResult.issues[0], { fundsBalance, outstandingBalance: Math.abs(currentBalance) }))
  return
}
// Manual funds-balance check (engine doesn't know funds_balance — caller passes it)
if (parsedFundsToApply > fundsBalance + 0.01) {
  setError(`Insufficient funds. Maximum available: ${formatCurrency(fundsBalance)}`)
  return
}
```

- [ ] **Step 3.2.2: Add the `formatValidationIssue` helper to the same file**

At the top of the file, after the imports and before the `interface Scout` declaration, insert:

```ts
import type { ValidationIssue } from '@/lib/payment-allocation'

function formatValidationIssue(
  issue: ValidationIssue,
  ctx: { fundsBalance: number; outstandingBalance: number }
): string {
  switch (issue.kind) {
    case 'no_money':
      return 'Please enter a payment amount'
    case 'no_charges_checked':
      return 'Please select at least one charge to apply this payment to'
    case 'sum_mismatch':
      return `Allocation total (${formatCurrency(issue.actual)}) does not match payment amount (${formatCurrency(issue.expected)})`
    case 'exceeds_outstanding':
      return `Payment exceeds outstanding balance. Maximum: ${formatCurrency(ctx.outstandingBalance)}`
    case 'funds_exceeds_available':
      return `Insufficient funds. Maximum available: ${formatCurrency(ctx.fundsBalance)}`
  }
}
```

The existing `formatCurrency` import handles the dollar formatting. Make sure `ValidationIssue` is included in the existing `@/lib/payment-allocation` import line (you can merge it into the existing import statement instead of adding a new line):

```ts
import type { OutstandingCharge, Allocation, RowState, ValidationIssue } from '@/lib/payment-allocation'
```

- [ ] **Step 3.2.3: Update submit-button-disabled rule**

Find the Submit `<Button>` (around line 854-865) and locate the `disabled` prop:

```tsx
disabled={
  isSubmitting ||
  !selectedScoutId ||
  totalPayment <= 0 ||
  (!fundsCoverAll && method === 'card' && !cardInitialized) ||
  (chargesLoaded && outstandingCharges.length === 0 && !inlineBillingDescription.trim())
}
```

Replace with:

```tsx
disabled={
  isSubmitting ||
  !selectedScoutId ||
  (outstandingCharges.length > 0 && !allocationResult.isValid) ||
  (outstandingCharges.length === 0 && totalPayment <= 0) ||
  (!fundsCoverAll && method === 'card' && !cardInitialized) ||
  (chargesLoaded && outstandingCharges.length === 0 && !inlineBillingDescription.trim())
}
```

- [ ] **Step 3.2.4: Update submit handlers to use engine results**

In `handleManualPayment` (around line 361-407), find the call to `recordQuickPayment`. Replace:

```ts
allocations: effectiveAllocations.length > 0
  ? effectiveAllocations.map((a) => ({ chargeId: a.chargeId, amount: a.amount }))
  : undefined,
```

with:

```ts
allocations: effectiveAllocations.length > 0
  ? effectiveAllocations.map((a) => ({ chargeId: a.chargeId, amount: a.amount }))
  : undefined,
```

(No change — the shape stays. The change is in *what* gets passed at the call site.)

Find `handleSubmit`'s "Step 2: Collect external payment" block (around line 497-503) and replace:

```ts
// Step 2: Collect external payment (cash/check/card) if any
if (parsedAmount > 0) {
  if (method === 'card') {
    await handleCardPayment()
  } else {
    await handleManualPayment(inlineAllocation)
  }
}
```

with:

```ts
// Step 2: Collect external payment (cash/check/card) if any
if (parsedAmount > 0) {
  const allocationsForServer = inlineAllocation ?? allocationResult.cashAllocations
  if (method === 'card') {
    await handleCardPayment()
  } else {
    await handleManualPayment(allocationsForServer)
  }
}
```

- [ ] **Step 3.2.5: Update `handleFundsTransfer` to pass allocations**

Find `handleFundsTransfer` (around line 345-359). Replace its body:

```ts
const handleFundsTransfer = async (transferAmount: number) => {
  if (!selectedScout?.scout_accounts?.id) return

  const supabase = createClient()

  const { error: rpcError } = await supabase.rpc('transfer_funds_to_billing', {
    p_scout_account_id: selectedScout.scout_accounts.id,
    p_amount: transferAmount,
    p_description: notes || 'Transfer from Scout Funds to pay balance',
  })

  if (rpcError) {
    throw new Error(rpcError.message)
  }
}
```

with:

```ts
const handleFundsTransfer = async (transferAmount: number, allocations: Allocation[]) => {
  if (!selectedScout?.scout_accounts?.id) return

  const supabase = createClient()

  const { error: rpcError } = await supabase.rpc('transfer_funds_to_billing', {
    p_scout_account_id: selectedScout.scout_accounts.id,
    p_amount: transferAmount,
    p_description: notes || 'Transfer from Scout Funds to pay balance',
    p_allocations: allocations.length > 0
      ? allocations.map((a) => ({ charge_id: a.chargeId, amount: a.amount }))
      : null,
  })

  if (rpcError) {
    throw new Error(rpcError.message)
  }
}
```

Find the existing call site in `handleSubmit` (around line 488):

```ts
await handleFundsTransfer(parsedFundsToApply)
```

Replace with:

```ts
await handleFundsTransfer(parsedFundsToApply, allocationResult.fundsAllocations)
```

- [ ] **Step 3.2.6: Verify type-check passes**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: no errors related to this file. If errors persist, re-check that all `setAllocations` references are gone (replaced) and the function signatures are consistent.

- [ ] **Step 3.2.7: Run all existing tests**

Run: `npm test`

Expected: all green except possibly the existing `tests/unit/components/billing-management-view.test.tsx` (which may reference internals of `QuickPaymentForm`). If failures appear, read them carefully — most should be unrelated to this change. If a failure points to `QuickPaymentForm` behavior that's no longer applicable (e.g., a test that asserts the amount field auto-fills), update the test to match the new no-pre-fill behavior.

- [ ] **Step 3.2.8: Commit**

```bash
git add src/components/payments/quick-payment-form.tsx
git commit -m "feat(billing): use computeAllocations for QuickPaymentForm validation + submit"
```

---

### Task 3.3: Component test for QuickPaymentForm

**Files:**
- Create: `tests/unit/components/quick-payment-form.test.tsx`

- [ ] **Step 3.3.1: Create the test file**

This file mocks the Supabase client and the server action; it tests the form's wiring of the engine.

Create `tests/unit/components/quick-payment-form.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QuickPaymentForm } from '@/components/payments/quick-payment-form'

// Mock router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

// Mock the server action — we just assert it gets called with the right shape.
const recordQuickPaymentMock = vi.fn(async () => ({ success: true, paymentId: 'pmt-1' }))
vi.mock('@/app/actions/payments', () => ({
  recordQuickPayment: (...args: unknown[]) => recordQuickPaymentMock(...args),
}))

// Mock analytics
vi.mock('@/lib/analytics', () => ({
  trackPaymentInitiated: vi.fn(),
  trackPaymentCompleted: vi.fn(),
  trackPaymentFailed: vi.fn(),
}))

// Mock the Supabase client — returns the outstanding charges for the scout.
const charges = [
  { id: 'A', amount: 30, paid_amount: 0, is_paid: false, billing_records: { id: 'br-A', description: 'Camp Deposit', billing_date: '2026-06-01', created_at: '2026-06-01' } },
  { id: 'B', amount: 25, paid_amount: 0, is_paid: false, billing_records: { id: 'br-B', description: 'Popcorn', billing_date: '2026-06-15', created_at: '2026-06-15' } },
]
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          or: () => Promise.resolve({ data: charges, error: null }),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: { success: true }, error: null })),
  }),
}))

const scout = {
  id: 's-1',
  first_name: 'Jane',
  last_name: 'Scout',
  scout_accounts: {
    id: 'sa-1',
    billing_balance: -55, // owes $55
    funds_balance: 10,
  },
}

beforeEach(() => {
  recordQuickPaymentMock.mockClear()
})

describe('QuickPaymentForm', () => {
  it('opens with no amount pre-filled even when initialChargeId provided (Bug 2)', async () => {
    render(
      <QuickPaymentForm
        unitId="u-1"
        scouts={[scout]}
        preselectedScoutId="s-1"
        initialChargeId="B"
      />
    )
    await waitFor(() => expect(screen.getByText('Popcorn')).toBeInTheDocument())
    const amountInputs = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
    // The first 0.00 is the form's main amount input; per-row inputs follow
    expect(amountInputs[0].value).toBe('')
  })

  it('opens with initialChargeId pre-checked in the allocation list (Bug 1)', async () => {
    render(
      <QuickPaymentForm
        unitId="u-1"
        scouts={[scout]}
        preselectedScoutId="s-1"
        initialChargeId="B"
      />
    )
    await waitFor(() => expect(screen.getByText('Popcorn')).toBeInTheDocument())
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    // Find the checkbox associated with charge B
    const popcornCheckbox = screen.getByLabelText(/Popcorn/i, { selector: 'input[type="checkbox"]' }) as HTMLInputElement
    expect(popcornCheckbox.checked).toBe(true)
    // And A's checkbox is not checked
    const campCheckbox = screen.getByLabelText(/Camp Deposit/i, { selector: 'input[type="checkbox"]' }) as HTMLInputElement
    expect(campCheckbox.checked).toBe(false)
  })

  it('submits with engine-computed allocations (Bug 3 + Bug 4)', async () => {
    render(
      <QuickPaymentForm
        unitId="u-1"
        scouts={[scout]}
        preselectedScoutId="s-1"
        initialChargeId="B"
      />
    )
    await waitFor(() => expect(screen.getByText('Popcorn')).toBeInTheDocument())

    // Type $25 in the main Amount field (= B's full owed)
    const mainAmount = screen.getByLabelText(/Amount to Collect|Cash \/ Check \/ Card Amount/i) as HTMLInputElement
    fireEvent.change(mainAmount, { target: { value: '25' } })

    const submit = screen.getByRole('button', { name: /Record/i })
    fireEvent.click(submit)

    await waitFor(() => expect(recordQuickPaymentMock).toHaveBeenCalled())
    const callArgs = recordQuickPaymentMock.mock.calls[0][0] as { allocations: Array<{ chargeId: string; amount: number }> }
    expect(callArgs.allocations).toEqual([{ chargeId: 'B', amount: 25 }])
  })

  it('blocks submit when cash exceeds outstanding (no auto-transfer)', async () => {
    render(
      <QuickPaymentForm
        unitId="u-1"
        scouts={[scout]}
        preselectedScoutId="s-1"
      />
    )
    await waitFor(() => expect(screen.getByText('Popcorn')).toBeInTheDocument())

    // Outstanding = $55. Type $100 (way over).
    const mainAmount = screen.getByLabelText(/Amount to Collect/i) as HTMLInputElement
    fireEvent.change(mainAmount, { target: { value: '100' } })

    const submit = screen.getByRole('button', { name: /Record/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })
})
```

- [ ] **Step 3.3.2: Run the tests**

Run: `vitest run tests/unit/components/quick-payment-form.test.tsx`

Expected: 4 tests pass.

If any fail:
- Inspect the rendered output via `screen.debug()` inside the test temporarily.
- Common pitfalls: the Supabase mock chain order may need adjusting; labels in `getByLabelText` may differ slightly from the actual text.

- [ ] **Step 3.3.3: Commit**

```bash
git add tests/unit/components/quick-payment-form.test.tsx
git commit -m "test(billing): cover QuickPaymentForm engine wiring (Bugs 1-4)"
```

---

## Phase 4 — Server Action + RPC Integration

Tighten `recordQuickPayment`'s validation and remove the auto-transfer.

### Task 4.1: Add server-side allocation validation

**Files:**
- Modify: `src/app/actions/payments.ts`

- [ ] **Step 4.1.1: Read the current state of `recordQuickPayment`**

Open `src/app/actions/payments.ts`. The action currently:
- Validates `amountDollars > 0`
- Authenticates + authorizes the user
- Creates journal entry + lines
- Creates a payment record
- Inserts payment_allocations rows if `params.allocations` is provided
- Increments `paid_amount` on each charge in the allocations loop
- Calls `auto_transfer_overpayment` if `billing_balance > 0` afterwards

We'll add validation, then remove the auto-transfer in 4.3.

- [ ] **Step 4.1.2: Add allocation-sum and ownership checks after authorization**

Find the block that ends with `if (scoutUnitId !== unitId)` (around line 79-81). After that block, insert this allocation-validation step:

```ts
// Validate allocations (if provided) against the scout account and amount
if (params.allocations && params.allocations.length > 0) {
  const allocSum = params.allocations.reduce((s, a) => s + a.amount, 0)
  if (Math.abs(allocSum - amountDollars) > 0.01) {
    return {
      success: false,
      error: `Allocation total ($${allocSum.toFixed(2)}) does not match payment amount ($${amountDollars.toFixed(2)})`,
    }
  }

  // Verify every chargeId belongs to this scout account and isn't voided
  const chargeIds = params.allocations.map((a) => a.chargeId)
  const { data: validCharges } = await supabase
    .from('billing_charges')
    .select('id, is_void')
    .in('id', chargeIds)
    .eq('scout_account_id', scoutAccountId)

  const validIds = new Set((validCharges || []).filter((c) => !c.is_void).map((c) => c.id))
  for (const id of chargeIds) {
    if (!validIds.has(id)) {
      return {
        success: false,
        error: `Charge ${id} is not owned by this scout account or is voided`,
      }
    }
  }
}
```

- [ ] **Step 4.1.3: Verify the file type-checks**

Run: `npx tsc --noEmit 2>&1 | grep payments.ts | head -5`

Expected: no errors.

- [ ] **Step 4.1.4: Commit**

```bash
git add src/app/actions/payments.ts
git commit -m "feat(billing): add server-side allocation validation to recordQuickPayment"
```

---

### Task 4.2: Remove the auto_transfer_overpayment call

**Files:**
- Modify: `src/app/actions/payments.ts`

- [ ] **Step 4.2.1: Remove the auto-transfer block**

Open `src/app/actions/payments.ts`. Find the block at lines 234-252:

```ts
// Check for overpayment and auto-transfer to Scout Funds
const { data: updatedAccount } = await supabase
  .from('scout_accounts')
  .select('billing_balance')
  .eq('id', scoutAccountId)
  .single()

if (updatedAccount && (updatedAccount.billing_balance || 0) > 0) {
  const overpaymentAmount = updatedAccount.billing_balance || 0
  const { error: transferError } = await supabase.rpc('auto_transfer_overpayment', {
    p_scout_account_id: scoutAccountId,
    p_amount: overpaymentAmount,
  })

  if (transferError) {
    console.error('Failed to transfer overpayment:', transferError)
    // Don't fail the payment, just log the error
  }
}
```

Delete this entire block.

- [ ] **Step 4.2.2: Check for any other live callers of auto_transfer_overpayment**

Run:

```bash
grep -rn "auto_transfer_overpayment" src/ supabase/migrations/ --include="*.ts" --include="*.tsx" --include="*.sql"
```

Expected: the RPC definition in `supabase/migrations/00000000000000_schema.sql` (keep — function stays in DB), zero callers in `src/` after this change. If a caller appears in `src/app/api/square/payments/route.ts` (flagged in Step 0.1.3), remove it the same way. **Do not remove the function definition itself.**

- [ ] **Step 4.2.3: Verify the file type-checks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4.2.4: Commit**

```bash
git add src/app/actions/payments.ts
git commit -m "feat(billing): remove auto_transfer_overpayment from recordQuickPayment path"
```

If you also edited `src/app/api/square/payments/route.ts`, include it in this commit.

---

### Task 4.3: Action tests for validation + no-auto-transfer

**Files:**
- Modify: `tests/unit/actions/payments.test.ts`

- [ ] **Step 4.3.1: Inspect existing test structure**

Open `tests/unit/actions/payments.test.ts`. Note how the file mocks Supabase and the auth chain — your new tests will follow the same pattern. Skim the existing `recordQuickPayment` describe block to understand the mock plumbing.

- [ ] **Step 4.3.2: Add a new describe block for the validation cases**

Append to the end of `tests/unit/actions/payments.test.ts` (or within the existing `recordQuickPayment` describe — whichever matches the existing pattern):

```ts
describe('recordQuickPayment — allocation validation', () => {
  it('rejects when allocations sum does not match amount', async () => {
    // The mocked supabase chain in the existing tests in this file is the template — reuse it.
    // Build params with amountDollars=10 but allocations summing to 20.
    const result = await recordQuickPayment({
      unitId: 'u-1',
      scoutAccountId: 'sa-1',
      scoutName: 'Test Scout',
      amountDollars: 10,
      method: 'cash',
      allocations: [{ chargeId: 'c-1', amount: 20 }],
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/does not match/i)
  })

  it('rejects when allocation references a charge not owned by the scout', async () => {
    // Set up the mocked billing_charges query to return no matching rows.
    // (Follow the existing mock pattern — set up the supabase chain so .in('id', ...) returns []).
    const result = await recordQuickPayment({
      unitId: 'u-1',
      scoutAccountId: 'sa-1',
      scoutName: 'Test Scout',
      amountDollars: 10,
      method: 'cash',
      allocations: [{ chargeId: 'foreign-charge', amount: 10 }],
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not owned/i)
  })

  it('does NOT call auto_transfer_overpayment', async () => {
    // Spy on supabase.rpc and assert it was never called with 'auto_transfer_overpayment'.
    // Follow the existing mock pattern for setting up supabase.rpc; use vi.fn() and assert.
    const result = await recordQuickPayment({
      unitId: 'u-1',
      scoutAccountId: 'sa-1',
      scoutName: 'Test Scout',
      amountDollars: 25,
      method: 'cash',
      allocations: [{ chargeId: 'c-1', amount: 25 }],
    })
    expect(result.success).toBe(true)
    // The mocked rpc should not have received 'auto_transfer_overpayment' as the first arg.
    // Read the calls from the mock and assert no match.
  })
})
```

**Note:** the existing file's mock setup determines exact assertion shape. Look at the existing tests for the imports, mocks, and `beforeEach` patterns — match them. The skeleton above shows the test intent; tighten the actual mock plumbing to match the existing style.

- [ ] **Step 4.3.3: Run the tests**

Run: `vitest run tests/unit/actions/payments.test.ts`

Expected: 3 new tests pass. If existing tests break, investigate — they may rely on the removed auto-transfer path. Update assertions or mocks accordingly.

- [ ] **Step 4.3.4: Commit**

```bash
git add tests/unit/actions/payments.test.ts
git commit -m "test(billing): cover allocation validation + no auto-transfer in recordQuickPayment"
```

---

## Phase 5 — Integration + Smoke Test

End-to-end verification in the dev environment.

### Task 5.1: Full test + build pass

**Files:** None directly; this is a verification gate.

- [ ] **Step 5.1.1: Run all tests fresh**

Run: `npm test`

Expected: all tests pass with no failures. Read the output carefully; do not rely on "should pass" — confirm `0 failures` in the output.

- [ ] **Step 5.1.2: Run a production build**

Run: `npm run build`

Expected: build completes with no errors. Warnings about Next.js middleware deprecation are expected (per CLAUDE.md) and can be ignored.

- [ ] **Step 5.1.3: Run the linter**

Run: `npm run lint`

Expected: no errors. Address any errors before continuing.

---

### Task 5.2: Manual smoke test in dev

**Files:** None; manual UI verification.

This is the highest-value verification step. Set aside ~15-20 minutes.

- [ ] **Step 5.2.1: Refresh dev database**

Run: `npm run db:fresh`

This resets and reseeds the dev DB with test data, including scouts with billing balances.

- [ ] **Step 5.2.2: Start the dev server**

Run: `lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev`

(Per CLAUDE.md — port-specific kill, never `pkill -f "next dev"`.)

- [ ] **Step 5.2.3: Run the modal smoke scenarios**

Log in as `richard.blaalid+treasurer@withcaldera.com` / `testpassword123`. Navigate to `/finances/billing`.

For each scenario, confirm the expected outcome. **STOP** at the first failure and diagnose.

**Scenario A — Bug 1 + 2 + 3 fix (pre-selection honored, no pre-fill, correct charge credited):**
1. Find a scout with multiple outstanding charges.
2. Click "Record Payment" on a specific (newer) charge row.
3. Modal opens. Verify:
   - The clicked charge's checkbox is checked.
   - Other charges' checkboxes are not checked.
   - The Amount field is **empty** (not pre-filled).
4. Type the clicked charge's owed amount.
5. Submit.
6. After refresh, verify on the billing card:
   - The specific charge you started from shows "Paid."
   - Other charges remain "Unpaid."

**Scenario B — Bug 4 fix (paid_amount matches cash):**
1. Find a scout with 2+ outstanding charges. Open the modal via a row-level "Record Payment."
2. Check a second charge (in addition to the pre-checked one) to allocate against multiple.
3. Type a cash amount **less than** the sum of checked owed.
4. Confirm the row inputs auto-fill with the engine's distribution.
5. Submit.
6. Verify each charge's `paid_amount` was incremented by exactly its row's input (use the SQL editor or browser dev tools to inspect billing_charges; or eyeball via the billing card's partial-payment display).

**Scenario C — Bug 5 fix (funds transfer attribution):**
1. Find a scout with `funds_balance > 0` and at least one outstanding charge.
2. Open the modal. Pre-check a specific charge.
3. Apply $X from scout funds (less than the charge's full owed). Leave cash blank.
4. Submit ("Apply Funds" path).
5. Verify on the billing card:
   - The charge now shows "Partial — $X of $Y."
6. Verify in the SQL editor:
   ```sql
   SELECT id, amount, paid_amount, is_paid FROM billing_charges WHERE id = 'YOUR_CHARGE_ID';
   ```
   Expected: `paid_amount = X`, `is_paid = false` (partial).

**Scenario D — Overpayment validation:**
1. Find a scout owing $25.
2. Open modal. Type $50 cash.
3. Verify:
   - Submit button is disabled.
   - Inline error shows "Payment exceeds outstanding balance. Maximum: $25.00."
4. Reduce cash to $25; verify submit re-enables.

**Scenario E — No auto-transfer to funds:**
1. Repeat Scenario A with cash = exactly the owed amount.
2. After submit, verify in the SQL editor:
   ```sql
   SELECT funds_balance FROM scout_accounts WHERE id = 'YOUR_SCOUT_ACCOUNT_ID';
   ```
   Expected: `funds_balance` unchanged from before the payment.
3. (For comparison: prior behavior would have left `funds_balance` unchanged in this case too — auto-transfer only fired on overpayment. The real test of the removal is that Scenario D's previously-allowed overpayment now blocks instead of silently sweeping.)

**Scenario F — Dashboard quick-pay (Q6 backward compatibility):**
1. Navigate to `/dashboard`. Open the Quick Actions quick-pay form.
2. Select a scout.
3. Type a cash amount.
4. Verify the modal shows the scout's outstanding charges; auto-fills FIFO; submit works.

- [ ] **Step 5.2.4: Document any deviations**

If any scenario fails or behaves unexpectedly:
1. Capture screenshots and SQL outputs.
2. Open a new task in the plan to fix.
3. Do NOT proceed to merge until all scenarios pass.

- [ ] **Step 5.2.5: Final commit if any fixes from smoke**

If smoke surfaced fixes, commit them with descriptive messages. Re-run Phase 5.1 verification gate after fixes.

---

### Task 5.3: Push to PR

**Files:** None; git operations.

- [ ] **Step 5.3.1: Push the branch**

Run: `git push -u origin feat/payment-modal-charge-allocation`

- [ ] **Step 5.3.2: Open PR**

Use `gh pr create` per CLAUDE.md guidance:

```bash
gh pr create --title "fix(billing): payment modal charge allocation (Bugs 1-5)" --body "$(cat <<'EOF'
## Summary

- Fixes 5 bugs in the payment recording modal where per-charge `paid_amount` was written incorrectly and silent overpayments routed to scout funds.
- Adds a pure-function allocation engine (`computeAllocations`) as the single source of truth for UI + server.
- `ChargeAllocationList` is now controlled, with per-row `$`-inputs.
- `transfer_funds_to_billing` RPC gains an optional `p_allocations` parameter so funds-transfers correctly attribute to charges.
- Removes `auto_transfer_overpayment` from `recordQuickPayment` — new validation prevents overpayment instead.

Spec: `docs/superpowers/specs/2026-05-12-payment-modal-charge-allocation-design.md`
Plan: `plans/2026-05-19-payment-modal-charge-allocation.md`

## Test plan

- [ ] `npm test` — all green
- [ ] `npm run build` — succeeds
- [ ] Scenario A (Bug 1/2/3): pre-selection honored, no pre-fill, correct charge credited
- [ ] Scenario B (Bug 4): `paid_amount` matches actual cash distributed
- [ ] Scenario C (Bug 5): funds-transfer writes `paid_amount` to the selected charge
- [ ] Scenario D: overpayment validation blocks submit
- [ ] Scenario E: no auto-transfer to scout funds
- [ ] Scenario F: dashboard quick-pay still works without pre-selection

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5.3.3: Wait for CI; address any failures**

If CI fails, read the failure logs carefully. Fix any issues, push, and re-verify.

---

## Production rollout (post-merge)

After the PR is approved and merged, the migration must be applied to PROD with explicit approval. Per CLAUDE.md:

1. Confirm with the user that PROD push is approved.
2. Run: `supabase link --project-ref jtzidlmxrorbjnygfvvp`
3. Run: `supabase db push`
4. Reload the PROD schema cache in the Supabase dashboard.
5. Re-link to DEV: `supabase link --project-ref feownmcpkfugkcivdoal`

Existing prod data is untouched by the migration (function-only change). No coordinated downtime needed.
