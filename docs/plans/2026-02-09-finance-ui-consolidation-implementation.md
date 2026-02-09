# Finance UI Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the finance section from 5 tabs to 3, consolidating all scout financial data and actions into a unified view.

**Architecture:** Build new unified components alongside existing ones, then swap navigation to use them. Delete deprecated routes and components last. All new components will be client components using React hooks for state management.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui components, Supabase, TypeScript

---

## Phase 0: Access Control Updates

Update role-based navigation to match new design. Leaders lose Finances access, parents/scouts lose Dashboard access.

### Task 0.1: Update PAGE_ACCESS in roles.ts

**Files:**
- Modify: `src/lib/roles.ts:40-49`
- Test: `tests/unit/roles.test.ts` (create if doesn't exist)

**Step 1: Write the failing test**

Create test file if it doesn't exist:

```typescript
// tests/unit/roles.test.ts
import { describe, it, expect } from 'vitest'
import { canAccessPage, getVisibleNavItems } from '@/lib/roles'

describe('canAccessPage', () => {
  describe('dashboard access', () => {
    it('allows admin to access dashboard', () => {
      expect(canAccessPage('admin', 'dashboard')).toBe(true)
    })
    it('allows treasurer to access dashboard', () => {
      expect(canAccessPage('treasurer', 'dashboard')).toBe(true)
    })
    it('allows leader to access dashboard', () => {
      expect(canAccessPage('leader', 'dashboard')).toBe(true)
    })
    it('denies parent access to dashboard', () => {
      expect(canAccessPage('parent', 'dashboard')).toBe(false)
    })
    it('denies scout access to dashboard', () => {
      expect(canAccessPage('scout', 'dashboard')).toBe(false)
    })
  })

  describe('finances access', () => {
    it('allows admin to access finances', () => {
      expect(canAccessPage('admin', 'finances')).toBe(true)
    })
    it('allows treasurer to access finances', () => {
      expect(canAccessPage('treasurer', 'finances')).toBe(true)
    })
    it('denies leader access to finances', () => {
      expect(canAccessPage('leader', 'finances')).toBe(false)
    })
    it('denies parent access to finances', () => {
      expect(canAccessPage('parent', 'finances')).toBe(false)
    })
    it('denies scout access to finances', () => {
      expect(canAccessPage('scout', 'finances')).toBe(false)
    })
  })

  describe('scouts/roster access', () => {
    it('allows all roles to access scouts', () => {
      expect(canAccessPage('admin', 'scouts')).toBe(true)
      expect(canAccessPage('treasurer', 'scouts')).toBe(true)
      expect(canAccessPage('leader', 'scouts')).toBe(true)
      expect(canAccessPage('parent', 'scouts')).toBe(true)
      expect(canAccessPage('scout', 'scouts')).toBe(true)
    })
  })
})

describe('getVisibleNavItems', () => {
  it('returns all nav items for admin', () => {
    const items = getVisibleNavItems('admin')
    expect(items.map(i => i.label)).toEqual(['Dashboard', 'Roster', 'Finances', 'Advancement'])
  })

  it('returns all nav items for treasurer', () => {
    const items = getVisibleNavItems('treasurer')
    expect(items.map(i => i.label)).toEqual(['Dashboard', 'Roster', 'Finances', 'Advancement'])
  })

  it('returns Dashboard, Roster, Advancement for leader (no Finances)', () => {
    const items = getVisibleNavItems('leader')
    expect(items.map(i => i.label)).toEqual(['Dashboard', 'Roster', 'Advancement'])
  })

  it('returns only Roster for parent', () => {
    const items = getVisibleNavItems('parent')
    expect(items.map(i => i.label)).toEqual(['Roster'])
  })

  it('returns only Roster for scout', () => {
    const items = getVisibleNavItems('scout')
    expect(items.map(i => i.label)).toEqual(['Roster'])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/unit/roles.test.ts`
Expected: FAIL - parent/scout still have dashboard access, leader still has finances access

**Step 3: Update PAGE_ACCESS**

```typescript
// src/lib/roles.ts - update PAGE_ACCESS (around line 40)
const PAGE_ACCESS: Record<AppPage, MemberRole[]> = {
  dashboard: ['admin', 'treasurer', 'leader'], // Removed parent, scout
  scouts: ['admin', 'treasurer', 'leader', 'parent', 'scout'], // No change - all can access (filtered)
  accounts: ['admin', 'treasurer', 'leader', 'parent', 'scout'], // Kept for now, will be removed later
  billing: ['admin', 'treasurer'],
  payments: ['admin', 'treasurer'],
  reports: ['admin', 'treasurer', 'leader'],
  finances: ['admin', 'treasurer'], // Removed leader, parent, scout
  advancement: ['admin', 'treasurer', 'leader'],
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/unit/roles.test.ts`
Expected: PASS

**Step 5: Run full test suite and build**

Run: `npm run build && npm test`
Expected: All tests pass, build succeeds

**Step 6: Commit**

```bash
git add src/lib/roles.ts tests/unit/roles.test.ts
git commit -m "feat: update role access - leaders no finances, parents/scouts no dashboard"
```

---

### Task 0.2: Update dashboard redirect for parents/scouts

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

**Step 1: Read current dashboard page**

Read the file to understand current structure.

**Step 2: Add role check and redirect**

At the top of the component, add redirect logic for parent/scout roles:

```typescript
// After getting currentRole from useUnit or server context
import { redirect } from 'next/navigation'
import { hasFilteredView } from '@/lib/roles'

// Inside the component, before rendering:
if (hasFilteredView(currentRole)) {
  redirect('/roster')
}
```

**Step 3: Verify manually**

Run: `npm run dev`
Test: Log in as parent user, verify redirect to /roster

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/app/(dashboard)/dashboard/page.tsx
git commit -m "feat: redirect parents/scouts from dashboard to roster"
```

---

### Task 0.3: Update finances redirect for unauthorized roles

**Files:**
- Modify: `src/app/(dashboard)/finances/page.tsx`
- Modify: `src/app/(dashboard)/finances/layout.tsx` (if exists)

**Step 1: Read current finances page**

Read the file to understand current redirect logic.

**Step 2: Update access check**

Ensure leaders, parents, and scouts are redirected away from /finances entirely:

```typescript
// At top of finances page or layout
import { redirect } from 'next/navigation'
import { canAccessPage } from '@/lib/roles'

// Inside component:
if (!canAccessPage(currentRole, 'finances')) {
  redirect('/roster')
}
```

**Step 3: Verify manually**

Run: `npm run dev`
Test: Log in as leader, verify redirect away from /finances

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/app/(dashboard)/finances/
git commit -m "feat: restrict finances access to admin/treasurer only"
```

---

## Phase 1: Build Unified Scout Accounts Components

Build the new components that will power the consolidated Scout Accounts tab.

### Task 1.1: Create BulkActionBar component

**Files:**
- Create: `src/components/finances/bulk-action-bar.tsx`
- Test: `tests/unit/components/bulk-action-bar.test.tsx`

**Step 1: Write the failing test**

```typescript
// tests/unit/components/bulk-action-bar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkActionBar } from '@/components/finances/bulk-action-bar'

describe('BulkActionBar', () => {
  const defaultProps = {
    selectedCount: 3,
    onBillSelected: vi.fn(),
    onAddFunds: vi.fn(),
    onSendReminders: vi.fn(),
    onExport: vi.fn(),
    onClearSelection: vi.fn(),
  }

  it('displays selected count', () => {
    render(<BulkActionBar {...defaultProps} />)
    expect(screen.getByText('3 scouts selected')).toBeInTheDocument()
  })

  it('renders all action buttons', () => {
    render(<BulkActionBar {...defaultProps} />)
    expect(screen.getByRole('button', { name: /bill selected/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add funds/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send reminders/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
  })

  it('calls onBillSelected when Bill Selected clicked', () => {
    render(<BulkActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /bill selected/i }))
    expect(defaultProps.onBillSelected).toHaveBeenCalled()
  })

  it('calls onClearSelection when Clear clicked', () => {
    render(<BulkActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(defaultProps.onClearSelection).toHaveBeenCalled()
  })

  it('is hidden when selectedCount is 0', () => {
    const { container } = render(<BulkActionBar {...defaultProps} selectedCount={0} />)
    expect(container.firstChild).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/unit/components/bulk-action-bar.test.tsx`
Expected: FAIL - module not found

**Step 3: Implement BulkActionBar**

```typescript
// src/components/finances/bulk-action-bar.tsx
'use client'

import { Button } from '@/components/ui/button'
import { Receipt, PiggyBank, Bell, Download, X } from 'lucide-react'

interface BulkActionBarProps {
  selectedCount: number
  onBillSelected: () => void
  onAddFunds: () => void
  onSendReminders: () => void
  onExport: () => void
  onClearSelection: () => void
}

export function BulkActionBar({
  selectedCount,
  onBillSelected,
  onAddFunds,
  onSendReminders,
  onExport,
  onClearSelection,
}: BulkActionBarProps) {
  if (selectedCount === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2">
      <span className="text-sm font-medium text-primary">
        {selectedCount} scout{selectedCount !== 1 ? 's' : ''} selected
      </span>
      <div className="ml-2 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBillSelected}>
          <Receipt className="mr-1.5 h-3.5 w-3.5" />
          Bill Selected
        </Button>
        <Button variant="outline" size="sm" onClick={onAddFunds}>
          <PiggyBank className="mr-1.5 h-3.5 w-3.5" />
          Add Funds
        </Button>
        <Button variant="outline" size="sm" onClick={onSendReminders}>
          <Bell className="mr-1.5 h-3.5 w-3.5" />
          Send Reminders
        </Button>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          <X className="mr-1.5 h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/unit/components/bulk-action-bar.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/finances/bulk-action-bar.tsx tests/unit/components/bulk-action-bar.test.tsx
git commit -m "feat: add BulkActionBar component for scout selection actions"
```

---

### Task 1.2: Create ScoutDetailSidePanel component

**Files:**
- Create: `src/components/finances/scout-detail-side-panel.tsx`
- Test: `tests/unit/components/scout-detail-side-panel.test.tsx`

**Step 1: Write the failing test**

```typescript
// tests/unit/components/scout-detail-side-panel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScoutDetailSidePanel } from '@/components/finances/scout-detail-side-panel'

const mockScout = {
  id: 'scout-1',
  scoutId: 'scout-1',
  scoutName: 'John Smith',
  patrolName: 'Eagle',
  isActive: true,
  billingBalance: -125.00,
  fundsBalance: 45.00,
  lastActivity: '2026-01-15',
  recentTransactions: [
    { id: '1', date: '2026-01-15', description: 'Payment received', amount: 50.00 },
    { id: '2', date: '2026-01-10', description: 'Camp fee charge', amount: -175.00 },
  ],
}

describe('ScoutDetailSidePanel', () => {
  const defaultProps = {
    scout: mockScout,
    isOpen: true,
    onClose: vi.fn(),
    onRecordPayment: vi.fn(),
    onUseFunds: vi.fn(),
    onAddFunds: vi.fn(),
    onSendReminder: vi.fn(),
  }

  it('displays scout name and patrol', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    expect(screen.getByText('John Smith')).toBeInTheDocument()
    expect(screen.getByText(/Eagle/)).toBeInTheDocument()
  })

  it('displays balances correctly', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    expect(screen.getByText('-$125.00')).toBeInTheDocument()
    expect(screen.getByText('$45.00')).toBeInTheDocument()
  })

  it('shows contextual actions for scout who owes money with funds', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    expect(screen.getByRole('button', { name: /record payment/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use funds/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send reminder/i })).toBeInTheDocument()
  })

  it('shows different actions for scout with zero balance and funds', () => {
    const noBalanceScout = { ...mockScout, billingBalance: 0 }
    render(<ScoutDetailSidePanel {...defaultProps} scout={noBalanceScout} />)
    expect(screen.getByRole('button', { name: /add funds/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use funds/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send reminder/i })).not.toBeInTheDocument()
  })

  it('calls onClose when close button clicked', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('displays recent transactions', () => {
    render(<ScoutDetailSidePanel {...defaultProps} />)
    expect(screen.getByText('Payment received')).toBeInTheDocument()
    expect(screen.getByText('Camp fee charge')).toBeInTheDocument()
  })

  it('is hidden when isOpen is false', () => {
    const { container } = render(<ScoutDetailSidePanel {...defaultProps} isOpen={false} />)
    // Panel should have transform or hidden class
    expect(container.querySelector('[data-state="closed"]')).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/unit/components/scout-detail-side-panel.test.tsx`
Expected: FAIL - module not found

**Step 3: Implement ScoutDetailSidePanel**

```typescript
// src/components/finances/scout-detail-side-panel.tsx
'use client'

import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { X, CreditCard, Wallet, PiggyBank, Bell, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface Transaction {
  id: string
  date: string
  description: string
  amount: number
}

interface ScoutData {
  id: string
  scoutId: string
  scoutName: string
  patrolName: string | null
  isActive: boolean
  billingBalance: number
  fundsBalance: number
  lastActivity: string | null
  recentTransactions: Transaction[]
}

interface ScoutDetailSidePanelProps {
  scout: ScoutData | null
  isOpen: boolean
  onClose: () => void
  onRecordPayment: (scoutId: string) => void
  onUseFunds: (scoutId: string) => void
  onAddFunds: (scoutId: string) => void
  onSendReminder: (scoutId: string) => void
}

export function ScoutDetailSidePanel({
  scout,
  isOpen,
  onClose,
  onRecordPayment,
  onUseFunds,
  onAddFunds,
  onSendReminder,
}: ScoutDetailSidePanelProps) {
  if (!scout) return null

  const owesBalance = scout.billingBalance < 0
  const hasFunds = scout.fundsBalance > 0

  // Determine which actions to show based on state
  const getActions = () => {
    if (owesBalance && hasFunds) {
      return ['recordPayment', 'useFunds', 'sendReminder'] as const
    }
    if (owesBalance && !hasFunds) {
      return ['recordPayment', 'sendReminder'] as const
    }
    if (!owesBalance && hasFunds) {
      return ['addFunds', 'useFunds'] as const
    }
    // No balance, no funds
    return ['recordPayment', 'addFunds'] as const
  }

  const actions = getActions()

  return (
    <div
      data-state={isOpen ? 'open' : 'closed'}
      className={cn(
        'fixed right-0 top-0 z-50 h-full w-[400px] transform border-l bg-background shadow-lg transition-transform duration-300',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <span className="text-sm text-muted-foreground">Scout Details</span>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close panel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scout Info */}
      <div className="border-b p-4">
        <h2 className="text-lg font-semibold">{scout.scoutName}</h2>
        <p className="text-sm text-muted-foreground">
          {scout.patrolName ? `${scout.patrolName} Patrol` : 'No patrol'} · {scout.isActive ? 'Active' : 'Inactive'}
        </p>
      </div>

      {/* Balance Summary */}
      <div className="grid grid-cols-2 gap-4 border-b p-4">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Amount Owed</p>
          <p className={cn('text-xl font-bold', owesBalance ? 'text-destructive' : 'text-foreground')}>
            {formatCurrency(scout.billingBalance)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Funds Balance</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(scout.fundsBalance)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 border-b p-4">
        {actions.includes('recordPayment') && (
          <Button variant="outline" size="sm" onClick={() => onRecordPayment(scout.scoutId)}>
            <CreditCard className="mr-1.5 h-3.5 w-3.5" />
            Record Payment
          </Button>
        )}
        {actions.includes('useFunds') && (
          <Button variant="outline" size="sm" onClick={() => onUseFunds(scout.scoutId)}>
            <Wallet className="mr-1.5 h-3.5 w-3.5" />
            Use Funds to Pay
          </Button>
        )}
        {actions.includes('addFunds') && (
          <Button variant="outline" size="sm" onClick={() => onAddFunds(scout.scoutId)}>
            <PiggyBank className="mr-1.5 h-3.5 w-3.5" />
            Add Funds
          </Button>
        )}
        {actions.includes('sendReminder') && (
          <Button variant="outline" size="sm" onClick={() => onSendReminder(scout.scoutId)}>
            <Bell className="mr-1.5 h-3.5 w-3.5" />
            Send Reminder
          </Button>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="p-4">
        <h3 className="mb-3 text-sm font-medium">Recent Transactions</h3>
        {scout.recentTransactions.length > 0 ? (
          <div className="space-y-2">
            {scout.recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-muted-foreground">
                    {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                  <p>{tx.description}</p>
                </div>
                <span className={cn('font-medium', tx.amount >= 0 ? 'text-green-600' : 'text-foreground')}>
                  {tx.amount >= 0 ? '+' : ''}
                  {formatCurrency(tx.amount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No recent transactions</p>
        )}

        <Link
          href={`/roster/scouts/${scout.scoutId}`}
          className="mt-4 flex items-center text-sm text-primary hover:underline"
        >
          View Full History
          <ExternalLink className="ml-1 h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/unit/components/scout-detail-side-panel.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/finances/scout-detail-side-panel.tsx tests/unit/components/scout-detail-side-panel.test.tsx
git commit -m "feat: add ScoutDetailSidePanel component for individual scout actions"
```

---

### Task 1.3: Create UnifiedScoutAccountsTable component

**Files:**
- Create: `src/components/finances/unified-scout-accounts-table.tsx`
- Test: `tests/unit/components/unified-scout-accounts-table.test.tsx`

**Step 1: Write the failing test**

```typescript
// tests/unit/components/unified-scout-accounts-table.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UnifiedScoutAccountsTable } from '@/components/finances/unified-scout-accounts-table'

const mockScouts = [
  {
    id: 'acc-1',
    scoutId: 'scout-1',
    scoutName: 'Smith, John',
    patrolName: 'Eagle',
    billingBalance: -125.00,
    fundsBalance: 45.00,
    lastActivity: '2026-01-15',
    isActive: true,
  },
  {
    id: 'acc-2',
    scoutId: 'scout-2',
    scoutName: 'Jones, Sarah',
    patrolName: 'Bear',
    billingBalance: 0,
    fundsBalance: 200.00,
    lastActivity: '2026-02-01',
    isActive: true,
  },
]

describe('UnifiedScoutAccountsTable', () => {
  const defaultProps = {
    scouts: mockScouts,
    patrols: ['Eagle', 'Bear'],
    onScoutSelect: vi.fn(),
    onSelectionChange: vi.fn(),
    selectedIds: [] as string[],
  }

  it('renders all scouts in the table', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    expect(screen.getByText('Smith, John')).toBeInTheDocument()
    expect(screen.getByText('Jones, Sarah')).toBeInTheDocument()
  })

  it('displays balance columns correctly', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    expect(screen.getByText('-$125.00')).toBeInTheDocument()
    expect(screen.getByText('$45.00')).toBeInTheDocument()
  })

  it('renders checkboxes for each row', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const checkboxes = screen.getAllByRole('checkbox')
    // Header checkbox + 2 row checkboxes
    expect(checkboxes.length).toBe(3)
  })

  it('calls onSelectionChange when checkbox clicked', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1]) // First row checkbox
    expect(defaultProps.onSelectionChange).toHaveBeenCalledWith(['acc-1'])
  })

  it('calls onScoutSelect when row clicked', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    fireEvent.click(screen.getByText('Smith, John'))
    expect(defaultProps.onScoutSelect).toHaveBeenCalledWith(mockScouts[0])
  })

  it('filters by search term', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText(/search/i)
    fireEvent.change(searchInput, { target: { value: 'Smith' } })
    expect(screen.getByText('Smith, John')).toBeInTheDocument()
    expect(screen.queryByText('Jones, Sarah')).not.toBeInTheDocument()
  })

  it('filters by balance state', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} />)
    const filterButton = screen.getByRole('button', { name: /owes money/i })
    fireEvent.click(filterButton)
    expect(screen.getByText('Smith, John')).toBeInTheDocument()
    expect(screen.queryByText('Jones, Sarah')).not.toBeInTheDocument()
  })

  it('shows selected state on rows', () => {
    render(<UnifiedScoutAccountsTable {...defaultProps} selectedIds={['acc-1']} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[1]).toBeChecked()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/unit/components/unified-scout-accounts-table.test.tsx`
Expected: FAIL - module not found

**Step 3: Implement UnifiedScoutAccountsTable**

```typescript
// src/components/finances/unified-scout-accounts-table.tsx
'use client'

import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'

export interface ScoutAccountRow {
  id: string
  scoutId: string
  scoutName: string
  patrolName: string | null
  billingBalance: number
  fundsBalance: number
  lastActivity: string | null
  isActive: boolean
}

type BalanceFilter = 'all' | 'owes' | 'has-funds' | 'zero'

interface UnifiedScoutAccountsTableProps {
  scouts: ScoutAccountRow[]
  patrols: string[]
  selectedIds: string[]
  onScoutSelect: (scout: ScoutAccountRow) => void
  onSelectionChange: (ids: string[]) => void
}

export function UnifiedScoutAccountsTable({
  scouts,
  patrols,
  selectedIds,
  onScoutSelect,
  onSelectionChange,
}: UnifiedScoutAccountsTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [patrolFilter, setPatrolFilter] = useState<string>('all')
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all')

  const filteredScouts = useMemo(() => {
    return scouts.filter((scout) => {
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase()
        if (!scout.scoutName.toLowerCase().includes(search)) {
          return false
        }
      }

      // Patrol filter
      if (patrolFilter !== 'all' && scout.patrolName !== patrolFilter) {
        return false
      }

      // Balance filter
      if (balanceFilter === 'owes' && scout.billingBalance >= 0) {
        return false
      }
      if (balanceFilter === 'has-funds' && scout.fundsBalance <= 0) {
        return false
      }
      if (balanceFilter === 'zero' && (scout.billingBalance !== 0 || scout.fundsBalance !== 0)) {
        return false
      }

      return true
    })
  }, [scouts, searchTerm, patrolFilter, balanceFilter])

  const allSelected = filteredScouts.length > 0 && filteredScouts.every((s) => selectedIds.includes(s.id))
  const someSelected = filteredScouts.some((s) => selectedIds.includes(s.id))

  const handleSelectAll = () => {
    if (allSelected) {
      onSelectionChange([])
    } else {
      onSelectionChange(filteredScouts.map((s) => s.id))
    }
  }

  const handleSelectOne = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((i) => i !== id))
    } else {
      onSelectionChange([...selectedIds, id])
    }
  }

  const handleRowClick = (scout: ScoutAccountRow, e: React.MouseEvent) => {
    // Don't trigger row click if clicking checkbox
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return
    }
    onScoutSelect(scout)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search scouts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={patrolFilter} onValueChange={setPatrolFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Patrols" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Patrols</SelectItem>
            {patrols.map((patrol) => (
              <SelectItem key={patrol} value={patrol}>
                {patrol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-1">
          <Button
            variant={balanceFilter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setBalanceFilter('all')}
          >
            All
          </Button>
          <Button
            variant={balanceFilter === 'owes' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setBalanceFilter('owes')}
          >
            Owes Money
          </Button>
          <Button
            variant={balanceFilter === 'has-funds' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setBalanceFilter('has-funds')}
          >
            Has Funds
          </Button>
          <Button
            variant={balanceFilter === 'zero' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setBalanceFilter('zero')}
          >
            Zero Balance
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Scout Name</TableHead>
              <TableHead>Patrol</TableHead>
              <TableHead className="text-right">Amount Owed</TableHead>
              <TableHead className="text-right">Funds Balance</TableHead>
              <TableHead>Last Activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredScouts.map((scout) => (
              <TableRow
                key={scout.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={(e) => handleRowClick(scout, e)}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.includes(scout.id)}
                    onCheckedChange={() => handleSelectOne(scout.id)}
                    aria-label={`Select ${scout.scoutName}`}
                  />
                </TableCell>
                <TableCell className="font-medium">{scout.scoutName}</TableCell>
                <TableCell>{scout.patrolName || '—'}</TableCell>
                <TableCell
                  className={cn('text-right', scout.billingBalance < 0 && 'text-destructive font-medium')}
                >
                  {formatCurrency(scout.billingBalance)}
                </TableCell>
                <TableCell className="text-right">{formatCurrency(scout.fundsBalance)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {scout.lastActivity
                    ? new Date(scout.lastActivity).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
            {filteredScouts.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No scouts found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/unit/components/unified-scout-accounts-table.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/finances/unified-scout-accounts-table.tsx tests/unit/components/unified-scout-accounts-table.test.tsx
git commit -m "feat: add UnifiedScoutAccountsTable component with filtering and selection"
```

---

## Phase 2: Update FinanceSubnav

Reduce navigation from 5 tabs to 3 tabs.

### Task 2.1: Update FinanceSubnav component

**Files:**
- Modify: `src/components/finances/finance-subnav.tsx`
- Test: `tests/unit/components/finance-subnav.test.tsx`

**Step 1: Write the failing test**

```typescript
// tests/unit/components/finance-subnav.test.tsx
import { describe, it, expect } from 'vitest'
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

  it('does not render Billing or Payments tabs', () => {
    render(<FinanceSubnav />)

    expect(screen.queryByRole('link', { name: /^billing$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^payments$/i })).not.toBeInTheDocument()
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
Expected: FAIL - still has 5 tabs

**Step 3: Read current FinanceSubnav implementation**

Read: `src/components/finances/finance-subnav.tsx`

**Step 4: Update FinanceSubnav to 3 tabs**

Update the tabs array to only include Overview, Scout Accounts, Reports:

```typescript
// src/components/finances/finance-subnav.tsx
// Update the tabs array (keep the component structure, just change tabs)

const tabs = [
  { href: '/finances', label: 'Overview', icon: LayoutDashboard },
  { href: '/finances/accounts', label: 'Scout Accounts', icon: Users },
  { href: '/finances/reports', label: 'Reports', icon: FileText },
]

// Remove any role-based tab filtering for Billing/Payments since they no longer exist
```

**Step 5: Run test to verify it passes**

Run: `npm test tests/unit/components/finance-subnav.test.tsx`
Expected: PASS

**Step 6: Run full build**

Run: `npm run build`
Expected: Build succeeds (may have route errors we'll fix next)

**Step 7: Commit**

```bash
git add src/components/finances/finance-subnav.tsx tests/unit/components/finance-subnav.test.tsx
git commit -m "feat: reduce FinanceSubnav from 5 tabs to 3 (Overview, Scout Accounts, Reports)"
```

---

## Phase 3: Update Finance Pages

Update the page components to use the new consolidated structure.

### Task 3.1: Update Overview page with quick actions

**Files:**
- Modify: `src/app/(dashboard)/finances/page.tsx`

**Step 1: Read current overview page**

Read: `src/app/(dashboard)/finances/page.tsx`

**Step 2: Add Quick Actions section**

Add three quick action buttons at the top:
- Create Billing (opens BillingForm in a dialog)
- Record Payment (opens PaymentEntry in a dialog)
- Send Reminders (opens reminder dialog)

Import required components and add the UI:

```typescript
// Add to imports
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { BillingForm } from '@/components/billing/billing-form'
import { PaymentEntryLazy } from '@/components/payments/payment-entry-lazy'
import { Receipt, CreditCard, Bell } from 'lucide-react'

// Add Quick Actions section after FinanceSubnav, before summary cards:
<div className="mb-6">
  <h2 className="text-sm font-medium text-muted-foreground mb-2">Quick Actions</h2>
  <div className="flex gap-3">
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Receipt className="mr-2 h-4 w-4" />
          Create Billing
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Billing</DialogTitle>
        </DialogHeader>
        <BillingForm scouts={scouts} onSuccess={() => router.refresh()} />
      </DialogContent>
    </Dialog>

    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CreditCard className="mr-2 h-4 w-4" />
          Record Payment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <PaymentEntryLazy scouts={scouts} onSuccess={() => router.refresh()} />
      </DialogContent>
    </Dialog>

    <Button variant="outline">
      <Bell className="mr-2 h-4 w-4" />
      Send Reminders
    </Button>
  </div>
</div>
```

**Step 3: Verify manually**

Run: `npm run dev`
Test: Navigate to /finances, verify quick action buttons appear

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/app/(dashboard)/finances/page.tsx
git commit -m "feat: add quick actions to finance overview page"
```

---

### Task 3.2: Replace Scout Accounts page with unified view

**Files:**
- Modify: `src/app/(dashboard)/finances/accounts/page.tsx`

**Step 1: Read current accounts page**

Read: `src/app/(dashboard)/finances/accounts/page.tsx`

**Step 2: Rewrite to use new unified components**

Replace the page content to use:
- UnifiedScoutAccountsTable
- BulkActionBar
- ScoutDetailSidePanel
- Create Billing button + dialog

```typescript
// src/app/(dashboard)/finances/accounts/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUnit } from '@/components/providers/unit-context'
import { FinanceSubnav } from '@/components/finances/finance-subnav'
import { UnifiedScoutAccountsTable, ScoutAccountRow } from '@/components/finances/unified-scout-accounts-table'
import { BulkActionBar } from '@/components/finances/bulk-action-bar'
import { ScoutDetailSidePanel } from '@/components/finances/scout-detail-side-panel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { BillingForm } from '@/components/billing/billing-form'
import { PaymentModal } from '@/components/accounts/payment-modal'
import { AddFundsModal } from '@/components/accounts/add-funds-modal'
import { UseFundsModal } from '@/components/accounts/use-funds-modal'
import { SendPaymentRequestModal } from '@/components/accounts/send-payment-request-modal'
import { Receipt, Plus } from 'lucide-react'

export default function ScoutAccountsPage() {
  const router = useRouter()
  const { currentUnit } = useUnit()
  const [scouts, setScouts] = useState<ScoutAccountRow[]>([])
  const [patrols, setPatrols] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedScout, setSelectedScout] = useState<ScoutAccountRow | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [isBillingOpen, setIsBillingOpen] = useState(false)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isAddFundsOpen, setIsAddFundsOpen] = useState(false)
  const [isUseFundsOpen, setIsUseFundsOpen] = useState(false)
  const [isReminderOpen, setIsReminderOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUnit?.id) return

    async function fetchData() {
      const supabase = createClient()

      // Fetch scout accounts with scout info
      const { data: accounts } = await supabase
        .from('scout_accounts')
        .select(`
          id,
          billing_balance,
          funds_balance,
          updated_at,
          scout:scouts(
            id,
            first_name,
            last_name,
            is_active,
            patrol:patrols(name)
          )
        `)
        .eq('unit_id', currentUnit.id)

      if (accounts) {
        const formattedScouts: ScoutAccountRow[] = accounts.map((acc) => ({
          id: acc.id,
          scoutId: acc.scout.id,
          scoutName: `${acc.scout.last_name}, ${acc.scout.first_name}`,
          patrolName: acc.scout.patrol?.name || null,
          billingBalance: acc.billing_balance,
          fundsBalance: acc.funds_balance,
          lastActivity: acc.updated_at,
          isActive: acc.scout.is_active,
        }))
        setScouts(formattedScouts)

        // Extract unique patrols
        const uniquePatrols = [...new Set(formattedScouts.map((s) => s.patrolName).filter(Boolean))] as string[]
        setPatrols(uniquePatrols)
      }

      setLoading(false)
    }

    fetchData()
  }, [currentUnit?.id])

  const handleScoutSelect = (scout: ScoutAccountRow) => {
    setSelectedScout(scout)
    setIsPanelOpen(true)
  }

  const handleClosePanel = () => {
    setIsPanelOpen(false)
    setSelectedScout(null)
  }

  const handleBillSelected = () => {
    setIsBillingOpen(true)
  }

  const handleSuccess = () => {
    router.refresh()
    setIsBillingOpen(false)
    setIsPaymentOpen(false)
    setIsAddFundsOpen(false)
    setIsUseFundsOpen(false)
    setIsReminderOpen(false)
    setSelectedIds([])
  }

  // Get scouts for billing form
  const scoutsForBilling = scouts.map((s) => ({
    id: s.scoutId,
    first_name: s.scoutName.split(', ')[1],
    last_name: s.scoutName.split(', ')[0],
    patrol: s.patrolName ? { name: s.patrolName } : null,
  }))

  // Pre-select scouts if any are selected
  const preSelectedScoutIds = selectedIds.map((id) => scouts.find((s) => s.id === id)?.scoutId).filter(Boolean) as string[]

  if (loading) {
    return <div className="p-6">Loading...</div>
  }

  return (
    <div className="flex flex-col">
      <FinanceSubnav />

      <div className="p-6 space-y-4">
        {/* Header with Create Billing button */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Scout Accounts</h1>
          <Dialog open={isBillingOpen} onOpenChange={setIsBillingOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Billing
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Billing</DialogTitle>
              </DialogHeader>
              <BillingForm
                scouts={scoutsForBilling}
                preSelectedScoutIds={preSelectedScoutIds}
                onSuccess={handleSuccess}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* Bulk Action Bar */}
        <BulkActionBar
          selectedCount={selectedIds.length}
          onBillSelected={handleBillSelected}
          onAddFunds={() => setIsAddFundsOpen(true)}
          onSendReminders={() => setIsReminderOpen(true)}
          onExport={() => {/* TODO: implement export */}}
          onClearSelection={() => setSelectedIds([])}
        />

        {/* Table */}
        <UnifiedScoutAccountsTable
          scouts={scouts}
          patrols={patrols}
          selectedIds={selectedIds}
          onScoutSelect={handleScoutSelect}
          onSelectionChange={setSelectedIds}
        />
      </div>

      {/* Side Panel */}
      <ScoutDetailSidePanel
        scout={selectedScout ? {
          ...selectedScout,
          recentTransactions: [], // TODO: fetch transactions
        } : null}
        isOpen={isPanelOpen}
        onClose={handleClosePanel}
        onRecordPayment={() => setIsPaymentOpen(true)}
        onUseFunds={() => setIsUseFundsOpen(true)}
        onAddFunds={() => setIsAddFundsOpen(true)}
        onSendReminder={() => setIsReminderOpen(true)}
      />

      {/* Modals - reuse existing components */}
      {selectedScout && (
        <>
          <PaymentModal
            isOpen={isPaymentOpen}
            onClose={() => setIsPaymentOpen(false)}
            scoutAccountId={selectedScout.id}
            scoutName={selectedScout.scoutName}
            currentBalance={selectedScout.billingBalance}
            onSuccess={handleSuccess}
          />
          <AddFundsModal
            isOpen={isAddFundsOpen}
            onClose={() => setIsAddFundsOpen(false)}
            scoutAccountId={selectedScout.id}
            scoutName={selectedScout.scoutName}
            currentFunds={selectedScout.fundsBalance}
            onSuccess={handleSuccess}
          />
          <UseFundsModal
            isOpen={isUseFundsOpen}
            onClose={() => setIsUseFundsOpen(false)}
            scoutAccountId={selectedScout.id}
            scoutName={selectedScout.scoutName}
            billingBalance={selectedScout.billingBalance}
            fundsBalance={selectedScout.fundsBalance}
            onSuccess={handleSuccess}
          />
          <SendPaymentRequestModal
            isOpen={isReminderOpen}
            onClose={() => setIsReminderOpen(false)}
            scoutAccountId={selectedScout.id}
            scoutName={selectedScout.scoutName}
            currentBalance={selectedScout.billingBalance}
            onSuccess={handleSuccess}
          />
        </>
      )}
    </div>
  )
}
```

**Step 3: Verify manually**

Run: `npm run dev`
Test: Navigate to /finances/accounts, verify unified table renders with side panel

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/app/(dashboard)/finances/accounts/page.tsx
git commit -m "feat: replace Scout Accounts page with unified view and side panel"
```

---

### Task 3.3: Update Reports page - make Journal default

**Files:**
- Modify: `src/app/(dashboard)/finances/reports/page.tsx`

**Step 1: Read current reports page**

Read: `src/app/(dashboard)/finances/reports/page.tsx`

**Step 2: Reorganize tabs with Journal first**

Update the tabs order to be: Journal, Aging Report, Collection Summary, Square History

**Step 3: Verify manually**

Run: `npm run dev`
Test: Navigate to /finances/reports, verify Journal is the default tab

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/app/(dashboard)/finances/reports/page.tsx
git commit -m "feat: make Journal the default tab in Reports"
```

---

## Phase 4: Remove Deprecated Routes

Delete old billing/payments pages and legacy flat routes.

### Task 4.1: Delete /finances/billing page

**Files:**
- Delete: `src/app/(dashboard)/finances/billing/page.tsx`
- Delete: `src/app/(dashboard)/finances/billing/` directory

**Step 1: Delete the directory**

```bash
rm -rf src/app/(dashboard)/finances/billing
```

**Step 2: Run build to verify no broken imports**

Run: `npm run build`
Expected: Build succeeds (no imports reference this page)

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated /finances/billing route (absorbed into Scout Accounts)"
```

---

### Task 4.2: Delete /finances/payments page

**Files:**
- Delete: `src/app/(dashboard)/finances/payments/page.tsx`
- Delete: `src/app/(dashboard)/finances/payments/` directory

**Step 1: Delete the directory**

```bash
rm -rf src/app/(dashboard)/finances/payments
```

**Step 2: Run build to verify no broken imports**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated /finances/payments route (absorbed into Scout Accounts)"
```

---

### Task 4.3: Delete legacy flat routes

**Files:**
- Delete: `src/app/(dashboard)/billing/`
- Delete: `src/app/(dashboard)/payments/`
- Delete: `src/app/(dashboard)/accounts/`
- Delete: `src/app/(dashboard)/reports/`

**Step 1: Delete all legacy directories**

```bash
rm -rf src/app/(dashboard)/billing
rm -rf src/app/(dashboard)/payments
rm -rf src/app/(dashboard)/accounts
rm -rf src/app/(dashboard)/reports
```

**Step 2: Run build to verify no broken imports**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove all legacy flat routes (/billing, /payments, /accounts, /reports)"
```

---

## Phase 5: Final Verification

### Task 5.1: Full test suite and manual verification

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
- [ ] Admin sees 3 tabs: Overview, Scout Accounts, Reports
- [ ] Quick actions on Overview work (Create Billing, Record Payment)
- [ ] Scout Accounts table shows all scouts with balances
- [ ] Clicking a row opens side panel with contextual actions
- [ ] Bulk selection shows action bar
- [ ] Bill Selected opens billing dialog with scouts pre-selected
- [ ] Reports defaults to Journal tab
- [ ] Leader CANNOT access /finances (redirected)
- [ ] Parent can ONLY see Roster (no Dashboard, no Finances)
- [ ] Scout can ONLY see Roster (their profile)
- [ ] Old routes (/billing, /payments, /accounts, /reports) return 404

**Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "test: verify finance UI consolidation complete"
```

---

## Summary

| Phase | Tasks | Estimated Steps |
|-------|-------|-----------------|
| Phase 0: Access Control | 3 tasks | ~15 steps |
| Phase 1: Build Components | 3 tasks | ~15 steps |
| Phase 2: Update Subnav | 1 task | ~7 steps |
| Phase 3: Update Pages | 3 tasks | ~15 steps |
| Phase 4: Remove Routes | 3 tasks | ~9 steps |
| Phase 5: Verification | 1 task | ~4 steps |

**Total: 14 tasks, ~65 steps**

Each step is designed to be completable in 2-5 minutes following TDD practices.
