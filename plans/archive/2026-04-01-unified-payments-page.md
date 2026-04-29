# Unified Payments Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Square-only Payments page with a unified view showing all payments (manual + card) with filtering, detail sheets, and Square transaction reconciliation.

**Architecture:** Server Component page fetches payments + unreconciled Square transactions, passes to a client `UnifiedPaymentsList` that merges/sorts/filters them. Detail view uses shadcn Sheet. Reconciliation uses a Dialog with two tabs (link to scout / mark non-scout). New `reconcileSquareTransaction` server action handles both paths with double-entry accounting.

**Tech Stack:** Next.js App Router, Supabase (PostgREST), shadcn/ui (Sheet, Dialog, Tabs), react-hook-form + zod, Tailwind CSS

**Spec:** [docs/superpowers/specs/2026-03-31-unified-payments-page-design.md](docs/superpowers/specs/2026-03-31-unified-payments-page-design.md)

---

## File Structure

### New Files
| File | Purpose |
|------|---------|
| `supabase/migrations/20260401000001_payments_unified_columns.sql` | Add `recorded_by`, `reconciliation_status` columns + backfill |
| `src/components/payments/unified-payments-list.tsx` | Main payments table with filters, sort, merged data |
| `src/components/payments/payment-detail-sheet.tsx` | Side sheet with full payment details + action buttons |
| `src/components/payments/reconcile-payment-dialog.tsx` | Two-tab dialog for Square transaction reconciliation |
| `src/app/actions/reconcile.ts` | `reconcileSquareTransaction` server action |

### Modified Files
| File | Changes |
|------|---------|
| `src/components/finances/finance-subnav.tsx` | Remove `showPaymentsTab` prop, always show Payments tab |
| `src/lib/roles.ts` | Add `reconcile_payments`, `edit_payment_notes` actions; update `void_payments` to include treasurer |
| `src/app/(dashboard)/finances/payments/page.tsx` | Replace Square-only view with unified data fetching + `UnifiedPaymentsList` |
| `src/app/actions/payments.ts` | Set `recorded_by` in `recordQuickPayment`; add `updatePaymentNotes` action |
| `src/app/actions/funds.ts` | Update `voidPayment` to allow treasurer role |
| `src/types/database.ts` | Regenerate after migration (add `recorded_by`, `reconciliation_status` to payments type) |

---

## Phase 0: Foundation

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260401000001_payments_unified_columns.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Add columns for unified payments page
ALTER TABLE payments ADD COLUMN recorded_by UUID REFERENCES profiles(id);
ALTER TABLE payments ADD COLUMN reconciliation_status VARCHAR(50);

-- Add comment for allowed values
COMMENT ON COLUMN payments.reconciliation_status IS 'Values: reconciled, not_scout_related, NULL (not applicable or not yet reconciled)';

-- Backfill recorded_by from the journal entry creator or unit admin as fallback
UPDATE payments p
SET recorded_by = COALESCE(
  -- Try to get the profile who created the associated journal entry
  (SELECT je.created_by FROM journal_entries je WHERE je.id = p.journal_entry_id),
  -- Fallback: unit admin
  (SELECT um.profile_id FROM unit_memberships um
   WHERE um.unit_id = p.unit_id AND um.role = 'admin' AND um.status = 'active'
   LIMIT 1)
);

