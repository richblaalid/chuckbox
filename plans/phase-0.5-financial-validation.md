# Phase 0.5: Financial Validation Sprint

> **Status:** In Progress (Phase 0 Complete)
> **Created:** 2026-02-07
> **Target:** Q1 2026 (end of March)
> **Author:** Claude
> **Branch:** `feature/phase-0.5-financial`

---

## 1. Requirements

### 1.1 Problem Statement

The pilot troop Treasurer is not yet using Chuckbox for **all** financial tracking. Key blockers:

1. **Workflow friction** - Common tasks (recording payments, creating charges, collecting overdue balances) require too many clicks
2. **Missing reports** - Balance sheet, income/expense statement, and dues-by-patrol reports don't exist
3. **No bank visibility** - Cannot see unit bank balance or transactions alongside scout accounts
4. **Collection difficulty** - No bulk messaging to families with overdue balances

Until these gaps are closed, Phase 0 cannot be validated per the success criterion: *"Pilot troop Treasurer actively using for all financial tracking"*

### 1.2 User Stories

**Workflow Improvements:**
- [x] As a Treasurer, I want to record a payment in 2-3 clicks so that I can quickly log cash/check received at meetings
- [x] As a Treasurer, I want to create event charges with fewer steps so that billing doesn't consume my evening
- [x] As a Treasurer, I want to send payment reminders to all overdue families with one click so that I don't spend hours chasing payments

**Financial Reports:**
- [x] As a Treasurer, I want a balance sheet report so that I can present financials to the Committee
- [x] As a Treasurer, I want an income/expense statement so that I can track spending trends
- [x] As a Treasurer, I want dues status grouped by patrol so that I can work with patrol leaders on collection

**Bank Visibility:**
- [x] As a Treasurer, I want to see our bank balance in Chuckbox so that I have one source of truth
- [x] As a Treasurer, I want to view bank transactions so that I can verify money movement

### 1.3 Acceptance Criteria

**Workflow:**
- [ ] Payment can be recorded from dashboard in ≤3 clicks
- [ ] Billing creation flow reduced by 50% in click count
- [ ] Bulk overdue email sends to all families meeting threshold with one action
- [ ] Overdue emails include personalized payment links

**Reports:**
- [ ] Balance sheet shows assets, liabilities, equity with flexible date
- [ ] Income/expense statement shows revenue and expenses for any date range
- [ ] Dues status report groups scouts by patrol with paid/unpaid status

**Bank Integration:**
- [ ] Plaid Link flow connects bank account
- [ ] Bank balance displayed on finance dashboard
- [ ] Bank transactions viewable (last 30 days minimum)
- [ ] Bank connection can be disconnected

### 1.4 Out of Scope

- **Transaction matching** - No automatic linking of bank transactions to Chuckbox entries
- **Bank import as entries** - Bank transactions are view-only, not imported to journal
- **Budget tracking** - Deferred (needs more requirements clarity)
- **Mobile app** - Deferred to post-Phase 0.5
- **Chat/SMS** - Deferred (continue using GroupMe)
- **Multi-bank support** - Single bank connection per unit initially

### 1.5 Open Questions

| Question | Answer | Decided By |
|----------|--------|------------|
| Which bank does pilot troop use? | North Stark Bank | User (2026-02-07) |
| Plaid production pricing acceptable? | Yes (~$0.30/connection/month) | User (2026-02-07) |
| Should overdue threshold be configurable in settings? | Yes - add to Settings UI | User (2026-02-07) |

---

## 2. Technical Design

### 2.1 Approach

**Workflow Improvements:**
- Add "Quick Payment" component to dashboard with scout selector and amount input
- Streamline billing form with smart defaults and fewer required fields
- Create dedicated "Collection Center" page with filtering and bulk actions

**Reports:**
- Build report components that query journal_lines with date range filters
- Use existing account codes for categorization (assets=1xxx, liabilities=2xxx, etc.)
- Generate printable/exportable versions

**Bank Integration:**
- Use Plaid Link React SDK for bank connection OAuth flow
- Store Plaid access tokens encrypted in new `plaid_connections` table
- Create API routes for token exchange and transaction fetching
- Display bank data on dedicated settings page and dashboard widget

### 2.2 Database Changes

