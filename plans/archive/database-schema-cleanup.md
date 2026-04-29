# Database Schema Cleanup Plan

## Problem Summary

Analysis of `supabase/migrations/00000000000000_init.sql` against the codebase reveals significant dead code and inconsistencies in this greenfield project.

**Important**: This is a greenfield project with no production data to migrate. We can rewrite the schema directly with best practices rather than creating incremental migrations.

## Key Findings

### 1. Dead Tables (13 unused - 38% of schema)

| Table | Status | Recommendation |
|-------|--------|----------------|
| `unit_invites` | Legacy, replaced by `unit_memberships` invite fields | **DELETE** |
| `sync_snapshots` | Scoutbook sync debugging - unused | **DELETE** |
| `snapshot_fingerprints` | Page structure tracking - unused | **DELETE** |
| `events` | Feature not implemented | Keep for future |
| `event_rsvps` | Feature not implemented | Keep for future |
| `inventory_items` | Feature not implemented | Keep for future |
| `inventory_checkouts` | Feature not implemented | Keep for future |
| `audit_log` | Has triggers but never queried | Keep, wire up reads |
| `adult_trainings` | BSA training tracking - unused | Keep for future |
| `scout_advancements` | Scoutbook sync - unused | Keep for future |
| `scout_rank_requirements` | Scoutbook sync - unused | Keep for future |
| `scout_leadership_positions` | Scoutbook sync - unused | Keep for future |
| `scout_activity_logs` | Scoutbook sync - unused | Keep for future |

### 2. Redundant Code

#### Duplicate Functions
```sql
-- These two functions are identical - DELETE ONE
get_user_units()           -- lines 783-797
get_user_active_unit_ids() -- lines 800-814 (keep this one, clearer name)
```

**RLS Policy Inconsistency**: Policies inconsistently reference both functions:
- Line 1195: `SELECT get_user_units()`
- Line 1214: `SELECT get_user_active_unit_ids()`

All policies must be updated to use the canonical `get_user_active_unit_ids()` function.

#### Duplicate Trigger Functions
```sql
-- These are identical - DELETE ONE
update_updated_at()        -- lines 890-896 (keep this one)
update_square_updated_at() -- lines 1094-1100 (delete)
```

Triggers on lines 1133-1135 must be updated to use `update_updated_at()`.

#### Conflicting Soft-Delete Patterns
`unit_memberships` has BOTH:
- `is_active BOOLEAN DEFAULT true` (line 85)
- `status VARCHAR CHECK (status IN ('roster', 'invited', 'active', 'inactive'))` (line 84)

**Problem**: Code inconsistently checks one or the other. RLS policies use both.

**Recommendation**: Remove `is_active`, use only `status`. The `user_has_role()` function already only checks `status = 'active'`.

#### Duplicate Position Tracking
- `unit_memberships.current_position` (for adults)
- `scouts.current_position` + `scouts.current_position_2`
- `scout_leadership_positions` table (full history)

**Recommendation**: Keep `current_position` on scouts/memberships for quick access, use `scout_leadership_positions` only if history is needed. Remove if not used.

### 3. Inconsistencies

#### Balance Semantics Confusion
- `scout_accounts.billing_balance` comment says "negative = owes money"
- But trigger uses `credit - debit` which can be positive or negative
- Code treats billing_balance as: negative = owes, zero = paid, positive = overpaid

**Recommendation**: Add comment clarifying: "Negative = owes unit, Zero = balanced, Positive = credit (auto-transferred to funds)"

#### Uncontrolled String Types
Multiple columns use `VARCHAR` with `CHECK` constraints for what should be proper ENUM types:
- `units.unit_type` - BSA-defined values
- `units.unit_gender` - fixed set
- `unit_memberships.role` - application-defined roles
- `accounts.account_type` - accounting standard
- `journal_entries.entry_type` - no constraint at all!
- `profiles.gender`, `scouts.gender` - fixed set
- `profiles.swim_classification`, `scouts.swim_classification` - BSA-defined

**Recommendation**: Use PostgreSQL ENUM types for stable, well-defined domains. Better type safety and Supabase generates TypeScript union types automatically.

#### Cascade Deletes on Financial Data
Deleting a `unit` cascades to delete all `scouts`, `scout_accounts`, `journal_entries`, etc.

**Recommendation**: Change to `ON DELETE RESTRICT` for financial tables to preserve audit trail.

