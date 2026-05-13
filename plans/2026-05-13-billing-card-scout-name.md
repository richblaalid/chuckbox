---
status: approved
last_verified: 2026-05-13
---

# Scout Name on Billing-Records Row — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scout-identity subtext line under each billing record's description on `/finances/billing` so users can identify single-scout records by name (and multi-scout records as "Multiple Scouts") without expanding the row.

**Spec:** [docs/superpowers/specs/2026-05-13-billing-card-scout-name-design.md](../docs/superpowers/specs/2026-05-13-billing-card-scout-name-design.md)

**Architecture:** Pure inline derivation inside the existing `BillingManagementView` row-rendering loop. Single derived constant `scoutDisplay` returns either a name (single-scout case), `'Multiple Scouts'` (2+ active scouts), or `null` (when the record is voided or has no active charges). A new `<p>` is conditionally rendered between the description and the existing mobile-only date+count subtext. No new files, no helper extraction, no schema or query changes — `ChargeDetail` already includes `scout_first_name` and `scout_last_name`.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Tailwind CSS 4, Vitest 4 + React Testing Library.

**Files involved:**

- **Modify**: `src/components/billing/billing-management-view.tsx` (add `scoutDisplay` derivation + subtext `<p>`)
- **Modify**: `tests/unit/components/billing-management-view.test.tsx` (add a new `describe` block with 4 test cases)

**Out of scope** (per spec): changes to `billing-charge-status.ts`, query layer, expanded view, or any other billing surface.

---

## Task 1: Implement `scoutDisplay` derivation + subtext render

This is a single TDD cycle covering all four spec cases. Tests written first to drive the derivation.

**Files:**
- Modify: `src/components/billing/billing-management-view.tsx` (around lines 555-595 — row-rendering loop body and description column)
- Modify: `tests/unit/components/billing-management-view.test.tsx` (append new describe block at end of file)

- [ ] **Step 1.1: Write the failing tests**

Append to `tests/unit/components/billing-management-view.test.tsx`, at the end of the file (after the final closing brace of the last `describe` block):

```tsx
describe('BillingManagementView — scout name subtext', () => {
  const recordSingleScout: BillingRecordEntry = {
    id: 'r-single',
    description: 'Adventure Camp Deposit',
    billing_date: '2026-05-13',
    created_at: '2026-05-13T00:00:00Z',
    total_amount: 50,
    is_void: false,
    batch_id: null,
    charges: [
      charge({
        id: 'c-single',
        amount: 50,
        paid_amount: 0,
        is_paid: false,
        scout_first_name: 'Alex',
        scout_last_name: 'Reed',
      }),
    ],
  }

  const recordRecordVoided: BillingRecordEntry = {
    id: 'r-void',
    description: 'Cancelled Trip',
    billing_date: '2026-05-13',
    created_at: '2026-05-13T00:00:00Z',
    total_amount: 50,
    is_void: true,
    batch_id: null,
    charges: [
      charge({
        id: 'c-active-anyway',
        amount: 50,
        paid_amount: 0,
        is_paid: false,
        is_void: false,
        scout_first_name: 'Alex',
        scout_last_name: 'Reed',
      }),
    ],
  }

  const recordAllChargesVoided: BillingRecordEntry = {
    id: 'r-all-charges-voided',
    description: 'Dropped Members',
    billing_date: '2026-05-13',
    created_at: '2026-05-13T00:00:00Z',
    total_amount: 100,
    is_void: false,
    batch_id: null,
    charges: [
      charge({ id: 'c-v1', is_void: true, scout_first_name: 'Alex', scout_last_name: 'Reed' }),
      charge({ id: 'c-v2', is_void: true, scout_first_name: 'Sam', scout_last_name: 'Lee' }),
    ],
  }

  it('renders scout name as subtext for single-scout records', () => {
    render(
      <BillingManagementView
        records={[recordSingleScout]}
        scouts={[scout(99, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )
    expect(screen.getByText('Alex Reed')).toBeInTheDocument()
  })

  it('renders "Multiple Scouts" subtext for multi-scout records', () => {
    render(
      <BillingManagementView
        records={[recordWithMixed]}
        scouts={[scout(1, 'John', 'Doe'), scout(2, 'Jane', 'Smith'), scout(3, 'Sam', 'Lee'), scout(4, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )
    expect(screen.getByText('Multiple Scouts')).toBeInTheDocument()
  })

  it('renders no scout subtext when record.is_void is true (even with active charges)', () => {
    render(
      <BillingManagementView
        records={[recordRecordVoided]}
        scouts={[scout(99, 'Alex', 'Reed')]}
        unitId="unit1"
      />
    )
    // The row is collapsed by default, so the only place 'Alex Reed' could
    // appear is in the new subtext. Asserting absence proves the subtext is
    // suppressed by the record.is_void predicate.
    expect(screen.queryByText('Alex Reed')).not.toBeInTheDocument()
    expect(screen.queryByText('Multiple Scouts')).not.toBeInTheDocument()
  })

  it('renders no scout subtext when all charges are voided', () => {
    render(
      <BillingManagementView
        records={[recordAllChargesVoided]}
        scouts={[scout(99, 'Alex', 'Reed'), scout(98, 'Sam', 'Lee')]}
        unitId="unit1"
      />
    )
    expect(screen.queryByText('Alex Reed')).not.toBeInTheDocument()
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument()
    expect(screen.queryByText('Multiple Scouts')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 1.2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/components/billing-management-view.test.tsx`