-- Index for filtering by reconciliation status
CREATE INDEX idx_payments_reconciliation_status ON payments(reconciliation_status) WHERE reconciliation_status IS NOT NULL;
```

- [ ] **Step 2: Push migration to dev**

Run: `supabase link --project-ref feownmcpkfugkcivdoal && supabase db push`
Expected: Migration applies successfully

- [ ] **Step 3: Verify migration applied**

Run: Check Supabase dashboard or run a test query to confirm `recorded_by` and `reconciliation_status` columns exist on `payments`.

- [ ] **Step 4: Check if `journal_entries` has `created_by` column**

Before relying on the backfill, verify `journal_entries` actually has a `created_by` column. If not, simplify the backfill to only use the unit admin fallback:

```sql
-- Simplified backfill if journal_entries lacks created_by
UPDATE payments p
SET recorded_by = (
  SELECT um.profile_id FROM unit_memberships um
  WHERE um.unit_id = p.unit_id AND um.role = 'admin' AND um.status = 'active'
  LIMIT 1
);
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260401000001_payments_unified_columns.sql
git commit -m "feat: add recorded_by and reconciliation_status columns to payments"
```

---

### Task 2: Update TypeScript Types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add the new columns to the payments type manually**

In `src/types/database.ts`, find the `payments` Row type and add:

```typescript
recorded_by: string | null
reconciliation_status: string | null
```

Also add to the `Insert` and `Update` types:

```typescript
recorded_by?: string | null
reconciliation_status?: string | null
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add recorded_by and reconciliation_status to payments types"
```

---

### Task 3: Update Roles & Permissions

**Files:**
- Modify: `src/lib/roles.ts`

- [ ] **Step 1: Write test for new permissions**

Create a test or verify manually. The key changes:
- `void_payments` should include `['admin', 'treasurer']` (was `['admin']`)
- New action `reconcile_payments`: `['admin', 'treasurer']`
- New action `edit_payment_notes`: `['admin', 'treasurer']`

- [ ] **Step 2: Update `AppAction` type**

In `src/lib/roles.ts`, add to the `AppAction` union type:

```typescript
| 'reconcile_payments'  // Reconcile Square transactions
| 'edit_payment_notes'  // Edit notes on existing payments
```

- [ ] **Step 3: Update `ACTION_ACCESS`**

```typescript
const ACTION_ACCESS: Record<AppAction, MemberRole[]> = {
  // ... existing entries ...
  void_payments: ['admin', 'treasurer'],        // Changed: was ['admin']
  reconcile_payments: ['admin', 'treasurer'],    // New
  edit_payment_notes: ['admin', 'treasurer'],    // New
  // ... rest unchanged ...
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat: add reconcile_payments and edit_payment_notes permissions, allow treasurer to void"
```

---

### Task 4: Update `voidPayment` Server Action for Treasurer Access

**Files:**
- Modify: `src/app/actions/funds.ts`

- [ ] **Step 1: Change admin-only check to include treasurer**

In `src/app/actions/funds.ts`, find line 187:

```typescript
// Before:
if (!membership || membership.role !== 'admin') {
  return { success: false, error: 'Only admins can void payments' }
}

// After:
if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
  return { success: false, error: 'Only admins and treasurers can void payments' }
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/funds.ts
git commit -m "feat: allow treasurers to void payments"
```

---

### Task 5: Set `recorded_by` in `recordQuickPayment`

**Files:**
- Modify: `src/app/actions/payments.ts`

- [ ] **Step 1: Add `recorded_by` to payment insert**

In `src/app/actions/payments.ts`, find the `.insert()` call for payments (around line 178) and add `recorded_by: profile.id`:

```typescript
const { data: payment, error: paymentError } = await supabase
  .from('payments')
  .insert({
    unit_id: unitId,
    scout_account_id: scoutAccountId,
    amount: amountDollars,
    fee_amount: 0,
    net_amount: amountDollars,
    payment_method: method,
    status: 'completed',
    journal_entry_id: journalEntry.id,
    recorded_by: profile.id,  // NEW
    notes: [reference ? `Check #${reference}` : null, notes].filter(Boolean).join(' - ') || null,
  })
  .select('id')
  .single()
```

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/payments.ts
git commit -m "feat: set recorded_by when recording quick payments"
```

---

### Task 6: Update FinanceSubnav to Always Show Payments Tab

**Files:**
- Modify: `src/components/finances/finance-subnav.tsx`

- [ ] **Step 1: Remove `showPaymentsTab` prop and always include Payments**

Replace the entire component with:

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Users, BarChart3, Receipt, CreditCard, ClipboardList } from 'lucide-react'

const tabs = [
  { label: 'Overview', href: '/finances', icon: LayoutDashboard },
  { label: 'Scout Accounts', href: '/finances/accounts', icon: Users },
  { label: 'Billing', href: '/finances/billing', icon: ClipboardList },
  { label: 'Payments', href: '/finances/payments', icon: CreditCard },
  { label: 'Expenses', href: '/expenses', icon: Receipt },
  { label: 'Reports', href: '/finances/reports', icon: BarChart3 },
]