```sql
-- Migration: 20260207000001_plaid_connections.sql

-- Store Plaid connections (encrypted access tokens)
CREATE TABLE plaid_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,

  -- Plaid identifiers
  item_id TEXT NOT NULL,
  access_token TEXT NOT NULL, -- Encrypted in application layer

  -- Connection metadata
  institution_id TEXT,
  institution_name TEXT,

  -- Account info (cached from Plaid)
  accounts JSONB DEFAULT '[]'::jsonb, -- Array of {account_id, name, mask, type, subtype}

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'disconnected')),
  error_code TEXT,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,

  -- Constraints
  UNIQUE(unit_id) -- One connection per unit initially
);

-- RLS policies
ALTER TABLE plaid_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their unit's plaid connection"
  ON plaid_connections FOR SELECT
  USING (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE user_id = auth.uid() AND role IN ('admin', 'treasurer')
  ));

CREATE POLICY "Admins and treasurers can manage plaid connection"
  ON plaid_connections FOR ALL
  USING (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE user_id = auth.uid() AND role IN ('admin', 'treasurer')
  ));

-- Index for lookups
CREATE INDEX idx_plaid_connections_unit ON plaid_connections(unit_id);
```

```sql
-- Migration: 20260207000002_collection_settings.sql

-- Add collection settings to units table
ALTER TABLE units ADD COLUMN IF NOT EXISTS collection_settings JSONB DEFAULT '{
  "overdue_threshold_days": 30,
  "overdue_threshold_amount_cents": 0,
  "reminder_email_subject": "Payment Reminder - {unit_name}",
  "reminder_email_template": "default"
}'::jsonb;
```

