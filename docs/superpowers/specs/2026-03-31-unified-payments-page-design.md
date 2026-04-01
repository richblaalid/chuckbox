# Unified Payments Page Design

**Date:** 2026-03-31
**Status:** Approved
**Branch:** feat/finances-ux-redesign

## Problem

The Payments page currently only shows Square transactions and is hidden when no payment provider is connected. This means:
- Manual payments (cash, check) have no centralized view
- Units without Square have no payments page at all
- Square transactions that aren't linked to a scout account have no reconciliation path
- There's no single place to manage all incoming money

## Solution

A unified Payments page that is always visible to admin/treasurer roles, showing all payment activity (manual and Square) with filtering, detail views, inline actions, and a Square transaction reconciliation workflow.

## Key Decisions

- **Payments tab always visible** — not gated on Square connection status
- **`payments` table is the canonical source** — unreconciled Square transactions surface separately with distinct visual treatment
- **Amount corrections via void-and-recreate** — no in-place amount editing to preserve accounting audit trail
- **Treasurer gets void permission** — updated from current admin-only restriction
- **Reconciliation has two paths**: link to scout account, or mark as not scout-related
- **"Recorded by" shown for audit** — visible in list and detail view, but not a filterable field
- **Square CTA banner** — shown when no payment provider is connected, with link to integration settings

## Out of Scope

- Refunds (future feature)
- Payment method editing (void and recreate instead)
- Exporting/downloading payment data (follow-up)
- Parent/scout-facing payment history (separate concern)

---

## Page Structure & Navigation

### Navigation Changes

`FinanceSubnav` always shows the Payments tab for admin/treasurer roles regardless of Square connection status. The tab ordering remains: Overview, Scout Accounts, Billing, **Payments**, Expenses, Reports.

### Page Layout

1. **Top bar**: Page title "Payments", "Record Payment" button (opens existing Quick Payment dialog), and "Sync Square" button (only if Square connected)
2. **Square CTA banner** (conditional): If no Square connection, a subtle banner below the top bar — "Connect a payment provider to accept card payments" with link to integration settings
3. **Filter bar**: Payment method, status (including "Needs Reconciliation"), date range presets, scout name search
4. **Payments table**: Unified list sorted by date descending
5. **Detail view**: Clicking a row opens a side sheet with full details and action buttons

### Table Columns

| Column | Content |
|--------|---------|
| Date | Payment date, formatted |
| Scout | Scout name, or "—" for non-scout payments |
| Amount | Gross amount (net amount shown in detail) |
| Method | Cash, Check, Card — with icon |
| Status | Completed, Voided, Needs Reconciliation (amber badge) |
| Recorded By | Name of the admin/treasurer who created/reconciled the payment |

### Filters

- **Payment method**: All, Cash, Check, Card
- **Status**: All, Completed, Voided, Needs Reconciliation
- **Date range**: 7 days, 30 days, 90 days, YTD, All Time (default: 30 days)
- **Scout search**: Type-ahead text input to filter by scout name

### Sort

Default sort: date descending (newest first). Sortable columns: Date, Amount, Scout Name, Method.

---

## Data Model Changes

### `payments` table additions

```sql
ALTER TABLE payments ADD COLUMN recorded_by UUID REFERENCES profiles(id);
ALTER TABLE payments ADD COLUMN reconciliation_status VARCHAR(50);
-- reconciliation_status values: 'reconciled', 'not_scout_related', NULL
-- NULL = not applicable (manual payments) or not yet reconciled
```

**Backfill strategy**: Set `recorded_by` on existing rows using the user who created the associated journal entry, or the unit admin as fallback.

### No changes to `square_transactions`

The existing `payment_id` FK already indicates reconciliation status:
- `payment_id IS NOT NULL` = reconciled (linked to a payments row)
- `payment_id IS NULL` = unreconciled

The `reconciliation_status` on the `payments` row distinguishes between "linked to scout" vs "not scout-related".

### Querying the unified list

**Main query**: `payments` table joined to `profiles` (for recorded_by name) and optionally `scout_accounts` -> `scouts` (for scout name). Filtered by `unit_id`.

