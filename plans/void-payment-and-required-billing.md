# Fix Void Payment Logic & Require Billing Record for Scout Payments

> **Status:** Draft
> **Created:** 2026-04-02
> **Branch:** feat/finances-ux-redesign

---

## 1. Requirements

### 1.1 Problem Statement

Two related issues with payment/void flow:

1. **Void doesn't fully reverse balance changes.** When a payment is voided, the overpayment-to-funds transfer that happened during recording is not reversed. The scout keeps inflated `funds_balance`. Additionally, payments without charge allocations skip journal reversal entirely, leaving accounting inconsistent.

2. **Payments can be made to a scout without a billing record.** This creates payments with no charge allocations, making voids unable to cleanly restore the pre-payment state. Every scout payment should have a corresponding billing charge.

### 1.2 Solution

**A) Require billing record for scout payments:** In the Quick Payment form, when a scout has no outstanding charges, the inline billing creation is required (not optional). The user must provide a billing description before submitting.

**B) Always reverse journal entries on void:** Remove the `v_has_allocations` condition. Every void creates reversal journal lines. After reversing the payment journal, also detect and reverse any overpayment-to-funds transfer that occurred.

### 1.3 Acceptance Criteria

- [ ] Quick Payment form: submit is disabled when scout has no charges and no inline billing description entered
- [ ] Quick Payment form: inline billing section auto-expands (no toggle button) when scout has no charges
- [ ] Quick Payment form: description field is required (blank = can't submit)
- [ ] Void: always reverses the payment's journal entry (regardless of allocations)
- [ ] Void: always reverses charge allocations (already done)
- [ ] Void: detects and reverses overpayment-to-funds transfers
- [ ] Void: after full reversal, scout balances match pre-payment state
- [ ] Build passes, all tests pass

### 1.4 Out of Scope

- Fixing existing payments without allocations (forward-only)
- Adding unit timezone settings
- Reconciliation void flow (Square payments already blocked)

### 1.5 Decisions

| Decision | Answer |
|----------|--------|
| Inline billing description default | Blank (user must fill in) |
| Funds reversal when funds partially spent | Reverse full amount; GREATEST(0,...) clamps to 0; treasurer resolves any remainder |

---

## 2. Technical Design

### 2.1 Quick Payment Form Change

**File:** `src/components/payments/quick-payment-form.tsx`

When `outstandingCharges.length === 0` and a scout is selected:
- Auto-expand the inline billing form (remove toggle button)
- Make description required for form submission
- Add validation: if `outstandingCharges.length === 0` and `(!showInlineBilling || !inlineBillingDescription.trim())`, disable submit

Current flow (lines 579-606): Shows amber box with optional "Create billing record" button.
New flow: Shows amber box with required description + date fields (always expanded). Submit blocked until description is filled.

### 2.2 Void Payment RPC Changes

**File:** New migration `supabase/migrations/20260402000001_void_payment_full_reversal.sql`

The updated `void_payment` function must:

1. **Always reverse payment journal entry** (remove `v_has_allocations` condition)
2. **Reverse charge allocations** (already done)
3. **Detect and reverse overpayment-to-funds transfers:**
   - After creating the payment reversal journal lines, check if `billing_balance > 0` for the scout
   - If positive, it means an overpayment was previously transferred to funds
   - Create a reverse transfer: debit funds (reduce `funds_balance`), credit billing (reduce `billing_balance` back to 0)
   - This mirrors `auto_transfer_overpayment` but in reverse

The overpayment detection approach (check `billing_balance > 0` after reversal) is simpler and more reliable than searching for the original transfer journal entry by description pattern.

### 2.3 Balance Flow Walkthrough

**Record $50 payment, no charges → void:**

Record:
1. Journal: credit $50 to receivable (1200) with `scout_account_id`, `target_balance='billing'`
   → Trigger: `billing_balance += 50` (now +50)
2. Overpayment check: `billing_balance > 0` → call `auto_transfer_overpayment($50)`
   → Journal: debit $50 billing (billing_balance -= 50, now 0), credit $50 funds (funds_balance += 50)
3. Final state: `billing_balance = 0`, `funds_balance += 50`

Void (new logic):
1. Reverse payment journal: debit $50 to receivable with `target_balance='billing'`
   → Trigger: `billing_balance -= 50` (now -50... wait)

Actually, let me re-trace. The payment journal has two lines:
- Line 1: bank account, debit=$50, credit=0, scout_account_id=NULL → no balance change
- Line 2: receivable, debit=0, credit=$50, scout_account_id=set, target_balance=NULL (defaults to 'billing')
  → Trigger: `billing_balance += (50-0) = +50`

After overpayment transfer (billing_balance was +50, now 0; funds_balance += 50).

Void reversal of payment journal (swap debit/credit):
- Line 1 reversed: bank, debit=0, credit=$50, scout_account_id=NULL → no balance change
- Line 2 reversed: receivable, debit=$50, credit=0, scout_account_id=set, target_balance='billing'
  → Trigger: `billing_balance += (0-50) = -50`

After reversal: `billing_balance = 0 + (-50) = -50`, `funds_balance = +50`

Now: billing_balance is -50 (scout owes), but no charge exists. The overpayment reverse should detect this differently.

Hmm, `billing_balance < 0` means the scout owes money. `billing_balance > 0` would mean overpayment. After reversal, billing is -50, which is "owes money" — but there's still +50 in funds from the transfer. We need to pull the funds back.

Better approach: **After ALL reversals (journal + allocations), check if funds_balance > 0 AND billing_balance < 0. If so, transfer from funds to billing to offset.**

Revised void step 3:
- After journal reversal + charge allocation reversal
- `SELECT billing_balance, funds_balance FROM scout_accounts WHERE id = scout_account_id`
- If `billing_balance < 0 AND funds_balance > 0`:
  - Transfer amount = `MIN(ABS(billing_balance), funds_balance)`
  - Create journal: debit funds (reduces funds_balance), credit billing (increases billing_balance toward 0)

**Record $50 payment with $30 charge → void:**

Record:
1. Journal: credit $50 to receivable → billing_balance += 50
2. Charge allocation: $30 to charge, $20 unallocated
3. billing_balance was -30 (owed), now +20 after payment
4. Overpayment: $20 transferred to funds → billing_balance = 0, funds_balance += 20

Void:
1. Reverse journal: billing_balance += -50 → now -50
2. Reverse allocations: charge marked unpaid, paid_amount reduced by $30
3. After reversal: billing_balance = -50, funds_balance = +20
4. Overpayment reversal: MIN(50, 20) = 20 → transfer $20 from funds to billing
5. Final: billing_balance = -30 (scout owes $30 = the charge amount), funds_balance = 0 ✓

---

## 3. Implementation Tasks

### Phase 0: Database

#### 0.1 Void Payment RPC Update
- [ ] **0.1.1** Create migration `20260402000001_void_payment_full_reversal.sql` with updated function:
  - Remove `v_has_allocations` condition for journal reversal
  - Always reverse journal entry when it exists
  - After reversal + allocation changes, check scout balance
  - If `billing_balance < 0 AND funds_balance > 0`, create reverse overpayment transfer
  - Files: `supabase/migrations/20260402000001_void_payment_full_reversal.sql`

- [ ] **0.1.2** Push migration to dev
  - Run: `supabase db push`

### Phase 1: UI Changes

#### 1.1 Quick Payment Form — Required Billing
- [ ] **1.1.1** Modify inline billing to auto-expand and be required
  - File: `src/components/payments/quick-payment-form.tsx`
  - When `outstandingCharges.length === 0`: remove the toggle button, always show description + date fields
  - Add `setShowInlineBilling(true)` automatically when charges are empty
  
- [ ] **1.1.2** Add submit validation for required billing
  - File: `src/components/payments/quick-payment-form.tsx`
  - In `handleSubmit`: if `outstandingCharges.length === 0` and `!inlineBillingDescription.trim()`, show error "Please create a billing record for this payment"
  - Also disable the submit button visually when this condition isn't met

### Phase 2: Verification

- [ ] **2.1.1** Run build: `npm run build`
- [ ] **2.1.2** Run tests: `npm test`
- [ ] **2.1.3** Manual test: record payment with no charges → billing form required
- [ ] **2.1.4** Manual test: record payment with charges → void → balances restored
- [ ] **2.1.5** Manual test: record payment without charges (new billing) → void → balances restored

---

## 4. Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `supabase/migrations/20260402000001_void_payment_full_reversal.sql` | Updated void_payment with full reversal logic |

### Modified Files
| File | Changes |
|------|---------|
| `src/components/payments/quick-payment-form.tsx` | Auto-expand inline billing, require description, submit validation |

---

## 5. Progress Summary

| Phase | Total | Complete | Status |
|-------|-------|----------|--------|
| Phase 0 | 2 | 0 | ⬜ Not Started |
| Phase 1 | 2 | 0 | ⬜ Not Started |
| Phase 2 | 5 | 0 | ⬜ Not Started |