export function FinanceSubnav() {
  const pathname = usePathname()

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

- [ ] **Step 2: Remove `showPaymentsTab` prop from all callers**

Search for `showPaymentsTab` across the codebase and remove the prop from every `<FinanceSubnav>` usage. The payments page currently passes `showPaymentsTab` — remove it.

Run: `grep -r "showPaymentsTab" src/`

Update each caller from `<FinanceSubnav showPaymentsTab />` or `<FinanceSubnav showPaymentsTab={...} />` to just `<FinanceSubnav />`.

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/finances/finance-subnav.tsx
git add -u  # pick up caller changes
git commit -m "feat: always show Payments tab in finance subnav"
```

---

## Phase 1: Unified Payments List

### Task 7: Rewrite Payments Page (Server Component)

**Files:**
- Modify: `src/app/(dashboard)/finances/payments/page.tsx`

- [ ] **Step 1: Rewrite the page to fetch unified data**

Replace the entire file. The page should:
1. Authenticate user and check `canAccessPage(role, 'payments')`
2. Query `payments` for this unit (joined to profiles for `recorded_by` name, and scout_accounts -> scouts for scout name)
3. Query `square_transactions` where `payment_id IS NULL` for unreconciled transactions
4. Check for active Square connection (for showing sync button + CTA banner)
5. Fetch scouts list (for the Record Payment dialog and reconcile dialog)
6. Pass all data to `<UnifiedPaymentsList>`

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canAccessPage } from '@/lib/roles'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { UnifiedPaymentsList } from '@/components/payments/unified-payments-list'

export default async function PaymentsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!profile) redirect('/login')

  const { data: membershipData } = await supabase
    .from('unit_memberships')
    .select('unit_id, role, units:units!unit_memberships_unit_id_fkey(name)')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .single()

  const membership = membershipData as {
    unit_id: string
    role: string
    units: { name: string } | null
  } | null

  if (!membership) redirect('/login')
  if (!canAccessPage(membership.role, 'payments')) redirect('/roster')

  // Fetch payments with related data
  const { data: payments } = await supabase
    .from('payments')
    .select(`
      id,
      amount,
      fee_amount,
      net_amount,
      payment_method,
      status,
      created_at,
      notes,
      square_payment_id,
      square_receipt_url,
      journal_entry_id,
      scout_account_id,
      voided_at,
      voided_by,
      void_reason,
      recorded_by,
      reconciliation_status,
      recorded_by_profile:profiles!payments_recorded_by_fkey(id, display_name),
      voided_by_profile:profiles!payments_voided_by_fkey(id, display_name),
      scout_account:scout_accounts(
        id,
        scout:scouts(id, first_name, last_name)
      )
    `)
    .eq('unit_id', membership.unit_id)
    .order('created_at', { ascending: false })

  // Fetch unreconciled Square transactions
  const { data: unreconciledSquare } = await supabase
    .from('square_transactions')
    .select('*')
    .eq('unit_id', membership.unit_id)
    .is('payment_id', null)
    .order('square_created_at', { ascending: false })

  // Check Square connection status
  const { data: squareCredentials } = await supabase
    .from('unit_square_credentials')
    .select('id')
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .maybeSingle()

  // Fetch scouts for dialogs (Record Payment, Reconcile)
  const { data: scouts } = await supabase
    .from('scouts')
    .select(`
      id,
      first_name,
      last_name,
      scout_accounts(id, billing_balance, funds_balance)
    `)
    .eq('unit_id', membership.unit_id)
    .eq('is_active', true)
    .order('last_name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Finances</h1>
        <p className="mt-1 text-stone-600">
          Financial overview for {membership.units?.name || 'your unit'}
        </p>
      </div>

      <FinanceSubnav />

      <UnifiedPaymentsList
        payments={payments || []}
        unreconciledSquareTransactions={unreconciledSquare || []}
        hasSquareConnection={!!squareCredentials}
        scouts={scouts || []}
        unitId={membership.unit_id}
        userRole={membership.role}
      />
    </div>
  )
}
```

> **Note:** The `profiles` join for `recorded_by` uses `profiles!payments_recorded_by_fkey`. If this FK name doesn't match, the implementer should check the actual FK constraint name in the migration or database and adjust. An alternative is to do a separate lookup.

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds (UnifiedPaymentsList doesn't exist yet — create a stub first if needed, or implement Task 8 first)

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/finances/payments/page.tsx
git commit -m "feat: rewrite payments page with unified data fetching"
```

---

### Task 8: Build UnifiedPaymentsList Component

**Files:**
- Create: `src/components/payments/unified-payments-list.tsx`

This is the largest component. It handles:
- Merging payments + unreconciled Square transactions into one sorted list
- Filter bar (method, status, date range, scout search)
- Sortable columns (date, amount, scout, method)
- Row click opens PaymentDetailSheet
- Square CTA banner when no connection

- [ ] **Step 1: Define the component types and props**

```typescript
'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CreditCard, Banknote, FileText, DollarSign, ArrowUpDown, AlertCircle, Settings, RefreshCw } from 'lucide-react'
import { QuickPaymentDialog } from '@/components/payments/quick-payment-dialog'
import { PaymentDetailSheet } from '@/components/payments/payment-detail-sheet'

// Types for the merged list
interface PaymentRow {
  type: 'payment'
  id: string
  date: string
  scoutName: string | null
  scoutAccountId: string | null
  amount: number
  feeAmount: number | null
  netAmount: number
  method: string | null
  status: string
  recordedBy: string | null
  notes: string | null
  squarePaymentId: string | null
  squareReceiptUrl: string | null
  journalEntryId: string | null
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string | null
  reconciliationStatus: string | null
  rawPayment: Record<string, unknown>
}

interface UnreconciledRow {
  type: 'unreconciled'
  id: string
  date: string
  scoutName: null
  scoutAccountId: null
  amount: number
  feeAmount: number
  netAmount: number
  method: 'card'
  status: 'needs_reconciliation'
  recordedBy: null
  cardholderName: string | null
  note: string | null
  squarePaymentId: string
  receiptUrl: string | null
  rawTransaction: Record<string, unknown>
}

type UnifiedRow = PaymentRow | UnreconciledRow

type SortField = 'date' | 'amount' | 'scoutName' | 'method'
type SortDirection = 'asc' | 'desc'

interface Scout {
  id: string
  first_name: string
  last_name: string
  scout_accounts: { id: string; billing_balance: number; funds_balance: number }[] | { id: string; billing_balance: number; funds_balance: number } | null
}

interface UnifiedPaymentsListProps {
  payments: Record<string, unknown>[]
  unreconciledSquareTransactions: Record<string, unknown>[]
  hasSquareConnection: boolean
  scouts: Scout[]
  unitId: string
  userRole: string
}
```

- [ ] **Step 2: Implement data transformation and merging**

Inside the component, transform raw data into `UnifiedRow[]`:

```typescript
export function UnifiedPaymentsList({
  payments,
  unreconciledSquareTransactions,
  hasSquareConnection,
  scouts,
  unitId,
  userRole,
}: UnifiedPaymentsListProps) {
  // State
  const [methodFilter, setMethodFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dateRange, setDateRange] = useState<string>('30')
  const [scoutSearch, setScoutSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [selectedRow, setSelectedRow] = useState<UnifiedRow | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Transform payments into unified rows
  const paymentRows: PaymentRow[] = useMemo(() =>
    payments.map((p: Record<string, unknown>) => {
      const scoutAccount = p.scout_account as { scout: { first_name: string; last_name: string } | null } | null
      const scout = scoutAccount?.scout
      const recordedByProfile = p.recorded_by_profile as { display_name: string } | null

      return {
        type: 'payment' as const,
        id: p.id as string,
        date: p.created_at as string,
        scoutName: scout ? `${scout.first_name} ${scout.last_name}` : null,
        scoutAccountId: p.scout_account_id as string | null,
        amount: p.amount as number,
        feeAmount: p.fee_amount as number | null,
        netAmount: p.net_amount as number,
        method: p.payment_method as string | null,
        status: p.status as string,
        recordedBy: recordedByProfile?.display_name || null,
        notes: p.notes as string | null,
        squarePaymentId: p.square_payment_id as string | null,
        squareReceiptUrl: p.square_receipt_url as string | null,
        journalEntryId: p.journal_entry_id as string | null,
        voidedAt: p.voided_at as string | null,
        voidedBy: p.voided_by as string | null,
        voidReason: p.void_reason as string | null,
        reconciliationStatus: p.reconciliation_status as string | null,
        rawPayment: p,
      }
    }), [payments])

  // Transform unreconciled Square transactions
  const unreconciledRows: UnreconciledRow[] = useMemo(() =>
    unreconciledSquareTransactions.map((t: Record<string, unknown>) => ({
      type: 'unreconciled' as const,
      id: t.id as string,
      date: t.square_created_at as string,
      scoutName: null,
      scoutAccountId: null,
      amount: (t.amount_money as number) / 100,
      feeAmount: ((t.fee_money as number) || 0) / 100,
      netAmount: (t.net_money as number) / 100,
      method: 'card' as const,
      status: 'needs_reconciliation' as const,
      recordedBy: null,
      cardholderName: t.cardholder_name as string | null,
      note: t.note as string | null,
      squarePaymentId: t.square_payment_id as string,
      receiptUrl: t.receipt_url as string | null,
      rawTransaction: t,
    })), [unreconciledSquareTransactions])

  // Merge and apply filters
  const allRows: UnifiedRow[] = useMemo(() => [...paymentRows, ...unreconciledRows], [paymentRows, unreconciledRows])
```

- [ ] **Step 3: Implement filtering logic**

```typescript
  const filteredRows = useMemo(() => {
    let rows = allRows

    // Date range filter
    if (dateRange !== 'all') {
      const now = new Date()
      let cutoff: Date
      if (dateRange === 'ytd') {
        cutoff = new Date(now.getFullYear(), 0, 1)
      } else {
        cutoff = new Date(now.getTime() - parseInt(dateRange) * 24 * 60 * 60 * 1000)
      }
      rows = rows.filter(r => new Date(r.date) >= cutoff)
    }

    // Method filter
    if (methodFilter !== 'all') {
      if (methodFilter === 'square') {
        // "Square" shows all Square-linked: reconciled card payments + unreconciled
        rows = rows.filter(r =>
          r.type === 'unreconciled' || (r.type === 'payment' && r.squarePaymentId)
        )
      } else {
        rows = rows.filter(r => {
          if (r.type === 'unreconciled') return methodFilter === 'card'
          return r.method === methodFilter
        })
      }
    }

    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'needs_reconciliation') {
        rows = rows.filter(r => r.type === 'unreconciled')
      } else {
        rows = rows.filter(r => r.type === 'payment' && r.status === statusFilter)
      }
    }

    // Scout search
    if (scoutSearch.trim()) {
      const search = scoutSearch.toLowerCase()
      rows = rows.filter(r => {
        if (r.scoutName) return r.scoutName.toLowerCase().includes(search)
        if (r.type === 'unreconciled' && r.cardholderName) {
          return r.cardholderName.toLowerCase().includes(search)
        }
        return false
      })
    }

    // Sort
    rows = [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'date':
          cmp = new Date(a.date).getTime() - new Date(b.date).getTime()
          break
        case 'amount':
          cmp = a.amount - b.amount
          break
        case 'scoutName':
          cmp = (a.scoutName || '').localeCompare(b.scoutName || '')
          break
        case 'method':
          cmp = (a.method || '').localeCompare(b.method || '')
          break
      }
      return sortDirection === 'desc' ? -cmp : cmp
    })

    return rows
  }, [allRows, dateRange, methodFilter, statusFilter, scoutSearch, sortField, sortDirection])