### 2.3 API/Server Actions

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/plaid/create-link-token` | POST | Generate Plaid Link token for OAuth |
| `/api/plaid/exchange-token` | POST | Exchange public token for access token |
| `/api/plaid/accounts` | GET | Fetch connected accounts and balances |
| `/api/plaid/transactions` | GET | Fetch recent transactions |
| `/api/plaid/disconnect` | POST | Remove Plaid connection |
| `/api/collection/send-reminders` | POST | Bulk send overdue payment emails |
| `/api/reports/balance-sheet` | GET | Generate balance sheet data |
| `/api/reports/income-expense` | GET | Generate income/expense data |

### 2.4 UI Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `QuickPaymentForm` | `src/components/payments/quick-payment-form.tsx` | Dashboard quick entry |
| `CollectionCenter` | `src/components/collection/collection-center.tsx` | Overdue management |
| `OverdueTable` | `src/components/collection/overdue-table.tsx` | Filterable overdue list |
| `BulkReminderDialog` | `src/components/collection/bulk-reminder-dialog.tsx` | Send bulk emails |
| `BalanceSheetReport` | `src/components/reports/balance-sheet-report.tsx` | Balance sheet |
| `IncomeExpenseReport` | `src/components/reports/income-expense-report.tsx` | P&L statement |
| `DuesByPatrolReport` | `src/components/reports/dues-by-patrol-report.tsx` | Patrol grouping |
| `PlaidLinkButton` | `src/components/plaid/plaid-link-button.tsx` | Connect bank |
| `BankAccountCard` | `src/components/plaid/bank-account-card.tsx` | Display balance |
| `BankTransactionsList` | `src/components/plaid/bank-transactions-list.tsx` | Transaction list |

### 2.5 Architecture Diagram

```mermaid
flowchart TD
    subgraph "Dashboard"
        QP[Quick Payment Form]
        BW[Bank Balance Widget]
    end

    subgraph "Collection Center"
        OT[Overdue Table]
        BRD[Bulk Reminder Dialog]
    end

    subgraph "Reports"
        BS[Balance Sheet]
        IE[Income/Expense]
        DP[Dues by Patrol]
    end

    subgraph "Settings"
        PL[Plaid Link Button]
        BC[Bank Connection Card]
    end

    subgraph "API Layer"
        PA[/api/plaid/*]
        CA[/api/collection/*]
        RA[/api/reports/*]
    end

    subgraph "External"
        PLAID[Plaid API]
        RESEND[Resend Email]
    end

    subgraph "Database"
        PC[(plaid_connections)]
        SA[(scout_accounts)]
        JE[(journal_entries)]
    end

    QP --> SA
    BW --> PA
    PL --> PA
    BC --> PA
    PA --> PLAID
    PA --> PC

    OT --> SA
    BRD --> CA
    CA --> RESEND

    BS --> RA
    IE --> RA
    DP --> RA
    RA --> JE
```

---

## 3. Implementation Tasks

### Phase 0: Foundation

#### 0.1 Database & Types
- [x] **0.1.1** Create Plaid connections migration ✓
  - Files: `supabase/migrations/20260207100001_plaid_connections.sql`
  - Test: `supabase db push` succeeds, table exists with RLS

- [x] **0.1.2** Create collection settings migration ✓
  - Files: `supabase/migrations/20260207100002_collection_settings.sql`
  - Test: Units table has collection_settings column

- [x] **0.1.3** Regenerate TypeScript database types ✓
  - Command: `supabase gen types typescript --local > src/types/database.ts`
  - Test: Types compile, `PlaidConnection` type available

#### 0.2 Plaid Setup
- [x] **0.2.1** Install Plaid dependencies ✓
  - Command: `npm install plaid react-plaid-link`
  - Test: Packages in package.json (plaid@41.1.0, react-plaid-link@4.1.1)

- [x] **0.2.2** Create Plaid client configuration ✓
  - Files: `src/lib/plaid/client.ts`
  - Test: Client initializes with env vars

- [x] **0.2.3** Add Plaid environment variables ✓
  - Files: `.env.local.example`
  - Vars: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENVIRONMENT` (sandbox/development/production)
  - Test: Env vars load correctly

---

### Phase 1: UX Improvements (Blocking Q1)

#### 1.1 Quick Payment Entry
- [x] **1.1.1** Create QuickPaymentForm component ✓
  - Files: `src/components/payments/quick-payment-dialog.tsx`
  - Features: Scout dropdown, amount input, payment method, submit
  - Test: Form renders, validates input

- [x] **1.1.2** Add quick payment to dashboard ✓
  - Files: `src/app/(dashboard)/dashboard/page.tsx`, `src/app/(dashboard)/finances/page.tsx`
  - Test: Quick payment dialog visible for Treasurer/Admin roles

- [x] **1.1.3** Wire up quick payment server action ✓
  - Files: `src/app/api/payments/quick/route.ts`
  - Test: Payment creates journal entry, updates scout balance

#### 1.2 Streamlined Billing
- [x] **1.2.1** Audit current billing flow click count ✓
  - Output: Document current steps and identify removable friction
  - Test: Baseline measurement documented

  **Audit Results (2026-02-08):**

  Current flow requires **7-10+ clicks/interactions**:

  | Step | Clicks | Description |
  |------|--------|-------------|
  | Navigation | 2-3 | Dashboard → Finances → Billing → Expand form |
  | Billing type | 1 | Toggle Fixed/Split |
  | Amount | 1 | Enter amount (keyboard) |
  | Description | 1 | Enter description (keyboard) |
  | Scout selection | 1-N | Select All or individual scouts |
  | Notifications | 0-1 | Optional checkbox |
  | Submit | 1 | Create Billing button |

  **Friction points identified:**
  1. Navigation overhead (2-3 clicks before seeing form)
  2. Form is in CollapsibleCard (may need to expand)
  3. No smart defaults - always starts blank
  4. Must manually select scouts every time (no presets)
  5. No keyboard shortcuts
  6. Description has no suggestions/autocomplete
  7. Cannot create billing directly from events

  **Target: 4-5 clicks (50% reduction)**

- [x] **1.2.2** Add smart defaults to billing form ✓
  - Files: `src/components/billing/billing-form.tsx`
  - Features: Remember last billing type, pre-select active scouts, keyboard shortcuts
  - Test: Fewer required interactions to create billing

  **Implementation:**
  - Remembers billing type preference in localStorage
  - Cmd/Ctrl+Enter keyboard shortcut to submit
  - Added keyboard hint below submit button
  - "Create Billing" button from finances page opens form automatically

- [x] **1.2.3** Add "Quick Billing" variant for common scenarios ✓
  - Files: `src/components/billing/quick-billing-form.tsx`
  - Features: Event selector auto-fills amount from event cost
  - Test: Event billing in 2 clicks (select event → submit)

  **Implementation:**
  - Created QuickBillingForm component
  - Auto-populates from events with cost_per_scout
  - Bills all active scouts with one click
  - Shows preview of total before submission

---

### Phase 2: Collection Center (Blocking Q1)

#### 2.1 Collection Dashboard
- [ ] **2.1.1** Create Collection Center page
  - Files: `src/app/(dashboard)/finances/collection/page.tsx`
  - Test: Page loads, shows overdue accounts

- [ ] **2.1.2** Create OverdueTable component with filtering
  - Files: `src/components/collection/overdue-table.tsx`
  - Features: Filter by days overdue, amount threshold, patrol
  - Test: Filters work, data displays correctly

- [ ] **2.1.3** Add navigation to Collection Center
  - Files: `src/components/nav/main-nav.tsx` (or similar)
  - Test: Link appears for Treasurer/Admin roles

#### 2.2 Bulk Reminder System
- [ ] **2.2.1** Create bulk reminder API endpoint
  - Files: `src/app/api/collection/send-reminders/route.ts`
  - Features: Accept array of scout_account_ids, send emails with payment links
  - Test: API returns success, emails sent via Resend

- [ ] **2.2.2** Create reminder email template
  - Files: `src/lib/email/templates/payment-reminder.ts`
  - Features: Scout name, amount due, age of debt, payment link, unit contact
  - Test: Email renders correctly

- [ ] **2.2.3** Create BulkReminderDialog component
  - Files: `src/components/collection/bulk-reminder-dialog.tsx`
  - Features: Preview recipients, customize message, send all
  - Test: Dialog shows count, sends on confirm

- [ ] **2.2.4** Wire up "Send Reminders" button in OverdueTable
  - Files: `src/components/collection/overdue-table.tsx`
  - Test: Button triggers dialog, emails send successfully

#### 2.3 Collection Settings
- [ ] **2.3.1** Add collection settings to Settings page
  - Files: `src/app/(dashboard)/settings/page.tsx` or new Collection tab
  - Features: Configure overdue threshold (days and amount), reminder email subject
  - Test: Settings save and persist

- [ ] **2.3.2** Use collection settings in OverdueTable filters
  - Files: `src/components/collection/overdue-table.tsx`
  - Test: Default filter uses unit's configured thresholds

---

### Phase 3: Financial Reports (Blocking Q1)

#### 3.1 Balance Sheet
- [ ] **3.1.1** Create balance sheet data query
  - Files: `src/app/api/reports/balance-sheet/route.ts`
  - Logic: Sum journal_lines by account category (assets/liabilities/equity)
  - Test: API returns correct totals for test data

- [ ] **3.1.2** Create BalanceSheetReport component
  - Files: `src/components/reports/balance-sheet-report.tsx`
  - Features: Date picker, categorized view, totals
  - Test: Component renders, totals match query

- [ ] **3.1.3** Add balance sheet to reports page
  - Files: `src/app/(dashboard)/finances/reports/page.tsx`
  - Test: Report accessible from reports hub

#### 3.2 Income/Expense Statement
- [ ] **3.2.1** Create income/expense data query
  - Files: `src/app/api/reports/income-expense/route.ts`
  - Logic: Sum journal_lines by income/expense accounts for date range
  - Test: API returns correct totals

- [ ] **3.2.2** Create IncomeExpenseReport component
  - Files: `src/components/reports/income-expense-report.tsx`
  - Features: Date range picker, category breakdown, net income
  - Test: Component renders with accurate data

- [ ] **3.2.3** Add income/expense to reports page
  - Files: `src/app/(dashboard)/finances/reports/page.tsx`
  - Test: Report accessible, printable

#### 3.3 Transaction History
- [ ] **3.3.1** Create transaction history page
  - Files: `src/app/(dashboard)/finances/transactions/page.tsx`
  - Features: Full journal entry list with filtering by date range, type, scout
  - Test: Page loads, shows all posted journal entries with pagination

- [ ] **3.3.2** Add transactions link to finance subnav
  - Files: `src/components/finances/finance-subnav.tsx`
  - Test: Link visible for Treasurer/Admin roles

#### 3.4 Dues by Patrol
- [ ] **3.4.1** Create dues-by-patrol query
  - Files: `src/app/api/reports/dues-by-patrol/route.ts`
  - Logic: Join scout_accounts with scouts/patrols, group by patrol
  - Test: API returns correct groupings

- [ ] **3.4.2** Create DuesByPatrolReport component
  - Files: `src/components/reports/dues-by-patrol-report.tsx`
  - Features: Patrol sections, paid/unpaid indicators, totals per patrol
  - Test: Renders correctly grouped data

- [ ] **3.4.3** Add dues-by-patrol to reports page
  - Files: `src/app/(dashboard)/finances/reports/page.tsx`
  - Test: Report accessible

---

<!-- MVP BOUNDARY - Everything above is required for Q1 validation -->

### Phase 4: Bank Integration (High Priority, Not Blocking)

> **Pricing Consideration:** Plaid charges Chuckbox (not end users) per connected bank account, typically $0.30-$3.00/month/connection in production. Options to consider before launching:
> 1. **Absorb cost** - Include in base subscription pricing
> 2. **Premium add-on** - Offer bank integration as paid feature add-on
> 3. **Tier-based** - Free for higher subscription tiers, add-on for basic
>
> Decision should be made before Phase 4 UI implementation to inform feature gating.

#### 4.1 Plaid Connection Flow
- [ ] **4.1.1** Create link token API endpoint
  - Files: `src/app/api/plaid/create-link-token/route.ts`
  - Test: Returns valid link token

- [ ] **4.1.2** Create token exchange API endpoint
  - Files: `src/app/api/plaid/exchange-token/route.ts`
  - Test: Exchanges public token, stores access token

- [ ] **4.1.3** Create PlaidLinkButton component
  - Files: `src/components/plaid/plaid-link-button.tsx`
  - Test: Opens Plaid Link modal, handles success/exit

- [ ] **4.1.4** Add Plaid connection UI to settings
  - Files: `src/app/(dashboard)/settings/page.tsx` or new tab
  - Test: Can connect bank from settings

#### 4.2 Bank Data Display
- [ ] **4.2.1** Create accounts/balance API endpoint
  - Files: `src/app/api/plaid/accounts/route.ts`
  - Test: Returns account names and balances

- [ ] **4.2.2** Create transactions API endpoint
  - Files: `src/app/api/plaid/transactions/route.ts`
  - Test: Returns last 30 days of transactions

- [ ] **4.2.3** Create BankAccountCard component
  - Files: `src/components/plaid/bank-account-card.tsx`
  - Test: Shows account name, mask, balance

- [ ] **4.2.4** Create BankTransactionsList component
  - Files: `src/components/plaid/bank-transactions-list.tsx`
  - Test: Shows recent transactions with date, description, amount

- [ ] **4.2.5** Add bank widget to finance dashboard
  - Files: `src/app/(dashboard)/finances/page.tsx`
  - Test: Bank balance visible on dashboard

#### 4.3 Connection Management
- [ ] **4.3.1** Create disconnect API endpoint
  - Files: `src/app/api/plaid/disconnect/route.ts`
  - Test: Removes Plaid connection, revokes access

- [ ] **4.3.2** Add disconnect button to settings
  - Files: `src/components/plaid/bank-account-card.tsx`
  - Test: Can disconnect bank, UI updates

- [ ] **4.3.3** Handle Plaid errors gracefully
  - Files: Various Plaid components
  - Test: Error states display helpful messages

---

## 4. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260207000001_plaid_connections.sql` | Plaid storage table |
| `supabase/migrations/20260207000002_collection_settings.sql` | Unit collection config |
| `src/lib/plaid/client.ts` | Plaid API client |
| `src/components/payments/quick-payment-form.tsx` | Dashboard quick entry |
| `src/components/billing/quick-billing-form.tsx` | Streamlined billing |
| `src/app/(dashboard)/finances/collection/page.tsx` | Collection center page |
| `src/components/collection/collection-center.tsx` | Collection layout |
| `src/components/collection/overdue-table.tsx` | Overdue scouts table |
| `src/components/collection/bulk-reminder-dialog.tsx` | Bulk email UI |
| `src/app/api/collection/send-reminders/route.ts` | Bulk email endpoint |
| `src/lib/email/templates/payment-reminder.ts` | Reminder email template |
| `src/components/reports/balance-sheet-report.tsx` | Balance sheet UI |
| `src/components/reports/income-expense-report.tsx` | P&L UI |
| `src/components/reports/dues-by-patrol-report.tsx` | Patrol grouping UI |
| `src/app/api/reports/balance-sheet/route.ts` | Balance sheet data |
| `src/app/api/reports/income-expense/route.ts` | Income/expense data |
| `src/app/api/reports/dues-by-patrol/route.ts` | Dues grouping data |
| `src/app/api/plaid/create-link-token/route.ts` | Plaid link token |
| `src/app/api/plaid/exchange-token/route.ts` | Token exchange |
| `src/app/api/plaid/accounts/route.ts` | Account balances |
| `src/app/api/plaid/transactions/route.ts` | Transaction history |
| `src/app/api/plaid/disconnect/route.ts` | Remove connection |
| `src/components/plaid/plaid-link-button.tsx` | Connect bank button |
| `src/components/plaid/bank-account-card.tsx` | Balance display |
| `src/components/plaid/bank-transactions-list.tsx` | Transaction list |

### Modified Files

| File | Changes |
|------|---------|
| `src/app/(dashboard)/dashboard/page.tsx` | Add QuickPaymentForm |
| `src/components/billing/billing-form.tsx` | Add smart defaults |
| `src/app/(dashboard)/finances/reports/page.tsx` | Add new report components |
| `src/app/(dashboard)/finances/page.tsx` | Add bank balance widget |
| `src/app/(dashboard)/settings/page.tsx` | Add Plaid connection UI |
| `src/components/nav/*` | Add Collection Center link |
| `package.json` | Add plaid, react-plaid-link |
| `.env.example` | Add Plaid env vars |

---

## 5. Testing Strategy

### Unit Tests
- [ ] Plaid client initialization with mock credentials
- [ ] Balance sheet calculation logic
- [ ] Income/expense date range filtering
- [ ] Overdue threshold filtering logic
- [ ] Payment reminder email generation

### Integration Tests
- [ ] Quick payment creates correct journal entries
- [ ] Bulk reminder sends emails to all selected accounts
- [ ] Report APIs return correct aggregations
- [ ] Plaid token exchange flow (with sandbox)

### Manual Testing
- [ ] Complete quick payment flow as Treasurer
- [ ] Create billing with new streamlined form
- [ ] Send bulk reminders, verify email received
- [ ] View all three report types with different date ranges
- [ ] Connect sandbox bank account via Plaid
- [ ] View bank balance and transactions
- [ ] Disconnect bank account

---

## 6. Rollout Plan

### Dependencies
- Plaid developer account with sandbox access
- Production Plaid credentials when ready
- Resend email service (already configured)

### Environment Variables
```
# Plaid Configuration
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox  # sandbox | development | production
```

### Migration Steps
1. Push database migrations to dev
2. Deploy API routes
3. Deploy UI components
4. Test full flow in dev
5. Push to production
6. Connect pilot troop bank account

### Verification
- [ ] Treasurer can record payment from dashboard
- [ ] Treasurer can send bulk reminders
- [ ] All three reports generate correctly
- [ ] Bank balance displays on dashboard
- [ ] No errors in Sentry/logs

---

## 7. Progress Summary

| Phase | Total | Complete | Status |
|-------|-------|----------|--------|
| Phase 0: Foundation | 6 | 6 | ✅ Complete |
| Phase 1: UX Improvements | 6 | 6 | ✅ Complete |
| Phase 2: Collection Center | 9 | 0 | ⬜ Not Started |
| Phase 3: Financial Reports | 11 | 0 | ⬜ Not Started |
| Phase 4: Bank Integration | 11 | 0 | ⬜ Not Started |
| **Total** | **43** | **12** | 🔄 In Progress (28%) |

---

## 8. Task Log

| Task | Date | Commit | Notes |
|------|------|--------|-------|
| 0.1.1, 0.1.2, 0.1.3 | 2026-02-07 | 1ffb178 | Plaid connections + collection settings migrations, types regenerated |
| 0.2.1, 0.2.2, 0.2.3 | 2026-02-07 | 140b9c8 | Plaid SDK installed, client config created, env vars added |
| 1.1.1, 1.1.2, 1.1.3 | 2026-02-08 | PR #9 | Quick payment dialog, button styling standardization |
| 1.2.1 | 2026-02-08 | — | Billing flow audit: 7-10 clicks baseline, 50% reduction target |
| 1.2.2 | 2026-02-08 | — | Smart defaults: pre-select scouts, remember type, ⌘+Enter shortcut |
| 1.2.3 | 2026-02-08 | — | Quick Billing: event-based billing in 2 clicks |

---

## Approval

- [ ] Requirements reviewed by: _____
- [ ] Technical design reviewed by: _____
- [ ] Ready for implementation
