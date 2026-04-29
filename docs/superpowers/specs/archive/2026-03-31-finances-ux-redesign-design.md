# Finances Section UX Redesign

**Date**: 2026-03-31
**Status**: Design approved, pending implementation planning
**Scope**: Moderate redesign — restructure Overview, standardize actions, improve billing UX, add split payments. No changes to parent/scout experience or reports.

## Problem Statement

The finances section has grown organically, resulting in:

1. **Inconsistent button patterns** — same actions use different variants, colors, icons, and positions across pages
2. **Confused navigation** — the same action (e.g., Record Payment) has 4-6 entry points with no clear "home"
3. **Passive Overview** — the dashboard shows status but doesn't drive action, forcing the treasurer to navigate away for every task
4. **Billing form friction** — event-based billing (the most common type) requires tedious manual scout selection with no search, filtering, or patrol-level selection
5. **Split payment gap** — parents and treasurers cannot apply scout funds + another payment method in a single transaction
6. **Bill + pay gap** — receiving payment for something not yet billed requires two separate actions

## Design Principles

- **Treasurer-first**: Design for the treasurer's most frequent jobs (billing > checking balances > reminders > payments)
- **Command center**: Overview should push the next action, not passively display status
- **One system**: Every button, icon, and action follows the same rules everywhere
- **Drill-down, not parallel**: Overview is the hub; sub-tabs are filtered detail views, not competing work surfaces

---

## Section 1: Action Design System

### Button Variant Hierarchy

| Variant | Semantic Meaning | Use For |
|---------|-----------------|---------|
| `default` (primary) | The main thing to do on this page | Primary CTA per page/dialog — only ONE per visible context |
| `outline` | Secondary actions | Alternative actions with less emphasis |
| `ghost` | Tertiary / inline | Icon-only row actions, clear/dismiss, low-emphasis utility |
| `destructive` | Irreversible actions | Void, Reject, Delete — always with confirmation dialog |
| `secondary` | Neutral alternative | Save as Draft, non-committal actions |

**Removed**: The `accent` variant is eliminated. All current `accent` usages become `default` (when primary) or `outline` (when secondary on that surface).

### Icon Standards

| Action | Icon | Rationale |
|--------|------|-----------|
| Record Payment | `DollarSign` | `CreditCard` reserved for card payment method UI |
| Create Billing | `Receipt` | Already consistent |
| Send Reminder | `Bell` | Already consistent |
| Void / Delete | `Trash2` | Always paired with `destructive` variant or `text-destructive` |
| Import | `Upload` | Already consistent |
| Export | `Download` | Already consistent |
| Add / New | `Plus` | Already consistent |

### Positioning Rules

| Context | Primary Action | Secondary Actions |
|---------|---------------|-------------------|
| Page-level action bar | Right side | Left of primary |
| Card header | Not used for actions | Actions live in page header or card content |
| Dialog footer | Right side | Left of primary; Cancel always leftmost |
| Table row | Right-aligned column, `ghost` icon-only | Max 3 icons per row |
| Bulk action bar | Left-aligned actions | Clear/dismiss on right |

### Technical Standards

- All interactive action elements use the shadcn `Button` component — no raw `<button>` elements
- Status filter toggles use `Button variant="outline" size="sm"` (inactive) / `Button variant="default" size="sm"` (active)
- Expense approval actions use semantic variants (`default` for Approve, `destructive` for Reject) — no hardcoded Tailwind color overrides

---

## Section 2: Overview Redesign (Treasurer Command Center)

The Overview (`/finances`) transforms from a passive dashboard to the treasurer's primary work surface.

### Layout (top to bottom)

**Row 1 — Status Strip** (unchanged)

Four summary cards: Total Owed, Overdue (31+ days), Scout Funds Held, Bank Balance. Read-only vital signs.

**Row 2 — Primary Actions Bar** (new)

Replaces the Quick Actions Card. This is page-level chrome (not inside a card) — a persistent toolbar.

