# Finances UX Improvements Design

**Date:** 2026-04-02
**Status:** Draft
**Branch:** feat/finances-ux-redesign

## Overview

Three targeted improvements to the Finances section focused on usability and reducing navigation friction:

1. **Adjust Funds** — Rename "Add Funds" to "Adjust Funds" everywhere, support both adding and removing from `funds_balance`, and surface the action in the scout accounts table
2. **Payment Method on Billing Charges** — Show how a charge was paid (cash, check, card) on expanded billing record cards when a definitive allocation link exists
3. **Record Payment from Billing Charges** — Launch the existing Quick Payment flow from an unpaid charge row in the billing view, pre-populated with charge details

## Out of Scope

- Changes to `billing_balance` (handled via billing record edits/voids)
- New payment methods or Square integration changes
- Bulk fund reductions (multi-scout remove)
- Refunds or payment editing

---

## 1. Adjust Funds

### Rename

All references to "Add Funds" become "Adjust Funds" across the codebase:
- `AddFundsModal` → `AdjustFundsModal`
- `AddFundsForm` (multi-scout, payments tab) → `AdjustFundsForm`
- `addFundsToScout` server action → `adjustScoutFunds`
- Button labels, dialog titles, form headers, menu items

### UI — AdjustFundsModal

The existing `AddFundsModal` is extended with a direction toggle:

- **Direction toggle** at top: "Add" (default) / "Remove" — segmented button control
- **Amount** field (required, > 0)
- **Fundraiser type** dropdown (optional) — shown for both add and remove
- **Notes** field — optional for adds, **required for removes** (validation message: "A note is required when removing funds")
- **Current balance** shown as context (e.g., "Current balance: $125.00")
- **Remove validation**: When "Remove" is selected and amount > current balance, inline error: "Amount exceeds current balance of $X.XX"

### UI — Multi-Scout Form

The `AddFundsForm` on the payments tab renames to `AdjustFundsForm` with the same direction toggle. Same validation rules apply per-scout.

### UI — Scout Accounts Table

New "Adjust Funds" icon action added to each row in `UnifiedScoutAccountsTable`, alongside the existing Record Payment and Send Reminder actions.

### Server Action

`addFundsToScout()` becomes `adjustScoutFunds()` with a new `direction` parameter (`'add' | 'remove'`):

- **Add**: Calls existing `credit_fundraising_to_scout` RPC (no change to journal logic)
- **Remove**: Calls new `debit_funds_from_scout` RPC:
  - Validates `amount <= current funds_balance` in the database (race-condition safe)
  - Creates journal entry with `entry_type: 'funds_adjustment'`
  - Journal lines: debit Scout Funds (1210) to reduce balance, credit income account (reversal)
  - Updates `funds_balance` accordingly
  - Requires notes (enforced server-side as well as client-side)

### Database

New RPC function `debit_funds_from_scout`:
- Parameters: `p_scout_account_id UUID`, `p_amount NUMERIC`, `p_description TEXT`, `p_fundraiser_type TEXT DEFAULT NULL`
- Validates `p_amount <= current funds_balance` (raises exception if not)
- Creates journal entry (entry_type: `'funds_adjustment'`)
- Creates two journal lines:
  1. Debit Scout Funds account (1210) with `target_balance: 'funds'` — reduces `funds_balance`
  2. Credit income account (4200/4210/4900 based on fundraiser type) — reverses revenue
- Decrements `funds_balance` on `scout_accounts`

### Permissions

Admin and treasurer only (same as current Add Funds).

### Files to Modify

| File | Change |
|------|--------|
| `src/components/accounts/add-funds-modal.tsx` | Rename to `adjust-funds-modal.tsx`, add direction toggle, remove validation, balance display |
| `src/components/payments/add-funds-form.tsx` | Rename to `adjust-funds-form.tsx`, add direction toggle |
| `src/app/actions/funds.ts` | Rename action, add `direction` parameter, call appropriate RPC |
| `src/components/finances/unified-scout-accounts-table.tsx` | Add "Adjust Funds" icon action to row |
| `supabase/migrations/` | New migration for `debit_funds_from_scout` RPC |
| All import sites | Update to new file/function names |

