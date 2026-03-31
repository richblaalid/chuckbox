# Finances UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the finances section to make the Overview a treasurer command center, standardize all button/action patterns, improve billing UX, and add traceable payment allocation with split payment support.

**Architecture:** Four-phase approach — database migrations first (new columns + table), then UI restructure (Overview + page standardization + entry point consolidation), then billing form improvements (search, patrol select, line items, deposits), then payment flow enhancements (allocation, split payment, bill+pay). Each phase is independently shippable.

**Tech Stack:** Next.js App Router, Supabase (PostgreSQL + RPC), shadcn/ui (Button, Dialog, Checkbox, Input), React Hook Form + Zod, Tailwind CSS 4, Vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-03-31-finances-ux-redesign-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260331000001_billing_line_items_deposits.sql` | Add `line_items`, `deposit_amount`, `deposit_due_date` to `billing_records` |
| `supabase/migrations/20260331000002_payment_allocations.sql` | Create `payment_allocations` table, add `paid_amount` to `billing_charges` |
| `src/components/finances/finance-action-bar.tsx` | Page-level action toolbar for Overview |
| `src/components/finances/scouts-owing-table.tsx` | Compact scouts-with-balances table for Overview |
| `src/components/payments/charge-allocation-list.tsx` | FIFO charge selection with auto-check for payment form |
| `tests/unit/charge-allocation.test.ts` | Unit tests for FIFO allocation logic |
| `tests/unit/billing-form-validation.test.ts` | Unit tests for line item sum validation |

### Modified files
| File | Changes |
|------|---------|
| `src/components/ui/button.tsx` | Remove `accent` variant |
| `src/app/(dashboard)/finances/page.tsx` | Replace Quick Actions + Outstanding Bills with action bar + scouts-owing table |
| `src/components/finances/unified-accounts-view.tsx` | Remove Create Billing button from header |
| `src/components/finances/unified-scout-accounts-table.tsx` | Replace raw `<button>` with `Button`, remove Create Billing icon, fix icons |
| `src/components/finances/bulk-action-bar.tsx` | Remove unimplemented Add Funds + Export buttons |
| `src/components/accounts/account-actions.tsx` | Remove Create Billing, add button grouping, contextual primary |
| `src/components/billing/billing-management-view.tsx` | Consolidate row actions into dropdown, fix status filters, fix bulk void variant |
| `src/components/billing/billing-form.tsx` | Reorder fields, add search/filter, patrol select, line items, deposit, preview |
| `src/components/payments/quick-payment-form.tsx` | Add charge allocation UI, split payment (funds first), inline billing creation |
| `src/components/expenses/expense-card.tsx` | Replace hardcoded color classes with semantic variants |
| `src/components/expenses/expense-detail-actions.tsx` | Replace hardcoded color classes with semantic variants |
| `src/app/(dashboard)/finances/reports/page.tsx` | Add Bank Widget relocated from Overview |
| `src/app/actions/payments.ts` | Accept allocations array, create `payment_allocations`, update `paid_amount` |
| `src/app/api/square/payments/route.ts` | Same allocation logic for card payments |
| `src/components/finances/paginated-transaction-history.tsx` | Show allocation detail in descriptions |
| `src/types/database.ts` | Regenerate after migrations (add new columns/table types) |

---

## Phase 1: Database Migrations + Action Design System

### Task 1: Database Migration — Billing Line Items and Deposits

**Files:**
- Create: `supabase/migrations/20260331000001_billing_line_items_deposits.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add line items, deposit amount, and deposit due date to billing_records
ALTER TABLE billing_records
  ADD COLUMN line_items jsonb DEFAULT NULL,
  ADD COLUMN deposit_amount numeric DEFAULT NULL,
  ADD COLUMN deposit_due_date date DEFAULT NULL;

-- Add constraint: deposit_amount must be positive if set
ALTER TABLE billing_records
  ADD CONSTRAINT billing_records_deposit_amount_positive
  CHECK (deposit_amount IS NULL OR deposit_amount > 0);

-- Add constraint: deposit_due_date requires deposit_amount
ALTER TABLE billing_records
  ADD CONSTRAINT billing_records_deposit_requires_amount
  CHECK (deposit_due_date IS NULL OR deposit_amount IS NOT NULL);

COMMENT ON COLUMN billing_records.line_items IS 'Informational breakdown of the total amount: [{description: string, amount: number}]';
COMMENT ON COLUMN billing_records.deposit_amount IS 'Optional deposit amount due before the full balance';
COMMENT ON COLUMN billing_records.deposit_due_date IS 'Due date for the deposit amount';
```

- [ ] **Step 2: Push migration to dev**

```bash
supabase link --project-ref feownmcpkfugkcivdoal
supabase db push
```

Expected: Migration applied successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260331000001_billing_line_items_deposits.sql
git commit -m "feat: add line_items, deposit_amount, deposit_due_date to billing_records"
```

---

### Task 2: Database Migration — Payment Allocations

**Files:**
- Create: `supabase/migrations/20260331000002_payment_allocations.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add paid_amount to billing_charges for fast querying
ALTER TABLE billing_charges
  ADD COLUMN paid_amount numeric NOT NULL DEFAULT 0;

-- Create payment_allocations table
CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  billing_charge_id uuid NOT NULL REFERENCES billing_charges(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_allocations_amount_positive CHECK (amount > 0)
);

-- Index for querying allocations by payment or charge
CREATE INDEX idx_payment_allocations_payment_id ON payment_allocations(payment_id);
CREATE INDEX idx_payment_allocations_billing_charge_id ON payment_allocations(billing_charge_id);

-- Enable RLS
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;

-- RLS policies: same access pattern as payments table
CREATE POLICY "Users can view payment allocations for their unit"
  ON payment_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payments p
      JOIN unit_memberships um ON um.unit_id = p.unit_id
      WHERE p.id = payment_allocations.payment_id
        AND um.profile_id = auth.uid()
        AND um.status = 'active'
    )
  );

CREATE POLICY "Financial roles can insert payment allocations"
  ON payment_allocations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payments p
      JOIN unit_memberships um ON um.unit_id = p.unit_id
      WHERE p.id = payment_allocations.payment_id
        AND um.profile_id = auth.uid()
        AND um.status = 'active'
        AND um.role IN ('admin', 'treasurer')
    )
  );

COMMENT ON TABLE payment_allocations IS 'Links payments to specific billing charges they cover (partial or full)';
COMMENT ON COLUMN billing_charges.paid_amount IS 'Denormalized sum of payment allocations for this charge. Derived: paid_amount >= amount means fully paid.';
```

- [ ] **Step 2: Push migration to dev**

```bash
supabase db push
```

Expected: Migration applied successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260331000002_payment_allocations.sql
git commit -m "feat: create payment_allocations table and add paid_amount to billing_charges"
```

---

### Task 3: Regenerate Database Types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Regenerate types from Supabase**

```bash
npx supabase gen types typescript --project-id feownmcpkfugkcivdoal > src/types/database.ts
```

- [ ] **Step 2: Verify new types exist**

Open `src/types/database.ts` and confirm:
- `billing_records.Row` has `line_items`, `deposit_amount`, `deposit_due_date`
- `billing_charges.Row` has `paid_amount`
- `payment_allocations` table type exists with `id`, `payment_id`, `billing_charge_id`, `amount`, `created_at`

- [ ] **Step 3: Run build to verify no type errors**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "chore: regenerate database types for payment allocations and billing enhancements"
```