#### Missing Positive Amount Constraints
Financial tables lack constraints ensuring amounts are positive:
- `payments.amount` - should be > 0
- `payments.fee_amount` - should be >= 0
- `billing_charges.amount` - should be > 0
- `payment_links.amount` - should be > 0
- `payment_links.fee_amount` - should be >= 0

### 4. Unused Columns

**profiles table:**
- `middle_name` - never used
- `patrol` - scouts use `patrol_id` instead
- `sync_session_id`, `last_synced_at` - set but never read

**unit_memberships table:**
- `is_active` - redundant with `status`
- `scout_ids` - legacy array, never used
- `expires_at` - redundant with `invite_expires_at`

**scouts table:**
- `patrol` (VARCHAR) - redundant with `patrol_id` (UUID FK)

---

## Implementation Plan

### Execution Order

Since this is greenfield, we'll make all changes directly to `init.sql` then regenerate types:

1. **Phase 1**: Add ENUM types (new section at top of file)
2. **Phase 2**: Delete obsolete tables and all artifacts
3. **Phase 3**: Remove duplicate functions and update references
4. **Phase 4**: Remove redundant columns
5. **Phase 5**: Fix inconsistencies and add constraints
6. **Phase 6**: Update table definitions to use ENUMs
7. **Phase 7**: Reorganize and clean up init.sql structure
8. **Phase 8**: Regenerate TypeScript types
9. **Phase 9**: Update application code

**Prerequisites:**
- [ ] Verify linked to DEV project: `supabase link --project-ref feownmcpkfugkcivdoal`

---

### Phase 1: Add ENUM Types

Add a new section at the **top** of `init.sql` (before any tables):

```sql
-- ============================================
-- SECTION 0: CUSTOM ENUM TYPES
-- ============================================

-- Unit classification (BSA-defined, stable)
CREATE TYPE unit_type AS ENUM ('troop', 'pack', 'crew', 'ship');
CREATE TYPE unit_gender AS ENUM ('boys', 'girls', 'coed');

-- Membership and roles
CREATE TYPE membership_role AS ENUM ('admin', 'treasurer', 'leader', 'parent', 'scout');
CREATE TYPE membership_status AS ENUM ('roster', 'invited', 'active', 'inactive');

-- Financial types (accounting standard)
CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
CREATE TYPE journal_entry_type AS ENUM (
    'billing', 'payment', 'refund', 'reversal',
    'adjustment', 'funds_transfer', 'fundraising_credit'
);

-- Personal attributes
CREATE TYPE gender AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
CREATE TYPE swim_classification AS ENUM ('swimmer', 'beginner', 'non-swimmer');

-- Status types (these may evolve, but benefit from type safety now)
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'voided');
CREATE TYPE payment_link_status AS ENUM ('pending', 'completed', 'expired', 'cancelled');
CREATE TYPE sync_status AS ENUM ('running', 'staged', 'completed', 'failed', 'cancelled');
CREATE TYPE rsvp_status AS ENUM ('going', 'not_going', 'maybe');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'expired', 'cancelled');
```

**Why ENUMs over CHECK constraints:**
| Aspect | ENUM | CHECK Constraint |
|--------|------|------------------|
| Storage | 4 bytes (efficient) | Variable (string length) |
| Type safety | Strong (database-level type) | Weak (just validation) |
| TypeScript generation | Maps to union type | Maps to `string` |
| Index performance | Better (fixed-size) | Good |

**Keep as CHECK constraints** (values likely to evolve frequently):
- None identified - all current string types benefit from ENUMs

---

### Phase 2: Delete Obsolete Tables

**File:** `supabase/migrations/00000000000000_init.sql`

Delete these tables and ALL associated artifacts:

#### 2.1 `unit_invites` table
- Table definition (lines 621-632)
- Indexes (lines 754-757):
  - `idx_unit_invites_email_status`
  - `idx_unit_invites_unit_id`
  - `idx_unit_invites_unique_pending`
- RLS enable (line 1179)
- RLS policies (lines 1571-1582):
  - "Admins can view unit invites"
  - "Users can view own pending invites"

#### 2.2 `sync_snapshots` table
- Table definition (lines 459-467)
- Indexes (lines 723-724):
  - `idx_sync_snapshots_session`
  - `idx_sync_snapshots_page_type`
- RLS enable (line 1169)
- RLS policies (lines 1432-1444):
  - `sync_snapshots_select`
  - `sync_snapshots_insert`

#### 2.3 `snapshot_fingerprints` table
- Table definition (lines 470-478)
- RLS enable (line 1170)
- RLS policy (line 1446):
  - `snapshot_fingerprints_select`

