# Scout Accounts UX Enhancements

## Overview

Enhance the Scout Accounts experience based on user feedback:
1. Add paginated transaction history to scout profiles and account views
2. Replace flyout panel with inline table actions
3. Improve table styling to match Roster patterns
4. Add sortable columns

## Phase 1: Transaction History Pagination

### 1.1 Create Paginated Transaction History Component

**File:** `src/components/finances/paginated-transaction-history.tsx`

Reusable component for displaying paginated transaction history:
- Server component that accepts `scoutAccountId` and pagination params
- Uses URL search params for page state (`?txPage=2`)
- 20 transactions per page
- Shows date, description, amount, running balance
- Follows existing `TransactionList` pagination pattern

### 1.2 Add Full History to Scout Profile

**File:** `src/app/(dashboard)/scouts/[id]/page.tsx`

Modify scout profile to include paginated transaction history:
- Add "Transaction History" section below existing content
- Query transactions with pagination
- Only show for scouts the user has permission to view

### 1.3 Add Full History to Scout Account Detail

**File:** `src/app/(dashboard)/finances/accounts/[id]/page.tsx`

Create dedicated account detail page:
- Full transaction history with pagination
- Account summary (billing balance, funds balance)
- Quick actions (Record Payment, Create Billing, Send Reminder, Use Funds)
- Breadcrumb navigation back to accounts list

## Phase 2: Replace Flyout with Inline Actions

### 2.1 Add Row Actions Dropdown

**File:** `src/components/finances/unified-scout-accounts-table.tsx`

Replace flyout panel click behavior with dropdown menu:
- Add `MoreHorizontal` action column to table
- Dropdown contains: Record Payment, Create Billing, Use Funds, Send Reminder, View History
- Actions open dialogs directly (no intermediate flyout)
- Row click navigates to account detail page (not flyout)

### 2.2 Create Action Dialogs Container

**File:** `src/components/finances/scout-account-actions.tsx`

Centralized action handling component:
- Contains dialog state for all actions
- `RecordPaymentDialog` - opens QuickPaymentForm pre-filled for scout
- `CreateBillingDialog` - opens BillingForm pre-filled for scout
- `UseFundsDialog` - transfer funds to billing balance
- `SendReminderDialog` - send payment reminder

### 2.3 Remove Flyout Panel

**Files to modify:**
- `src/components/finances/unified-accounts-view.tsx` - remove side panel state
- `src/components/finances/scout-detail-side-panel.tsx` - delete file

## Phase 3: Table Styling Improvements

### 3.1 Improve Filter Controls

**File:** `src/components/finances/unified-scout-accounts-table.tsx`

Match Roster table styling:
- Use `StatusFilterButtons` component pattern for balance filters
- Use proper `Select` styling for patrol dropdown
- Add "Clear all" button when filters are active
- Show results count: "Showing 12 of 45 scouts"

### 3.2 Improve Table Header Styling

**File:** `src/components/finances/unified-scout-accounts-table.tsx`

- Add proper header row background: `bg-stone-50 dark:bg-stone-800/50`
- Improve header text styling with consistent font weight
- Add subtle bottom border to header row

### 3.3 Add Sortable Columns

**File:** `src/components/finances/unified-scout-accounts-table.tsx`

Add sorting capability:
- Sort by: Scout Name (default), Amount Owed, Funds Balance, Last Activity
- Click header to toggle sort direction
- Visual indicator (chevron) for sort direction
- Maintain sort state in component

## Implementation Tasks

### Phase 1: Transaction History (4 tasks)
- [ ] 1.1.1 Create `PaginatedTransactionHistory` server component
- [ ] 1.1.2 Add pagination query helper for transactions
- [ ] 1.2.1 Add transaction history section to scout profile
- [ ] 1.3.1 Create account detail page with full history

### Phase 2: Inline Actions (4 tasks)
- [ ] 2.1.1 Add actions column with dropdown menu to table
- [ ] 2.2.1 Create `ScoutAccountActions` component with dialogs
- [ ] 2.2.2 Wire up all action dialogs (payment, billing, funds, reminder)
- [ ] 2.3.1 Remove flyout panel and related code

### Phase 3: Table Styling (3 tasks)
- [ ] 3.1.1 Improve filter controls styling and add clear/count
- [ ] 3.2.1 Improve table header row styling
- [ ] 3.3.1 Add sortable columns with visual indicators

## Design Decisions

### Why Dropdown Menu Over Flyout
- **Fewer clicks**: Actions trigger immediately from dropdown
- **Consistent pattern**: Matches other tables in the app (Roster)
- **Mobile-friendly**: Dropdowns work better on small screens than slide panels
- **Discoverable**: MoreHorizontal icon is a recognized pattern

### Why URL-Based Pagination
- **Shareable**: Users can share links to specific pages
- **Back/forward**: Browser navigation works correctly
- **Server-side**: Better for large datasets, only loads needed data

### Table Improvements Priority
1. **Inline actions** - Biggest UX improvement, reduces clicks
2. **Sorting** - Essential for finding specific scouts
3. **Styling** - Visual polish for consistency

## Testing Plan

Each task requires:
1. Unit tests for new components
2. Manual verification of:
   - Pagination navigation works
   - Actions trigger correct dialogs
   - Sorting maintains data integrity
   - Filters work with sorting
   - Mobile responsiveness