---

### Task 4: Remove `accent` Button Variant

**Files:**
- Modify: `src/components/ui/button.tsx`

- [ ] **Step 1: Read the current button variants**

Read `src/components/ui/button.tsx` to see the full variant definition.

- [ ] **Step 2: Remove the `accent` variant from buttonVariants**

In `src/components/ui/button.tsx`, remove the `accent` line from the `variant` object in `buttonVariants`:

```tsx
// DELETE this line:
accent: "bg-amber-700 text-white shadow-sm hover:bg-amber-800 focus-visible:ring-amber-500/50",
```

- [ ] **Step 3: Find all usages of `variant="accent"` across the codebase**

```bash
grep -r 'variant="accent"' src/ --include="*.tsx" --include="*.ts" -l
```

Replace each occurrence:
- If the button is the primary CTA on its page/dialog → change to `variant="default"`
- If the button is a secondary action → change to `variant="outline"`

Based on the audit, these files use `accent`:
- `src/components/finances/quick-actions-card.tsx` — "Create Billing" → will be removed entirely in Phase 2, change to `default` for now
- `src/components/finances/unified-accounts-view.tsx` — "Create Billing" → will be removed in Phase 2, change to `default` for now
- `src/components/accounts/account-actions.tsx` — "Create Billing" → will be removed in Phase 2, change to `default` for now; "Make a Payment" → change to `default`
- `src/components/payments/quick-payment-form.tsx` — submit button → change to `default`

For each file, replace `variant="accent"` with `variant="default"`.

- [ ] **Step 4: Run build to verify no references remain**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors about `accent`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/button.tsx
git add -A src/components/  # all files that had accent replaced
git commit -m "refactor: remove accent button variant, replace with default/outline per context"
```

---

## Phase 2: UI Restructure (Overview + Page Standardization + Entry Point Consolidation)

### Task 5: Create Finance Action Bar Component

**Files:**
- Create: `src/components/finances/finance-action-bar.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { BillingForm } from '@/components/billing/billing-form'
import { QuickPaymentDialog } from '@/components/payments/quick-payment-dialog'
import { ReminderSelectionDialog } from '@/components/finances/reminder-selection-dialog'
import { BulkReminderWrapper } from '@/components/finances/bulk-reminder-wrapper'
import { Receipt, DollarSign, Bell, Upload } from 'lucide-react'

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: {
    id: string
    billing_balance: number | null
    funds_balance?: number | null
  } | null
}

interface FinanceActionBarProps {
  unitId: string
  unitName: string
  scouts: Scout[]
  squareConfig?: {
    applicationId: string
    locationId: string
    environment: 'sandbox' | 'production'
  }
  owingCount: number
}

export function FinanceActionBar({
  unitId,
  unitName,
  scouts,
  squareConfig,
  owingCount,
}: FinanceActionBarProps) {
  const [isBillingOpen, setIsBillingOpen] = useState(false)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isSelectionOpen, setIsSelectionOpen] = useState(false)
  const [isReminderOpen, setIsReminderOpen] = useState(false)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])

  const handleReminderSelect = (accountIds: string[]) => {
    setSelectedAccountIds(accountIds)
    setIsSelectionOpen(false)
    setIsReminderOpen(true)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setIsBillingOpen(true)}>
          <Receipt className="mr-2 h-4 w-4" />
          Create Billing
        </Button>

        <QuickPaymentDialog
          unitId={unitId}
          scouts={scouts}
          squareConfig={squareConfig}
          trigger={
            <Button variant="outline">
              <DollarSign className="mr-2 h-4 w-4" />
              Record Payment
            </Button>
          }
        />

        <Button
          variant="outline"
          onClick={() => setIsSelectionOpen(true)}
          disabled={owingCount === 0}
        >
          <Bell className="mr-2 h-4 w-4" />
          Send Reminders
          {owingCount > 0 && (
            <span className="ml-1.5 rounded-full bg-stone-200 px-1.5 py-0.5 text-xs font-medium text-stone-700">
              {owingCount}
            </span>
          )}
        </Button>

        <Button variant="outline" asChild>
          <Link href="/settings/import/charges">
            <Upload className="mr-2 h-4 w-4" />
            Import Charges
          </Link>
        </Button>
      </div>

      {/* Create Billing Dialog */}
      <Dialog open={isBillingOpen} onOpenChange={setIsBillingOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Billing</DialogTitle>
          </DialogHeader>
          <BillingForm
            unitId={unitId}
            scouts={scouts}
            onSuccess={() => setIsBillingOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Reminder Selection Dialog */}
      <ReminderSelectionDialog
        open={isSelectionOpen}
        onOpenChange={setIsSelectionOpen}
        scouts={scouts}
        onSelect={handleReminderSelect}
      />

      {/* Bulk Reminder Wrapper */}
      <BulkReminderWrapper
        open={isReminderOpen}
        onOpenChange={setIsReminderOpen}
        unitId={unitId}
        unitName={unitName}
        accountIds={selectedAccountIds}
      />
    </>
  )
}
```

Note: The `QuickPaymentDialog` component may need to accept a `trigger` prop instead of using `DialogTrigger` internally. Check the component and adapt — if it uses `DialogTrigger` with `asChild`, pass the button as the child. The key pattern is that the action bar renders the trigger button, not the dialog component.

- [ ] **Step 2: Run build to verify**

```bash
npm run build
```

Expected: Build succeeds (component may have unused import warnings which is fine — it won't be mounted until the Overview is restructured).

- [ ] **Step 3: Commit**

```bash
git add src/components/finances/finance-action-bar.tsx
git commit -m "feat: create FinanceActionBar component for Overview command center"
```

---

### Task 6: Create Scouts Owing Table Component

**Files:**
- Create: `src/components/finances/scouts-owing-table.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { DollarSign, Bell } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface ScoutOwing {
  scoutId: string
  scoutAccountId: string
  scoutName: string
  amountOwed: number
  lastPaymentDate: string | null
  daysOverdue: number
}

interface ScoutsOwingTableProps {
  scouts: ScoutOwing[]
  onRecordPayment: (scoutAccountId: string) => void
  onSendReminder: (scoutAccountId: string) => void
}

