# Expense Reimbursement UI Updates

## Overview

Improve the expense reimbursement user experience by adding proper navigation, quick actions, and role-appropriate access points throughout the application.

## Requirements

### User Value
- **All users** can easily submit expense reimbursement requests
- **Submitters** can track the status of their submissions
- **Treasurers** can efficiently review and manage expenses within the Finances section

### Scope

**In Scope:**
- Dashboard: "Submit Expense" quick action + "My Open Expenses" section
- Profile page: "Expenses" tab showing full submission history
- Finances section: "Expenses" tab for treasurer review/approval workflow
- Navigation updates to make expenses discoverable

**Out of Scope:**
- Email notifications for expense status changes
- Batch approval operations
- Expense reporting/analytics

### Success Criteria
1. Any unit member can submit an expense from the dashboard (or roster for parents/scouts)
2. Users can view all their expense submissions (including history) on their profile
3. Treasurers can review and manage all unit expenses from the Finances section
4. Clear status visibility throughout the workflow

## Technical Design

### Current State
- Expenses page exists at `/expenses` but is not in navigation
- Parents/scouts redirect from dashboard to `/roster`
- No expense tracking on profile page
- No expense tab in Finances section

### Target State
1. **Dashboard** (management roles): Quick action button + open expenses card
2. **Roster** (parents/scouts): Add expense submission link since they don't see dashboard
3. **Profile** (all roles): Expenses tab showing user's submission history
4. **Finances** (treasurers): Expenses tab in subnav for review/approval

### Key Files to Modify
| File | Change |
|------|--------|
| `src/app/(dashboard)/dashboard/page.tsx` | Add quick action + open expenses card |
| `src/app/(dashboard)/roster/page.tsx` | Add expense submission link for parents/scouts |
| `src/app/(dashboard)/profile/page.tsx` | Add Expenses tab |
| `src/components/finances/finance-subnav.tsx` | Add Expenses tab |
| `src/lib/roles.ts` | Add 'expenses' to PAGE_ACCESS |

### New Components to Create
| Component | Purpose |
|-----------|---------|
| `src/components/dashboard/open-expenses-card.tsx` | Dashboard card showing user's open expenses |
| `src/components/profile/profile-expenses.tsx` | Profile tab content for expense history |

## Implementation Tasks

### Phase 0: Setup

- [ ] **0.1.1** Add 'expenses' page to PAGE_ACCESS in roles.ts for all roles
- [ ] **0.1.2** Add Expenses to FinanceSubnav (visible only to financial roles)

### Phase 1: Dashboard Updates

- [ ] **1.1.1** Add "Submit Expense" quick action button to dashboard
- [ ] **1.1.2** Query user's open expenses (status !== 'paid') in dashboard page
- [ ] **1.1.3** Create OpenExpensesCard component for dashboard
- [ ] **1.1.4** Add OpenExpensesCard to dashboard layout

### Phase 2: Parent/Scout Access

- [ ] **2.1.1** Add expense submission button/link to roster page header
- [ ] **2.1.2** Test that parents and scouts can access /expenses/new

### Phase 3: Profile Expenses Tab

- [ ] **3.1.1** Create ProfileExpenses component with expense list
- [ ] **3.1.2** Convert profile page to use tabs (Profile, Expenses)
- [ ] **3.1.3** Query all user's expenses (not just open) for profile

### Phase 4: Verification

- [ ] **4.1.1** Test full flow: submit → review → approve → mark paid
- [ ] **4.1.2** Verify all roles can access appropriate features
- [ ] **4.1.3** Run build and tests

## Testing Strategy

### Manual Testing
1. **As Admin/Treasurer**: Submit expense from dashboard → see it in open expenses → review in Finances → approve → mark paid
2. **As Parent**: Submit expense from roster → track in profile → see status updates
3. **As Treasurer**: See all unit expenses in Finances/Expenses tab → approve/reject

### Automated Tests
- Existing tests should continue to pass
- No new tests required for this UI-focused update

## Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| | | | |
