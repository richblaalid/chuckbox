---
status: approved
last_verified: 2026-05-12
---

# Partial Payment Display on Billing Records — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface partial-payment state on the billing-records page (`/finances/billing`) so the row's amount column shows outstanding total (not original billed), so per-charge rows in the expanded view show a distinct `Partial` badge with remaining vs. billed, and so the record's "delete" action is blocked when any charge has a non-zero `paid_amount`.

**Spec:** [docs/superpowers/specs/2026-05-12-partial-payment-billing-card-design.md](../docs/superpowers/specs/2026-05-12-partial-payment-billing-card-design.md)

**Architecture:** One new pure-helper file (`billing-charge-status.ts`) is the single source of truth for charge-status classification and remaining-amount math. The page-level Supabase query at `src/app/(dashboard)/finances/billing/page.tsx` adds `paid_amount` to its select clause and threads it through the data-mapping step. `BillingManagementView` consumes the helper to compute outstanding totals, drive the existing record-level `Partial` badge with widened semantics, and render new charge-level badges/subtext. `BillingRecordActions` gets a single renamed prop with a widened threshold.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Tailwind CSS, Vitest 4 + React Testing Library, Supabase client (`@supabase/supabase-js`).

**Files involved:**

- **Create**: `src/components/billing/billing-charge-status.ts` (pure helper)
- **Create**: `tests/unit/components/billing-charge-status.test.ts` (helper test)
- **Create**: `tests/unit/components/billing-management-view.test.tsx` (component test)
- **Modify**: `src/app/(dashboard)/finances/billing/page.tsx` (select `paid_amount`, type, mapping)
- **Modify**: `src/components/billing/billing-management-view.tsx` (consume helper, render changes, prop rename)
- **Modify**: `src/components/billing/billing-record-actions.tsx` (rename prop)

**Out of scope** (per spec): cleanup of the orphan `src/components/billing/billing-record-card.tsx`. Do not touch.

---

## Task 1: Pure helper `billing-charge-status.ts`

**Files:**
- Create: `src/components/billing/billing-charge-status.ts`
- Create: `tests/unit/components/billing-charge-status.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `tests/unit/components/billing-charge-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  chargeStatus,
  chargeRemaining,
  type ChargeStatusInput,
} from '@/components/billing/billing-charge-status'

const base = (over: Partial<ChargeStatusInput> = {}): ChargeStatusInput => ({
  amount: 50,
  paid_amount: 0,
  is_paid: false,
  is_void: false,
  ...over,
})

describe('chargeStatus', () => {
  it('returns voided when is_void is true (regardless of other fields)', () => {
    expect(chargeStatus(base({ is_void: true }))).toBe('voided')
    expect(chargeStatus(base({ is_void: true, is_paid: true, paid_amount: 50 }))).toBe('voided')
  })

  it('returns paid when is_paid is true (paid_amount = amount)', () => {
    expect(chargeStatus(base({ is_paid: true, paid_amount: 50 }))).toBe('paid')
  })

  it('returns paid when is_paid is true and overpaid (paid_amount > amount)', () => {
    expect(chargeStatus(base({ is_paid: true, paid_amount: 60 }))).toBe('paid')
  })

  it('returns partial when paid_amount > 0 and is_paid is false', () => {
    expect(chargeStatus(base({ paid_amount: 20 }))).toBe('partial')
  })

  it('returns unpaid when paid_amount = 0 and is_paid is false', () => {
    expect(chargeStatus(base())).toBe('unpaid')
  })

  it('returns unpaid when paid_amount is null', () => {
    expect(chargeStatus(base({ paid_amount: null }))).toBe('unpaid')
  })
})

describe('chargeRemaining', () => {
  it('subtracts paid_amount from amount', () => {
    expect(chargeRemaining(base({ amount: 50, paid_amount: 20 }))).toBe(30)
  })

  it('treats null paid_amount as zero', () => {
    expect(chargeRemaining(base({ amount: 50, paid_amount: null }))).toBe(50)
  })

  it('clamps to zero on overpayment (never negative)', () => {
    expect(chargeRemaining(base({ amount: 50, paid_amount: 60 }))).toBe(0)
  })
})
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/billing-charge-status.test.ts`
Expected: FAIL — "Cannot find module '@/components/billing/billing-charge-status'".

- [ ] **Step 1.3: Write the minimal implementation**

Create `src/components/billing/billing-charge-status.ts`:

```ts
export interface ChargeStatusInput {
  amount: number
  paid_amount: number | null
  is_paid: boolean | null
  is_void: boolean | null
}