**Needs Reconciliation query**: `square_transactions` where `payment_id IS NULL` for the unit. These render with amber badge treatment in the list.

The two result sets merge client-side, with unreconciled Square transactions appearing inline sorted by date alongside regular payments.

---

## Actions & Permissions

### Payment Detail Sheet

Clicking any payment row opens a side sheet containing:
- Full payment details (amount, fee, net, method, date, status)
- Scout name and account link (if applicable)
- Charge allocations list (which charges this payment covers)
- Journal entry reference
- Square receipt link (if card payment)
- Notes
- "Recorded by" with timestamp
- Void details (if voided): reason, voided by, voided at

### Action Buttons

| Action | Admin | Treasurer | When Available |
|--------|-------|-----------|----------------|
| View Details | Yes | Yes | Always |
| Edit Notes | Yes | Yes | Non-voided payments |
| Edit Allocations | Yes | Yes | Non-voided payments with a scout account |
| Void Payment | Yes | Yes | Non-voided payments |
| Reconcile | Yes | Yes | Unreconciled Square transactions only |
| Record Payment | Yes | Yes | Always (top bar button) |

### Permissions Changes

In `roles.ts`:
- `void_payments`: Update to allow **treasurer** (currently admin only)
- `reconcile_payments`: New permission — admin, treasurer
- `edit_payment_notes`: New permission — admin, treasurer

---

## Reconciliation Flow

When a user clicks "Reconcile" on an unreconciled Square transaction, a dialog opens with two options.

### Option 1: Link to Scout Account

1. Searchable scout selector (same component as Quick Payment form)
2. After selecting scout, display their outstanding charges
3. User allocates the Square transaction amount to specific charges (or leaves unallocated as general payment)
4. Amount, fee, and net are **read-only** from the Square transaction
5. On submit:
   - Create `payments` row with `scout_account_id`, `payment_method: 'card'`, `square_payment_id`, `reconciliation_status: 'reconciled'`, `recorded_by`
   - Create `journal_entry` (debit bank account, credit accounts receivable)
   - Create `payment_allocations` linking payment to selected charges
   - Update `square_transactions.payment_id` to the new payment
   - Update charge `paid_amount` and `is_paid` flags
   - Auto-transfer overpayment to scout funds (same logic as Quick Payment)

### Option 2: Mark as Not Scout-Related

1. Optional notes field (e.g., "Camp store sale", "Fundraiser revenue")
2. Amount, fee, and net are **read-only**
3. On submit:
   - Create `payments` row with `scout_account_id: null`, `payment_method: 'card'`, `square_payment_id`, `reconciliation_status: 'not_scout_related'`, `recorded_by`, notes
   - Create `journal_entry` (debit bank account, credit "Other Income" account — code 4900, already exists in chart of accounts)
   - Update `square_transactions.payment_id` to the new payment

---

## Components to Build/Modify

### New Components

1. **`UnifiedPaymentsList`** — Main payments table with filters, sort, and merged data from `payments` + unreconciled `square_transactions`
2. **`PaymentDetailSheet`** — Side panel with full payment info and action buttons
3. **`ReconcilePaymentDialog`** — Two-tab dialog for linking to scout or marking as not scout-related
4. **`reconcileSquareTransaction` server action** — Handles both reconciliation paths

### Modified Components

5. **`FinanceSubnav`** — Always show Payments tab (remove `showPaymentsTab` conditional)
6. **`roles.ts`** — Update `void_payments` to include treasurer, add `reconcile_payments` and `edit_payment_notes`
7. **`payments/page.tsx`** — Replace Square-only view with unified view; optionally keep Square History as a sub-tab for raw sync troubleshooting
8. **`recordQuickPayment` server action** — Set `recorded_by` field when creating payments

### Reused As-Is

9. **`QuickPaymentDialog`** / **`QuickPaymentForm`** — Launched from "Record Payment" button
10. **`VoidPaymentDialog`** — Launched from detail sheet, existing void logic

### Database Migration

- Add `recorded_by` and `reconciliation_status` columns to `payments`
- Backfill `recorded_by` from journal entries or unit admin
- Update RLS policies for new permission actions
