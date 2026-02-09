# Finance UI Consolidation Design

**Date:** 2026-02-09
**Status:** Approved
**Author:** Brainstorming session with Rich

## Problem Statement

The current finance section has grown broad with multiple tabs (Overview, Accounts, Billing, Payments, Reports) that create fragmentation. Scout financial data lives in multiple separate views, requiring too many clicks and causing confusion about where to perform actions. Volunteer treasurers need a simpler, more intuitive interface.

## Goals

1. Reduce navigation complexity from 5 finance tabs to 3
2. Consolidate scout financial data into a single unified view
3. Enable all treasurer actions from one place (individual and bulk)
4. Clarify role-based access across the application
5. Eliminate redundant routes and duplicate views

## Design

### Navigation Access by Role

| Role | Dashboard | Roster | Finances | Advancement | Settings |
|------|-----------|--------|----------|-------------|----------|
| Admin | Yes | Yes (all) | Yes (full) | Yes | Yes |
| Treasurer | Yes | Yes (all) | Yes (full) | Yes | Yes |
| Leader | Yes | Yes (all) | No | Yes | No |
| Parent | No | Yes (filtered*) | No | No | Profile only |
| Scout | No | Yes (filtered**) | No | No | Profile only |

*Parent filtered view: Their linked scouts + all adults linked to those scouts
**Scout filtered view: Their own profile only

### Finances Section Structure (Admin/Treasurer only)

**Before (5 tabs):**
```
Overview | Accounts | Billing | Payments | Reports
```

**After (3 tabs):**
```
Overview | Scout Accounts | Reports
```

#### Tab 1: Overview (Landing Page)