export type ChargeStatus = 'voided' | 'paid' | 'partial' | 'unpaid'

export function chargeStatus(c: ChargeStatusInput): ChargeStatus {
  if (c.is_void) return 'voided'
  if (c.is_paid) return 'paid'
  if ((c.paid_amount ?? 0) > 0) return 'partial'
  return 'unpaid'
}

export function chargeRemaining(c: ChargeStatusInput): number {
  return Math.max(0, c.amount - (c.paid_amount ?? 0))
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/billing-charge-status.test.ts`
Expected: PASS — 9 tests pass across two describe blocks.

- [ ] **Step 1.5: Lint and typecheck**

Run: `npx eslint src/components/billing/billing-charge-status.ts tests/unit/components/billing-charge-status.test.ts`
Expected: no output (clean).

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 1.6: Commit**

```bash
git add src/components/billing/billing-charge-status.ts tests/unit/components/billing-charge-status.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): add chargeStatus + chargeRemaining helper for partial-payment classification

Pure helper that classifies a billing charge into one of four states
(voided / paid / partial / unpaid) and computes the remaining amount,
clamped to zero on overpayment. Will be consumed by BillingManagementView
to render partial-payment state on rows and per-charge badges.
EOF
)"
```

---

## Task 2: Thread `paid_amount` through query + types

**Files:**
- Modify: `src/app/(dashboard)/finances/billing/page.tsx:50-146`
- Modify: `src/components/billing/billing-management-view.tsx:32-42`

This task is pure plumbing. TypeScript will validate the type chain end-to-end; no runtime test is needed beyond `npm run build`.

- [ ] **Step 2.1: Add `paid_amount` to the Supabase select**

In `src/app/(dashboard)/finances/billing/page.tsx`, find the `.from('billing_records').select(...)` block at lines 50-79. Inside the `billing_charges (...)` subselect, add `paid_amount,` on its own line after `amount,`:

```ts
  const { data: billingRecordsData } = await supabase
    .from('billing_records')
    .select(`
      id,
      description,
      billing_date,
      created_at,
      total_amount,
      is_void,
      billing_import_batch_id,
      billing_charges (
        id,
        amount,
        paid_amount,
        is_paid,
        is_void,
        scout_account_id,
        scout_accounts (
          scouts (
            first_name,
            last_name
          )
        ),
        payment_allocations (
          payments (
            payment_method,
            notes
          )
        )
      )
    `)
    .eq('unit_id', membership.unit_id)
    .order('created_at', { ascending: false })
```

- [ ] **Step 2.2: Add `paid_amount` to the inline `BillingRecordWithCharges` type**

In the same file at line 91-109, inside the `billing_charges: Array<{ ... }>` type, add `paid_amount: number | null` after `amount: number`:

```ts
    billing_charges: Array<{
      id: string
      amount: number
      paid_amount: number | null
      is_paid: boolean | null
      is_void: boolean | null
      scout_account_id: string
      scout_accounts: {
        scouts: {
          first_name: string
          last_name: string
        }
      } | null
      payment_allocations: Array<{
        payments: {
          payment_method: string | null
          notes: string | null
        } | null
      }>
    }>
```

- [ ] **Step 2.3: Pass `paid_amount` through the mapping step**

In the same file at line 122-146, inside the `.map((charge) => { ... })` block, add `paid_amount: charge.paid_amount` to the returned object after `amount: charge.amount`:

```ts
      return {
        id: charge.id,
        amount: charge.amount,
        paid_amount: charge.paid_amount,
        is_paid: charge.is_paid,
        is_void: charge.is_void,
        scout_account_id: charge.scout_account_id,
        scout_first_name: charge.scout_accounts?.scouts?.first_name || 'Unknown',
        scout_last_name: charge.scout_accounts?.scouts?.last_name || '',
        payment_method: paymentMethod,
        check_ref: checkRef,
      }