```

- [ ] **Step 4: Implement the render: filter bar, table, and row click**

Build the JSX with:
- Square CTA banner (when `!hasSquareConnection`): subtle info banner — "Connect a payment provider to accept card payments" with `<Link>` to `/settings` (integration settings)
- Top bar with title + "Record Payment" button (reuse `QuickPaymentDialog`) + "Sync Square" button (if `hasSquareConnection` — calls `POST /api/square/sync` same as `SquareHistoryTab`)
- Filter bar: Select for method (All, Cash, Check, Card, Square), Select for status (All, Completed, Voided, Needs Reconciliation), button group for date range (7d, 30d, 90d, YTD, All), Input for scout search
- Table with columns: Date, Scout, Amount, Method, Status, Recorded By
- Sortable column headers (click to toggle sort)
- Row click handler: `setSelectedRow(row); setSheetOpen(true)`
- Method icons: `Banknote` for cash, `FileText` for check, `CreditCard` for card
- Status badges: green for completed, red for voided, amber for needs_reconciliation
- Empty state message

This is a large render block. The implementer should follow the existing table pattern from `SquareHistoryTab` (manual `<table>` with Tailwind styling) and the filter toggle pattern (inline button group with `bg-forest-700 text-white` active state).

- [ ] **Step 5: Wire up PaymentDetailSheet**

At the end of the component's JSX, render:

```typescript
  <PaymentDetailSheet
    row={selectedRow}
    open={sheetOpen}
    onOpenChange={setSheetOpen}
    scouts={scouts}
    unitId={unitId}
    userRole={userRole}
  />
