---
status: draft
last_verified: 2026-05-12
---

# Billing Records — Void / Delete / Per-Charge UX

> **Status**: Findings only. Not yet brainstormed or fully spec'd.
> Pick this up with the `superpowers:brainstorming` skill to resolve the open
> questions below, then promote to `approved` before writing a plan.

## Context

During manual verification of the partial-payment display work on branch `phase-6-smoke-runbook-and-cleanup` (May 2026), the user surfaced three gaps in the billing-records actions menu UX. None of the gaps are regressions from the partial-payment work — they exist in `main` and ship in prod today — but they constrain what a treasurer can do once a billing record has any payment activity, and they were partially obscured by the spec's loose use of "delete" to colloquially mean "void."

The user's decision: do NOT fix on the partial-payment branch. Park for proper brainstorm + spec.

## Findings

### Finding 1 — No Delete option exists anywhere

The record-level actions menu at [src/components/billing/billing-record-actions.tsx:80-98](../../src/components/billing/billing-record-actions.tsx#L80-L98) only ever offers **Void Record** or a disabled **"Cannot void (has payments)"**. There is no separate Delete path that hard-removes the record without leaving a void audit trail.

The original partial-payment spec used "delete" colloquially in a way that implied a Delete-vs-Void branch existed. It doesn't. The wording was wrong; the behavior was always Void or block.

### Finding 2 — Void is completely blocked once any payment is collected

Same actions menu. When `hasCollectedPayments` is true (any active charge has paid OR partial state), the Void option is disabled. There is no payment-reversal flow, no two-step "void payments first, then void record," and no warning-with-confirmation path. The record is permanently un-voidable once any cash has been collected against it.

Task 6 of the partial-payment plan widened the threshold from "any fully-paid charge" to "any charge with `paid_amount > 0`," making MORE records fall into the blocked category. Pre-existing prod behavior was identical in structure (just with a narrower trigger).

### Finding 3 — Per-charge actions are missing entirely

A multi-scout billing record (e.g., "Summer Camp Deposit" billed across 4 scouts at $50 each) has no way to void a single scout's charge in the UI. The `BillingChargeActions` component exists at [billing-record-actions.tsx:121-213](../../src/components/billing/billing-record-actions.tsx#L121-L213) but is **only consumed by the dead `billing-record-card.tsx`** (which itself has zero callers).

The live `BillingManagementView` expanded view renders a "Record Payment" button per row but no actions dropdown. So a treasurer who needs to void a single scout's charge while keeping the rest of the billing record intact has no path.

## Out of scope

- Anything in the partial-payment display layer (shipped on the same branch).
- The payment-modal allocation work parked separately in [docs/superpowers/specs/2026-05-12-payment-modal-charge-allocation-design.md](2026-05-12-payment-modal-charge-allocation-design.md).
- Cleanup of the orphan `billing-record-card.tsx` file (still dead code; cleanup is a separate, mechanical task).

## Open questions (for the next brainstorming session)

These have non-obvious trade-offs and shape the implementation surface significantly.

1. **Terminology.** Today the code says "Void Record" only. Should the menu offer:
   - **(a)** Just "Void" — single term, no Delete (matches today's vocabulary; simplest).
   - **(b)** "Delete" when no payments exist + "Void" when payments exist — two terms for two paths (matches typical SaaS expectations).
   - **(c)** Just "Delete" with internal soft-delete (rename Void → Delete, hide the audit-trail distinction from the UI).

2. **What happens when a treasurer voids a record that has collected payments?** Today it's blocked. Options:
   - **(a)** Auto-reverse all payments on void (single-action). Server creates reversal journal entries, refunds funds-to-billing transfers, etc.
   - **(b)** Two-step: require the treasurer to void each payment first, then the record becomes voidable.
   - **(c)** Confirm + warn ("$X has been collected. Voiding will not refund this — handle separately"). Allow the void without reversing.
   - **(d)** Keep today's "blocked" behavior. Only add the Delete path for clean records.

   Trade-offs: (a) is convenient but accounting-heavy; (b) is explicit but slow; (c) lets cash drift; (d) is safe but inflexible.

3. **Per-charge void.** Should the expanded view render `BillingChargeActions`? When?
   - **(a)** Always present per row, with appropriate disabled states.
   - **(b)** Only for unpaid charges (consistent with "no reversal flow" today).
   - **(c)** Only for paid charges, to let treasurer correct a misapplied payment.
   - **(d)** Both, with a clear UX for each state.

4. **Void cascading.** When you void a billing record with multiple scouts, today all child charges become voided (via the void-billing-dialog flow + `void_payment_full_reversal` SQL function). Is that still the right model under any of the above changes? Especially for option-(b) of question 2 where charges might already be voided individually before the record gets voided.

5. **Reversal trigger interaction.** The reconcile trigger at [supabase/migrations/20260326000002_reconcile_billing_charges.sql](../../supabase/migrations/20260326000002_reconcile_billing_charges.sql) marks `is_paid = true` when balance is fully covered. If a void-with-reversal flow runs, the balance moves backward — does the trigger correctly flip `is_paid = false` again? (Quick check during brainstorming: it currently only handles forward improvement. Backward movement may be a separate edge case.)

6. **Audit / undo for accidental voids.** Today a void writes `is_void = true` and is one-way (no undo UI exists). If we make void easier (option 2a or 2c), accidental voids become more likely. Should there be an "undo within N minutes" or a soft-void state?

## Adjacent work to track

- **Finding 2 + 5 of the parked payment-modal spec** (Bug 5: funds transfers don't write to charge-level state) interacts with reversal logic. Voiding a record that has had funds transferred in needs to know to refund the funds. If the data layer doesn't track which funds went to which charge, that's a hard reversal to do automatically.
- **The "scout name on card" item** in the user's billing-UX queue is unrelated to this work but is also in the queue. Different surface; can ship independently.
- The orphan `billing-record-card.tsx` file becomes a real concern here — if we add Delete/per-charge void UX, do we revive that file as a real component, or extend the inline JSX in `BillingManagementView`? Likely the latter (it's where the active UI lives), but worth asking.

## Files likely involved (when implementation lands)

- `src/components/billing/billing-record-actions.tsx` — main edit surface
- `src/components/billing/billing-management-view.tsx` — render `BillingChargeActions` in expanded view if Finding 3 is addressed
- `src/components/billing/void-billing-dialog.tsx` — extend for the "void with reversal" flow if option 2a/c chosen
- `src/app/actions/billing.ts` — server action; may need a `voidBillingRecordWithReversal` variant
- `supabase/migrations/...` — possibly a new function or trigger for cascading reversal
- Tests across each surface