export function ScoutsOwingTable({
  scouts,
  onRecordPayment,
  onSendReminder,
}: ScoutsOwingTableProps) {
  if (scouts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scouts Owing</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-success font-medium">All scouts are paid up!</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scouts Owing</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-xs font-medium text-stone-500">
              <th className="px-6 py-2">Scout</th>
              <th className="px-6 py-2 text-right">Amount Owed</th>
              <th className="hidden px-6 py-2 sm:table-cell">Last Payment</th>
              <th className="hidden px-6 py-2 text-right md:table-cell">Days Overdue</th>
              <th className="px-6 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scouts.map((scout) => (
              <tr key={scout.scoutAccountId} className="border-b last:border-0 hover:bg-stone-50">
                <td className="px-6 py-3">
                  <Link
                    href={`/finances/accounts/${scout.scoutAccountId}`}
                    className="text-sm font-medium text-forest-600 hover:text-forest-800 hover:underline"
                  >
                    {scout.scoutName}
                  </Link>
                </td>
                <td className="px-6 py-3 text-right text-sm font-medium text-red-600">
                  {formatCurrency(Math.abs(scout.amountOwed))}
                </td>
                <td className="hidden px-6 py-3 text-sm text-stone-500 sm:table-cell">
                  {scout.lastPaymentDate
                    ? new Date(scout.lastPaymentDate).toLocaleDateString()
                    : 'Never'}
                </td>
                <td className="hidden px-6 py-3 text-right text-sm md:table-cell">
                  {scout.daysOverdue > 0 ? (
                    <span className={scout.daysOverdue > 30 ? 'font-medium text-red-600' : 'text-stone-600'}>
                      {scout.daysOverdue}d
                    </span>
                  ) : (
                    <span className="text-stone-400">Current</span>
                  )}
                </td>
                <td className="px-6 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => onRecordPayment(scout.scoutAccountId)}
                            aria-label={`Record payment for ${scout.scoutName}`}
                          >
                            <DollarSign className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Record Payment</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => onSendReminder(scout.scoutAccountId)}
                            aria-label={`Send reminder to ${scout.scoutName}`}
                          >
                            <Bell className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Send Reminder</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
      <CardFooter className="justify-center border-t py-3">
        <Link
          href="/finances/accounts"
          className="text-sm font-medium text-forest-600 hover:text-forest-800"
        >
          View all accounts &rarr;
        </Link>
      </CardFooter>
    </Card>
  )
}
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/finances/scouts-owing-table.tsx
git commit -m "feat: create ScoutsOwingTable component for Overview command center"
```

---

### Task 7: Restructure Overview Page

**Files:**
- Modify: `src/app/(dashboard)/finances/page.tsx`

- [ ] **Step 1: Read the full current Overview page**

Read `src/app/(dashboard)/finances/page.tsx` to understand the complete data fetching and layout.

- [ ] **Step 2: Compute scouts-owing data**

After the existing data fetching section, add the scouts-owing query. This needs:
- All scout accounts with negative `billing_balance`
- Last payment date per scout (from `payments` table)
- Days overdue (from oldest unpaid `billing_charges.billing_date` via the parent `billing_records`)

Add the data transformation after the existing queries. The exact queries depend on what's already fetched — adapt to the existing pattern.

- [ ] **Step 3: Replace the layout**

Replace the section from QuickActionsCard through the two-column layout with:

1. **FinanceActionBar** — right after FinanceSubnav + summary cards
2. **ScoutsOwingTable** — replaces Outstanding Bills (full width)
3. **Recent Activity** — below, simplified to 5 items with "View all" link

Remove:
- `QuickActionsCard` import and usage
- `OutstandingBillsCard` import and usage
- `BankWidget` import and usage (will be added to Reports in Task 12)

- [ ] **Step 4: Run build and dev server to verify**

```bash
npm run build
```

Expected: Build succeeds. Verify the page renders with the new layout by checking the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/finances/page.tsx
git commit -m "feat: restructure Overview as treasurer command center with action bar and scouts-owing table"
```

---

### Task 8: Standardize Scout Accounts Table Row Actions

**Files:**
- Modify: `src/components/finances/unified-scout-accounts-table.tsx`

- [ ] **Step 1: Read the row actions section**

Read the file focusing on the row action buttons (the `<td>` with the three raw `<button>` elements).

- [ ] **Step 2: Replace raw buttons with Button components**

Replace the three raw `<button>` elements with shadcn `Button` components. Remove the Create Billing button entirely. Change the Record Payment icon from `CreditCard` to `DollarSign`.

For each remaining button (Record Payment, Send Reminder):

```tsx
<TooltipProvider delayDuration={200}>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => onRecordPayment?.(scout)}
        disabled={scout.billingBalance >= 0}
        aria-label={`Record payment for ${scout.scoutName}`}
      >
        <DollarSign className="h-4 w-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>
      {scout.billingBalance >= 0 ? 'No balance owed' : 'Record Payment'}
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

Same pattern for Bell/Send Reminder. Remove the Receipt/Create Billing button entirely.

- [ ] **Step 3: Remove `onCreateBilling` callback prop if it exists**

Check if the component accepts and uses `onCreateBilling`. If so, remove it from the props interface and all call sites.

- [ ] **Step 4: Update imports**

Replace `CreditCard` import with `DollarSign`. Remove `Receipt` import if no longer used. Add `Button` import if not already present.

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: Build succeeds. If `onCreateBilling` was removed from props, update the parent component (`unified-accounts-view.tsx`) to stop passing it.

- [ ] **Step 6: Commit**

```bash
git add src/components/finances/unified-scout-accounts-table.tsx
git add src/components/finances/unified-accounts-view.tsx  # if modified
git commit -m "refactor: standardize accounts table row actions with Button components, remove Create Billing"
```

---

### Task 9: Clean Up Unified Accounts View and Bulk Action Bar

**Files:**
- Modify: `src/components/finances/unified-accounts-view.tsx`
- Modify: `src/components/finances/bulk-action-bar.tsx`

- [ ] **Step 1: Read both files**

Read the full `unified-accounts-view.tsx` and `bulk-action-bar.tsx`.

- [ ] **Step 2: Remove Create Billing from accounts page header**

In `unified-accounts-view.tsx`, remove the "Create Billing" `DialogTrigger`/`Button` from the page header. Keep the "Import Balances" button (change to `variant="outline"` if not already). Remove the `isBillingOpen` state and the billing `Dialog` if it was only used from the header (check if any remaining paths use it — the table row no longer triggers it after Task 8).

Also remove `isIndividualBillingOpen` and associated dialog if the row-level billing trigger was removed.

- [ ] **Step 3: Remove unimplemented bulk actions**

In `bulk-action-bar.tsx`, remove the "Add Funds" and "Export" buttons (which were marked TODO). Keep only:
- "Send Reminders" (`outline`, `sm`, `Bell` icon)
- "Clear" (`ghost`, `sm`)

Update the props interface to remove `onAddFunds` and `onExport` callbacks.

- [ ] **Step 4: Update parent to stop passing removed props**

In `unified-accounts-view.tsx`, remove the `onAddFunds` and `onExport` props from the `BulkActionBar` usage.

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/finances/unified-accounts-view.tsx src/components/finances/bulk-action-bar.tsx
git commit -m "refactor: remove Create Billing from accounts header, remove unimplemented bulk actions"
```

---

### Task 10: Standardize Account Detail Actions

**Files:**
- Modify: `src/components/accounts/account-actions.tsx`

- [ ] **Step 1: Read the full file**

Read `src/components/accounts/account-actions.tsx`.

- [ ] **Step 2: Remove Create Billing button**

Remove the "Create Billing" button and its associated dialog. Remove the `isBillingOpen` state variable and the `Dialog` component for billing.

- [ ] **Step 3: Make Record Payment contextually primary**

Change the Record Payment button:
- When `billingBalance < 0` (scout owes): `variant="default"` (primary)
- When `billingBalance >= 0` (paid up): don't render the Record Payment button at all

- [ ] **Step 4: Group buttons into two clusters**

Restructure the layout:

```tsx
<div className="flex flex-wrap items-center gap-6">
  {/* Money-in group */}
  <div className="flex items-center gap-2">
    {/* Record Payment — only when scout owes */}
    {billingBalance < 0 && isFinancialRole && (
      <QuickPaymentDialog ...>
        <Button>
          <DollarSign className="mr-2 h-4 w-4" />
          Record Payment
        </Button>
      </QuickPaymentDialog>
    )}
    {/* Use Scout Funds — parent only */}
    {isParent && hasFunds && billingBalance < 0 && (
      <Button variant="outline" ...>
        <Wallet className="mr-2 h-4 w-4" />
        Use Scout Funds
      </Button>
    )}
    {/* Make a Payment — parent + Square */}
    {isParent && billingBalance < 0 && squareConfig && (
      <Button variant="default" ...>
        Make a Payment
      </Button>
    )}
  </div>

  {/* Administrative group */}
  <div className="flex items-center gap-2">
    {isFinancialRole && billingBalance < 0 && (
      <SendPaymentRequestModal ...>
        <Button variant="outline">
          <Bell className="mr-2 h-4 w-4" />
          Send Reminder
        </Button>
      </SendPaymentRequestModal>
    )}
    {isFinancialRole && (
      <AddFundsModal ...>
        <Button variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Add Funds
        </Button>
      </AddFundsModal>
    )}
  </div>
</div>
```

- [ ] **Step 5: Fix icon — ensure DollarSign not CreditCard**

Replace `CreditCard` with `DollarSign` for the Record Payment button if needed.

- [ ] **Step 6: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/accounts/account-actions.tsx
git commit -m "refactor: remove Create Billing from account detail, add button grouping, contextual primary"
```

---

### Task 11: Standardize Billing Management View

**Files:**
- Modify: `src/components/billing/billing-management-view.tsx`
- Modify: `src/components/billing/billing-record-actions.tsx` (if needed)

- [ ] **Step 1: Read the status filter section, row actions section, and bulk bar**

Read `src/components/billing/billing-management-view.tsx` focusing on lines with raw `<button>` status filters, the per-row action buttons, and the bulk action bar.

- [ ] **Step 2: Replace status filter raw buttons with Button components**

Replace the inline `<button>` elements in the status filter with:

```tsx
<div className="inline-flex rounded-lg border border-stone-200 bg-white p-1">
  {(['all', 'unpaid', 'paid', 'voided'] as StatusFilter[]).map((s) => (
    <Button
      key={s}
      variant={statusFilter === s ? 'default' : 'outline'}
      size="sm"
      onClick={() => setStatusFilter2(s)}
      className="capitalize"
    >
      {s}
    </Button>
  ))}
</div>
```

- [ ] **Step 3: Consolidate per-row actions into dropdown only**

Remove the inline `Bell` and `Trash2` ghost buttons from each billing record row. The `BillingRecordActions` dropdown (three-dot menu) should be the only per-row action. Ensure the dropdown contains:
- "Send Billing Reminder" (for non-void records with unpaid charges) — note the label distinction
- "Void Record" (`destructive` text styling)

Also remove the `CreditCard` icon from expanded charge rows (the per-charge "Record Payment" button).

- [ ] **Step 4: Fix bulk bar void variant**

Change the bulk "Void (N)" button from `variant="outline"` with `text-error` override to `variant="destructive"`:

```tsx
<Button variant="destructive" size="sm" onClick={handleBulkVoid} disabled={isBulkVoiding}>
  {isBulkVoiding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
  Void ({selectedNonVoided.length})
</Button>
```

- [ ] **Step 5: Make Create Billing explicitly `default` variant**

If the "Create Billing" button in the filter bar has no variant prop (which defaults to `default` but is implicit), add `variant="default"` explicitly for clarity.

- [ ] **Step 6: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/billing/billing-management-view.tsx src/components/billing/billing-record-actions.tsx
git commit -m "refactor: standardize billing page — Button status filters, dropdown-only row actions, destructive void"
```

---

### Task 12: Standardize Expense Actions + Relocate Bank Widget

**Files:**
- Modify: `src/components/expenses/expense-card.tsx`
- Modify: `src/components/expenses/expense-detail-actions.tsx`
- Modify: `src/app/(dashboard)/finances/reports/page.tsx`

- [ ] **Step 1: Fix expense card action buttons**

In `expense-card.tsx`, replace the hardcoded color classes:

```tsx
{/* Approve — was outline + border-green-200 text-green-700 */}
<Button variant="default" size="sm" onClick={() => setApprovalMode('approve')}>
  Approve
</Button>

{/* Reject — was outline + border-red-200 text-red-700 */}
<Button variant="destructive" size="sm" onClick={() => setApprovalMode('reject')}>
  Reject
</Button>

{/* Mark Paid — was outline + border-emerald-200 text-emerald-700 */}
<Button variant="default" size="sm" onClick={() => setShowPaymentDialog(true)}>
  Mark Paid
</Button>
```

Keep Edit and Edit & Resubmit as `variant="outline"`. Keep View as `variant="ghost"`.

- [ ] **Step 2: Fix expense detail action buttons**

In `expense-detail-actions.tsx`, apply the same variant changes:
- Approve → `variant="default"` (remove `className` color overrides)
- Reject → `variant="destructive"` (remove `className` color overrides)
- Mark Paid → `variant="default"` (remove `className` color overrides)

- [ ] **Step 3: Add Bank Widget to Reports page**

Read `src/app/(dashboard)/finances/reports/page.tsx`. Add the `BankWidget` component (and its feature flag check) after the Collection Summary section. Copy the import and conditional rendering pattern from the Overview page (which is being removed in Task 7).

```tsx
{/* Bank Connection — relocated from Overview */}
{isFeatureEnabled(FeatureFlag.BANK_INTEGRATION) && canTakeActions && (
  <BankWidget unitId={unitId} />
)}
```

Ensure the necessary imports (`BankWidget`, `isFeatureEnabled`, `FeatureFlag`) are added. The Reports page already has role checking — use whatever `canTakeActions` or role variable is available.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/expenses/expense-card.tsx src/components/expenses/expense-detail-actions.tsx src/app/(dashboard)/finances/reports/page.tsx
git commit -m "refactor: semantic expense button variants, relocate Bank Widget to Reports"
```

---

## Phase 3: Billing Form UX Improvements

### Task 13: Reorder Billing Form Fields + Add Scout Search

**Files:**
- Modify: `src/components/billing/billing-form.tsx`

- [ ] **Step 1: Read the full billing form**

Read `src/components/billing/billing-form.tsx` completely.

- [ ] **Step 2: Reorder form fields**

Move the form sections to this order:
1. **Description** (text input) — move to top
2. **Billing Type Toggle** (split/fixed)
3. **Amount** (dollar input)
4. **Scout Selection** (with new search)
5. **Preview** (cost summary)
6. **Notification checkbox**
7. **Submit button**

This means physically moving the JSX blocks within the return statement.

- [ ] **Step 3: Add search input to scout selection**

Add a search state and filter above the patrol-grouped checkboxes:

```tsx
const [scoutSearch, setScoutSearch] = useState('')

// Filter scouts by search
const filteredScouts = scouts.filter((s) =>
  `${s.first_name} ${s.last_name}`.toLowerCase().includes(scoutSearch.toLowerCase())
)

// Group filtered scouts by patrol (same existing grouping logic, but on filteredScouts)
```

Render the search input:

```tsx
<div className="space-y-2">
  <div className="flex items-center justify-between">
    <Label>Select Scouts</Label>
    <div className="flex gap-2 text-sm">
      <button type="button" onClick={selectAll} className="text-forest-600 hover:text-forest-800">
        Select All
      </button>
      <button type="button" onClick={clearAll} className="text-forest-600 hover:text-forest-800">
        Clear
      </button>
    </div>
  </div>
  <Input
    placeholder="Search scouts..."
    value={scoutSearch}
    onChange={(e) => setScoutSearch(e.target.value)}
    className="mb-2"
  />
  {/* Existing patrol-grouped checkboxes, but using filteredScouts */}
</div>
```

- [ ] **Step 4: Add "Select Patrol" toggle on each patrol group header**

For each patrol group heading, add a checkbox that toggles all scouts in that patrol:

```tsx
{Object.entries(scoutsByPatrol).map(([patrol, patrolScouts]) => {
  const allSelected = patrolScouts.every((s) => selectedScouts.has(s.id))
  const someSelected = patrolScouts.some((s) => selectedScouts.has(s.id))

  return (
    <div key={patrol}>
      <div className="flex items-center gap-2 mb-1">
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected && !allSelected}
          onCheckedChange={(checked) => {
            const newSelected = new Set(selectedScouts)
            patrolScouts.forEach((s) => {
              if (checked) newSelected.add(s.id)
              else newSelected.delete(s.id)
            })
            setSelectedScouts(newSelected)
          }}
        />
        <span className="text-sm font-medium text-stone-700">{patrol || 'Unassigned'}</span>
      </div>
      {/* Individual scout checkboxes */}
    </div>
  )
})}
```

Note: shadcn `Checkbox` may not support `indeterminate` as a prop directly. Check the component — if not, use `data-state="indeterminate"` or a ref approach. Adapt to the actual shadcn/ui Checkbox API.

- [ ] **Step 5: Add selected preview footer**

After the scout selection, add a sticky preview:

```tsx
{selectedScouts.size > 0 && parsedAmount > 0 && (
  <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
    {billingType === 'fixed' ? (
      <span>
        {selectedScouts.size} scouts selected &middot; {formatCurrency(parsedAmount)} each &middot;{' '}
        <strong>Total: {formatCurrency(parsedAmount * selectedScouts.size)}</strong>
      </span>
    ) : (
      <span>
        {selectedScouts.size} scouts selected &middot; {formatCurrency(parsedAmount)} &divide;{' '}
        {selectedScouts.size} ={' '}
        <strong>{formatCurrency(parsedAmount / selectedScouts.size)}/scout</strong>
      </span>
    )}
  </div>
)}
```

- [ ] **Step 6: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/billing/billing-form.tsx
git commit -m "feat: reorder billing form fields, add scout search, patrol select, cost preview"
```