Expected: 4 new tests fail. The single-scout test fails because `'Alex Reed'` is not rendered. The multi-scout test fails because `'Multiple Scouts'` is not rendered. The two voided tests should pass already (they assert absence, which is already true today). Confirm the two failing tests fail for the expected reason (text not found in document), not for some other crash.

- [ ] **Step 1.3: Add the `scoutDisplay` derivation**

In `src/components/billing/billing-management-view.tsx`, find the row-rendering loop body. The derivations currently sit at around lines 551-559:

```ts
              {filtered.map((record) => {
                const isExpanded = expandedId === record.id
                const status = getRecordStatus(record)
                const activeCharges = record.charges.filter((c) => !c.is_void)
                const paidCount = activeCharges.filter((c) => chargeStatus(c) === 'paid').length
                const hasUnpaid = activeCharges.some((c) => chargeStatus(c) !== 'paid')
                const billedTotal = activeCharges.reduce((s, c) => s + c.amount, 0)
                const outstandingTotal = activeCharges.reduce((s, c) => s + chargeRemaining(c), 0)
                const showBilledSubtext = outstandingTotal !== billedTotal
```

Add `scoutDisplay` as a new const after `showBilledSubtext`:

```ts
                const showBilledSubtext = outstandingTotal !== billedTotal
                const scoutDisplay =
                  record.is_void || activeCharges.length === 0
                    ? null
                    : activeCharges.length === 1
                      ? `${activeCharges[0].scout_first_name} ${activeCharges[0].scout_last_name}`.trim()
                      : 'Multiple Scouts'
```

- [ ] **Step 1.4: Add the subtext `<p>` to the description column**

In the same file, find the description column block at around lines 582-590:

```tsx
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${record.is_void ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                          {record.description}
                        </p>
                        <p className="text-xs text-stone-500 sm:hidden">
                          {new Date(record.billing_date + 'T00:00:00').toLocaleDateString()} · {paidCount}/{activeCharges.length} paid
                        </p>
                      </div>
```

Insert a new `<p>` between the description `<p>` and the mobile-only `<p>`. The new `<p>` renders only when `scoutDisplay` is non-null:

```tsx
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${record.is_void ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                          {record.description}
                        </p>
                        {scoutDisplay && (
                          <p className="text-xs text-stone-500 truncate">
                            {scoutDisplay}
                          </p>
                        )}
                        <p className="text-xs text-stone-500 sm:hidden">
                          {new Date(record.billing_date + 'T00:00:00').toLocaleDateString()} · {paidCount}/{activeCharges.length} paid
                        </p>
                      </div>
```

- [ ] **Step 1.5: Run the tests and verify all 4 pass**

Run: `npx vitest run tests/unit/components/billing-management-view.test.tsx`
Expected: 12 tests pass total (the 8 from the partial-payment shipping + the 4 new ones). No failures.

- [ ] **Step 1.6: Run the full test suite + typecheck + build**

Run: `npx vitest run`
Expected: 1174 tests pass (was 1170; +4 from this task). No failures.

Run: `npx tsc --noEmit`
Expected: clean (no output).

Run: `npm run build`
Expected: exit 0, ✓ Compiled successfully.

- [ ] **Step 1.7: Commit**