| Button | Variant | Icon | Notes |
|--------|---------|------|-------|
| Create Billing | `default` | `Receipt` | Primary — treasurer's #1 job |
| Record Payment | `outline` | `DollarSign` | Opens Quick Payment dialog |
| Send Reminders | `outline` | `Bell` | Disabled with count badge when no one owes |
| Import Charges | `outline` | `Upload` | Links to `/settings/import/charges` |

**Row 3 — Scouts Owing Table** (replaces Outstanding Bills)

A compact accounts table filtered to scouts with negative billing balance. Organized by **scout** (not by billing record), matching the treasurer's mental model: "who owes me money?"

| Column | Content |
|--------|---------|
| Scout Name | Links to `/finances/accounts/[id]` |
| Amount Owed | From `billing_balance` |
| Last Payment | Date of most recent payment |
| Days Overdue | Calculated from oldest unpaid charge |
| Actions | `ghost` icons: `DollarSign` (record payment), `Bell` (send reminder) |

Footer: "View all accounts" link to `/finances/accounts`.

**Row 4 — Recent Activity** (simplified)

Keep combined payment + billing feed. Reduce from 10 to 5 items. Add "View all" link.

### Removed from Overview

- Quick Actions Card — replaced by action bar
- Outstanding Bills Card — replaced by Scouts Owing table
- Bank Widget (Plaid) — relocated to Reports page

---

## Section 3: Page Standardization

### Scout Accounts (`/finances/accounts`)

| Change | Before | After |
|--------|--------|-------|
| Page header buttons | "Create Billing" + "Import Balances" | "Import Balances" only (`outline`) |
| Table row actions | Raw `<button>` elements with manual colors | `Button variant="ghost"`: `DollarSign`, `Bell` |
| Row-level "Create Billing" icon | Present | Removed (billing is event-driven, not per-scout) |
| Bulk actions | 4 buttons (2 unimplemented TODO) | "Send Reminders" only; remove unimplemented buttons |

### Account Detail (`/finances/accounts/[id]`)

| Change | Before | After |
|--------|--------|-------|
| Primary action | Always "Record Payment" `default` | Contextual: `default` when scout owes, no primary when paid up |
| "Create Billing" | `accent` | Removed from this page (billing is event-driven) |
| "Send Reminder" | `outline` | `outline` (unchanged) |
| "Add Funds" | `outline` | `outline` (unchanged) |
| Button grouping | Flat row of all buttons | Two groups with visual gap: money-in (Record Payment, Use Scout Funds) and administrative (Send Reminder, Add Funds) |

### Billing (`/finances/billing`)

| Change | Before | After |
|--------|--------|-------|
| "Create Billing" button | `default` (no variant prop) | `default` (explicit, primary on this page) |
| Status filter buttons | Raw `<button>` with manual classes | `Button` components with `outline`/`default` size `sm` |
| Per-row actions | Mixed inline icons + dropdown menu | Dropdown menu only (consolidate bell and trash into dropdown) |
| Expanded charge row "Record Payment" icon | Present (CreditCard on unpaid charges) | Removed — record payments from Overview or Accounts, not Billing |
| Void in bulk bar | `outline` with red text override | `destructive` variant |
| Billing-record reminder | Was being removed | Stays — via dropdown, with "Send Billing Reminder" label |

### Expenses

| Change | Before | After |
|--------|--------|-------|
| Approve button | `outline` + hardcoded `border-green-200 text-green-700` | `default` |
| Reject button | `outline` + hardcoded `border-red-200 text-red-700` | `destructive` |
| Mark Paid button | `outline` + hardcoded `border-emerald-200 text-emerald-700` | `default` |
| Edit / Edit & Resubmit | `outline` | `outline` (unchanged) |
| Consistency | Different greens for Approve vs Mark Paid | Same variant for both positive actions |

### Reports (`/finances/reports`)

- Add Bank Widget (Plaid) here, relocated from Overview
- No button changes — read-only page

### Payments (`/finances/payments`)

- No changes — read-only Square history view

---

## Section 4: Billing Form UX Improvements

### Field Reordering

