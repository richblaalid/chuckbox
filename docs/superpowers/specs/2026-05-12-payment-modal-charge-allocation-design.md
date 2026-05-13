---
status: draft
last_verified: 2026-05-12
---

# Payment Modal — Charge Allocation Fixes

> **Status**: Findings + initial analysis only. Not yet brainstormed or fully spec'd.
> Pick this up with the `superpowers:brainstorming` skill to resolve the open
> questions below, then promote to `approved` before writing a plan.

## Context

While testing the partial-payment display work (spec `2026-05-12-partial-payment-billing-card-design.md`, shipped as commits `67c992a`..`5b71499` on branch `phase-6-smoke-runbook-and-cleanup`), the user discovered three related bugs in the **payment recording modal** (`QuickPaymentForm` + `ChargeAllocationList`). These bugs predate the billing-card work — they exist in `main` and ship in prod today — but they undermine the trust signal the new partial-payment UI is trying to provide.

The user wants to ship the billing-card display work first, then return to this. This document captures what was learned so we don't lose context.

## Findings (from manual test against `/finances/billing`)

The test flow:

1. Scout has multiple outstanding billing charges across different records.
2. Treasurer expands a billing row on `/finances/billing` and clicks **Record Payment** on a specific scout's row.
3. The QuickPaymentForm dialog opens.

What was observed:

### Bug 1 — Pre-selected charge not visible in the allocation list