---

### Task 14: Add Line Items and Deposit Fields to Billing Form

**Files:**
- Modify: `src/components/billing/billing-form.tsx`
- Create: `tests/unit/billing-form-validation.test.ts`

- [ ] **Step 1: Write validation test for line items**

```typescript
import { describe, it, expect } from 'vitest'

interface LineItem {
  description: string
  amount: number
}

function validateLineItems(lineItems: LineItem[], totalAmount: number): string | null {
  if (lineItems.length === 0) return null // line items are optional
  const sum = lineItems.reduce((acc, item) => acc + item.amount, 0)
  if (Math.abs(sum - totalAmount) > 0.01) {
    return `Line items sum to ${sum.toFixed(2)} but total is ${totalAmount.toFixed(2)}`
  }
  if (lineItems.some((item) => !item.description.trim())) {
    return 'All line items must have a description'
  }
  if (lineItems.some((item) => item.amount <= 0)) {
    return 'All line item amounts must be positive'
  }
  return null
}

describe('validateLineItems', () => {
  it('returns null when no line items (optional)', () => {
    expect(validateLineItems([], 100)).toBeNull()
  })

  it('returns null when line items sum matches total', () => {
    const items = [
      { description: 'Base fee', amount: 390 },
      { description: 'Basketry MB', amount: 15 },
      { description: 'Rifle Shooting MB', amount: 50 },
    ]
    expect(validateLineItems(items, 455)).toBeNull()
  })

  it('returns error when line items sum does not match total', () => {
    const items = [
      { description: 'Base fee', amount: 390 },
      { description: 'Extra', amount: 10 },
    ]
    expect(validateLineItems(items, 455)).toContain('sum to')
  })

  it('returns error when line item has empty description', () => {
    const items = [{ description: '', amount: 100 }]
    expect(validateLineItems(items, 100)).toContain('description')
  })

  it('returns error when line item has zero amount', () => {
    const items = [{ description: 'Fee', amount: 0 }]
    expect(validateLineItems(items, 0)).toContain('positive')
  })
})

export { validateLineItems }
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/billing-form-validation.test.ts
```

Expected: Tests should pass since the function is defined in the test file. (In this case TDD means we define the contract first — the function will be extracted to the form component.)

- [ ] **Step 3: Add line items section to billing form**

After the amount field and before scout selection, add an optional line items section:

```tsx
const [lineItems, setLineItems] = useState<Array<{ description: string; amount: number }>>([])
const [showLineItems, setShowLineItems] = useState(false)

// In JSX, after amount field:
<div className="space-y-2">
  {!showLineItems ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        setShowLineItems(true)
        setLineItems([{ description: '', amount: 0 }])
      }}
    >
      <Plus className="mr-1 h-3.5 w-3.5" />
      Add itemized breakdown
    </Button>
  ) : (
    <div className="space-y-2 rounded-md border border-stone-200 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Line Items</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowLineItems(false)
            setLineItems([])
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {lineItems.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            placeholder="Description"
            value={item.description}
            onChange={(e) => {
              const updated = [...lineItems]
              updated[index] = { ...item, description: e.target.value }
              setLineItems(updated)
            }}
            className="flex-1"
          />
          <Input
            type="number"
            placeholder="0.00"
            value={item.amount || ''}
            onChange={(e) => {
              const updated = [...lineItems]
              updated[index] = { ...item, amount: parseFloat(e.target.value) || 0 }
              setLineItems(updated)
            }}
            className="w-24"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setLineItems(lineItems.filter((_, i) => i !== index))}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setLineItems([...lineItems, { description: '', amount: 0 }])}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add line item
      </Button>
      {/* Sum validation hint */}
      {lineItems.length > 0 && parsedAmount > 0 && (
        <p className={cn(
          'text-xs',
          Math.abs(lineItems.reduce((s, i) => s + i.amount, 0) - parsedAmount) < 0.01
            ? 'text-stone-500'
            : 'text-red-500'
        )}>
          Line items total: {formatCurrency(lineItems.reduce((s, i) => s + i.amount, 0))}
          {Math.abs(lineItems.reduce((s, i) => s + i.amount, 0) - parsedAmount) >= 0.01 &&
            ` (must equal ${formatCurrency(parsedAmount)})`}
        </p>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 4: Add deposit fields**

After the line items section:

```tsx
const [showDeposit, setShowDeposit] = useState(false)
const [depositAmount, setDepositAmount] = useState('')
const [depositDueDate, setDepositDueDate] = useState('')