```

- [ ] **Step 2.4: Add `paid_amount` to the `ChargeDetail` interface**

In `src/components/billing/billing-management-view.tsx` at line 32-42, add `paid_amount: number | null` after `amount: number`:

```ts
interface ChargeDetail {
  id: string
  amount: number
  paid_amount: number | null
  is_paid: boolean | null
  is_void: boolean | null
  scout_account_id: string
  scout_first_name: string
  scout_last_name: string
  payment_method: string | null
  check_ref: string | null
}
```

- [ ] **Step 2.5: Verify the typecheck and build pass**

Run: `npx tsc --noEmit`
Expected: no output (clean). TypeScript guarantees the page→view type chain is consistent.

Run: `npm run build`
Expected: exit 0; build summary shows `/finances/billing` route compiled.

- [ ] **Step 2.6: Commit**

```bash
git add src/app/\(dashboard\)/finances/billing/page.tsx src/components/billing/billing-management-view.tsx
git commit -m "$(cat <<'EOF'
feat(billing): include paid_amount in billing-records query and ChargeDetail

Threads the new paid_amount field from billing_charges through the page-level
Supabase select, the inline data-mapping type, and the ChargeDetail interface
consumed by BillingManagementView. No runtime behavior change yet — sets up
Task 3+ to use the value.
EOF
)"
```

---

## Task 3: Widen `getRecordStatus()` to use chargeStatus

**Files:**
- Modify: `src/components/billing/billing-management-view.tsx:317-325`
- Modify: `tests/unit/components/billing-charge-status.test.ts` (extend)

The existing `getRecordStatus()` only fires `'partial'` when one charge is fully paid AND another is not. Under the spec, it should also fire when any charge is partial (i.e., `paid_amount > 0` but not fully paid).

- [ ] **Step 3.1: Extract `getRecordStatus` to the helper file and test it**

Append to `tests/unit/components/billing-charge-status.test.ts`:

```ts
import { getRecordStatus } from '@/components/billing/billing-charge-status'

const charge = (over: Partial<ChargeStatusInput> = {}) => base(over)

describe('getRecordStatus', () => {
  it('returns voided when the record itself is voided', () => {
    expect(getRecordStatus({ is_void: true, charges: [charge()] })).toBe('voided')
  })

  it('returns paid when all active charges are paid', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ is_paid: true, paid_amount: 50 }), charge({ is_paid: true, paid_amount: 50 })],
    })).toBe('paid')
  })

  it('returns paid when the only non-voided charges are paid (voided charges ignored)', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ is_paid: true, paid_amount: 50 }), charge({ is_void: true })],
    })).toBe('paid')
  })

  it('returns paid when there are no active charges (all voided)', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ is_void: true }), charge({ is_void: true })],
    })).toBe('paid')
  })

  it('returns partial when at least one charge is fully paid and another is unpaid', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ is_paid: true, paid_amount: 50 }), charge()],
    })).toBe('partial')
  })

  it('returns partial when at least one charge is partially paid (new behavior)', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge({ paid_amount: 20 }), charge(), charge()],
    })).toBe('partial')
  })

  it('returns unpaid when no charges have any collected payment', () => {
    expect(getRecordStatus({
      is_void: false,
      charges: [charge(), charge(), charge()],
    })).toBe('unpaid')
  })
})
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/billing-charge-status.test.ts`
Expected: FAIL — "getRecordStatus is not exported from '@/components/billing/billing-charge-status'".

- [ ] **Step 3.3: Add `getRecordStatus` to the helper**

Append to `src/components/billing/billing-charge-status.ts`:

```ts
export interface RecordStatusInput {
  is_void: boolean | null
  charges: ChargeStatusInput[]
}

