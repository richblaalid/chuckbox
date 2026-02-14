# Finance UI Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the finance section from 7 tabs to 3, consolidating all scout financial data and actions into a unified view.

**Architecture:** Leverage existing phase-0.5 components (UnifiedAccountsView, OverdueTable, report components) and update navigation. Delete deprecated routes last. All changes use existing patterns.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui components, Supabase, TypeScript

**Updated:** 2026-02-09 - Revised to account for phase-0.5 merge which added many components.

---

## Pre-Implementation Status

### Components Already Built (from phase-0.5)

| Component | Location | Purpose |
|-----------|----------|---------|
| `UnifiedScoutAccountsTable` | `src/components/finances/` | Main table with checkboxes, filters |
| `ScoutDetailSidePanel` | `src/components/finances/` | Slide-in panel with actions |
| `BulkActionBar` | `src/components/finances/` | Selection-based bulk actions |
| `UnifiedAccountsView` | `src/components/finances/` | Coordinates table + panel + dialogs |
| `OverdueTable` | `src/components/collection/` | Overdue accounts with bulk reminders |
| `BulkReminderDialog` | `src/components/collection/` | Send reminders to selected scouts |
| `QuickPaymentForm` | `src/components/payments/` | Inline payment recording |
| `QuickBillingForm` | `src/components/billing/` | Inline billing creation |
| `AgingReport` | `src/components/reports/` | Charges by age bucket |
| `CollectionSummary` | `src/components/reports/` | Collection rates & trends |
| `BalanceSheetReport` | `src/components/reports/` | Balance sheet display |
| `IncomeExpenseReport` | `src/components/reports/` | Income/expense statement |
| `DuesByPatrolReport` | `src/components/reports/` | Dues grouped by patrol |
| `BankWidget` | `src/components/plaid/` | Plaid bank connection widget |

### Current Finance Subnav (7 tabs - needs consolidation)

```
Overview | Accounts | Billing | Payments | Collection | Reports | Transactions
```

### Target Finance Subnav (3 tabs)

```
Overview | Scout Accounts | Reports
```

### What Gets Consolidated

| Current Tab | Goes To |
|-------------|---------|
| Overview | Overview (enhanced with quick action dialogs) |
| Accounts | Scout Accounts |
| Billing | Scout Accounts → Create Billing button/dialog |
| Payments | Scout Accounts → Side panel actions |
| Collection | Scout Accounts → "Overdue" filter + bulk reminders |
| Reports | Reports |
| Transactions | Reports → Transaction History section |

---

## Phase 0: Verify Access Control

The access control changes may have already been applied. Verify and update if needed.

### Task 0.1: Verify roles.ts PAGE_ACCESS settings