Current: Billing Type → Amount → Description → Scout Selection
New: **Description → Billing Type → Amount → Scout Selection → Preview**

The treasurer names the event first ("Summer Camp 2026"), then configures the charge. Matches the mental model of starting from an event.

### Scout Selection Enhancements

- **Search input** above the patrol-grouped checkboxes — type to filter by scout name
- **"Select Patrol" toggle** on each patrol group header — common for campouts where whole patrols attend
- **Keep existing**: Select All, Clear, individual checkboxes

### Selected Preview (sticky footer in scout selection area)

```
15 scouts selected · $45.00 each · Total: $675.00     [Fixed]
15 scouts selected · $675.00 / 15 = $45.00/scout      [Split]
```

### Itemized Breakdown (new, optional)

A billing record can include **line item details** — description + amount pairs that explain the total.

```
Summer Camp 2026 — $455 total
  Base fee:           $390
  Basketry MB:         $15
  Rifle Shooting MB:   $50
```

- Informational only — not separately billable charges
- Parents see this breakdown when viewing the charge
- Line items must sum to the billing amount (validated on submit)
- Stored as JSONB on `billing_records`: `line_items: [{description: string, amount: number}]`
- UI: "Add line item" button in the billing form, removable rows with description + amount inputs

### Deposit Tracking (new, optional)

A billing record can specify a **deposit amount** and **deposit due date**.

- `deposit_amount` (numeric) and `deposit_due_date` (date) columns on `billing_records`
- The charge per scout is still one charge for the full amount
- The treasurer can view "who hasn't paid the deposit yet" = scouts whose total payments on this billing record are less than the deposit amount
- Parents see two payment options: "Pay Deposit ($50)" or "Pay Full Balance ($455)"
- Deposit status filterable on the Billing page

### Data Model Changes

New columns on `billing_records`:
- `line_items` — JSONB, array of `{description: string, amount: number}`, nullable
- `deposit_amount` — numeric, nullable
- `deposit_due_date` — date, nullable

No new tables. No changes to `billing_charges`, `journal_entries`, or `journal_lines`.

---

## Section 5: Entry Point Consolidation

### Record Payment — 4 to 3 paths

| Path | Variant | Context |
|------|---------|---------|
| Overview action bar | `outline` | "I received a payment" — general starting point |
| Account detail page | `default` (when scout owes) | "I'm on this scout's account" — drill-down |
| Accounts table row icon | `ghost` | "Quick action while scanning balances" |

**Removed**: Billing page expanded charge row CreditCard icon — confusing context switch from invoices to payments.

### Create Billing — 5 to 2 paths

| Path | Variant | Context |
|------|---------|---------|
| Overview action bar | `default` | "I need to bill for an event" — primary workflow |
| Billing page filter bar | `default` | "I'm managing billing and need to add one" |

**Removed**: Accounts page header, Account detail page, Accounts table row icon — billing is event-driven, not per-scout.

### Send Reminders — 6 to 4 paths

| Path | Variant | Context | Reminder Type |
|------|---------|---------|---------------|
| Overview action bar | `outline` | "Remind people who owe" | **Balance reminder** (total owed) |
| Accounts table row icon | `ghost` | "This scout needs a nudge" | **Balance reminder** (total owed) |
| Account detail page | `outline` | "Send this scout a reminder" | **Balance reminder** (total owed) |
| Billing page row dropdown | dropdown item | "Remind about this specific charge" | **Billing reminder** (specific charge) |

The distinction matters: balance reminders reference total amount owed, billing reminders reference a specific charge with its description and due date.

### Void Billing — 3 patterns to 1

All voiding goes through the Billing page row dropdown with `destructive` styling and confirmation dialog. Bulk void via row selection + bulk bar uses `destructive` variant button.

---

## Section 6: Bill + Pay in One Step

### Problem

Treasurer receives a physical payment for something not yet billed. Currently requires: create billing record (dialog 1) → close → record payment (dialog 2). Two separate actions for one real-world event.

### Solution