export function getRecordStatus(record: RecordStatusInput): ChargeStatus {
  if (record.is_void) return 'voided'
  const activeCharges = record.charges.filter(c => !c.is_void)
  if (activeCharges.length === 0) return 'paid'
  const statuses = activeCharges.map(chargeStatus)
  if (statuses.every(s => s === 'paid')) return 'paid'
  if (statuses.some(s => s === 'paid' || s === 'partial')) return 'partial'
  return 'unpaid'
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/billing-charge-status.test.ts`
Expected: PASS — all 16 tests across three describe blocks.

- [ ] **Step 3.5: Replace the inline helper in BillingManagementView**

In `src/components/billing/billing-management-view.tsx`:

- Add to the imports (find the existing import block near top of file):

```ts
import { chargeStatus, chargeRemaining, getRecordStatus, type ChargeStatus } from '@/components/billing/billing-charge-status'
```

- Delete the inline helper at lines 317-325 (the `const getRecordStatus = ...` arrow function definition). It is now imported.

- Update the `statusBadge` helper's argument type at line 327 from `ReturnType<typeof getRecordStatus>` to the imported `ChargeStatus` (since `getRecordStatus` is no longer a local symbol):

```ts
const statusBadge = (status: ChargeStatus) => {
```

- [ ] **Step 3.6: Run the unit tests + typecheck**

Run: `npx vitest run tests/unit/components/billing-charge-status.test.ts`
Expected: still PASS.

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3.7: Commit**

```bash
git add src/components/billing/billing-charge-status.ts src/components/billing/billing-management-view.tsx tests/unit/components/billing-charge-status.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): widen getRecordStatus to flag records with partially-paid charges

Moves the record-status helper out of BillingManagementView and into the
shared billing-charge-status module, and broadens its 'partial' trigger so
it fires whenever any active charge has a non-zero paid_amount (not only
when at least one charge is fully paid alongside an unpaid one).
EOF
)"
```

---

## Task 4: Row amount column — outstanding total + "of $X billed" subtext

**Files:**
- Modify: `src/components/billing/billing-management-view.tsx:559-625`
- Create: `tests/unit/components/billing-management-view.test.tsx`

- [ ] **Step 4.1: Write the failing component test**

Create `tests/unit/components/billing-management-view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { BillingManagementView, type BillingRecordEntry } from '@/components/billing/billing-management-view'

vi.mock('@/app/actions/billing', () => ({
  voidBillingRecord: vi.fn(),
}))

const scout = (i: number, first: string, last: string) => ({
  id: `s${i}`,
  first_name: first,
  last_name: last,
  is_active: true,
  scout_accounts: { id: `acct${i}`, billing_balance: 0, funds_balance: 0 },
  patrols: null,
})

const charge = (overrides: Partial<BillingRecordEntry['charges'][number]>): BillingRecordEntry['charges'][number] => ({
  id: 'c1',
  amount: 50,
  paid_amount: 0,
  is_paid: false,
  is_void: false,
  scout_account_id: 'acct1',
  scout_first_name: 'Jane',
  scout_last_name: 'Smith',
  payment_method: null,
  check_ref: null,
  ...overrides,
})

const recordWithMixed: BillingRecordEntry = {
  id: 'r1',
  description: 'Summer Camp Deposit',
  billing_date: '2026-05-08',
  created_at: '2026-05-08T00:00:00Z',
  total_amount: 200,
  is_void: false,
  batch_id: null,
  charges: [
    charge({ id: 'c1', is_paid: true, paid_amount: 50, scout_first_name: 'John', scout_last_name: 'Doe' }),
    charge({ id: 'c2', paid_amount: 20, scout_first_name: 'Jane', scout_last_name: 'Smith' }),
    charge({ id: 'c3', scout_first_name: 'Sam', scout_last_name: 'Lee' }),
    charge({ id: 'c4', scout_first_name: 'Alex', scout_last_name: 'Reed' }),
  ],
}

const recordAllUnpaid: BillingRecordEntry = {
  ...recordWithMixed,
  id: 'r2',
  description: 'Field Trip',
  charges: [
    charge({ id: 'd1' }),
    charge({ id: 'd2' }),
    charge({ id: 'd3' }),
    charge({ id: 'd4' }),
  ],
}

