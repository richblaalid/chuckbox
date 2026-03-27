# Billing Management Page Implementation Plan

> **Status:** Completed
> **Created:** 2026-03-26
> **Author:** Claude

---

## 1. Requirements

### 1.1 Problem Statement

Treasurers need a centralized place to view, filter, and act on all billing charges across the unit. The current Outstanding Bills card on the finances overview is limited to 10 recent records and has no filtering or action capabilities. Key actions like sending charge-specific reminders, voiding records, and recording manual payments against specific charges are either hidden behind APIs with no UI or not possible at all.

### 1.2 User Stories

- [ ] As a **treasurer**, I want to see all billing records with their paid/unpaid status so I can track what's been collected
- [ ] As a **treasurer**, I want to filter billing records by status (unpaid/paid/voided) so I can focus on what needs attention
- [ ] As a **treasurer**, I want to search for a specific scout's charges so I can answer parent questions quickly
- [ ] As a **treasurer**, I want to send charge-specific reminders so parents know exactly what they owe for
- [ ] As a **treasurer**, I want to void a billing record when a charge was created in error
- [ ] As a **treasurer**, I want to record a cash/check payment against a specific charge so the Outstanding Bills view is accurate
- [ ] As a **treasurer**, I want to create a new billing charge directly from this page without navigating to the import wizard

### 1.3 Acceptance Criteria

- [ ] New "Billing" tab in finance sub-nav (between Scout Accounts and Payments)
- [ ] Page shows all billing records with per-scout charge details
- [ ] Status filter: All / Unpaid / Paid / Voided
- [ ] Date range filter for billing_date
- [ ] Search by scout name or description
- [ ] Sort by date (default: most recent), amount, description
- [ ] Per-record actions: Send Reminders, Void, Record Payment
- [ ] Inline billing creation (reuses existing BillingForm in a dialog)
- [ ] Batch imports grouped into single rows (expandable)
- [ ] Build and all tests pass

### 1.4 Out of Scope

- Editing existing billing records (void and recreate instead)
- Recurring/scheduled billing
- Export to CSV/PDF (future enhancement)
- Charge splitting (partial payments against specific charges)

### 1.5 Open Questions

| Question | Answer | Decided By |
|----------|--------|------------|
| Where in the nav? | New "Billing" tab in FinanceSubnav, always visible for admin/treasurer | User |
| What actions? | Send reminders, void, record payment, create new (all four) | User |
| What filters? | Full suite: status + date range + scout name search + description search + sort | User |

---

## 2. Technical Design

### 2.1 Approach

Create a new server-rendered page at `/finances/billing` with a client-side data table. The page fetches all billing records with their charges and scout info server-side, then renders a filterable/sortable table with action dialogs. Reuses existing components (BillingForm, QuickPaymentForm) in dialogs for actions.

**Key decisions:**
- Server-side initial data load (same pattern as accounts page)
- Client-side filtering/sorting (no server round-trips for filter changes)
- Batch-imported records grouped by `billing_import_batch_id` (same as Outstanding Bills card)
- Actions open dialogs that call existing APIs/actions

### 2.2 Database Changes

None — all required tables and columns already exist.

### 2.3 API/Server Actions

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/api/billing-records/[id]/notify` | Send charge-specific notifications | **Exists** — needs UI |
| `/api/import/charges/[batchId]/void` | Void batch of charges | **Exists** — needs UI |
| New: void single billing record action | Void one record + charges + reversal entries | **Needed** |

### 2.4 UI Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `BillingManagementView` | `src/components/billing/billing-management-view.tsx` | Main client component with table, filters, actions |
| `BillingRecordRow` | (inline in above) | Expandable row showing record + charges |
| `VoidBillingDialog` | `src/components/billing/void-billing-dialog.tsx` | Confirmation dialog for voiding a record |

### 2.5 Architecture

```mermaid
flowchart TD
    A[/finances/billing page] -->|Server| B[Fetch billing_records + charges + scouts]
    B --> C[BillingManagementView client component]
    C --> D[Filter bar: Status / Date / Search / Sort]
    D --> E[Filtered billing records table]
    E --> F[Expandable rows with per-scout charges]

    F -->|Send Reminders| G[POST /api/billing-records/id/notify]
    F -->|Void| H[VoidBillingDialog → server action]
    F -->|Record Payment| I[QuickPaymentForm in dialog]
    C -->|Create Billing| J[BillingForm in dialog]