---

## 2. Payment Method on Billing Charge Rows

### Data

Modify the billing records page query to left-join through `payment_allocations` to `payments`:

```
billing_charges → payment_allocations → payments.payment_method
```

Only surfaces payment method when a `payment_allocation` row definitively links a payment to the charge. If no allocation exists, no method is shown.

### Display

On each paid charge row in the expanded billing record card, after the "Paid" badge:

| Payment Method | Display |
|---------------|---------|
| Cash | "Paid · Cash" |
| Check (no ref) | "Paid · Check" |
| Check (with ref) | "Paid · Check #1234" |
| Card | "Paid · Card" |
| No allocation | "Paid" (no method — same as today) |

Method text uses secondary/muted styling. Not a separate badge — inline with the existing paid indicator.

### Check Reference

The check reference number is stored in the payment's `notes` field in the format `Check #1234` (or `Check #1234 - additional notes` if notes were also provided). The display extracts the check number from this pattern when `payment_method = 'check'`.

### Files to Modify

| File | Change |
|------|--------|
| `src/app/(dashboard)/finances/billing/page.tsx` | Extend query to join `payment_allocations` → `payments` |
| `src/components/billing/billing-record-card.tsx` | Display payment method on paid charge rows |

---

## 3. Record Payment from Billing Charge Row

### Trigger

Each **unpaid** charge row in the expanded billing record card gets a "Record Payment" action button. Not shown on voided or already-paid charges.

### Dialog Behavior

Clicking opens the existing `QuickPaymentForm` in a dialog, pre-populated:

| Field | Pre-populated Value | Editable? |
|-------|-------------------|-----------|
| Scout | From charge's `scout_account_id` | No (locked, visible) |
| Amount | From charge `amount` | Yes |
| Charge allocation | Specific charge pre-selected | Yes (can add more) |
| Method | Empty | Yes |
| Reference | Empty | Yes |
| Notes | Empty | Yes |

The dialog header shows context: "Payment for: [billing record description]".

### Data Passed to Dialog

The billing charge row passes these props to the dialog:

- `scoutAccountId` — identifies the scout
- `chargeId` — for pre-selecting the allocation
- `chargeAmount` — for pre-filling the amount
- `billingDescription` — for context in the dialog header

### Post-Payment Behavior

After successful payment:
- Billing records page revalidates via existing `revalidatePath` pattern
- Billing card reflects updated paid/unpaid status
- If fully paid, the charge row shows "Paid" badge with method (per Section 2)

### No New Server Logic

Reuses `recordQuickPayment` action entirely. The only new work is the trigger point on the charge row and pre-population props passed to `QuickPaymentForm`.

### Permissions

Admin and treasurer only (same as current Record Payment).

### Files to Modify

| File | Change |
|------|--------|
| `src/components/billing/billing-record-card.tsx` | Add "Record Payment" action on unpaid charge rows |
| `src/components/billing/billing-management-view.tsx` | Manage dialog state, pass charge data to QuickPaymentForm |
| `src/components/payments/quick-payment-form.tsx` | Accept optional pre-population props (`initialScoutAccountId`, `initialAmount`, `initialChargeId`, `locked` flags) |

---

## Component Dependency Summary

```
Section 1 (Adjust Funds):
  AdjustFundsModal (new name) ← UnifiedScoutAccountsTable (new action)
  AdjustFundsForm (new name) ← Payments tab
  adjustScoutFunds action ← debit_funds_from_scout RPC (new)

Section 2 (Payment Method):
  billing/page.tsx query ← payment_allocations → payments join
  BillingRecordCard ← display method on paid charges

Section 3 (Record Payment from Billing):
  BillingRecordCard (unpaid charge action) → QuickPaymentForm (pre-populated)
  No new server logic
```

All three sections are independent and can be implemented in any order.