---

### Phase 3: Remove Duplicate/Redundant Code

#### 3.1 Delete `get_user_units()` function
Remove lines 783-797. Keep `get_user_active_unit_ids()` (lines 800-814).

#### 3.2 Update RLS policies referencing `get_user_units()`

Search and replace all occurrences. Known locations:
- Line 1195: profiles policy "Users can view non-user profiles linked as guardians"
- Line 1278: scout_guardians policy "Users can view guardians in their units"
- Line 1285: accounts policy "Users can view accounts in their units"
- Line 1381: events policy "Users can view events in their units"
- Line 1388: event_rsvps policy "Users can view RSVPs in their units"
- Line 1398: inventory_items policy "Users can view inventory in their units"
- Line 1404: inventory_checkouts policy "Users can view checkouts in their units"

#### 3.3 Delete `update_square_updated_at()` function
Remove lines 1094-1100.

#### 3.4 Update triggers to use `update_updated_at()`
Update these triggers (lines 1133-1135):
```sql
-- Change FROM:
CREATE TRIGGER trigger_update_square_credentials_timestamp BEFORE UPDATE ON unit_square_credentials FOR EACH ROW EXECUTE FUNCTION update_square_updated_at();
CREATE TRIGGER trigger_update_square_transactions_timestamp BEFORE UPDATE ON square_transactions FOR EACH ROW EXECUTE FUNCTION update_square_updated_at();
CREATE TRIGGER trigger_update_payment_links_timestamp BEFORE UPDATE ON payment_links FOR EACH ROW EXECUTE FUNCTION update_square_updated_at();

-- Change TO:
CREATE TRIGGER trigger_update_square_credentials_timestamp BEFORE UPDATE ON unit_square_credentials FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_update_square_transactions_timestamp BEFORE UPDATE ON square_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_update_payment_links_timestamp BEFORE UPDATE ON payment_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

### Phase 4: Remove Redundant Columns

#### 4.1 `unit_memberships` table
Remove from table definition (around line 85):
- `is_active BOOLEAN DEFAULT true`
- `scout_ids UUID[] DEFAULT NULL`
- `expires_at TIMESTAMPTZ` (keep `invite_expires_at`)

#### 4.2 `scouts` table
Remove from table definition (around line 130):
- `patrol VARCHAR(100)` (keep `patrol_id UUID`)

#### 4.3 `profiles` table
Remove from table definition (around line 56):
- `patrol VARCHAR(100)`
- `middle_name VARCHAR(100)` (never used)

---

### Phase 5: Fix Inconsistencies

#### 5.1 Change CASCADE deletes to RESTRICT on financial tables

Update these foreign key definitions:

```sql
-- scouts table (line 122)
unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT

-- scout_accounts table (line 192)
scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE RESTRICT

-- journal_entries table (line 207)
unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT

-- payments table (line 270)
unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT

-- billing_records table (line 240)
unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT
```

#### 5.2 Add positive amount constraints

Add CHECK constraints to these tables:

```sql
-- payments table
CONSTRAINT payments_amount_positive CHECK (amount > 0),
CONSTRAINT payments_fee_non_negative CHECK (fee_amount >= 0)

-- billing_charges table
CONSTRAINT billing_charges_amount_positive CHECK (amount > 0)

-- payment_links table
amount INTEGER NOT NULL CHECK (amount > 0),
fee_amount INTEGER DEFAULT 0 CHECK (fee_amount >= 0),

-- events table
max_participants INTEGER CHECK (max_participants IS NULL OR max_participants > 0),
```

#### 5.3 Add missing foreign key indexes

```sql
CREATE INDEX idx_billing_charges_void_je ON billing_charges(void_journal_entry_id) WHERE void_journal_entry_id IS NOT NULL;
CREATE INDEX idx_payments_journal_entry ON payments(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE INDEX idx_journal_entries_created_by ON journal_entries(created_by) WHERE created_by IS NOT NULL;
```

#### 5.4 Add partial indexes for soft deletes

```sql
CREATE INDEX idx_scouts_active_unit ON scouts(unit_id) WHERE is_active = true;
CREATE INDEX idx_payments_not_voided ON payments(unit_id, created_at) WHERE voided_at IS NULL;
CREATE INDEX idx_billing_records_not_void ON billing_records(unit_id, billing_date) WHERE is_void = false;
```

#### 5.5 Update balance semantics comment

```sql
COMMENT ON COLUMN scout_accounts.billing_balance IS
    'Balance owed: Negative = owes unit, Zero = balanced, Positive = credit (auto-transferred to funds)';
```

---

### Phase 6: Update Table Definitions to Use ENUMs

Replace VARCHAR with CHECK constraints to use ENUM types:

#### 6.1 `units` table
```sql
-- Change FROM:
unit_type VARCHAR(20) NOT NULL CHECK (unit_type IN ('troop', 'pack', 'crew', 'ship')),
unit_gender VARCHAR(20) CHECK (unit_gender IN ('boys', 'girls', 'coed')),

-- Change TO:
unit_type unit_type NOT NULL,
unit_gender unit_gender,
```

#### 6.2 `unit_memberships` table
```sql
-- Change FROM:
role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'treasurer', 'leader', 'parent', 'scout')),
status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('roster', 'invited', 'active', 'inactive')),