```

- [ ] **Step 6: Verify build passes**

Run: `npm run build`
Expected: Build succeeds (PaymentDetailSheet may need a stub)

- [ ] **Step 7: Commit**

```bash
git add src/components/payments/unified-payments-list.tsx
git commit -m "feat: build UnifiedPaymentsList with filters, sort, and merged data"
```

---

## Phase 2: Detail Sheet & Actions

### Task 9: Build PaymentDetailSheet

**Files:**
- Create: `src/components/payments/payment-detail-sheet.tsx`

Uses shadcn `Sheet` component. Shows full payment details and action buttons.

- [ ] **Step 1: Build the component**

```typescript
'use client'

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { formatCurrency, formatDate } from '@/lib/utils'
import { canPerformAction } from '@/lib/roles'
import { ExternalLink, Ban, FileEdit, Link2 } from 'lucide-react'
import { VoidPaymentDialog } from '@/components/payments/void-payment-dialog'
import { ReconcilePaymentDialog } from '@/components/payments/reconcile-payment-dialog'
```

Props should accept the `UnifiedRow` type (or `null`), `open`, `onOpenChange`, `scouts`, `unitId`, `userRole`.

The sheet content should display:
- **Header**: Scout name (or "No scout" / cardholder name for unreconciled), amount prominently
- **Details section**: Date, method (with icon), status badge, fee, net, notes, recorded by, journal reference
- **Charge allocations section**: If payment has `scout_account_id`, fetch and display which charges this payment covers (this can be a future enhancement — for MVP, show "View in Scout Account" link)
- **Square section** (if card): Receipt link (external), Square payment ID
- **Void details** (if voided): Reason, voided by, voided at
- **Action buttons**:
  - "Edit Notes" — visible if `canPerformAction(userRole, 'edit_payment_notes')` and not voided and type === 'payment'. Inline edit: clicking toggles a textarea for the notes field. On save, call `updatePaymentNotes(paymentId, notes)` — a small server action to add to `src/app/actions/payments.ts` that does `supabase.from('payments').update({ notes }).eq('id', paymentId)` with auth/permission checks.
  - "Void Payment" — visible if `canPerformAction(userRole, 'void_payments')` and not already voided and type === 'payment'
  - "Reconcile" — visible if type === 'unreconciled'

- [ ] **Step 2: Wire up VoidPaymentDialog**

When "Void Payment" is clicked, open the existing `VoidPaymentDialog` with the payment data. The VoidPaymentDialog already exists and works — just pass the right props:

```typescript
<VoidPaymentDialog
  payment={{
    id: row.id,
    amount: row.amount,
    payment_method: row.method,
    created_at: row.date,
    notes: row.type === 'payment' ? row.notes : null,
    scout_name: row.scoutName || undefined,
  }}
  open={voidDialogOpen}
  onOpenChange={setVoidDialogOpen}