Enhance the Quick Payment Form with inline billing record creation.

**Flow when no matching charge exists**:

1. Treasurer opens Record Payment, selects scout, enters amount
2. If the scout has no unpaid billing charges, a prompt appears: **"No outstanding bill found. Create one?"** (This checks for any unpaid charge on the scout's account, not amount-matching.)
3. Expanding reveals inline fields: description (required), billing date (defaults to today)
4. Submit atomically creates the billing record + billing charge + payment + journal entries
5. Net effect on scout account: billing charge and payment cancel out (or partially, if amounts differ)

**Flow when matching charge exists**: No change — normal payment recording.

The inline billing creation is optional — the treasurer can dismiss it and record a payment without a matching bill (funds go to the scout's account as before).

---

## Section 7: Split Payment (Funds + Payment Method)

### Problem

Scout funds and payment methods are mutually exclusive in the current form. A parent with $100 in scout funds paying a $455 bill must do two transactions.

### Solution

Restructure the Quick Payment Form so funds application is the **first step**, not a payment method.

### New Payment Form Layout

```
┌─ Apply Scout Funds ──────────────────────────┐
│  Available: $100.00                           │
│  Apply: [$100.00]           [Apply All]       │
│  (set to $0 to skip)                          │
└───────────────────────────────────────────────┘

Remaining: $355.00

┌─ Payment Method ─────────────────────────────┐
│  ○ Cash   ○ Check   ○ Card                   │
│  [Method-specific fields]                     │
└───────────────────────────────────────────────┘

         [ Pay $455.00 ]
```

### Behavior

- Funds section appears **only when scout has funds available** (> $0)
- Default: apply all available funds (or charge amount, whichever is less)
- Treasurer/parent can adjust the funds amount down to $0
- If funds cover the full charge: payment method section hides, button says "Apply Funds ($455.00)"
- If funds partially cover: remaining amount shown, payment method required for the rest
- Submit creates two journal entry sets atomically: funds transfer + payment (card/cash/check)
- "From Funds" is removed from the payment method radio group — it was never a payment method

### Deposit-Aware Variant

When a billing record has a deposit configured, the parent sees:

```
Summer Camp 2026 — $455 total owed
  Deposit: $50 (due June 1)

  ○ Pay Deposit ($50)
  ○ Pay Full Balance ($455)
  ○ Custom Amount: [____]
```

This appears above the funds/payment sections. The selected amount flows into the payment form below.

---

## Section 8: Payment Allocation (Traceable Payments)

### Problem

Payments currently credit the scout's overall `billing_balance` without linking to specific billing charges. The treasurer records "$70 from Johnny" but the system doesn't track that $50 went to the Summer Camp Deposit and $20 went to May Dues. Bills don't get individually marked as paid — only the aggregate balance changes.

### Solution

When recording a payment, show the scout's outstanding charges and auto-allocate the payment across them.

### Payment Form Enhancement

When a scout is selected and has outstanding charges, the payment form shows:

```
Scout: Johnny Smith — owes $505 total

  Outstanding charges:
  ☑ Summer Camp Deposit     $50   (due Jun 1)
  ☑ May Dues                $20   (due May 15)
  ☐ Summer Camp Balance    $435   (due Jul 15)

  Amount: [$70.00]   [Pay Full Balance]
```

### Auto-Apply Behavior (FIFO)

- Charges listed oldest-first (by `billing_date`, then `created_at`)
- As the treasurer enters or adjusts the payment amount, checkboxes auto-check from the top as the amount covers each charge
- Typing "$70" → deposit ($50) and dues ($20) auto-check; Summer Camp Balance remains unchecked
- Typing "$505" or clicking "Pay Full Balance" → all three check
- **Manual override**: Treasurer can uncheck/check specific charges (e.g., parent says "this $50 is specifically for the camp deposit")
- When manually checking/unchecking, the payment amount auto-updates to match the sum of checked charges (treasurer can still override the amount)

### Partial Payments

- If the payment amount exceeds some charges but not the next: the last partially-covered charge gets a partial allocation
- Example: $60 payment → deposit ($50 fully paid) + $10 applied to May Dues ($20 charge, $10 remaining)
- Partially paid charges show as "Partial" status (not "Paid")

### Data Model Changes

**New table: `payment_allocations`**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid, PK | |
| `payment_id` | uuid, FK → `payments` | The payment being allocated |
| `billing_charge_id` | uuid, FK → `billing_charges` | The charge being paid |
| `amount` | numeric | Amount applied to this charge |
| `created_at` | timestamptz | |

A single payment can have multiple allocations (one per charge it covers). A single charge can have multiple allocations (partial payments over time).

**New column on `billing_charges`:**
- `paid_amount` — numeric, default 0. Denormalized sum of allocations for fast querying. Updated by trigger or in the payment action.
- Charge status derived: `paid_amount >= amount` → "Paid", `paid_amount > 0` → "Partial", `paid_amount = 0` → "Unpaid"

### Traceability

After this change, the system can answer:
- "Which charges did this payment cover?" → query `payment_allocations` by `payment_id`
- "How was this charge paid?" → query `payment_allocations` by `billing_charge_id`
- "Has the Summer Camp deposit been paid?" → check `billing_charges.paid_amount >= billing_records.deposit_amount`
- "Which scouts still owe the deposit?" → filter charges where `paid_amount < deposit_amount` for that billing record

### Impact on Account Detail Transaction History

The transaction history on the account detail page can now show richer detail: "Payment $70 — applied to Summer Camp Deposit ($50), May Dues ($20)" instead of just "Cash payment from Johnny Smith."

---

## Files Affected

### Components to modify
- `src/components/finances/quick-actions-card.tsx` — remove, replace with action bar
- `src/components/finances/outstanding-bills-card.tsx` — remove, replace with scouts-owing table
- `src/components/finances/unified-accounts-view.tsx` — remove Create Billing button, clean up bulk actions
- `src/components/finances/unified-scout-accounts-table.tsx` — replace raw buttons with Button components
- `src/components/finances/bulk-action-bar.tsx` — remove unimplemented actions
- `src/components/accounts/account-actions.tsx` — remove Create Billing, add button grouping, contextual primary
- `src/components/billing/billing-management-view.tsx` — consolidate row actions into dropdown, fix status filters
- `src/components/billing/billing-form.tsx` — reorder fields, add scout search/filter, patrol select, line items, deposit, preview
- `src/components/payments/quick-payment-form.tsx` — split payment (funds first), inline billing creation, charge allocation UI
- `src/components/expenses/expense-card.tsx` — semantic button variants
- `src/components/expenses/expense-detail-actions.tsx` — semantic button variants
- `src/app/(dashboard)/finances/page.tsx` — Overview layout restructure
- `src/app/(dashboard)/finances/reports/page.tsx` — add Bank Widget
- `src/app/actions/payments.ts` — accept charge allocations, create `payment_allocations` records, update `billing_charges.paid_amount`
- `src/app/api/square/payments/route.ts` — same allocation logic for card payments
- `src/components/finances/paginated-transaction-history.tsx` — show allocation detail in transaction descriptions

### Components to create
- `src/components/finances/action-bar.tsx` — new page-level action toolbar
- `src/components/finances/scouts-owing-table.tsx` — new compact owing table for Overview

### Database migration
- Add to `billing_records`: `line_items` (JSONB), `deposit_amount` (numeric), `deposit_due_date` (date)
- Add to `billing_charges`: `paid_amount` (numeric, default 0)
- Create table: `payment_allocations` (id, payment_id, billing_charge_id, amount, created_at)
- Update `recordQuickPayment` server action and Square payment handler to create allocations

### No changes to
- Route structure (all URLs stay the same)
- `journal_entries` / `journal_lines` schema
- `scout_accounts` schema
- Reports page content (except adding Bank Widget)
- Payments page
- Parent/scout experience structure and routes (parents will see new UI within existing pages: line item breakdowns on charges, deposit payment options, and the restructured split payment form)