**Files:**
- Read: `src/lib/roles.ts`
- Test: `tests/unit/roles.test.ts` (create if doesn't exist)

**Step 1: Read current roles.ts**

Verify that PAGE_ACCESS has:
- `dashboard: ['admin', 'treasurer', 'leader']` (no parent, scout)
- `finances: ['admin', 'treasurer']` (no leader, parent, scout)

**Step 2: Write test if not exists**

Create `tests/unit/roles.test.ts` with tests for:
- Parent/scout cannot access dashboard
- Leader/parent/scout cannot access finances
- All roles can access scouts (roster)

**Step 3: Run tests**

Run: `npm test tests/unit/roles.test.ts`
Expected: PASS

**Step 4: Commit if changes made**

```bash
git add src/lib/roles.ts tests/unit/roles.test.ts
git commit -m "test: add role access tests for finances consolidation"
```

---

### Task 0.2: Verify redirect logic in finance pages

**Files:**
- Read: `src/app/(dashboard)/finances/page.tsx`
- Read: `src/app/(dashboard)/dashboard/page.tsx`

**Step 1: Verify finances page has access check**

The Overview page should redirect unauthorized roles:
```typescript
if (!canAccessPage(membership.role, 'finances')) {
  redirect('/roster')
}
```

**Step 2: Verify dashboard page has access check**

The Dashboard should redirect parents/scouts:
```typescript
if (hasFilteredView(membership.role)) {
  redirect('/roster')
}
```

**Step 3: Add checks if missing, run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit if changes made**

```bash
git add src/app/(dashboard)/finances/page.tsx src/app/(dashboard)/dashboard/page.tsx
git commit -m "feat: ensure proper role redirects for finances and dashboard"
```

---

## Phase 1: Update FinanceSubnav

Reduce navigation from 7 tabs to 3 tabs.

### Task 1.1: Update FinanceSubnav to 3 tabs

**Files:**
- Modify: `src/components/finances/finance-subnav.tsx`
- Test: `tests/unit/components/finance-subnav.test.tsx` (create)

**Step 1: Write the failing test**

```typescript
// tests/unit/components/finance-subnav.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FinanceSubnav } from '@/components/finances/finance-subnav'

// Mock usePathname
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/finances'),
}))

describe('FinanceSubnav', () => {
  it('renders exactly 3 tabs: Overview, Scout Accounts, Reports', () => {
    render(<FinanceSubnav />)

    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /scout accounts/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument()
  })

  it('does not render deprecated tabs', () => {
    render(<FinanceSubnav />)

    expect(screen.queryByRole('link', { name: /^billing$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^payments$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^collection$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^transactions$/i })).not.toBeInTheDocument()
  })

  it('links to correct routes', () => {
    render(<FinanceSubnav />)

    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute('href', '/finances')
    expect(screen.getByRole('link', { name: /scout accounts/i })).toHaveAttribute('href', '/finances/accounts')
    expect(screen.getByRole('link', { name: /reports/i })).toHaveAttribute('href', '/finances/reports')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/unit/components/finance-subnav.test.tsx`
Expected: FAIL - still has 7 tabs

**Step 3: Update FinanceSubnav**

Replace the tabs array:

```typescript
// src/components/finances/finance-subnav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Users, BarChart3 } from 'lucide-react'

const tabs = [
  { label: 'Overview', href: '/finances', icon: LayoutDashboard },
  { label: 'Scout Accounts', href: '/finances/accounts', icon: Users },
  { label: 'Reports', href: '/finances/reports', icon: BarChart3 },
]

export function FinanceSubnav() {
  const pathname = usePathname()

  // Determine active tab - handle nested routes
  const getIsActive = (href: string) => {
    if (href === '/finances') {
      return pathname === '/finances'
    }
    return pathname.startsWith(href)
  }

  return (
    <nav className="border-b border-stone-200">
      <div className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = getIsActive(tab.href)

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap border-b-3 px-4 py-3 text-sm font-semibold transition-colors',
                isActive
                  ? 'border-forest-600 text-stone-900'
                  : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-700'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/unit/components/finance-subnav.test.tsx`
Expected: PASS

**Step 5: Run full build**

Run: `npm run build`
Expected: Build succeeds (routes still exist, just not linked)

**Step 6: Commit**

```bash
git add src/components/finances/finance-subnav.tsx tests/unit/components/finance-subnav.test.tsx
git commit -m "feat: reduce FinanceSubnav from 7 tabs to 3 (Overview, Scout Accounts, Reports)"
```

---

## Phase 2: Update Scout Accounts Page

Integrate Collection functionality (overdue filter, bulk reminders) into the Scout Accounts page.

### Task 2.1: Add overdue filter and bulk reminder support to Scout Accounts

**Files:**
- Modify: `src/app/(dashboard)/finances/accounts/page.tsx`
- Modify: `src/components/finances/unified-scout-accounts-table.tsx` (add overdue filter if needed)

**Step 1: Read current accounts page**

Read: `src/app/(dashboard)/finances/accounts/page.tsx`

Understand how UnifiedAccountsView is used.

**Step 2: Add "Overdue Only" filter option**

In `unified-scout-accounts-table.tsx`, add an additional filter for overdue accounts:

```typescript
// Add to BalanceFilter type
type BalanceFilter = 'all' | 'owes' | 'overdue' | 'has-funds' | 'zero'

// Add filter button
<Button
  variant={balanceFilter === 'overdue' ? 'secondary' : 'ghost'}
  size="sm"
  onClick={() => setBalanceFilter('overdue')}
>
  Overdue (30+)
</Button>

// Add filter logic
if (balanceFilter === 'overdue') {
  // Filter for scouts with charges > 30 days old
  // This requires adding days_overdue to ScoutAccountRow
  if (!scout.daysOverdue || scout.daysOverdue < 30) {
    return false
  }
}
```

**Step 3: Add bulk reminders to BulkActionBar**

The `onSendReminders` callback in `UnifiedAccountsView` currently does nothing. Wire it to open `BulkReminderDialog`:

```typescript
import { BulkReminderDialog } from '@/components/collection/bulk-reminder-dialog'

// Add state
const [isReminderDialogOpen, setIsReminderDialogOpen] = useState(false)

// Wire up the action
<BulkActionBar
  ...
  onSendReminders={() => setIsReminderDialogOpen(true)}
/>

// Add dialog
<BulkReminderDialog
  isOpen={isReminderDialogOpen}
  onClose={() => setIsReminderDialogOpen(false)}
  selectedAccountIds={selectedIds}
  unitId={unitId}
  unitName={unitName}
/>
```

**Step 4: Verify manually**

Run: `npm run dev`
Test: Navigate to /finances/accounts, verify Overdue filter works

**Step 5: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/app/(dashboard)/finances/accounts/page.tsx src/components/finances/unified-scout-accounts-table.tsx src/components/finances/unified-accounts-view.tsx
git commit -m "feat: add overdue filter and bulk reminders to Scout Accounts page"
```

---

### Task 2.2: Fetch oldest charge date for overdue calculation

**Files:**
- Modify: `src/app/(dashboard)/finances/accounts/page.tsx`

**Step 1: Add query for oldest unpaid charges**

Update the server-side data fetching to include the oldest unpaid charge date per account:

```typescript
// Get oldest unpaid billing date for each account
const accountIds = accounts.map(a => a.id)

let oldestChargesByAccount: Record<string, string> = {}

if (accountIds.length > 0) {
  const { data: unpaidChargesData } = await supabase
    .from('billing_charges')
    .select(`
      scout_account_id,
      billing_records!inner (
        billing_date
      )
    `)
    .in('scout_account_id', accountIds)
    .eq('is_paid', false)
    .or('is_void.is.null,is_void.eq.false')
    .order('billing_records(billing_date)', { ascending: true })

  for (const charge of unpaidChargesData || []) {
    if (!oldestChargesByAccount[charge.scout_account_id]) {
      oldestChargesByAccount[charge.scout_account_id] = charge.billing_records.billing_date
    }
  }
}

// Calculate days overdue for each account
const today = new Date()
today.setHours(0, 0, 0, 0)

// Add daysOverdue to each account row
const accountsWithOverdue = accounts.map(account => {
  const oldestDate = oldestChargesByAccount[account.id]
  let daysOverdue = 0

  if (oldestDate) {
    const chargeDate = new Date(oldestDate)
    chargeDate.setHours(0, 0, 0, 0)
    daysOverdue = Math.floor((today.getTime() - chargeDate.getTime()) / (1000 * 60 * 60 * 24))
  }

  return { ...account, daysOverdue }
})
```

**Step 2: Update ScoutAccountRow interface**

Add `daysOverdue` to the interface:

```typescript
export interface ScoutAccountRow {
  // ... existing fields
  daysOverdue?: number
}
```

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/app/(dashboard)/finances/accounts/page.tsx src/components/finances/unified-scout-accounts-table.tsx
git commit -m "feat: add days overdue calculation to scout accounts for filtering"
```

---

## Phase 3: Update Overview Page

Add quick action dialogs instead of links, and integrate Collection metrics.

### Task 3.1: Add quick action dialogs to Overview

**Files:**
- Modify: `src/app/(dashboard)/finances/page.tsx`

**Step 1: Read current overview page**

Read the file to understand the current Quick Actions section.

**Step 2: Replace links with dialogs**

Currently the quick actions link to /finances/payments and /finances/billing.
Update to use dialogs with QuickPaymentDialog and BillingForm:

```typescript
'use client' // Convert to client component or use a client wrapper

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { QuickPaymentDialog } from '@/components/payments/quick-payment-dialog'
import { BillingForm } from '@/components/billing/billing-form'

// In Quick Actions section:
<Dialog>
  <DialogTrigger asChild>
    <Button className="gap-2">
      <CreditCard className="h-4 w-4" />
      Record Payment
    </Button>
  </DialogTrigger>
  <DialogContent className="max-w-xl">
    <DialogHeader>
      <DialogTitle>Record Payment</DialogTitle>
    </DialogHeader>
    <QuickPaymentDialog unitId={unitId} onSuccess={() => router.refresh()} />
  </DialogContent>
</Dialog>

<Dialog>
  <DialogTrigger asChild>
    <Button variant="accent" className="gap-2">
      <Receipt className="h-4 w-4" />
      Create Billing
    </Button>
  </DialogTrigger>
  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>Create Billing</DialogTitle>
    </DialogHeader>
    <BillingForm unitId={unitId} scouts={scouts} />
  </DialogContent>
</Dialog>
```

**Note:** This may require splitting the page into server + client components, or wrapping the Quick Actions in a client component.

**Step 3: Verify manually**

Run: `npm run dev`
Test: Navigate to /finances, verify dialogs open instead of navigating

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/app/(dashboard)/finances/page.tsx
git commit -m "feat: convert overview quick actions to dialogs"
```

---

### Task 3.2: Add Collection metrics to Overview

**Files:**
- Modify: `src/app/(dashboard)/finances/page.tsx`

**Step 1: Add 30+ and 60+ days overdue counts**

The Overview already shows "Overdue (31+ days)" amount. Add count of accounts:

```typescript
// Already calculated: overdueAmount

// Add counts
const accountsOver30Days = unpaidCharges.filter(charge => {
  const billingDate = new Date(charge.billing_records.billing_date)
  const daysOld = Math.floor((today.getTime() - billingDate.getTime()) / (1000 * 60 * 60 * 24))
  return daysOld >= 30
}).length // This counts charges, need to group by account

// Better: Calculate unique accounts with overdue charges
const overdueAccountIds = new Set<string>()
unpaidCharges.forEach(charge => {
  const billingDate = new Date(charge.billing_records.billing_date)
  const daysOld = Math.floor((today.getTime() - billingDate.getTime()) / (1000 * 60 * 60 * 24))
  if (daysOld >= 30) {
    overdueAccountIds.add(charge.scout_account_id)
  }
})
const overdueAccountCount = overdueAccountIds.size
```

**Step 2: Update card content**

```typescript
<CardContent>
  <p className="text-xs text-muted-foreground">
    {overdueAccountCount > 0
      ? `${overdueAccountCount} scout${overdueAccountCount !== 1 ? 's' : ''} need follow-up`
      : 'All current'}
  </p>
</CardContent>
```

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/app/(dashboard)/finances/page.tsx
git commit -m "feat: add overdue account count to overview metrics"
```

---

## Phase 4: Update Reports Page

Ensure Reports contains Transaction History (it already does from phase-0.5).

### Task 4.1: Verify Transaction History is in Reports

**Files:**
- Read: `src/app/(dashboard)/finances/reports/page.tsx`

**Step 1: Verify Transaction History section exists**

The Reports page already has a "Transaction History" section showing journal entries.

**Step 2: If not present, add it**

If the Transaction History section is missing, add it using the existing code pattern from the Transactions page.

**Step 3: No changes needed if already present**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit if changes made**

```bash
git add src/app/(dashboard)/finances/reports/page.tsx
git commit -m "feat: ensure Transaction History is in Reports page"
```

---

## Phase 5: Remove Deprecated Routes

Delete old billing, payments, collection, and transactions pages.

### Task 5.1: Delete /finances/billing route

**Files:**
- Delete: `src/app/(dashboard)/finances/billing/`

**Step 1: Delete the directory**

```bash
rm -rf src/app/(dashboard)/finances/billing
```

**Step 2: Run build to verify no broken imports**

Run: `npm run build`
Expected: Build succeeds (FinanceSubnav no longer links here)

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove /finances/billing route (absorbed into Scout Accounts)"
```

---

### Task 5.2: Delete /finances/payments route

**Files:**
- Delete: `src/app/(dashboard)/finances/payments/`

**Step 1: Delete the directory**

```bash
rm -rf src/app/(dashboard)/finances/payments
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove /finances/payments route (absorbed into Scout Accounts)"
```

---

### Task 5.3: Delete /finances/collection route

**Files:**
- Delete: `src/app/(dashboard)/finances/collection/`

**Step 1: Delete the directory**

```bash
rm -rf src/app/(dashboard)/finances/collection
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove /finances/collection route (absorbed into Scout Accounts)"
```

---

### Task 5.4: Delete /finances/transactions route

**Files:**
- Delete: `src/app/(dashboard)/finances/transactions/`

**Step 1: Delete the directory**

```bash
rm -rf src/app/(dashboard)/finances/transactions
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove /finances/transactions route (absorbed into Reports)"
```

---

### Task 5.5: Clean up any legacy flat routes

**Files:**
- Check and delete if exist: `src/app/(dashboard)/billing/`
- Check and delete if exist: `src/app/(dashboard)/payments/`
- Check and delete if exist: `src/app/(dashboard)/accounts/`
- Check and delete if exist: `src/app/(dashboard)/reports/`

**Step 1: Check if legacy routes exist**

```bash
ls src/app/(dashboard)/billing 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
ls src/app/(dashboard)/payments 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
ls src/app/(dashboard)/accounts 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
ls src/app/(dashboard)/reports 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

**Step 2: Delete any that exist**

```bash
rm -rf src/app/(dashboard)/billing 2>/dev/null
rm -rf src/app/(dashboard)/payments 2>/dev/null
rm -rf src/app/(dashboard)/accounts 2>/dev/null
rm -rf src/app/(dashboard)/reports 2>/dev/null
```

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit if changes made**

```bash
git add -A
git commit -m "chore: remove legacy flat routes"
```

---

## Phase 6: Final Verification

### Task 6.1: Full test suite and manual verification

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Manual verification checklist**

Run: `npm run dev`

Test each scenario:
- [ ] Admin can access /finances (Overview tab)
- [ ] Admin sees exactly 3 tabs: Overview, Scout Accounts, Reports
- [ ] Quick actions on Overview open dialogs (not navigate)
- [ ] Scout Accounts table shows all scouts with balances
- [ ] Clicking a row opens side panel with contextual actions
- [ ] "Overdue (30+)" filter works in Scout Accounts
- [ ] Bulk selection + Send Reminders opens BulkReminderDialog
- [ ] Bill Selected opens billing dialog with scouts pre-selected
- [ ] Reports page shows all report sections including Transaction History
- [ ] Leader CANNOT access /finances (redirected)
- [ ] Parent can ONLY see Roster (no Dashboard, no Finances)
- [ ] Scout can ONLY see Roster (their profile)
- [ ] Old routes return 404: /finances/billing, /finances/payments, /finances/collection, /finances/transactions

**Step 4: Commit verification**

```bash
git add -A
git commit -m "test: verify finance UI consolidation complete"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| Phase 0 | 2 tasks | Verify access control |
| Phase 1 | 1 task | Update FinanceSubnav to 3 tabs |
| Phase 2 | 2 tasks | Enhance Scout Accounts with overdue/reminders |
| Phase 3 | 2 tasks | Update Overview with dialogs + metrics |
| Phase 4 | 1 task | Verify Transaction History in Reports |
| Phase 5 | 5 tasks | Remove deprecated routes |
| Phase 6 | 1 task | Final verification |

**Total: 14 tasks (~40 steps)**

### Changes from Original Plan

1. **Phase 1 (Build Components)** - REMOVED: All components already exist from phase-0.5
2. **Phase 2 (Update Subnav)** - Now Phase 1, simplified
3. **Phase 3 (Update Pages)** - Split into Phase 2 (Scout Accounts) + Phase 3 (Overview)
4. **Phase 4 (Remove Routes)** - Now Phase 5, added Collection and Transactions routes
5. **New Phase 4** - Verify Transaction History (simple check)

The phase-0.5 merge brought significant functionality:
- UnifiedAccountsView (table + panel + dialogs)
- Collection features (OverdueTable, BulkReminderDialog)
- Report components (5 different report types)
- Payment/Billing quick forms
- Plaid integration

This consolidation now focuses on navigation changes and wiring up existing components rather than building new ones.