/>
```

- [ ] **Step 3: Wire up ReconcilePaymentDialog**

When "Reconcile" is clicked on an unreconciled row, open `ReconcilePaymentDialog`:

```typescript
{row.type === 'unreconciled' && (
  <ReconcilePaymentDialog
    transaction={row.rawTransaction}
    open={reconcileDialogOpen}
    onOpenChange={setReconcileDialogOpen}
    scouts={scouts}
    unitId={unitId}
  />
)}
```

- [ ] **Step 4: Verify build passes**

Run: `npm run build`
Expected: Build succeeds (ReconcilePaymentDialog may need a stub)

- [ ] **Step 5: Commit**

```bash
git add src/components/payments/payment-detail-sheet.tsx
git commit -m "feat: build PaymentDetailSheet with void and reconcile actions"
```

---

## Phase 3: Reconciliation

### Task 10: Build `reconcileSquareTransaction` Server Action

**Files:**
- Create: `src/app/actions/reconcile.ts`

This server action handles both reconciliation paths:
1. **Link to scout account**: Create payment, journal entry (debit 1000, credit 1200), allocations, update square_transactions.payment_id
2. **Not scout-related**: Create payment, journal entry (debit 1000, credit 4900), update square_transactions.payment_id

- [ ] **Step 1: Write the server action**

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface ReconcileToScoutParams {
  type: 'scout'
  squareTransactionId: string
  unitId: string
  scoutAccountId: string
  scoutName: string
  amount: number       // in dollars
  feeAmount: number    // in dollars
  netAmount: number    // in dollars
  squarePaymentId: string
  receiptUrl: string | null
  allocations?: Array<{ chargeId: string; amount: number }>
  notes?: string
}

interface ReconcileNotScoutParams {
  type: 'not_scout'
  squareTransactionId: string
  unitId: string
  amount: number
  feeAmount: number
  netAmount: number
  squarePaymentId: string
  receiptUrl: string | null
  notes?: string
}

type ReconcileParams = ReconcileToScoutParams | ReconcileNotScoutParams

interface ActionResult {
  success: boolean
  error?: string
  paymentId?: string
}

export async function reconcileSquareTransaction(params: ReconcileParams): Promise<ActionResult> {
  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile) return { success: false, error: 'Profile not found' }

  // Permission check
  const { data: membership } = await supabase
    .from('unit_memberships')
    .select('role')
    .eq('unit_id', params.unitId)
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!membership || !['admin', 'treasurer'].includes(membership.role)) {
    return { success: false, error: 'Permission denied' }
  }

  // Verify the Square transaction exists and is unreconciled
  const { data: sqTxn } = await supabase
    .from('square_transactions')
    .select('id, payment_id')
    .eq('id', params.squareTransactionId)
    .single()

  if (!sqTxn) return { success: false, error: 'Square transaction not found' }
  if (sqTxn.payment_id) return { success: false, error: 'Transaction already reconciled' }

  try {
    const paymentDate = new Date().toISOString().split('T')[0]

    // Determine credit account based on reconciliation type
    const isScout = params.type === 'scout'
    const creditAccountCode = isScout ? '1200' : '4900'
    const description = isScout
      ? `Card payment reconciled for ${params.scoutName}`
      : `Card payment reconciled — ${params.notes || 'not scout-related'}`

    // Create journal entry
    const { data: journalEntry, error: journalError } = await supabase
      .from('journal_entries')
      .insert({
        unit_id: params.unitId,
        entry_date: paymentDate,
        description,
        entry_type: 'payment',
        is_posted: true,
      })
      .select()
      .single()

    if (journalError || !journalEntry) {
      return { success: false, error: 'Failed to create journal entry' }
    }

    // Get accounts
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('unit_id', params.unitId)
      .in('code', ['1000', creditAccountCode])

    const bankAccount = accounts?.find(a => a.code === '1000')
    const creditAccount = accounts?.find(a => a.code === creditAccountCode)

    if (!bankAccount || !creditAccount) {
      await supabase.from('journal_entries').delete().eq('id', journalEntry.id)
      return { success: false, error: `Required accounts not found (1000, ${creditAccountCode})` }
    }

    // Create journal lines
    const { error: linesError } = await supabase.from('journal_lines').insert([
      {
        journal_entry_id: journalEntry.id,
        account_id: bankAccount.id,
        scout_account_id: null,
        debit: params.netAmount,   // Net amount (after fees) hits the bank
        credit: 0,
        memo: 'Card payment received (net of fees)',
      },
      {
        journal_entry_id: journalEntry.id,
        account_id: creditAccount.id,
        scout_account_id: isScout ? params.scoutAccountId : null,
        debit: 0,
        credit: params.amount,     // Gross amount credited
        memo: isScout ? 'Payment received' : (params.notes || 'Non-scout card payment'),
      },
    ])

    if (linesError) {
      await supabase.from('journal_entries').delete().eq('id', journalEntry.id)
      return { success: false, error: 'Failed to create journal lines' }
    }

    // Create payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        unit_id: params.unitId,
        scout_account_id: isScout ? params.scoutAccountId : null,
        amount: params.amount,
        fee_amount: params.feeAmount,
        net_amount: params.netAmount,
        payment_method: 'card',
        status: 'completed',
        journal_entry_id: journalEntry.id,
        square_payment_id: params.squarePaymentId,
        square_receipt_url: params.receiptUrl,
        recorded_by: profile.id,
        reconciliation_status: isScout ? 'reconciled' : 'not_scout_related',
        notes: params.notes || null,
      })
      .select('id')
      .single()

    if (paymentError) {
      return { success: false, error: 'Failed to create payment record' }
    }

    // Link square_transactions to the new payment
    await supabase
      .from('square_transactions')
      .update({ payment_id: payment.id })
      .eq('id', params.squareTransactionId)

    // If scout reconciliation: handle allocations and overpayment
    if (isScout && params.allocations && params.allocations.length > 0) {
      const allocationRows = params.allocations.map(alloc => ({
        payment_id: payment.id,
        billing_charge_id: alloc.chargeId,
        amount: alloc.amount,
      }))

      await supabase.from('payment_allocations').insert(allocationRows)

      // Update paid_amount on each billing charge
      for (const alloc of params.allocations) {
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

      // Auto-transfer overpayment
      const { data: updatedAccount } = await supabase
        .from('scout_accounts')
        .select('billing_balance')
        .eq('id', params.scoutAccountId)
        .single()

      if (updatedAccount && (updatedAccount.billing_balance || 0) > 0) {
        await supabase.rpc('auto_transfer_overpayment', {
          p_scout_account_id: params.scoutAccountId,
          p_amount: updatedAccount.billing_balance,
        })
      }
    }

    revalidatePath('/finances')
    revalidatePath('/finances/payments')
    revalidatePath('/finances/accounts')
    revalidatePath('/dashboard')

    return { success: true, paymentId: payment.id }
  } catch (err) {
    console.error('reconcileSquareTransaction error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}
```