describe('BillingManagementView — row amount column', () => {
  it('shows outstanding total ($130) and "of $200 billed" subtext for mixed-status record', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    expect(screen.getByText('$130.00')).toBeInTheDocument()
    expect(screen.getByText(/of \$200\.00 billed/i)).toBeInTheDocument()
  })

  it('shows only $200 with no "of $X billed" subtext for all-unpaid record (regression guard)', () => {
    render(
      <BillingManagementView
        records={[recordAllUnpaid]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    expect(screen.getByText('$200.00')).toBeInTheDocument()
    expect(screen.queryByText(/of \$/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/billing-management-view.test.tsx`
Expected: FAIL — first test asserts `$130.00` is in the document but the row currently renders `$200.00` (today's behavior uses `record.total_amount`).

- [ ] **Step 4.3: Update the row to render outstanding total + subtext**

In `src/components/billing/billing-management-view.tsx`, find the row-rendering block at line 559-625. Inside the `.map((record) => { ... })` body at line 559-565, add `billedTotal` and `outstandingTotal` derivations alongside the existing `paidCount`:

```ts
              {filtered.map((record) => {
                const isExpanded = expandedId === record.id
                const status = getRecordStatus(record)
                const activeCharges = record.charges.filter((c) => !c.is_void)
                const paidCount = activeCharges.filter((c) => c.is_paid).length
                const hasUnpaid = activeCharges.some((c) => !c.is_paid)
                const billedTotal = activeCharges.reduce((s, c) => s + c.amount, 0)
                const outstandingTotal = activeCharges.reduce((s, c) => s + chargeRemaining(c), 0)
                const showBilledSubtext = outstandingTotal !== billedTotal
```

Then replace the amount column at line 608-610:

```ts
                      <div className={`w-24 text-right text-sm font-medium ${record.is_void ? 'text-stone-400' : 'text-stone-900'}`}>
                        {formatCurrency(record.total_amount)}
                      </div>
```

with:

```ts
                      <div className={`w-24 text-right flex flex-col items-end ${record.is_void ? 'text-stone-400' : 'text-stone-900'}`}>
                        <span className="text-sm font-medium">
                          {formatCurrency(outstandingTotal)}
                        </span>
                        {showBilledSubtext && (
                          <span className="text-xs text-stone-500">
                            of {formatCurrency(billedTotal)} billed
                          </span>
                        )}
                      </div>
```

- [ ] **Step 4.4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/billing-management-view.test.tsx`
Expected: PASS — both tests in this describe block now pass.

Run: `npx vitest run`
Expected: full suite PASS (no regressions).

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4.5: Commit**

```bash
git add src/components/billing/billing-management-view.tsx tests/unit/components/billing-management-view.test.tsx
git commit -m "$(cat <<'EOF'
feat(billing): show outstanding total in row amount column with billed subtext

The row's amount column now displays the outstanding total (sum of
amount - paid_amount across active charges) as the primary number. When
outstanding differs from billed (i.e., any charge has paid_amount > 0), a
muted "of $X billed" subtext renders below. Fully-unpaid records still
show only the original total with no subtext.
EOF
)"
```

---

## Task 5: Per-charge row — Partial badge, remaining amount, recolor Unpaid

**Files:**
- Modify: `src/components/billing/billing-management-view.tsx:633-686`
- Modify: `tests/unit/components/billing-management-view.test.tsx` (extend)

- [ ] **Step 5.1: Write the failing tests**

Append to `tests/unit/components/billing-management-view.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react'

describe('BillingManagementView — expanded per-charge rows', () => {
  it('shows Partial badge + remaining amount + "of $X billed" subtext for partial charge', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    // Click the expand chevron for the first record
    const expandButton = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-chevron-right'))
    expect(expandButton).toBeDefined()
    fireEvent.click(expandButton!)

    // Jane Smith is the partial scout ($20 of $50 paid → $30 remaining)
    const janeRow = screen.getByText('Jane Smith').closest('div')!.parentElement!
    expect(within(janeRow).getByText('Partial')).toBeInTheDocument()
    expect(within(janeRow).getByText('$30.00')).toBeInTheDocument()
    expect(within(janeRow).getByText(/of \$50\.00 billed/i)).toBeInTheDocument()
  })

  it('renders per-charge Unpaid badge with stone (neutral) classes, not amber', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    const expandButton = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-chevron-right'))
    fireEvent.click(expandButton!)

    // Sam Lee is fully unpaid — badge should be neutral stone, not amber
    const samRow = screen.getByText('Sam Lee').closest('div')!.parentElement!
    const unpaidBadge = within(samRow).getByText('Unpaid')
    expect(unpaidBadge.className).toMatch(/stone-/)
    expect(unpaidBadge.className).not.toMatch(/amber-/)
  })

  it('renders Paid badge unchanged for fully-paid charge (regression guard)', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )

    const expandButton = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-chevron-right'))
    fireEvent.click(expandButton!)

    const johnRow = screen.getByText('John Doe').closest('div')!.parentElement!
    expect(within(johnRow).getByText(/Paid/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 5.2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/billing-management-view.test.tsx`
Expected: FAIL — the partial test fails because today's render says "Unpaid" and shows "$50.00" for Jane (since `is_paid` is false and `paid_amount` is ignored). The stone-color test fails because today's Unpaid badge uses `amber-200 bg-amber-50 text-amber-700`.

- [ ] **Step 5.3: Update the per-charge row rendering**

In `src/components/billing/billing-management-view.tsx`, find the expanded-row block at line 633-686. Replace the entire `.map((charge) => (...))` body with:

```ts
                          {record.charges
                            .sort((a, b) => `${a.scout_last_name} ${a.scout_first_name}`.localeCompare(`${b.scout_last_name} ${b.scout_first_name}`))
                            .map((charge) => {
                              const status = chargeStatus(charge)
                              const remaining = chargeRemaining(charge)
                              const isPartial = status === 'partial'

                              return (
                                <div
                                  key={charge.id}
                                  className="flex items-center justify-between py-1.5 text-sm"
                                >
                                  <div className="flex items-center gap-2">
                                    <Link
                                      href={`/finances/accounts/${charge.scout_account_id}`}
                                      className="text-forest-600 hover:text-forest-800 hover:underline"
                                    >
                                      {charge.scout_first_name} {charge.scout_last_name}
                                    </Link>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="flex flex-col items-end">
                                      <span className={charge.is_paid ? 'text-stone-400 line-through' : 'text-stone-900'}>
                                        {formatCurrency(isPartial ? remaining : charge.amount)}
                                      </span>
                                      {isPartial && (
                                        <span className="text-xs text-stone-500">
                                          of {formatCurrency(charge.amount)} billed
                                        </span>
                                      )}
                                    </div>
                                    {charge.is_void ? (
                                      <Badge variant="outline" className="border-stone-200 text-stone-400 text-xs px-1.5 py-0">
                                        Voided
                                      </Badge>
                                    ) : charge.is_paid ? (
                                      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs px-1.5 py-0">
                                        Paid
                                        {charge.payment_method && (
                                          <span className="text-green-500 font-normal">
                                            {' · '}{charge.payment_method === 'check' && charge.check_ref
                                              ? `Check #${charge.check_ref}`
                                              : charge.payment_method === 'check'
                                                ? 'Check'
                                                : charge.payment_method === 'card'
                                                  ? 'Card'
                                                  : charge.payment_method.charAt(0).toUpperCase() + charge.payment_method.slice(1)}
                                          </span>
                                        )}
                                      </Badge>
                                    ) : isPartial ? (
                                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs px-1.5 py-0">
                                        Partial
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-600 text-xs px-1.5 py-0">
                                        Unpaid
                                      </Badge>
                                    )}
                                    {!charge.is_void && !charge.is_paid && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs text-forest-600 hover:text-forest-800"
                                        onClick={() => handleRecordPaymentForCharge(charge, record.description)}
                                      >
                                        <DollarSign className="h-3 w-3 mr-1" />
                                        Record Payment
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
```

Key changes vs. today:
- New `status` and `remaining` derived per charge via the helper.
- Amount span shows `remaining` for partial charges, full `amount` otherwise.
- New "of $X billed" subtext stacks beneath the amount for partial only.
- New `Partial` badge branch (amber).
- Unpaid badge recolored from amber to stone.

- [ ] **Step 5.4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/billing-management-view.test.tsx`
Expected: PASS — all 5 tests across both describe blocks.

Run: `npx vitest run`
Expected: full suite PASS.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/billing/billing-management-view.tsx tests/unit/components/billing-management-view.test.tsx
git commit -m "$(cat <<'EOF'
feat(billing): render Partial badge + remaining amount on partially-paid charges

Per-charge rows in the expanded view now distinguish partial charges with
an amber Partial badge, show the remaining amount as the primary number,
and stack an "of $X billed" subtext beneath it. The previous Unpaid badge
is recolored from amber to neutral stone so it doesn't collide with the
new Partial color. Paid and Voided rendering is unchanged.
EOF
)"
```

---

## Task 6: Rename `hasPaidCharges` → `hasCollectedPayments`, widen threshold

**Files:**
- Modify: `src/components/billing/billing-charge-status.ts` (add `hasCollectedPayments` export)
- Modify: `tests/unit/components/billing-charge-status.test.ts` (extend)
- Modify: `src/components/billing/billing-record-actions.tsx:22, 33, 83`
- Modify: `src/components/billing/billing-management-view.tsx:619`

The threshold check is a pure data question — testable without rendering. Putting it in the helper module keeps the testing story simple and avoids brittle Radix-dropdown integration tests.

- [ ] **Step 6.1: Write the failing test for `hasCollectedPayments(record)`**

Append to `tests/unit/components/billing-charge-status.test.ts`:

```ts
import { hasCollectedPayments } from '@/components/billing/billing-charge-status'

describe('hasCollectedPayments', () => {
  it('returns false when all active charges are unpaid', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge(), charge(), charge()],
    })).toBe(false)
  })

  it('returns false when the only non-voided charges are unpaid', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge(), charge({ is_void: true })],
    })).toBe(false)
  })

  it('returns true when at least one charge is fully paid', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge({ is_paid: true, paid_amount: 50 }), charge()],
    })).toBe(true)
  })

  it('returns true when at least one charge is partially paid', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge({ paid_amount: 20 }), charge()],
    })).toBe(true)
  })

  it('ignores voided charges even if their paid_amount is non-zero (historical edge case)', () => {
    expect(hasCollectedPayments({
      is_void: false,
      charges: [charge({ is_void: true, paid_amount: 25 }), charge()],
    })).toBe(false)
  })
})
```

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/billing-charge-status.test.ts`
Expected: FAIL — "hasCollectedPayments is not exported from '@/components/billing/billing-charge-status'".