// In JSX:
<div className="space-y-2">
  {!showDeposit ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setShowDeposit(true)}
    >
      <Plus className="mr-1 h-3.5 w-3.5" />
      Add deposit requirement
    </Button>
  ) : (
    <div className="flex items-center gap-2 rounded-md border border-stone-200 p-3">
      <div className="flex-1 space-y-1">
        <Label className="text-xs">Deposit Amount</Label>
        <Input
          type="number"
          placeholder="0.00"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
        />
      </div>
      <div className="flex-1 space-y-1">
        <Label className="text-xs">Deposit Due Date</Label>
        <Input
          type="date"
          value={depositDueDate}
          onChange={(e) => setDepositDueDate(e.target.value)}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-5 h-8 w-8 p-0"
        onClick={() => {
          setShowDeposit(false)
          setDepositAmount('')
          setDepositDueDate('')
        }}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )}
</div>
```

- [ ] **Step 5: Pass line items and deposit to the RPC call**

Update the `supabase.rpc('create_billing_with_journal', ...)` call to include the new fields. This requires updating the RPC function parameters. If the RPC doesn't support these yet, pass them as a separate update after the RPC call:

```tsx
// After successful RPC call that returns the billing record ID:
if (lineItems.length > 0 || showDeposit) {
  await supabase
    .from('billing_records')
    .update({
      line_items: lineItems.length > 0 ? lineItems : null,
      deposit_amount: showDeposit && depositAmount ? parseFloat(depositAmount) : null,
      deposit_due_date: showDeposit && depositDueDate ? depositDueDate : null,
    })
    .eq('id', billingRecordId)
}
```

- [ ] **Step 6: Add form validation**

Before submit, validate:
- If line items exist, their sum must equal the total amount
- If deposit amount set, it must be less than or equal to the total amount
- If deposit due date set, deposit amount must also be set

Import and use the `validateLineItems` function (extract it from the test file to a shared utils location like `src/lib/billing.ts` or keep inline).

- [ ] **Step 7: Run build and tests**

```bash
npm run build && npx vitest run tests/unit/billing-form-validation.test.ts
```

Expected: Both pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/billing/billing-form.tsx tests/unit/billing-form-validation.test.ts
git commit -m "feat: add optional line items and deposit tracking to billing form"
```

---

## Phase 4: Payment Flow Enhancements

### Task 15: Create Charge Allocation Logic and Component

**Files:**
- Create: `src/lib/payment-allocation.ts`
- Create: `tests/unit/charge-allocation.test.ts`
- Create: `src/components/payments/charge-allocation-list.tsx`

- [ ] **Step 1: Write tests for FIFO allocation logic**

```typescript
import { describe, it, expect } from 'vitest'
import { allocatePayment, type OutstandingCharge } from '@/lib/payment-allocation'

const makeCharge = (id: string, amount: number, date: string): OutstandingCharge => ({
  id,
  billingRecordId: `br-${id}`,
  description: `Charge ${id}`,
  amount,
  paidAmount: 0,
  billingDate: date,
  createdAt: date,
})

describe('allocatePayment', () => {
  const charges = [
    makeCharge('1', 50, '2026-06-01'),   // oldest
    makeCharge('2', 20, '2026-06-15'),
    makeCharge('3', 435, '2026-07-15'),  // newest
  ]

  it('allocates nothing for zero payment', () => {
    const result = allocatePayment(charges, 0)
    expect(result).toEqual([])
  })

  it('fully covers first charge only', () => {
    const result = allocatePayment(charges, 50)
    expect(result).toEqual([{ chargeId: '1', amount: 50 }])
  })

  it('fully covers first two charges', () => {
    const result = allocatePayment(charges, 70)
    expect(result).toEqual([
      { chargeId: '1', amount: 50 },
      { chargeId: '2', amount: 20 },
    ])
  })

  it('partially covers a charge', () => {
    const result = allocatePayment(charges, 60)
    expect(result).toEqual([
      { chargeId: '1', amount: 50 },
      { chargeId: '2', amount: 10 },
    ])
  })

  it('covers all charges exactly', () => {
    const result = allocatePayment(charges, 505)
    expect(result).toEqual([
      { chargeId: '1', amount: 50 },
      { chargeId: '2', amount: 20 },
      { chargeId: '3', amount: 435 },
    ])
  })

  it('handles charges with existing partial payments', () => {
    const partiallyPaid = [
      { ...charges[0], paidAmount: 30 }, // owes 20 remaining
      charges[1],
      charges[2],
    ]
    const result = allocatePayment(partiallyPaid, 40)
    expect(result).toEqual([
      { chargeId: '1', amount: 20 }, // remaining on first
      { chargeId: '2', amount: 20 }, // full second
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/charge-allocation.test.ts
```

Expected: FAIL — `allocatePayment` not found.

- [ ] **Step 3: Implement the allocation function**

```typescript
// src/lib/payment-allocation.ts

export interface OutstandingCharge {
  id: string
  billingRecordId: string
  description: string
  amount: number
  paidAmount: number
  billingDate: string
  createdAt: string
}

export interface Allocation {
  chargeId: string
  amount: number
}

/**
 * Allocate a payment amount across outstanding charges using FIFO (oldest first).
 * Respects existing partial payments on each charge.
 */
export function allocatePayment(
  charges: OutstandingCharge[],
  paymentAmount: number
): Allocation[] {
  if (paymentAmount <= 0) return []

  // Sort oldest first (by billing_date, then created_at)
  const sorted = [...charges].sort((a, b) => {
    const dateComp = a.billingDate.localeCompare(b.billingDate)
    if (dateComp !== 0) return dateComp
    return a.createdAt.localeCompare(b.createdAt)
  })

  const allocations: Allocation[] = []
  let remaining = paymentAmount

  for (const charge of sorted) {
    if (remaining <= 0) break
    const owed = charge.amount - charge.paidAmount
    if (owed <= 0) continue
    const alloc = Math.min(remaining, owed)
    allocations.push({ chargeId: charge.id, amount: alloc })
    remaining -= alloc
  }

  return allocations
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/charge-allocation.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Build the ChargeAllocationList component**

```tsx
// src/components/payments/charge-allocation-list.tsx
'use client'

import { useState, useEffect } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { formatCurrency } from '@/lib/utils'
import { allocatePayment, type OutstandingCharge, type Allocation } from '@/lib/payment-allocation'

interface ChargeAllocationListProps {
  charges: OutstandingCharge[]
  paymentAmount: number
  onAllocationsChange: (allocations: Allocation[]) => void
  onAmountChange?: (amount: number) => void
}