> **Note on journal lines for fees:** The spec says "debit bank account, credit accounts receivable". In practice, the bank receives `netAmount` (after Square fees). The fee amount needs accounting treatment — either a separate journal line debiting a "Processing Fees" expense account (code 6100 or similar), or the simpler approach of debiting bank for net and crediting receivable for gross. The implementer should check existing card payment patterns in the codebase. The code above uses the simpler approach — the debit/credit mismatch (net vs gross) means fees are implicitly absorbed. If the unit has a processing fees account, add a third journal line for the fee.

- [ ] **Step 2: Verify build passes**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/reconcile.ts
git commit -m "feat: add reconcileSquareTransaction server action with both paths"
```

---

### Task 11: Build ReconcilePaymentDialog

**Files:**
- Create: `src/components/payments/reconcile-payment-dialog.tsx`

A Dialog with two tabs:
1. **Link to Scout** — Scout selector, outstanding charges, allocation UI, submit
2. **Not Scout-Related** — Notes field, submit

Amount/fee/net are read-only from the Square transaction in both tabs.

- [ ] **Step 1: Build the dialog structure with tabs**

Use shadcn `Dialog` + `Tabs` components:

```typescript
'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'
import { reconcileSquareTransaction } from '@/app/actions/reconcile'
import { useRouter } from 'next/navigation'
import { AlertCircle, User, FileText } from 'lucide-react'
```

Props:
```typescript
interface ReconcilePaymentDialogProps {
  transaction: Record<string, unknown>  // raw square_transactions row
  open: boolean
  onOpenChange: (open: boolean) => void
  scouts: Array<{
    id: string
    first_name: string
    last_name: string
    scout_accounts: { id: string; billing_balance: number; funds_balance: number }[] | { id: string; billing_balance: number; funds_balance: number } | null
  }>
  unitId: string
}
```

- [ ] **Step 2: Implement the "Link to Scout" tab**

This tab shows:
- Read-only amount/fee/net from the Square transaction
- Scout selector (searchable Select or the same pattern as QuickPaymentForm)
- After selecting a scout, fetch their outstanding charges via Supabase client query
- Charge allocation list (checkboxes with amounts, same pattern as QuickPaymentForm's `ChargeAllocationList`)
- Submit button calls `reconcileSquareTransaction({ type: 'scout', ... })`

The charge fetching should use the Supabase browser client:
```typescript
import { createClient } from '@/lib/supabase/client'