-- Change TO:
role membership_role NOT NULL,
status membership_status DEFAULT 'active',
```

#### 6.3 `accounts` table
```sql
-- Change FROM:
account_type VARCHAR(50) NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),

-- Change TO:
account_type account_type NOT NULL,
```

#### 6.4 `journal_entries` table
```sql
-- Change FROM:
entry_type VARCHAR(50),

-- Change TO:
entry_type journal_entry_type,
```

#### 6.5 `profiles` table
```sql
-- Change FROM:
gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
swim_classification VARCHAR(20) CHECK (swim_classification IN ('swimmer', 'beginner', 'non-swimmer')),

-- Change TO:
gender gender,
swim_classification swim_classification,
```

#### 6.6 `scouts` table
```sql
-- Change FROM:
gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
swim_classification VARCHAR(20) CHECK (swim_classification IN ('swimmer', 'beginner', 'non-swimmer')),

-- Change TO:
gender gender,
swim_classification swim_classification,
```

#### 6.7 `payments` table
```sql
-- Change FROM:
status VARCHAR(20) DEFAULT 'completed',

-- Change TO:
status payment_status DEFAULT 'completed',
```

#### 6.8 `payment_links` table
```sql
-- Change FROM:
status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),

-- Change TO:
status payment_link_status DEFAULT 'pending',
```

#### 6.9 `sync_sessions` table
```sql
-- Change FROM:
status TEXT NOT NULL CHECK (status IN ('running', 'staged', 'completed', 'failed', 'cancelled')) DEFAULT 'running',

-- Change TO:
status sync_status NOT NULL DEFAULT 'running',
```

#### 6.10 `event_rsvps` table
```sql
-- Change FROM:
status VARCHAR(20) NOT NULL CHECK (status IN ('going', 'not_going', 'maybe')),

-- Change TO:
status rsvp_status NOT NULL,
```

#### 6.11 Update helper functions

Update `user_has_role()` function parameter type:
```sql
-- Change FROM:
CREATE OR REPLACE FUNCTION user_has_role(unit UUID, required_roles TEXT[])

-- Change TO:
CREATE OR REPLACE FUNCTION user_has_role(unit UUID, required_roles membership_role[])
```

Update function calls in RLS policies:
```sql
-- Change FROM:
user_has_role(unit_id, ARRAY['admin', 'treasurer'])

-- Change TO:
user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[])
```

---

### Phase 7: Reorganize init.sql Structure

After all changes, reorganize the file with this structure:

```sql
-- ============================================
-- CHUCKBOX DATABASE SCHEMA
-- Consolidated init file for greenfield deployments
-- ============================================