export function ChargeAllocationList({
  charges,
  paymentAmount,
  onAllocationsChange,
  onAmountChange,
}: ChargeAllocationListProps) {
  const [manualOverride, setManualOverride] = useState(false)
  const [selectedChargeIds, setSelectedChargeIds] = useState<Set<string>>(new Set())

  // Sort charges oldest-first for display
  const sortedCharges = [...charges].sort((a, b) => {
    const dateComp = a.billingDate.localeCompare(b.billingDate)
    if (dateComp !== 0) return dateComp
    return a.createdAt.localeCompare(b.createdAt)
  })

  // Auto-allocate when amount changes (unless manually overridden)
  useEffect(() => {
    if (manualOverride) return
    const autoAllocations = allocatePayment(charges, paymentAmount)
    const autoIds = new Set(autoAllocations.map((a) => a.chargeId))
    setSelectedChargeIds(autoIds)
    onAllocationsChange(autoAllocations)
  }, [paymentAmount, charges, manualOverride, onAllocationsChange])

  const handleToggleCharge = (chargeId: string, checked: boolean) => {
    setManualOverride(true)
    const newIds = new Set(selectedChargeIds)
    if (checked) newIds.add(chargeId)
    else newIds.delete(chargeId)
    setSelectedChargeIds(newIds)

    // Recalculate amount based on selected charges
    const selectedAmount = sortedCharges
      .filter((c) => newIds.has(c.id))
      .reduce((sum, c) => sum + (c.amount - c.paidAmount), 0)

    // Update allocations
    const newAllocations = sortedCharges
      .filter((c) => newIds.has(c.id))
      .map((c) => ({ chargeId: c.id, amount: c.amount - c.paidAmount }))

    onAllocationsChange(newAllocations)
    onAmountChange?.(selectedAmount)
  }

  if (sortedCharges.length === 0) return null

  return (
    <div className="space-y-1.5 rounded-md border border-stone-200 p-3">
      <p className="text-xs font-medium text-stone-500 mb-2">Outstanding charges:</p>
      {sortedCharges.map((charge) => {
        const remaining = charge.amount - charge.paidAmount
        if (remaining <= 0) return null
        const isChecked = selectedChargeIds.has(charge.id)

        return (
          <label key={charge.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={isChecked}
              onCheckedChange={(checked) => handleToggleCharge(charge.id, !!checked)}
            />
            <span className="flex-1">{charge.description}</span>
            <span className="font-medium">{formatCurrency(remaining)}</span>
            {charge.paidAmount > 0 && (
              <span className="text-xs text-stone-400">
                ({formatCurrency(charge.paidAmount)} paid)
              </span>
            )}
          </label>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/payment-allocation.ts tests/unit/charge-allocation.test.ts src/components/payments/charge-allocation-list.tsx
git commit -m "feat: FIFO payment allocation logic and charge selection component"
```

---

### Task 16: Update Payment Server Action with Allocations

**Files:**
- Modify: `src/app/actions/payments.ts`

- [ ] **Step 1: Read the full current server action**

Read `src/app/actions/payments.ts`.

- [ ] **Step 2: Add allocations parameter**

Update the `QuickPaymentParams` interface:

```typescript
interface QuickPaymentParams {
  unitId: string
  scoutAccountId: string
  scoutName: string
  amountDollars: number
  method: 'cash' | 'check'
  reference?: string
  notes?: string
  allocations?: Array<{ chargeId: string; amount: number }>
}
```

- [ ] **Step 3: After creating the payment record, insert allocations**

After the payment record is created successfully (after the `payments` insert), add:

```typescript
// Create payment allocations if provided
if (params.allocations && params.allocations.length > 0 && payment?.id) {
  const allocationRows = params.allocations.map((alloc) => ({
    payment_id: payment.id,
    billing_charge_id: alloc.chargeId,
    amount: alloc.amount,
  }))

  const { error: allocError } = await supabase
    .from('payment_allocations')
    .insert(allocationRows)

  if (allocError) {
    console.error('Failed to create payment allocations:', allocError)
    // Don't fail the payment — allocations are supplementary
  }

  // Update paid_amount on each billing charge
  for (const alloc of params.allocations) {
    const { error: updateError } = await supabase.rpc('increment_paid_amount', {
      p_billing_charge_id: alloc.chargeId,
      p_amount: alloc.amount,
    })

    if (updateError) {
      // Fallback: direct update
      const { data: charge } = await supabase
        .from('billing_charges')
        .select('paid_amount')
        .eq('id', alloc.chargeId)
        .single()

      if (charge) {
        await supabase
          .from('billing_charges')
          .update({ paid_amount: (charge.paid_amount || 0) + alloc.amount })
          .eq('id', alloc.chargeId)
      }
    }
  }
}
```

Note: The `increment_paid_amount` RPC may not exist. If not, use the fallback direct update approach (read current value, add, write). If you want atomicity, create a small migration with an RPC:

```sql
CREATE OR REPLACE FUNCTION increment_paid_amount(p_billing_charge_id uuid, p_amount numeric)
RETURNS void AS $$
BEGIN
  UPDATE billing_charges
  SET paid_amount = paid_amount + p_amount
  WHERE id = p_billing_charge_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Decide at implementation time whether the RPC is worth it or if the direct update is sufficient.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/payments.ts
git commit -m "feat: payment server action accepts and persists charge allocations"
```

---

### Task 17: Integrate Allocation UI into Payment Form

**Files:**
- Modify: `src/components/payments/quick-payment-form.tsx`

- [ ] **Step 1: Read the full payment form**

Read `src/components/payments/quick-payment-form.tsx` completely.

- [ ] **Step 2: Fetch outstanding charges when scout is selected**

After the scout is selected, query their outstanding billing charges:

```tsx
const [outstandingCharges, setOutstandingCharges] = useState<OutstandingCharge[]>([])
const [allocations, setAllocations] = useState<Allocation[]>([])

useEffect(() => {
  if (!selectedScoutId) {
    setOutstandingCharges([])
    return
  }
  const selectedScout = scouts.find((s) => s.id === selectedScoutId)
  const accountId = selectedScout?.scout_accounts?.id
  if (!accountId) return

  const fetchCharges = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('billing_charges')
      .select(`
        id,
        amount,
        paid_amount,
        billing_records!inner (id, description, billing_date, created_at)
      `)
      .eq('scout_account_id', accountId)
      .eq('is_void', false)
      .or('is_paid.is.null,is_paid.eq.false')
      .order('created_at', { ascending: true })

    if (data) {
      setOutstandingCharges(data.map((c) => ({
        id: c.id,
        billingRecordId: (c.billing_records as any).id,
        description: (c.billing_records as any).description,
        amount: c.amount,
        paidAmount: c.paid_amount || 0,
        billingDate: (c.billing_records as any).billing_date,
        createdAt: (c.billing_records as any).created_at || '',
      })))
    }
  }
  fetchCharges()
}, [selectedScoutId, scouts])
```

- [ ] **Step 3: Add ChargeAllocationList to the form**

After the scout selector and before the amount/method fields, render:

```tsx
<ChargeAllocationList
  charges={outstandingCharges}
  paymentAmount={parsedAmount}
  onAllocationsChange={setAllocations}
  onAmountChange={(newAmount) => setAmount(String(newAmount))}
/>
```

- [ ] **Step 4: Pass allocations to the server action**

Update the `recordQuickPayment` call to include allocations:

```tsx
const result = await recordQuickPayment({
  unitId,
  scoutAccountId: selectedScout.scout_accounts!.id,
  scoutName: `${selectedScout.first_name} ${selectedScout.last_name}`,
  amountDollars: parsedAmount,
  method,
  reference,
  notes,
  allocations: allocations.map((a) => ({ chargeId: a.chargeId, amount: a.amount })),
})
```

- [ ] **Step 5: Restructure funds as first step (split payment)**

Move "From Funds" out of the payment method radio group. Add a funds section above the method selector:

```tsx
{hasFunds && (
  <div className="rounded-md border border-stone-200 p-3 space-y-2">
    <div className="flex items-center justify-between">
      <Label className="text-sm font-medium">Apply Scout Funds</Label>
      <span className="text-sm text-stone-500">Available: {formatCurrency(fundsBalance)}</span>
    </div>
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={fundsToApply}
        onChange={(e) => setFundsToApply(e.target.value)}
        className="w-32"
        min={0}
        max={maxFromFunds}
        step="0.01"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setFundsToApply(String(maxFromFunds))}
      >
        Apply All
      </Button>
    </div>
    {parsedFundsToApply > 0 && (
      <p className="text-sm text-stone-600">
        Remaining after funds: {formatCurrency(parsedAmount - parsedFundsToApply)}
      </p>
    )}
  </div>
)}
```

Add state: `const [fundsToApply, setFundsToApply] = useState('0')`

Remove `'balance'` from the `PaymentMethod` type. Remove the "From Funds" radio option.

When `parsedFundsToApply > 0` and it covers the full amount, hide the payment method selector and change the submit button label to "Apply Funds".

When submitting with funds, the server action needs to handle both the funds transfer and the remaining payment — this may require a new server action or extending the existing one. At minimum, call the existing `transfer_funds_to_billing` RPC for the funds portion, then `recordQuickPayment` for the remaining cash/check/card portion.

- [ ] **Step 6: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/payments/quick-payment-form.tsx
git commit -m "feat: integrate charge allocation, split payment with funds-first in payment form"
```

---

### Task 18: Add Inline Billing Creation to Payment Form

**Files:**
- Modify: `src/components/payments/quick-payment-form.tsx`

- [ ] **Step 1: Add "no outstanding bill" prompt**

When `outstandingCharges.length === 0` and a scout is selected, show:

```tsx
{selectedScoutId && outstandingCharges.length === 0 && (
  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
    <p className="text-sm text-amber-800">
      No outstanding bill found for this scout.
    </p>
    {!showInlineBilling ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setShowInlineBilling(true)}
      >
        Create billing record for this payment
      </Button>
    ) : (
      <div className="space-y-2">
        <Input
          placeholder="Description (e.g., Summer Camp Deposit)"
          value={inlineBillingDescription}
          onChange={(e) => setInlineBillingDescription(e.target.value)}
        />
        <Input
          type="date"
          value={inlineBillingDate}
          onChange={(e) => setInlineBillingDate(e.target.value)}
        />
      </div>
    )}
  </div>
)}
```

Add state:
```tsx
const [showInlineBilling, setShowInlineBilling] = useState(false)
const [inlineBillingDescription, setInlineBillingDescription] = useState('')
const [inlineBillingDate, setInlineBillingDate] = useState(new Date().toISOString().split('T')[0])
```

- [ ] **Step 2: Handle inline billing on submit**

When submitting with `showInlineBilling === true`, the submit handler needs to:
1. Create the billing record + charge via the existing RPC
2. Then create the payment and allocate against the new charge

This requires sequencing two operations. Update the submit handler:

```tsx
if (showInlineBilling && inlineBillingDescription) {
  // Step 1: Create billing record
  const { data: billingResult, error: billingError } = await supabase.rpc('create_billing_with_journal', {
    p_unit_id: unitId,
    p_description: inlineBillingDescription,
    p_total_amount: parsedAmount,
    p_billing_date: inlineBillingDate,
    p_billing_type: 'fixed',
    p_per_scout_amount: parsedAmount,
    p_scout_accounts: [selectedScout.scout_accounts!.id],
  })

  if (billingError) {
    setError('Failed to create billing record: ' + billingError.message)
    return
  }

  // Step 2: Fetch the new charge to get its ID
  const { data: newCharge } = await supabase
    .from('billing_charges')
    .select('id')
    .eq('billing_record_id', billingResult)
    .eq('scout_account_id', selectedScout.scout_accounts!.id)
    .single()

  // Step 3: Record payment with allocation to the new charge
  const paymentAllocations = newCharge
    ? [{ chargeId: newCharge.id, amount: parsedAmount }]
    : []

  // Continue with normal payment recording, passing paymentAllocations
}
```

Integrate this into the existing submit flow.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/payments/quick-payment-form.tsx
git commit -m "feat: inline billing record creation in payment form when no outstanding bill exists"
```

---

### Task 19: Update Square Payment Handler with Allocations

**Files:**
- Modify: `src/app/api/square/payments/route.ts`

- [ ] **Step 1: Read the current Square payment handler**

Read `src/app/api/square/payments/route.ts`.

- [ ] **Step 2: Accept allocations in the request body**

Update the request body parsing to accept an optional `allocations` array:

```typescript
const { sourceId, amount, scoutAccountId, unitId, scoutName, allocations } = await req.json()
```

- [ ] **Step 3: After creating the payment record, insert allocations**

Use the same allocation insertion pattern from Task 16 — insert into `payment_allocations` and update `billing_charges.paid_amount` for each allocation.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/square/payments/route.ts
git commit -m "feat: Square payment handler accepts and persists charge allocations"
```

---

### Task 20: Update Transaction History with Allocation Details

**Files:**
- Modify: `src/components/finances/paginated-transaction-history.tsx`

- [ ] **Step 1: Read the current component**

Read `src/components/finances/paginated-transaction-history.tsx`.

- [ ] **Step 2: Enhance payment descriptions with allocation info**

When fetching journal lines for display, also fetch related payment allocations for payment-type entries. If a journal entry is of type `payment` and has allocations, enrich the description:

```
"Cash payment — applied to Summer Camp Deposit ($50), May Dues ($20)"
```

This requires joining through `payments.journal_entry_id` → `payment_allocations.payment_id` → `billing_charges.billing_record_id` → `billing_records.description`.

The exact implementation depends on the current fetch pattern. If the component fetches via API route, update that route. If it fetches directly from Supabase, add a secondary query for allocation details on payment-type entries.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/finances/paginated-transaction-history.tsx
git commit -m "feat: show payment allocation details in transaction history"
```

---

### Task 21: Final Build + Test Verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: All tests pass, including the new allocation and validation tests.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: No new lint errors.

- [ ] **Step 4: Verify key flows manually**

Start the dev server and verify:
1. Overview page shows action bar + scouts owing table
2. Create Billing form has new field order, search, patrol select
3. Record Payment form shows outstanding charges with auto-check
4. Expense buttons use correct semantic variants
5. Billing page uses dropdown-only row actions
6. Account detail page has button grouping without Create Billing

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final verification and cleanup for finances UX redesign"
```

---

## Summary

| Phase | Tasks | What Ships |
|-------|-------|-----------|
| 1: Foundation | 1-4 | Database ready, `accent` variant removed |
| 2: UI Restructure | 5-12 | Overview command center, standardized buttons everywhere |
| 3: Billing UX | 13-14 | Better billing form with search, line items, deposits |
| 4: Payment Flow | 15-20 | Traceable allocations, split payment, bill+pay |
| Final | 21 | Full verification |

Each phase can be deployed independently. Phase 1 is backward-compatible (new nullable columns). Phase 2 is the biggest visual change. Phases 3 and 4 add new functionality.