Financial health dashboard answering: "What's our overall financial state?"

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ FINANCES OVERVIEW                                           │
├─────────────────────────────────────────────────────────────┤
│ QUICK ACTIONS                                               │
│ [Create Billing]  [Record Payment]  [Send Reminders]        │
├─────────────────┬─────────────────┬─────────────────────────┤
│ TOTAL OWED      │ TOTAL FUNDS     │ BANK BALANCE            │
│ $2,450.00       │ $1,200.00       │ $8,542.31               │
│ 18 scouts       │ held for scouts │ (if Plaid connected)    │
├─────────────────┴─────────────────┴─────────────────────────┤
│                                                             │
│ RECENT PAYMENT ACTIVITY (last 7 days)                       │
│ ───────────────────────────────────────────────────────────│
│ $850 collected · 12 payments · 3 via Square                 │
│                                                             │
│ Feb 8   Square payment - Jones family      +$125.00         │
│ Feb 7   Check #1042 - Smith family         +$175.00         │
│ Feb 6   Cash - Williams family             +$50.00          │
│                                        View all in Reports →│
├─────────────────────────────────────────────────────────────┤
│ QUICK STATS                                                 │
│ ───────────────────────────────────────────────────────────│
│ • 5 scouts overdue (60+ days)          → View in Accounts   │
│ • $450 collected this month                                 │
│ • 85% collection rate                                       │
└─────────────────────────────────────────────────────────────┘
```

**Quick action behaviors:**
- Create Billing → opens billing modal (same as Scout Accounts)
- Record Payment → opens payment modal with scout selector
- Send Reminders → opens modal to send to all scouts with balances

**Conditional sections:**
- Bank Balance card only shows if Plaid is connected
- Square activity highlights only if Square is connected
- Quick stats link to filtered views in Scout Accounts

#### Tab 2: Scout Accounts (Unified Ledger)

Single view for all scout financial data and actions.

**Table columns (minimal, scannable):**

| ☐ | Scout Name | Patrol | Amount Owed | Funds Balance | Last Activity |
|---|------------|--------|-------------|---------------|---------------|
| ☐ | Smith, John | Eagle | -$125.00 | $45.00 | Jan 15, 2026 |
| ☐ | Jones, Sarah | Bear | $0.00 | $200.00 | Feb 1, 2026 |

**Table features:**
- Checkbox column for bulk selection
- Sortable columns (click headers)
- Search/filter bar above table (by name, patrol, balance state)
- Row click opens side panel (doesn't interfere with checkbox)
- Amount Owed shows red when negative (owes money)

**Above the table:**
- "Create Billing" button (always visible, opens modal with scout selector)
- Filter controls (patrol dropdown, balance state: All / Owes Money / Has Funds / Zero Balance)

**Bulk action bar (appears when scouts selected):**
```
3 scouts selected: [Bill Selected] [Add Funds] [Send Reminders] [Export] [Clear Selection]
```

**Bulk billing access (two options):**
1. Select scouts via checkboxes → click "Bill Selected"
2. Click "Create Billing" button → use modal's built-in scout selector

#### Side Panel (Scout Detail)

When a treasurer clicks a row, a panel slides in from the right (~400px wide). The main table remains visible but narrower.

**Panel layout:**
```
┌─────────────────────────────────────┐
│ ← Back                    [✕ Close] │
├─────────────────────────────────────┤
│ John Smith                          │
│ Eagle Patrol · Active               │
├─────────────────────────────────────┤
│ AMOUNT OWED         FUNDS BALANCE   │
│ -$125.00 (red)      $45.00          │
├─────────────────────────────────────┤
│ [Record Payment] [Use Funds to Pay] │
│ [Send Reminder]                     │
│ (contextual based on state)         │
├─────────────────────────────────────┤
│ Recent Transactions                 │
│ ─────────────────────────────────── │
│ Jan 15  Payment received    +$50.00 │
│ Jan 10  Camp fee charge    -$175.00 │
│ Jan 5   Fundraiser credit   +$45.00 │
│ Dec 20  Dues charge         -$45.00 │
│ Dec 1   Payment received    +$45.00 │
│                                     │
│ View Full History →                 │
│ (links to scout profile)            │
└─────────────────────────────────────┘
```

**Contextual actions logic:**

| Scout State | Buttons Shown |
|-------------|---------------|
| Owes money + has funds | Record Payment, Use Funds to Pay, Send Reminder |
| Owes money + no funds | Record Payment, Send Reminder |
| No balance + has funds | Add Funds, Use Funds |
| No balance + no funds | Record Payment, Add Funds |

**Note:** "Bill Scout" is NOT in the side panel. Billing is a bulk operation accessed via the main table (select scouts) or the "Create Billing" button.

**Action behavior:** Clicking an action button opens a compact form or modal. After completing the action, the panel refreshes to show updated balance and the new transaction.

#### Tab 3: Reports (Default: Journal)

Audit and analysis tools for reviewing historical data.

**Sub-tabs (Journal is default):**

| Sub-tab | Purpose |
|---------|---------|
| **Journal** | Full double-entry ledger, searchable/filterable by date, scout, type |
| **Aging Report** | Charges grouped by age (0-30, 31-60, 61+ days overdue) |
| **Collection Summary** | Collection rates, cash flow trends, patrol breakdowns |
| **Square History** | Complete Square transaction log (if connected) |

**Journal features:**
- Date range filter
- Scout filter (dropdown)
- Transaction type filter (payments, charges, fund adds, voids)
- Search by description
- Export to CSV

**Square History access:**
- Recent activity shown on Overview tab
- Full history available in Reports > Square History

### Scout Profile Financial Section

Full transaction history for a scout lives on their profile page (accessible to parents/scouts for their own scouts).

**Contents:**
- Current balance summary (Amount Owed, Funds Balance)
- Full transaction history (all time)
- Payment action (if they owe money and Square is connected)

### Routes to Remove

**Absorbed into Scout Accounts:**
- `/finances/billing` → bulk billing via "Create Billing" button or checkbox selection
- `/finances/payments` → side panel actions (Record Payment, Add Funds)

**Duplicate flat routes (legacy):**
- `/billing`
- `/payments`
- `/accounts`
- `/reports`

### Access Control Changes

**`src/lib/roles.ts` updates:**

```typescript
const PAGE_ACCESS: Record<AppPage, MemberRole[]> = {
  dashboard: ['admin', 'treasurer', 'leader'], // Remove parent, scout
  scouts: ['admin', 'treasurer', 'leader', 'parent', 'scout'], // Keep, but filtered
  finances: ['admin', 'treasurer'], // Remove leader, parent, scout
  advancement: ['admin', 'treasurer', 'leader'], // No change
}
```

**Sidebar updates:**
- Settings visible only to admin, treasurer (no change)
- Parent/Scout see: Roster (filtered), Profile
- Leader sees: Dashboard, Roster, Advancement (no Finances, no Settings)

## Implementation Notes

### Components to Create

1. **UnifiedScoutAccountsTable** - Main table with checkboxes, sorting, filtering
2. **ScoutDetailSidePanel** - Slide-in panel with balance, actions, transactions
3. **BulkActionBar** - Appears on selection with bulk action buttons
4. **FinanceOverviewDashboard** - Refactored overview with quick actions

### Components to Modify

1. **FinanceSubnav** - Reduce from 5 tabs to 3
2. **BillingForm** - Ensure it works as a modal from multiple entry points
3. **PaymentEntry** - Ensure it works in side panel context
4. **AccountsList** - May be replaced or heavily refactored

### Components to Remove/Deprecate

1. Individual page components for `/finances/billing`, `/finances/payments`
2. Legacy flat route pages (`/billing`, `/payments`, `/accounts`, `/reports`)

### Migration Strategy

1. Build new unified components alongside existing ones
2. Update FinanceSubnav to use new structure
3. Update role access controls
4. Remove deprecated routes
5. Clean up unused components

## Success Criteria

1. Treasurer can perform all financial tasks without leaving Scout Accounts tab
2. Navigation reduced from 5 finance tabs to 3
3. No duplicate routes exist
4. Role access is correctly enforced (leaders can't see finances, parents see filtered roster)
5. Parent/Scout experience is simplified to profile-centric views