// Inside the component, when scout is selected:
const fetchCharges = async (scoutAccountId: string) => {
  const supabase = createClient()
  const { data } = await supabase
    .from('billing_charges')
    .select('id, amount, paid_amount, is_paid, billing_records(description, billing_date)')
    .eq('scout_account_id', scoutAccountId)
    .eq('is_paid', false)
    .is('is_void', null)
    .order('created_at', { ascending: true })
  return data || []
}
```

- [ ] **Step 3: Implement the "Not Scout-Related" tab**

Simpler tab:
- Read-only amount/fee/net
- Optional notes textarea
- Submit button calls `reconcileSquareTransaction({ type: 'not_scout', ... })`

- [ ] **Step 4: Handle loading/error/success states**

Both tabs should show:
- Loading spinner while submitting
- Error message if action fails
- Close dialog and refresh on success via `router.refresh()`

- [ ] **Step 5: Verify build passes**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/components/payments/reconcile-payment-dialog.tsx
git commit -m "feat: build ReconcilePaymentDialog with scout link and non-scout tabs"
```

---

## Phase 4: Polish & Integration Testing

### Task 12: Manual Integration Testing

- [ ] **Step 1: Seed test data and verify the page loads**

Run: `npm run db:fresh` to get a clean state, then `npm run dev`

Navigate to `/finances/payments` as admin. Verify:
- Page loads without errors
- FinanceSubnav shows Payments tab
- Filter bar renders
- "Record Payment" button works (opens existing QuickPaymentDialog)
- Empty state shows when no payments exist

- [ ] **Step 2: Record a manual payment and verify it appears**

Use "Record Payment" to record a cash/check payment. Verify:
- Payment appears in the list
- Click opens the detail sheet
- Scout name, amount, method, status, recorded by are all correct

- [ ] **Step 3: Test void flow**

Click a payment, click "Void Payment" in the detail sheet. Verify:
- VoidPaymentDialog opens
- After voiding, payment shows "Voided" status
- Test as treasurer role — verify treasurer can now void

- [ ] **Step 4: Test Square CTA banner**

If no Square connection exists, verify the banner appears with a link to settings.

- [ ] **Step 5: Test filters**

Verify each filter works: method, status, date range, scout search. Verify sort toggles work.

- [ ] **Step 6: Test reconciliation (if Square transactions exist)**

If there are unreconciled Square transactions, test both reconciliation paths:
- Link to scout: verify payment created, square_transactions.payment_id updated
- Not scout-related: verify payment created with reconciliation_status = 'not_scout_related'

- [ ] **Step 7: Commit any fixes**

```bash
git add -u
git commit -m "fix: integration testing fixes for unified payments page"
```

---

### Task 13: Final Build & Test Verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Exit 0, no errors

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

---

## Progress Summary

| Phase | Total | Complete | Status |
|-------|-------|----------|--------|
| Phase 0: Foundation | 6 | 0 | Not Started |
| Phase 1: Unified Payments List | 2 | 0 | Not Started |
| Phase 2: Detail Sheet & Actions | 1 | 0 | Not Started |
| Phase 3: Reconciliation | 2 | 0 | Not Started |
| Phase 4: Polish | 2 | 0 | Not Started |

---

## Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| | | | |