The "Record Payment" button passes `initialChargeId` to the modal at [src/components/billing/billing-management-view.tsx:742](../../src/components/billing/billing-management-view.tsx#L742). The user expects this specific charge to appear pre-checked in the modal's "Outstanding Charges" list. It doesn't. The checkbox state of the list is driven by FIFO auto-allocation based on `paymentAmount`, which has no knowledge of `initialChargeId`.

### Bug 2 — "Amount to Collect" field pre-populated with the full charge amount

`initialAmount={paymentCharge.amount}` is passed to the modal and used directly as the default for the `amount` state at [src/components/payments/quick-payment-form.tsx:70](../../src/components/payments/quick-payment-form.tsx#L70). For partial or split payments, the user has to manually clear this value first — extra friction. User's stated preference: do not pre-populate; require the treasurer to enter the cash collected explicitly.

### Bug 3 — Payment credited to the wrong charge

Downstream of Bug 1. Because the modal's auto-allocation runs FIFO (oldest charge first), the cash gets credited against `billing_charges.paid_amount` for charges other than the one the user started from. The scout's overall billing balance nets correctly via the AR journal entry, but the per-charge `is_paid` / `paid_amount` state drifts from the user's intent.

### Bug 4 (bonus, spotted in code during root-cause tracing)

In [src/components/payments/charge-allocation-list.tsx:53-61](../../src/components/payments/charge-allocation-list.tsx#L53-L61), the allocation amount reported to the parent for each checked charge is the **full remaining owed**, regardless of how much cash was actually collected:

```ts
.map((c) => {
  const owed = c.amount - c.paidAmount
  return { chargeId: c.id, amount: owed }
})
```

Combined with the server logic at [src/app/actions/payments.ts:218-231](../../src/app/actions/payments.ts#L218-L231), this means `paid_amount` increments by the full owed amount of every checked charge, even when the cash payment is smaller. A $30 cash payment against checked charges A($30) + B($50) marks both charges fully paid in the per-charge state, while only $30 hits the journal. Accounting drifts silently.

## Root cause (Bug 1 + Bug 3, mechanical)

`QuickPaymentForm` already tries to honor `initialChargeId`:

```ts
// quick-payment-form.tsx:184-194 (inside useEffect that loads charges)
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

But `setAllocations` updates the **parent's** state. `ChargeAllocationList` (the child rendering the checkboxes) maintains its own `checkedIds` state and is driven by:

```ts
// charge-allocation-list.tsx:46-50
useEffect(() => {
  if (manualOverride) return
  const auto = allocatePayment(sortCharges(charges), paymentAmount)
  setCheckedIds(new Set(auto.map((a) => a.chargeId)))
}, [paymentAmount, manualOverride, charges])
```

`paymentAmount` is the cash field, not the parent's allocation state. So FIFO auto-allocation runs against whatever cash amount was pre-filled (Bug 2), checks FIFO charges, and overwrites the parent's pre-selection through `onAllocationsChange`. The mechanism is half-wired: parent thinks it has set the initial selection, child ignores it.

## Out of scope from this spec

- Anything in the billing-card display layer. That work is already shipped on `phase-6-smoke-runbook-and-cleanup` (commits `67c992a`..`5b71499`).
- Refactor of the `auto_transfer_overpayment` RPC or `transfer_funds_to_billing` RPC.
- Changes to how funds-from-scout-balance are applied (they go through a separate path).

## Proposed approach (working hypothesis, NOT yet decided)

1. **Wire `initialChargeId` through to `ChargeAllocationList`** as a real prop. The child either accepts an initial `checkedIds` set, or accepts a `lockedChargeId` for cases where the modal is scoped to a single charge.
2. **Drop the `initialAmount` pre-fill** entirely. Always start with the cash field blank. The user can use the existing "Pay Full Balance" helper or charge-toggle behavior to populate it.
3. **Fix Bug 4** by reporting allocation amount as the actual cash distributed to each charge, not the full owed. Probably means: if cash < sum(owed of checked charges), distribute proportionally OR cap at cash collected.

   This is the most consequential change — it shifts the per-charge state to match the actual cash recorded in the journal. Open question: how should the distribution work when the user explicitly checks multiple charges but pays less than their total?
4. **Add tests** covering pre-selection, no-pre-fill, and distribution math.

## Open questions (for the next brainstorming session)

These need answers before writing a plan. They have non-obvious trade-offs.

1. **Initial selection semantics.** When the user clicks "Record Payment" on a specific charge, should the modal:
   - **(a)** Pre-check that charge only, leave amount blank, let the user enter cash. As they type, auto-allocate against the checked charge first (then FIFO for the rest if amount exceeds).
   - **(b)** Pre-check that charge only, leave amount blank, AND lock the charge selection (user can't uncheck or add other charges). Forces the modal into "pay this specific charge" mode.
   - **(c)** Pre-check that charge AND pre-fill amount with the charge's remaining (current behavior), but keep the pre-selection visible.

2. **Distribution when cash < sum(owed of checked charges).** If the user checks charges A($30) + B($50) and pays $40:
   - **(a)** FIFO: A gets $30, B gets $10. A marked paid, B partially paid.
   - **(b)** Proportional: A gets $15, B gets $25. Both partial.
   - **(c)** Require the user to enter per-charge amounts manually (no auto-distribute).
   - **(d)** Reject the submission with a "cash less than selected charges total — adjust selection or amount" error.

3. **Distribution when cash > sum(owed of checked charges).** Currently overpayment auto-transfers to scout funds via `auto_transfer_overpayment`. Should we keep that behavior, or warn the user?

4. **What about funds-only payments?** When the user applies $X from scout funds and $0 cash, do the same allocation rules apply? Today the funds-transfer goes through a separate RPC (`transfer_funds_to_billing`) that doesn't touch `billing_charges.paid_amount` at all. Should it?

5. **Per-charge partial-pay input.** Currently the allocation list is checkbox-only — you include a charge (full owed) or exclude it. Should we add a per-row amount input so a treasurer can type "$25 against this $50 charge"?

6. **Backward compatibility with the dashboard quick-payment button.** The dashboard's `QuickActionsCard` opens the same `QuickPaymentForm` without `initialChargeId`. The current FIFO auto-allocation behavior is reasonable there. Make sure the proposed changes don't break that flow.

## Files involved (when implementation lands)

- `src/components/payments/quick-payment-form.tsx`
- `src/components/payments/charge-allocation-list.tsx`
- `src/components/billing/billing-management-view.tsx` (the caller — minor; pass-through of props)
- `src/app/actions/payments.ts` (server-side allocation handling — may need to adjust the `paid_amount` increment logic)
- `tests/unit/components/charge-allocation-list.test.tsx` (probably new)
- `tests/unit/actions/payments.test.ts` (extend)

## Why this work matters

The billing-card display work shipped on `phase-6-smoke-runbook-and-cleanup` accurately reflects whatever state `billing_charges.paid_amount` is in. But that data is currently being written incorrectly by the modal (Bugs 1+3+4). So a treasurer who uses the modal sees the partial-payment UI light up correctly, but it's lighting up against the wrong charges. The display fix gets full value only after the modal write path is fixed.

## Related context

- Earlier conversation revealed the user's preference for "Amount" = cash only (resulted in commit `853a3e1`). That fix is independent and already shipped.
- The user's queue of billing UX improvements still has three more items beyond this:
  - Scout name on billing cards (single-scout case shows name; multi-scout shows count)
  - Create-billing modal: line items + total interaction
  - Parent billing emails: line-item detail
- All four areas were originally listed at the top of this conversation thread.