- [ ] **Step 6.3: Add `hasCollectedPayments` to the helper module**

Append to `src/components/billing/billing-charge-status.ts`:

```ts
export function hasCollectedPayments(record: RecordStatusInput): boolean {
  return record.charges.some(c => {
    if (c.is_void) return false
    const s = chargeStatus(c)
    return s === 'paid' || s === 'partial'
  })
}
```

- [ ] **Step 6.4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/billing-charge-status.test.ts`
Expected: PASS — all 21 tests across four describe blocks.

- [ ] **Step 6.5: Rename the prop in `BillingRecordActions`**

In `src/components/billing/billing-record-actions.tsx`:

- Line 22: change `hasPaidCharges: boolean` → `hasCollectedPayments: boolean`
- Line 33: change destructure `hasPaidCharges,` → `hasCollectedPayments,`
- Line 83: change usage `{hasPaidCharges ? (` → `{hasCollectedPayments ? (`

No other behavior change inside the component — the conditional logic that switches between "Void" and "Delete" actions is preserved.

- [ ] **Step 6.6: Update the caller in `BillingManagementView`**

In `src/components/billing/billing-management-view.tsx`:

- Update the import line (added in Task 3.5) to also pull in `hasCollectedPayments`:

```ts
import { chargeStatus, chargeRemaining, getRecordStatus, hasCollectedPayments, type ChargeStatus } from '@/components/billing/billing-charge-status'
```

- Find line 619 (`hasPaidCharges={record.charges.some((c) => c.is_paid && !c.is_void)}`). Replace with:

```tsx
                          hasCollectedPayments={hasCollectedPayments(record)}
```

- [ ] **Step 6.7: Run all tests + typecheck + build**

Run: `npx vitest run`
Expected: PASS — full suite. The component tests from Tasks 4/5 should still pass because the rename is type-safe.

Run: `npx tsc --noEmit`
Expected: no output. If any other caller of `BillingRecordActions` exists with the old prop name, TypeScript will flag it.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6.8: Commit**

```bash
git add src/components/billing/billing-charge-status.ts tests/unit/components/billing-charge-status.test.ts src/components/billing/billing-record-actions.tsx src/components/billing/billing-management-view.tsx
git commit -m "$(cat <<'EOF'
feat(billing): widen void-protection to block delete on records with any collected payment

Adds hasCollectedPayments helper that returns true whenever any active
charge is in 'paid' OR 'partial' state, and renames BillingRecordActions's
hasPaidCharges prop accordingly. Records with partial cash collected can
no longer be silently deleted — they must go through the void flow.
EOF
)"
```

---

## Task 7: Manual verification in dev

**Files:** none (verification only).

This task does not modify code. Its purpose is to confirm the UI matches the spec on a real running app before the work is declared shipped.

- [ ] **Step 7.1: Reset the dev database to a clean state**

```bash
npm run db:fresh
```

Expected: completes without errors. Output ends with the validation summary line.

- [ ] **Step 7.2: Start the dev server**

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev
```

Wait for "Ready in <N>ms" or "started server on 0.0.0.0:3000".

- [ ] **Step 7.3: Log in as treasurer**

Open `http://localhost:3000/login` and sign in:
- Email: `richard.blaalid+treasurer@withcaldera.com`
- Password: `testpassword123`

You should land on `/scouts`.

- [ ] **Step 7.4: Create a billing record across 4 scouts**

Navigate to `/finances/billing`. Click **Create Billing**. In the dialog:
- Description: `Summer Camp Deposit`
- Date: today
- Amount: `200`
- Type: fixed
- Assign to: 4 scouts (any 4 from the test data)
- Per-scout: `50`

Submit. Confirm the row appears in the list showing **$200** with status **Unpaid** and **0/4** paid count, and no "of $X billed" subtext.

- [ ] **Step 7.5: Record a full payment for scout #1**

Expand the row. Click **Record Payment** next to scout #1. In the payment form:
- Method: Cash
- Amount: `50` (the row should pre-fill this)

Submit. The row's amount column should now show **$150** with subtext **of $200.00 billed**. Status badge should be **Partial**. Paid count: **1/4**.

- [ ] **Step 7.6: Record a partial payment for scout #2**

Click **Record Payment** for scout #2. Method: Cash. Amount: `20`. Submit.

Expanded row for scout #2 should show:
- Amount: **$30.00**
- Subtext: **of $50.00 billed**
- Badge: **Partial** (amber)
- Record Payment button still visible

Row amount column should now show **$130** with **of $200.00 billed** subtext.

- [ ] **Step 7.7: Confirm Unpaid badge color**

Look at scout #3 or scout #4's row in the expanded view. The **Unpaid** badge should be neutral stone (gray border, gray-on-white text), not amber. Visually distinct from scout #2's amber **Partial** badge.

- [ ] **Step 7.8: Confirm void-protection threshold**

Click the kebab/Actions menu on the record row. The menu should offer "Void" (not "Delete"), confirming that `hasCollectedPayments` evaluated to true because of the partial + fully-paid charges. Close the menu without taking action.

- [ ] **Step 7.9: Resize to mobile breakpoint**

Open browser devtools, switch to a narrow viewport (e.g., 375px wide). Confirm:
- Row amount column still readable, "of $200.00 billed" subtext stacks below the primary amount.
- Expanded per-charge rows still readable; subtext under the partial charge's amount stacks cleanly.

- [ ] **Step 7.10: Document the result**

Reply to the user with what you confirmed (or any deviations from the spec). No commit needed — manual verification is a sign-off, not a code change.

---

## Self-review checklist (for the plan author)

After writing this plan, I checked against the spec:

- ✅ Spec Section "Status state machine" → Task 1 implements `chargeStatus` + test cases cover all 6 conditions.
- ✅ Spec Section "Record-level partial state" → Task 3 widens `getRecordStatus`.
- ✅ Spec Section "Row (collapsed)" → Task 4 updates the row amount column and subtext.
- ✅ Spec Section "Expanded view" → Task 5 adds Partial badge, remaining amount, subtext, recolors Unpaid.
- ✅ Spec Section "Query changes" → Task 2 adds `paid_amount` to select.
- ✅ Spec Section "Type changes" → Task 2 adds `paid_amount` to `ChargeDetail`.
- ✅ Spec Section "Derived helper" → Task 1 creates `billing-charge-status.ts`.
- ✅ Spec Section "Void protection" → Task 6 renames prop and widens threshold.
- ✅ Spec Section "Testing strategy" → Tasks 1, 3, 6 cover the pure-helper unit tests; Tasks 4-5 cover the component rendering tests.
- ✅ Spec Section "Manual" → Task 7.
- ✅ No placeholders. Every step has either exact code or an exact command.
- ✅ Types and helper signatures consistent across tasks (`ChargeStatusInput`, `chargeStatus`, `chargeRemaining`, `getRecordStatus`, `ChargeStatus`).