```bash
git add src/components/billing/billing-management-view.tsx tests/unit/components/billing-management-view.test.tsx
git commit -m "$(cat <<'EOF'
feat(billing): show scout name on billing-records row description column

Adds a subtext line beneath each record's description showing either the
single scout's name ("First Last" matching the expanded view) or
"Multiple Scouts" for records with 2+ active charges. Subtext suppressed
when the record is voided or has no active charges — the existing
description strikethrough already conveys the dead state.

Renders at all breakpoints; on mobile it stacks above the existing
date + N/M paid subtext line. No new files; logic is a single inline
derivation alongside the other row-level row computations. No data layer
changes (scout_first_name/scout_last_name already flow through ChargeDetail
from the partial-payment work).
EOF
)"
```

---

## Task 2: Manual verification in dev

**Files:** none (verification only).

This task does not modify code. It confirms the UI matches the spec on a real running app before the work is declared shipped.

- [ ] **Step 2.1: Reset the dev database to a clean state**

Run: `npm run db:fresh`
Expected: completes without errors, ending with a validation summary line.

- [ ] **Step 2.2: Start the dev server**

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev
```

Wait for `Ready in <N>ms`.

- [ ] **Step 2.3: Log in as treasurer**

Open `http://localhost:3000/login` and sign in:
- Email: `richard.blaalid+treasurer@withcaldera.com`
- Password: `testpassword123`

You should land on `/scouts`.

- [ ] **Step 2.4: Create a single-scout billing record**

Navigate to `/finances/billing`. Click **Create Billing**. In the dialog:
- Description: `Single-Scout Test`
- Date: today
- Amount: `50`
- Type: fixed
- Assign to: exactly one scout

Submit. **Confirm**: the new row shows the scout's `First Last` name as a subtext line directly beneath the description.

- [ ] **Step 2.5: Create a multi-scout billing record**

Click **Create Billing** again. In the dialog:
- Description: `Multi-Scout Test`
- Date: today
- Amount: `200`
- Type: fixed
- Assign to: 4 scouts at $50 each

Submit. **Confirm**: the new row shows `Multiple Scouts` as a subtext line directly beneath the description.

- [ ] **Step 2.6: Void the multi-scout record**

Click the kebab/Actions menu on the multi-scout record → **Void Record**. Confirm the void.

**Confirm**: after the void completes, the row's description renders with strikethrough AND the `Multiple Scouts` subtext disappears entirely. Only the description (struck through) shows above the mobile-only date subtext line.

- [ ] **Step 2.7: Mobile breakpoint check**

Open browser devtools, switch to a narrow viewport (e.g., 375px wide). Confirm:
- Single-scout row: description, then `First Last` subtext, then `date · 0/1 paid` mobile subtext (3 lines total in the description column).
- Multi-scout row (assuming it's not voided): description, then `Multiple Scouts` subtext, then `date · N/M paid` mobile subtext.
- Long descriptions and long scout names truncate cleanly (no overflow).

- [ ] **Step 2.8: Report results**

Reply with what you confirmed, including any deviations from the spec. No commit needed — manual verification is a sign-off, not a code change.

---

## Self-review checklist (for the plan author)

After writing this plan, I checked against the spec:

- ✅ Spec section "Status state machine (charge counting)" → Task 1 Step 1.3 implements the same predicate ordering (`record.is_void || activeCharges.length === 0` → null; length === 1 → name; else `'Multiple Scouts'`).
- ✅ Spec section "UI changes / Row description column" → Task 1 Step 1.4 inserts the subtext `<p>` in exactly the spot the spec shows.
- ✅ Spec section "Mobile behavior" → the new `<p>` has no `sm:hidden` so it renders at all breakpoints; the existing mobile-only date subtext is preserved unchanged.
- ✅ Spec section "Testing strategy / Component (RTL)" → Task 1 Step 1.1 has all 4 test cases enumerated.
- ✅ Spec section "Testing strategy / Manual" → Task 2 walks through the same scenarios.
- ✅ Spec section "Data flow / Query changes" → no changes needed, plan reflects that.
- ✅ Spec section "Files touched" → only the two files listed in the plan are modified.
- ✅ No placeholders. Every step has either exact code or an exact command.
- ✅ Type consistency: `scoutDisplay`, `activeCharges`, `record.is_void`, `scout_first_name`, `scout_last_name` all used consistently across tests and implementation.