-- SECTION 0: CUSTOM ENUM TYPES
-- SECTION 1: CORE TABLES (units, profiles, memberships, patrols, scouts, guardians)
-- SECTION 2: FINANCIAL TABLES (accounts, scout_accounts, journal_*, billing_*, payments)
-- SECTION 3: EVENTS TABLES
-- SECTION 4: INVENTORY TABLES
-- SECTION 5: SQUARE INTEGRATION TABLES
-- SECTION 6: SYNC/IMPORT TABLES
-- SECTION 7: ADVANCEMENT TABLES
-- SECTION 8: AUDIT & SYSTEM TABLES
-- SECTION 9: INDEXES
-- SECTION 10: HELPER FUNCTIONS
-- SECTION 11: TRIGGER FUNCTIONS
-- SECTION 12: TRIGGERS
-- SECTION 13: ENABLE ROW LEVEL SECURITY
-- SECTION 14: RLS POLICIES
-- SECTION 15: STORED PROCEDURES / RPC FUNCTIONS
```

**Cleanup tasks:**
- Remove all deleted table references
- Ensure consistent formatting
- Verify all foreign keys reference existing tables
- Verify all indexes reference existing columns
- Verify all RLS policies reference existing tables/columns
- Add section comments for navigation

---

### Phase 8: Regenerate TypeScript Types

After schema changes:
```bash
supabase db push
npx supabase gen types typescript --project-id feownmcpkfugkcivdoal > src/types/database.ts
```

**Verify ENUM types are generated correctly:**
```typescript
// Expected output in database.ts:
export type UnitType = 'troop' | 'pack' | 'crew' | 'ship'
export type MembershipRole = 'admin' | 'treasurer' | 'leader' | 'parent' | 'scout'
export type JournalEntryType = 'billing' | 'payment' | 'refund' | 'reversal' | 'adjustment' | 'funds_transfer' | 'fundraising_credit'
// etc.
```

---

### Phase 9: Update Application Code

Search and update any code references to removed columns or changed types:

#### 9.1 `unit_memberships.is_active`
Search: `is_active` in membership-related code
Replace: Check `status = 'active'` instead

#### 9.2 `scouts.patrol`
Search: `scouts.patrol` or `.patrol` on scout objects
Replace: Use `patrol_id` with join to `patrols` table, or include patrol in query

#### 9.3 `profiles.patrol`
Search: `profiles.patrol`
Replace: Remove any references (was never used for adults)

#### 9.4 `unit_memberships.scout_ids`
Search: `scout_ids` in membership code
Replace: Remove references (legacy, never used)

#### 9.5 ENUM type usage in code
The generated TypeScript types should handle this automatically, but verify:
- Role comparisons use the correct type
- Status comparisons use the correct type
- Any string literals match ENUM values exactly

---

## Testing Checklist

### Database Tests
- [ ] Run `npm run db:fresh` after schema changes
- [ ] Verify ENUM types created successfully
- [ ] Test that RESTRICT prevents unit deletion with financial data
- [ ] Verify all RLS policies work correctly

### Application Tests
- [ ] Verify app loads without errors
- [ ] Test roster import flow
- [ ] Test invite flow (create, accept, expire)
- [ ] Test billing/payment flow
- [ ] Test parent viewing scout accounts
- [ ] Run `npm run build` to check for type errors
- [ ] Run `npm test` to verify all tests pass

### TypeScript Tests
- [ ] Verify ENUM types generate as union types
- [ ] Verify removed columns don't appear in types
- [ ] Verify no type errors in application code

### RLS Tests
- [ ] Verify admin can still manage memberships
- [ ] Verify parent can view their scout's data
- [ ] Verify users can view profiles in their units

---

## Files to Modify

1. `supabase/migrations/00000000000000_init.sql` - Complete schema rewrite
2. `src/types/database.ts` - Regenerate after schema changes
3. Application code files (to be identified during Phase 9)

---

## Risk Assessment

| Change | Risk Level | Mitigation |
|--------|------------|------------|
| Add ENUM types | Low | Greenfield - no data migration needed |
| Drop tables | Medium | Grep codebase for references first |
| Remove columns | Low | TypeScript regeneration catches issues |
| Remove functions | Medium | Update all RLS policies before removing |
| CASCADE→RESTRICT | Low | Prevents accidental data loss |
| Add constraints | Low | Greenfield - no existing data to violate |
| Convert to ENUMs | Low | Greenfield - direct schema change |

---

## Summary of Changes

### Tables Removed (3)
- `unit_invites`
- `sync_snapshots`
- `snapshot_fingerprints`

### Columns Removed (7)
- `unit_memberships.is_active`
- `unit_memberships.scout_ids`
- `unit_memberships.expires_at`
- `scouts.patrol`
- `profiles.patrol`
- `profiles.middle_name`

### Functions Removed (2)
- `get_user_units()`
- `update_square_updated_at()`

### ENUM Types Added (11)
- `unit_type`
- `unit_gender`
- `membership_role`
- `membership_status`
- `account_type`
- `journal_entry_type`
- `gender`
- `swim_classification`
- `payment_status`
- `payment_link_status`
- `sync_status`
- `rsvp_status`
- `invite_status`

### Constraints Added
- Positive amount checks on financial tables
- RESTRICT on financial table foreign keys
- ENUM type constraints (replacing CHECK constraints)

### Indexes Added (6)
- `idx_billing_charges_void_je`
- `idx_payments_journal_entry`
- `idx_journal_entries_created_by`
- `idx_scouts_active_unit`
- `idx_payments_not_voided`
- `idx_billing_records_not_void`