```

### 2.6 Data Flow

The page query fetches billing records with nested charges and scout names (same pattern as the Outstanding Bills card query but without the limit). Records are grouped by batch client-side. The filter state is managed with `useState` and `useMemo` for derived filtered/sorted lists.

**Filter state:**
```typescript
interface BillingFilters {
  status: 'all' | 'unpaid' | 'paid' | 'voided'
  dateFrom: string | null
  dateTo: string | null
  search: string  // matches scout name or description
  sortBy: 'date' | 'amount' | 'description'
  sortOrder: 'asc' | 'desc'
}
```

---

## 3. Implementation Tasks

### Phase 0: Foundation

#### 0.1 Navigation
- [x] **0.1.1** Add "Billing" tab to FinanceSubnav (always visible for admin/treasurer)
  - Files: `src/components/finances/finance-subnav.tsx`
  - Test: Tab renders, links to `/finances/billing`, active state works

#### 0.2 Server Action
- [x] **0.2.1** Create void single billing record server action
  - Files: `src/app/actions/billing.ts`
  - Test: Voids billing_record + billing_charges, creates reversal journal entries

---

### Phase 1: Billing Management Page

#### 1.1 Page Route
- [x] **1.1.1** Create `/finances/billing` page with data loading
  - Files: `src/app/(dashboard)/finances/billing/page.tsx`
  - Test: Page loads for admin/treasurer, fetches billing records with charges and scout names

#### 1.2 Main View Component
- [x] **1.2.1** Create `BillingManagementView` with filter bar and table
  - Files: `src/components/billing/billing-management-view.tsx`
  - Test: Renders filter controls (status, date, search, sort), shows billing records table

#### 1.3 Record Display
- [x] **1.3.1** Add expandable row rendering with per-scout charge details
  - Files: `src/components/billing/billing-management-view.tsx`
  - Test: Rows expand to show charges with scout names, paid/unpaid badges, amounts

#### 1.4 Filtering & Sorting
- [x] **1.4.1** Implement client-side filtering (status, date range, search) and sorting
  - Files: `src/components/billing/billing-management-view.tsx`
  - Test: Filters narrow results correctly, sort toggles work, search matches scout name and description

---

### Phase 2: Actions

#### 2.1 Send Reminders
- [x] **2.1.1** Add per-record "Send Reminders" button that calls existing notify API
  - Files: `src/components/billing/billing-management-view.tsx`
  - Test: Button triggers notification for unpaid charges, shows success/error feedback

#### 2.2 Void Record
- [x] **2.2.1** Create `VoidBillingDialog` with confirmation and void action
  - Files: `src/components/billing/void-billing-dialog.tsx`, `src/components/billing/billing-management-view.tsx`
  - Test: Dialog shows charge count and amount, confirms void, record disappears from unpaid view

#### 2.3 Record Payment
- [x] **2.3.1** Add per-charge "Record Payment" action opening QuickPaymentForm dialog
  - Files: `src/components/billing/billing-management-view.tsx`
  - Test: Opens payment form pre-filled with scout and amount, payment marks charge as paid

#### 2.4 Create Billing
- [x] **2.4.1** Add "Create Billing" button opening BillingForm dialog
  - Files: `src/components/billing/billing-management-view.tsx`
  - Test: Opens billing form, new charge appears in table after creation

---

### Phase 3: Polish

#### 3.1 Overview Integration
- [x] **3.1.1** Add "View All" link on Outstanding Bills card pointing to `/finances/billing?status=unpaid`
  - Files: `src/components/finances/outstanding-bills-card.tsx`
  - Test: Link navigates to billing page with unpaid filter pre-applied

#### 3.2 Summary Stats
- [x] **3.2.1** Add summary cards at top of page (total billed, total collected, total outstanding, total voided)
  - Files: `src/components/billing/billing-management-view.tsx`
  - Test: Stats update when filters change

---

<!-- MVP BOUNDARY -->

### Phase 4: Enhancements (Post-MVP)

#### 4.1 Bulk Actions
- [x] **4.1.1** Add multi-select with bulk "Send Reminders" and "Void" actions
  - Files: `src/components/billing/billing-management-view.tsx`
  - Test: Select multiple records, bulk action applies to all selected

#### 4.2 URL State
- [x] **4.2.1** Sync filter state to URL search params for shareable/bookmarkable views
  - Files: `src/components/billing/billing-management-view.tsx`
  - Test: Filter changes update URL, page load reads filters from URL

---

## 4. Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `src/app/(dashboard)/finances/billing/page.tsx` | Page route with data loading |
| `src/components/billing/billing-management-view.tsx` | Main client component |
| `src/components/billing/void-billing-dialog.tsx` | Void confirmation dialog |
| `src/app/actions/billing.ts` | Void billing record server action |

### Modified Files
| File | Changes |
|------|---------|
| `src/components/finances/finance-subnav.tsx` | Add "Billing" tab (always visible) |
| `src/components/finances/outstanding-bills-card.tsx` | Add "View All" link |

---

## 5. Testing Strategy

### Unit Tests
- [ ] Void billing action: creates reversal entries, marks charges voided
- [ ] Filter logic: status, date range, search matching

### Manual Testing
- [ ] Upload charges via CSV → appear on billing page
- [ ] Filter by unpaid → only unpaid charges shown
- [ ] Search by scout name → correct results
- [ ] Send reminders for a record → emails sent, feedback shown
- [ ] Void a record → disappears from unpaid, appears in voided filter
- [ ] Record cash payment → charge marked as paid
- [ ] Create new billing → appears in table immediately

---

## 6. Rollout Plan

### Dependencies
- No new migrations required
- No new environment variables
- Existing APIs cover all actions except single-record void (new server action)

### Verification
- All existing tests pass
- Build succeeds with new route
- Manual walkthrough of all four action types

---

## 7. Progress Summary

| Phase | Total | Complete | Status |
|-------|-------|----------|--------|
| Phase 0 | 2 | 2 | ✅ Complete |
| Phase 1 | 4 | 4 | ✅ Complete |
| Phase 2 | 4 | 4 | ✅ Complete (built in Phase 1) |
| Phase 3 | 2 | 2 | ✅ Complete |
| Phase 4 | 2 | 2 | ✅ Complete |

---

## 8. Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| 0.1.1 | 2026-03-26 | pending | Billing tab in subnav + placeholder page |
| 0.2.1 | 2026-03-26 | pending | Void single billing record server action |
| 1.1.1–1.4.1 | 2026-03-26 | pending | Billing page + management view with filters, expandable rows, summary stats |

---

## Approval

- [ ] Requirements reviewed by: _____
- [ ] Technical design reviewed by: _____
- [ ] Ready for implementation
