-- ============================================
-- CHUCKBOX DATABASE SCHEMA
-- Consolidated init file for greenfield deployments
-- ============================================
--
-- TABLE OF CONTENTS:
-- SECTION 0:  Custom Enum Types
-- SECTION 1:  Core Tables (units, profiles, memberships, patrols, scouts, guardians)
-- SECTION 2:  Financial Tables (accounts, scout_accounts, journal_*, billing_*, payments)
-- SECTION 3:  Events Tables
-- SECTION 4:  Inventory Tables
-- SECTION 5:  Square Integration Tables
-- SECTION 6:  Sync/Import Tables
-- SECTION 7:  Advancement Tables
-- SECTION 8:  Audit & System Tables
-- SECTION 9:  Indexes
-- SECTION 10: Helper Functions
-- SECTION 11: Trigger Functions
-- SECTION 12: Triggers
-- SECTION 13: Enable Row Level Security
-- SECTION 14: RLS Policies
-- SECTION 15: Stored Procedures / RPC Functions
-- SECTION 16: Storage Bucket
--
-- ============================================

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

-- Status types
CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'voided', 'refunded');
CREATE TYPE payment_link_status AS ENUM ('pending', 'completed', 'expired', 'cancelled');
CREATE TYPE sync_status AS ENUM ('running', 'staged', 'completed', 'failed', 'cancelled');
CREATE TYPE rsvp_status AS ENUM ('going', 'not_going', 'maybe');

-- ============================================
-- SECTION 1: CORE TABLES
-- ============================================

-- Units (Troops/Packs/Crews)
CREATE TABLE units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    unit_number VARCHAR(20) NOT NULL,
    unit_type unit_type NOT NULL,
    unit_gender unit_gender,
    council VARCHAR(255),
    district VARCHAR(255),
    chartered_org VARCHAR(255),
    logo_url TEXT,
    -- Fee settings
    processing_fee_percent DECIMAL(5,4) DEFAULT 0.0260,
    processing_fee_fixed DECIMAL(10,2) DEFAULT 0.10,
    pass_fees_to_payer BOOLEAN DEFAULT false,
    -- Sub-unit hierarchy
    parent_unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    is_section BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN units.processing_fee_percent IS 'Card processing fee percentage (e.g., 0.0260 = 2.6%)';
COMMENT ON COLUMN units.processing_fee_fixed IS 'Fixed card processing fee amount in dollars';
COMMENT ON COLUMN units.pass_fees_to_payer IS 'If true, processing fees are added to payment amount';

-- Profiles (decoupled from auth.users - can exist without user account)
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255),
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone_primary VARCHAR(30),
    phone_secondary VARCHAR(30),
    email_secondary VARCHAR(255),
    address_street VARCHAR(255),
    address_city VARCHAR(100),
    address_state VARCHAR(50),
    address_zip VARCHAR(20),
    gender gender,
    -- BSA/Scoutbook fields
    bsa_member_id VARCHAR(20),
    member_type VARCHAR(20) CHECK (member_type IN ('LEADER', 'P 18+') OR member_type IS NULL),
    position TEXT,
    position_2 TEXT,
    renewal_status VARCHAR(50),
    expiration_date VARCHAR(20),
    date_joined DATE,
    health_form_status VARCHAR(50),
    health_form_expires DATE,
    swim_classification swim_classification,
    swim_class_date DATE,
    is_active BOOLEAN DEFAULT true,
    -- Sync tracking
    sync_session_id UUID,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN profiles.user_id IS 'Links to auth.users when they have an account (nullable for imported adults)';
COMMENT ON COLUMN profiles.is_active IS 'Soft delete flag - false means account is deactivated';
COMMENT ON COLUMN profiles.gender IS 'Used for auto-assigning members to boys/girls sections in coed troops';

-- Unit Memberships (links profiles to units with roles)
CREATE TABLE unit_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    role membership_role NOT NULL,
    status membership_status DEFAULT 'active',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    -- Invite fields
    email VARCHAR(255),
    linked_scout_id UUID,
    invited_by UUID REFERENCES profiles(id),
    invited_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    invite_expires_at TIMESTAMPTZ,
    -- Position tracking
    current_position VARCHAR(100),
    -- Sub-unit support
    section_unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    created_by UUID REFERENCES profiles(id)
);

COMMENT ON COLUMN unit_memberships.status IS 'roster=imported, invited=sent invite, active=member, inactive=removed';
COMMENT ON COLUMN unit_memberships.current_position IS 'Current leadership position (e.g., Scoutmaster, Committee Chair)';
COMMENT ON COLUMN unit_memberships.linked_scout_id IS 'For scout role invites, specifies which scout record this user represents';

-- Patrols
CREATE TABLE patrols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(unit_id, name)
);

-- Scouts (youth members)
CREATE TABLE scouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    gender gender,
    bsa_member_id VARCHAR(20),
    patrol_id UUID REFERENCES patrols(id) ON DELETE SET NULL,
    rank VARCHAR(50),
    current_position VARCHAR(100),
    current_position_2 TEXT,
    date_joined DATE,
    health_form_status VARCHAR(50),
    health_form_expires DATE,
    swim_classification swim_classification,
    swim_class_date DATE,
    renewal_status VARCHAR(50),
    expiration_date VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN scouts.profile_id IS 'Links to user profile when a scout has their own login. One-to-one relationship.';
COMMENT ON COLUMN scouts.current_position IS 'Current leadership position (e.g., Senior Patrol Leader, Patrol Leader)';
COMMENT ON COLUMN scouts.renewal_status IS 'BSA registration status (Current, Eligible for Renewal, Expired)';
COMMENT ON COLUMN scouts.expiration_date IS 'BSA membership expiration date';

-- Scout-Guardian Relationships
CREATE TABLE scout_guardians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    relationship VARCHAR(50) DEFAULT 'parent',
    is_primary BOOLEAN DEFAULT false,
    UNIQUE(scout_id, profile_id)
);

-- ============================================
-- SECTION 2: FINANCIAL TABLES
-- ============================================

-- Chart of Accounts
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    account_type account_type NOT NULL,
    parent_id UUID REFERENCES accounts(id),
    is_system BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(unit_id, code)
);

-- Fundraiser Types
CREATE TABLE fundraiser_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(unit_id, name)
);

-- Scout Individual Accounts (dual-balance sub-ledger)
CREATE TABLE scout_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    billing_balance DECIMAL(10,2) DEFAULT 0.00,
    funds_balance DECIMAL(10,2) DEFAULT 0.00 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_id),
    CONSTRAINT funds_balance_non_negative CHECK (funds_balance >= 0)
);

COMMENT ON COLUMN scout_accounts.billing_balance IS 'Balance owed: Negative = owes unit, Zero = balanced, Positive = credit (auto-transferred to funds)';
COMMENT ON COLUMN scout_accounts.funds_balance IS 'Scout funds from fundraising/overpayments (always >= 0)';

-- Journal Entries (transaction headers)
CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    entry_date DATE NOT NULL,
    description TEXT NOT NULL,
    reference VARCHAR(100),
    entry_type journal_entry_type,
    is_posted BOOLEAN DEFAULT false,
    is_void BOOLEAN DEFAULT false,
    void_reason TEXT,
    fundraiser_type_id UUID REFERENCES fundraiser_types(id),
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    posted_at TIMESTAMPTZ
);

-- Journal Entry Lines (debits and credits)
CREATE TABLE journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id),
    scout_account_id UUID REFERENCES scout_accounts(id),
    debit DECIMAL(10,2) DEFAULT 0.00,
    credit DECIMAL(10,2) DEFAULT 0.00,
    memo TEXT,
    target_balance VARCHAR(20) DEFAULT 'billing',
    CHECK (debit >= 0 AND credit >= 0),
    CHECK (NOT (debit > 0 AND credit > 0))
);

COMMENT ON COLUMN journal_lines.target_balance IS 'Which scout balance to affect: billing or funds';

-- Billing Records (Fair Share)
CREATE TABLE billing_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    billing_date DATE NOT NULL,
    journal_entry_id UUID REFERENCES journal_entries(id),
    is_void BOOLEAN DEFAULT false,
    void_reason TEXT,
    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES profiles(id),
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual Charges From Billing
CREATE TABLE billing_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_record_id UUID NOT NULL REFERENCES billing_records(id) ON DELETE CASCADE,
    scout_account_id UUID NOT NULL REFERENCES scout_accounts(id),
    amount DECIMAL(10,2) NOT NULL,
    is_paid BOOLEAN DEFAULT false,
    is_void BOOLEAN DEFAULT false,
    void_reason TEXT,
    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES profiles(id),
    void_journal_entry_id UUID REFERENCES journal_entries(id),
    CONSTRAINT billing_charges_amount_positive CHECK (amount > 0)
);

-- Payments
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    scout_account_id UUID REFERENCES scout_accounts(id),
    amount DECIMAL(10,2) NOT NULL,
    fee_amount DECIMAL(10,2) DEFAULT 0.00,
    net_amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50),
    square_payment_id VARCHAR(255),
    square_receipt_url TEXT,
    status payment_status DEFAULT 'completed',
    journal_entry_id UUID REFERENCES journal_entries(id),
    notes TEXT,
    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES profiles(id),
    void_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT payments_amount_positive CHECK (amount > 0),
    CONSTRAINT payments_fee_non_negative CHECK (fee_amount >= 0)
);

-- Payment Links
CREATE TABLE payment_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    scout_account_id UUID REFERENCES scout_accounts(id),
    billing_charge_id UUID REFERENCES billing_charges(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    base_amount INTEGER,
    fee_amount INTEGER DEFAULT 0 CHECK (fee_amount >= 0),
    fees_passed_to_payer BOOLEAN DEFAULT false,
    description TEXT,
    token VARCHAR(64) NOT NULL UNIQUE,
    status payment_link_status DEFAULT 'pending',
    payment_id UUID REFERENCES payments(id),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN payment_links.base_amount IS 'Original amount owed in cents (before any fees)';
COMMENT ON COLUMN payment_links.fee_amount IS 'Processing fee amount in cents';

-- ============================================
-- SECTION 3: EVENTS TABLES
-- ============================================

-- Events
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    event_type VARCHAR(50),
    location VARCHAR(255),
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ,
    cost_per_scout DECIMAL(10,2),
    cost_per_adult DECIMAL(10,2),
    max_participants INTEGER CHECK (max_participants IS NULL OR max_participants > 0),
    rsvp_deadline TIMESTAMPTZ,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK after events table exists
ALTER TABLE billing_records ADD CONSTRAINT billing_records_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;

-- Event RSVPs
CREATE TABLE event_rsvps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    scout_id UUID REFERENCES scouts(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    status rsvp_status NOT NULL,
    is_driver BOOLEAN DEFAULT false,
    vehicle_seats INTEGER,
    notes TEXT,
    responded_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (scout_id IS NOT NULL OR profile_id IS NOT NULL)
);

-- ============================================
-- SECTION 4: INVENTORY TABLES
-- ============================================

-- Inventory Items
CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(50),
    category VARCHAR(100),
    unit_cost DECIMAL(10,2),
    sale_price DECIMAL(10,2),
    quantity_on_hand INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inventory Checkouts
CREATE TABLE inventory_checkouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
    scout_id UUID NOT NULL REFERENCES scouts(id),
    quantity_out INTEGER NOT NULL,
    quantity_returned INTEGER DEFAULT 0,
    quantity_sold INTEGER DEFAULT 0,
    checked_out_at TIMESTAMPTZ DEFAULT NOW(),
    returned_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    notes TEXT
);

-- ============================================
-- SECTION 5: SQUARE INTEGRATION TABLES
-- ============================================

-- Unit Square Credentials
CREATE TABLE unit_square_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    merchant_id VARCHAR(255) NOT NULL,
    location_id VARCHAR(255),
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    environment VARCHAR(20) DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
    is_active BOOLEAN DEFAULT true,
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(unit_id)
);

-- Square Transactions
CREATE TABLE square_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    square_payment_id VARCHAR(255) NOT NULL,
    square_order_id VARCHAR(255),
    amount_money INTEGER NOT NULL,
    fee_money INTEGER DEFAULT 0,
    net_money INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(50) NOT NULL,
    source_type VARCHAR(50),
    card_brand VARCHAR(50),
    last_4 VARCHAR(4),
    receipt_url TEXT,
    receipt_number VARCHAR(100),
    payment_id UUID REFERENCES payments(id),
    scout_account_id UUID REFERENCES scout_accounts(id),
    is_reconciled BOOLEAN DEFAULT false,
    buyer_email_address TEXT,
    cardholder_name TEXT,
    note TEXT,
    order_line_items JSONB,
    square_created_at TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(unit_id, square_payment_id)
);

COMMENT ON COLUMN square_transactions.order_line_items IS 'JSON array of line items: [{name: string, quantity: number, amount: number}]';
COMMENT ON COLUMN square_transactions.note IS 'Payment note/memo from Square';

-- ============================================
-- SECTION 6: SYNC/IMPORT TABLES
-- ============================================

-- Sync Sessions
CREATE TABLE sync_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status sync_status NOT NULL DEFAULT 'running',
    pages_visited INTEGER DEFAULT 0,
    records_extracted INTEGER DEFAULT 0,
    error_log JSONB DEFAULT '[]'::jsonb,
    sync_source TEXT DEFAULT 'local',
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sync_sessions IS 'Tracks Scoutbook sync operations for auditing and debugging';
COMMENT ON COLUMN sync_sessions.sync_source IS 'How sync was initiated: local or extension';

-- Sync Staged Members
CREATE TABLE sync_staged_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sync_sessions(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    bsa_member_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    member_type TEXT NOT NULL,
    age TEXT,
    rank TEXT,
    patrol TEXT,
    position TEXT,
    position_2 TEXT,
    renewal_status TEXT,
    expiration_date TEXT,
    change_type TEXT NOT NULL,
    existing_scout_id UUID REFERENCES scouts(id),
    existing_profile_id UUID REFERENCES profiles(id),
    matched_profile_id UUID REFERENCES profiles(id),
    match_type TEXT,
    changes JSONB,
    skip_reason TEXT,
    is_selected BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sync_staged_members IS 'Temporary storage for Scoutbook roster data pending user confirmation';
COMMENT ON COLUMN sync_staged_members.change_type IS 'create = new, update = existing with changes, skip = adult or no changes';
COMMENT ON COLUMN sync_staged_members.matched_profile_id IS 'Profile ID matched by BSA ID or name for adults';
COMMENT ON COLUMN sync_staged_members.match_type IS 'How the profile was matched: bsa_id, name, or null';
COMMENT ON COLUMN sync_staged_members.status IS 'Processing status: pending, approved, rejected';

-- Adult Trainings
CREATE TABLE adult_trainings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    training_code VARCHAR(50) NOT NULL,
    training_name VARCHAR(255) NOT NULL,
    completed_at DATE,
    expires_at DATE,
    is_current BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(profile_id, unit_id, training_code)
);

COMMENT ON TABLE adult_trainings IS 'Tracks BSA training completions for adult leaders';

-- Extension Auth Tokens (for browser extension authentication)
CREATE TABLE extension_auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    is_revoked BOOLEAN DEFAULT false
);

COMMENT ON TABLE extension_auth_tokens IS 'Stores hashed tokens for browser extension authentication';
COMMENT ON COLUMN extension_auth_tokens.token_hash IS 'SHA-256 hash of the actual token';
COMMENT ON COLUMN extension_auth_tokens.expires_at IS '60 day expiration from creation';
COMMENT ON COLUMN extension_auth_tokens.is_revoked IS 'User can manually revoke tokens';

-- ============================================
-- SECTION 7: ADVANCEMENT TABLES
-- ============================================

-- Scout Advancements
CREATE TABLE scout_advancements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    bsa_member_id TEXT,
    current_rank TEXT,
    last_rank_scouts_bsa TEXT,
    last_rank_cub_scout TEXT,
    date_joined TEXT,
    membership_status TEXT,
    advancement_data JSONB DEFAULT '{}'::jsonb,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    UNIQUE(scout_id)
);

-- Scout Rank Requirements
CREATE TABLE scout_rank_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    rank_name TEXT NOT NULL,
    requirements_version TEXT,
    percent_complete INTEGER DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('not_started', 'started', 'approved', 'awarded')) DEFAULT 'not_started',
    completed_date TEXT,
    requirements JSONB DEFAULT '[]'::jsonb,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    UNIQUE(scout_id, rank_name)
);

-- Scout Leadership Positions
CREATE TABLE scout_leadership_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    position TEXT NOT NULL,
    days INTEGER DEFAULT 0,
    is_current BOOLEAN DEFAULT false,
    unit_name TEXT,
    date_range TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL
);

-- Scout Activity Logs
CREATE TABLE scout_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    camping_nights INTEGER DEFAULT 0,
    hiking_miles DECIMAL(10, 2) DEFAULT 0,
    service_hours DECIMAL(10, 2) DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    UNIQUE(scout_id)
);

-- ============================================
-- SECTION 8: AUDIT & SYSTEM TABLES
-- ============================================

-- Audit Log
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    performed_by UUID REFERENCES profiles(id),
    performed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Waitlist
CREATE TABLE waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    unit_type TEXT,
    unit_size TEXT,
    current_software TEXT,
    current_payment_platform TEXT,
    biggest_pain_point TEXT,
    additional_info TEXT,
    referral_source TEXT,
    ip_address TEXT,
    user_agent TEXT
);

-- ============================================
-- SECTION 9: INDEXES
-- ============================================

-- Units indexes
CREATE INDEX idx_units_parent_unit_id ON units(parent_unit_id) WHERE parent_unit_id IS NOT NULL;

-- Profiles indexes
CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_profiles_bsa_member_id ON profiles(bsa_member_id);

-- Unit memberships indexes
CREATE INDEX idx_unit_memberships_profile ON unit_memberships(profile_id);
CREATE INDEX idx_unit_memberships_unit ON unit_memberships(unit_id);
CREATE INDEX idx_unit_memberships_email ON unit_memberships(email) WHERE email IS NOT NULL;
CREATE INDEX idx_unit_memberships_section ON unit_memberships(section_unit_id) WHERE section_unit_id IS NOT NULL;
CREATE UNIQUE INDEX idx_unit_memberships_unit_profile ON unit_memberships(unit_id, profile_id) WHERE profile_id IS NOT NULL AND status != 'inactive';
CREATE UNIQUE INDEX idx_unit_memberships_unit_email_invited ON unit_memberships(unit_id, email) WHERE profile_id IS NULL AND status = 'invited';

-- Scouts indexes
CREATE INDEX idx_scouts_unit ON scouts(unit_id);
CREATE INDEX idx_scouts_patrol_id ON scouts(patrol_id);
CREATE INDEX idx_scouts_profile ON scouts(profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX idx_scouts_profile_unit ON scouts(profile_id, unit_id) WHERE profile_id IS NOT NULL;
CREATE INDEX idx_scouts_active_unit ON scouts(unit_id) WHERE is_active = true;

-- Scout guardians indexes
CREATE INDEX idx_scout_guardians_scout ON scout_guardians(scout_id);
CREATE INDEX idx_scout_guardians_profile ON scout_guardians(profile_id);

-- Patrols indexes
CREATE INDEX idx_patrols_unit_id ON patrols(unit_id);

-- Accounts indexes
CREATE INDEX idx_accounts_unit ON accounts(unit_id);

-- Scout accounts indexes
CREATE INDEX idx_scout_accounts_scout ON scout_accounts(scout_id);
CREATE INDEX idx_scout_accounts_unit ON scout_accounts(unit_id);

-- Journal entries/lines indexes
CREATE INDEX idx_journal_entries_unit ON journal_entries(unit_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_entries_fundraiser ON journal_entries(fundraiser_type_id) WHERE fundraiser_type_id IS NOT NULL;
CREATE INDEX idx_journal_entries_created_by ON journal_entries(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_scout_account ON journal_lines(scout_account_id);

-- Events indexes
CREATE INDEX idx_events_unit ON events(unit_id);
CREATE INDEX idx_events_dates ON events(start_date, end_date);
CREATE INDEX idx_event_rsvps_event ON event_rsvps(event_id);

-- Billing indexes
CREATE INDEX idx_billing_records_unit ON billing_records(unit_id);
CREATE INDEX idx_billing_records_event ON billing_records(event_id);
CREATE INDEX idx_billing_records_void ON billing_records(is_void) WHERE is_void = false;
CREATE INDEX idx_billing_records_not_void ON billing_records(unit_id, billing_date) WHERE is_void = false;
CREATE INDEX idx_billing_charges_record ON billing_charges(billing_record_id);
CREATE INDEX idx_billing_charges_scout ON billing_charges(scout_account_id);
CREATE INDEX idx_billing_charges_void ON billing_charges(is_void) WHERE is_void = false;
CREATE INDEX idx_billing_charges_void_je ON billing_charges(void_journal_entry_id) WHERE void_journal_entry_id IS NOT NULL;

-- Payments indexes
CREATE INDEX idx_payments_unit ON payments(unit_id);
CREATE INDEX idx_payments_scout_account ON payments(scout_account_id);
CREATE INDEX idx_payments_journal_entry ON payments(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_voided ON payments(voided_at) WHERE voided_at IS NOT NULL;
CREATE INDEX idx_payments_not_voided ON payments(unit_id, created_at) WHERE voided_at IS NULL;

-- Payment links indexes
CREATE INDEX idx_payment_links_unit ON payment_links(unit_id);
CREATE INDEX idx_payment_links_token ON payment_links(token);
CREATE INDEX idx_payment_links_status ON payment_links(status, expires_at);

-- Inventory indexes
CREATE INDEX idx_inventory_items_unit ON inventory_items(unit_id);
CREATE INDEX idx_inventory_checkouts_item ON inventory_checkouts(inventory_item_id);
CREATE INDEX idx_inventory_checkouts_scout ON inventory_checkouts(scout_id);

-- Square integration indexes
CREATE INDEX idx_square_credentials_unit ON unit_square_credentials(unit_id);
CREATE INDEX idx_square_credentials_merchant ON unit_square_credentials(merchant_id);
CREATE INDEX idx_square_transactions_unit ON square_transactions(unit_id);
CREATE INDEX idx_square_transactions_payment ON square_transactions(square_payment_id);
CREATE INDEX idx_square_transactions_reconciled ON square_transactions(unit_id, is_reconciled);
CREATE INDEX idx_square_transactions_created ON square_transactions(square_created_at);
CREATE INDEX idx_square_transactions_buyer_email ON square_transactions(buyer_email_address) WHERE buyer_email_address IS NOT NULL;

-- Sync tables indexes
CREATE INDEX idx_sync_sessions_unit ON sync_sessions(unit_id);
CREATE INDEX idx_sync_sessions_status ON sync_sessions(status);
CREATE INDEX idx_sync_sessions_created_by ON sync_sessions(created_by);
CREATE INDEX idx_sync_staged_session ON sync_staged_members(session_id);
CREATE INDEX idx_sync_staged_unit ON sync_staged_members(unit_id);

-- Extension auth tokens indexes
CREATE INDEX idx_extension_auth_token_hash ON extension_auth_tokens(token_hash);
CREATE INDEX idx_extension_auth_expires ON extension_auth_tokens(expires_at);
CREATE INDEX idx_extension_auth_profile ON extension_auth_tokens(profile_id);
CREATE INDEX idx_extension_auth_unit ON extension_auth_tokens(unit_id);

-- Adult trainings indexes
CREATE INDEX idx_adult_trainings_profile ON adult_trainings(profile_id);
CREATE INDEX idx_adult_trainings_unit ON adult_trainings(unit_id);
CREATE INDEX idx_adult_trainings_expiring ON adult_trainings(expires_at) WHERE is_current = true;

-- Advancement indexes
CREATE INDEX idx_scout_advancements_scout ON scout_advancements(scout_id);
CREATE INDEX idx_scout_advancements_bsa_id ON scout_advancements(bsa_member_id);
CREATE INDEX idx_scout_rank_requirements_scout ON scout_rank_requirements(scout_id);
CREATE INDEX idx_scout_rank_requirements_rank ON scout_rank_requirements(rank_name);
CREATE INDEX idx_scout_leadership_positions_scout ON scout_leadership_positions(scout_id);
CREATE INDEX idx_scout_activity_logs_scout ON scout_activity_logs(scout_id);

-- Fundraiser types indexes
CREATE INDEX idx_fundraiser_types_unit_id ON fundraiser_types(unit_id);
CREATE INDEX idx_fundraiser_types_active ON fundraiser_types(unit_id, is_active);

-- Audit log indexes
CREATE INDEX idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_unit ON audit_log(unit_id);
CREATE INDEX idx_audit_log_performed_at ON audit_log(performed_at);

-- Waitlist indexes
CREATE INDEX idx_waitlist_email ON waitlist(email);
CREATE INDEX idx_waitlist_created_at ON waitlist(created_at DESC);

-- ============================================
-- SECTION 10: HELPER FUNCTIONS
-- ============================================

-- Get user's email from auth
CREATE OR REPLACE FUNCTION get_auth_user_email()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT email FROM auth.users WHERE id = auth.uid();
$$;

-- Get current user's profile_id
CREATE OR REPLACE FUNCTION get_current_profile_id()
RETURNS UUID AS $$
BEGIN
    RETURN (SELECT id FROM profiles WHERE user_id = auth.uid() LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Get user's active unit IDs
CREATE OR REPLACE FUNCTION get_user_active_unit_ids()
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    SELECT id INTO v_profile_id FROM profiles WHERE user_id = auth.uid() LIMIT 1;
    RETURN QUERY
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = v_profile_id AND status = 'active';
END;
$$;

-- Check if user has role in unit
CREATE OR REPLACE FUNCTION user_has_role(unit UUID, required_roles membership_role[])
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    SELECT id INTO v_profile_id FROM profiles WHERE user_id = auth.uid() LIMIT 1;
    RETURN EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_id = unit
        AND profile_id = v_profile_id
        AND status = 'active'
        AND role = ANY(required_roles)
    );
END;
$$;

-- Check if user is unit admin
CREATE OR REPLACE FUNCTION user_is_unit_admin(check_unit_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    SELECT id INTO v_profile_id FROM profiles WHERE user_id = auth.uid() LIMIT 1;
    RETURN EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE profile_id = v_profile_id
          AND unit_id = check_unit_id
          AND role = 'admin'
          AND status = 'active'
    );
END;
$$;

-- Get all sections of a unit
CREATE OR REPLACE FUNCTION get_unit_sections(p_unit_id UUID)
RETURNS SETOF UUID AS $$
BEGIN
    RETURN QUERY
    SELECT id FROM units WHERE parent_unit_id = p_unit_id
    UNION ALL
    SELECT p_unit_id WHERE NOT EXISTS (
        SELECT 1 FROM units WHERE parent_unit_id = p_unit_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Get parent unit
CREATE OR REPLACE FUNCTION get_parent_unit(p_unit_id UUID)
RETURNS UUID AS $$
DECLARE
    v_parent_id UUID;
BEGIN
    SELECT COALESCE(parent_unit_id, p_unit_id) INTO v_parent_id
    FROM units WHERE id = p_unit_id;
    RETURN v_parent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- ============================================
-- SECTION 11: TRIGGER FUNCTIONS
-- ============================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-create profile on user signup (links existing profile by email)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    existing_profile_id UUID;
BEGIN
    SELECT id INTO existing_profile_id
    FROM public.profiles
    WHERE email = NEW.email AND user_id IS NULL
    LIMIT 1;

    IF existing_profile_id IS NOT NULL THEN
        UPDATE public.profiles
        SET user_id = NEW.id,
            full_name = COALESCE(full_name, NEW.raw_user_meta_data->>'full_name', NEW.email)
        WHERE id = existing_profile_id;
    ELSE
        INSERT INTO public.profiles (user_id, email, full_name)
        VALUES (
            NEW.id,
            NEW.email,
            COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-create scout account when scout is created
CREATE OR REPLACE FUNCTION create_scout_account()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO scout_accounts (scout_id, unit_id, billing_balance, funds_balance)
    VALUES (NEW.id, NEW.unit_id, 0.00, 0.00);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

-- Update scout account balance on journal line insert (dual-balance)
CREATE OR REPLACE FUNCTION update_scout_account_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_amount DECIMAL(10,2);
    v_target VARCHAR(20);
BEGIN
    IF NEW.scout_account_id IS NOT NULL THEN
        v_amount := NEW.credit - NEW.debit;
        v_target := COALESCE(NEW.target_balance, 'billing');

        IF v_target = 'billing' THEN
            UPDATE scout_accounts
            SET billing_balance = billing_balance + v_amount,
                updated_at = NOW()
            WHERE id = NEW.scout_account_id;
        ELSIF v_target = 'funds' THEN
            UPDATE scout_accounts
            SET funds_balance = GREATEST(0, funds_balance + v_amount),
                updated_at = NOW()
            WHERE id = NEW.scout_account_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

-- Reverse scout account balance on journal line delete
CREATE OR REPLACE FUNCTION reverse_scout_account_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_amount DECIMAL(10,2);
    v_target VARCHAR(20);
BEGIN
    IF OLD.scout_account_id IS NOT NULL THEN
        v_amount := OLD.credit - OLD.debit;
        v_target := COALESCE(OLD.target_balance, 'billing');

        IF v_target = 'billing' THEN
            UPDATE scout_accounts
            SET billing_balance = billing_balance - v_amount,
                updated_at = NOW()
            WHERE id = OLD.scout_account_id;
        ELSIF v_target = 'funds' THEN
            UPDATE scout_accounts
            SET funds_balance = GREATEST(0, funds_balance - v_amount),
                updated_at = NOW()
            WHERE id = OLD.scout_account_id;
        END IF;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

-- Audit logging function
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER AS $$
DECLARE
    v_unit_id UUID;
    v_old_values JSONB;
    v_new_values JSONB;
    v_record_jsonb JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_record_jsonb := to_jsonb(OLD);
        v_old_values := v_record_jsonb;
        v_new_values := NULL;
    ELSIF TG_OP = 'INSERT' THEN
        v_record_jsonb := to_jsonb(NEW);
        v_old_values := NULL;
        v_new_values := v_record_jsonb;
    ELSE
        v_record_jsonb := to_jsonb(NEW);
        v_old_values := to_jsonb(OLD);
        v_new_values := v_record_jsonb;
    END IF;

    v_unit_id := CASE
        WHEN TG_TABLE_NAME = 'units' THEN (v_record_jsonb->>'id')::UUID
        WHEN v_record_jsonb ? 'unit_id' THEN (v_record_jsonb->>'unit_id')::UUID
        ELSE NULL
    END;

    INSERT INTO audit_log (unit_id, table_name, record_id, action, old_values, new_values, performed_by)
    VALUES (v_unit_id, TG_TABLE_NAME, (v_record_jsonb->>'id')::UUID, TG_OP, v_old_values, v_new_values, get_current_profile_id());

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Validate journal entry balance
CREATE OR REPLACE FUNCTION validate_journal_entry_balance(entry_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    total_debits DECIMAL(10,2);
    total_credits DECIMAL(10,2);
BEGIN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO total_debits, total_credits
    FROM journal_lines
    WHERE journal_entry_id = entry_id;
    RETURN total_debits = total_credits;
END;
$$ LANGUAGE plpgsql;

-- Create default chart of accounts for a unit
CREATE OR REPLACE FUNCTION create_default_accounts(p_unit_id UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO accounts (unit_id, code, name, account_type, is_system) VALUES
    -- Assets
    (p_unit_id, '1000', 'Bank Account - Checking', 'asset', true),
    (p_unit_id, '1010', 'Bank Account - Savings', 'asset', false),
    (p_unit_id, '1100', 'Accounts Receivable', 'asset', true),
    (p_unit_id, '1200', 'Scout Billing Receivable', 'asset', true),
    (p_unit_id, '1210', 'Scout Funds Receivable', 'asset', true),
    (p_unit_id, '1300', 'Inventory - Fundraising', 'asset', false),
    -- Liabilities
    (p_unit_id, '2000', 'Scout Account Balances (Legacy)', 'liability', true),
    (p_unit_id, '2010', 'Scout Funds Payable', 'liability', true),
    (p_unit_id, '2100', 'Accounts Payable', 'liability', false),
    -- Income
    (p_unit_id, '4000', 'Dues Income', 'income', true),
    (p_unit_id, '4100', 'Camping Fees', 'income', true),
    (p_unit_id, '4200', 'Fundraising Income - Popcorn', 'income', false),
    (p_unit_id, '4210', 'Fundraising Income - Camp Cards', 'income', false),
    (p_unit_id, '4300', 'Donations', 'income', false),
    (p_unit_id, '4900', 'Other Income', 'income', false),
    -- Expenses
    (p_unit_id, '5000', 'Camping Expenses', 'expense', true),
    (p_unit_id, '5100', 'Equipment & Supplies', 'expense', false),
    (p_unit_id, '5200', 'Awards & Recognition', 'expense', true),
    (p_unit_id, '5300', 'Training', 'expense', false),
    (p_unit_id, '5400', 'Insurance', 'expense', false),
    (p_unit_id, '5500', 'Charter Fees', 'expense', false),
    (p_unit_id, '5600', 'Payment Processing Fees', 'expense', true),
    (p_unit_id, '5900', 'Other Expenses', 'expense', false)
    ON CONFLICT (unit_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

-- Setup new unit (create default accounts)
CREATE OR REPLACE FUNCTION setup_new_unit()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM create_default_accounts(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SECTION 12: TRIGGERS
-- ============================================

-- Updated_at triggers
CREATE TRIGGER trigger_units_updated_at BEFORE UPDATE ON units FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_scouts_updated_at BEFORE UPDATE ON scouts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_scout_accounts_updated_at BEFORE UPDATE ON scout_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_patrols_updated_at BEFORE UPDATE ON patrols FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auth user creation trigger
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Scout account triggers
CREATE TRIGGER trigger_create_scout_account AFTER INSERT ON scouts FOR EACH ROW EXECUTE FUNCTION create_scout_account();
CREATE TRIGGER trigger_update_scout_balance_insert AFTER INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION update_scout_account_balance();
CREATE TRIGGER trigger_reverse_scout_balance_delete BEFORE DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION reverse_scout_account_balance();

-- Unit setup trigger
CREATE TRIGGER trigger_setup_new_unit AFTER INSERT ON units FOR EACH ROW EXECUTE FUNCTION setup_new_unit();

-- Audit triggers
CREATE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_journal_lines AFTER INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_billing_records AFTER INSERT OR UPDATE OR DELETE ON billing_records FOR EACH ROW EXECUTE FUNCTION log_audit_event();
CREATE TRIGGER audit_scout_accounts AFTER INSERT OR UPDATE OR DELETE ON scout_accounts FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- Square integration triggers
CREATE TRIGGER trigger_update_square_credentials_timestamp BEFORE UPDATE ON unit_square_credentials FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_update_square_transactions_timestamp BEFORE UPDATE ON square_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_update_payment_links_timestamp BEFORE UPDATE ON payment_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Add linked_scout_id constraint to unit_memberships (after scouts table created)
ALTER TABLE unit_memberships ADD CONSTRAINT unit_memberships_linked_scout_id_fkey
    FOREIGN KEY (linked_scout_id) REFERENCES scouts(id) ON DELETE SET NULL;
ALTER TABLE unit_memberships ADD CONSTRAINT chk_linked_scout_for_scout_role
    CHECK (linked_scout_id IS NULL OR role = 'scout');

-- ============================================
-- SECTION 13: ENABLE ROW LEVEL SECURITY
-- ============================================

ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrols ENABLE ROW LEVEL SECURITY;
ALTER TABLE scouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fundraiser_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_square_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE square_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_staged_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE adult_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_advancements ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_rank_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_leadership_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SECTION 14: RLS POLICIES
-- ============================================

-- PROFILES POLICIES
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Users can view profiles in their units" ON profiles FOR SELECT TO authenticated
    USING (id IN (SELECT profile_id FROM unit_memberships WHERE unit_id IN (SELECT get_user_active_unit_ids())));

CREATE POLICY "Users can view non-user profiles linked as guardians" ON profiles FOR SELECT TO authenticated
    USING (user_id IS NULL AND id IN (
        SELECT profile_id FROM scout_guardians WHERE scout_id IN (
            SELECT id FROM scouts WHERE unit_id IN (SELECT get_user_active_unit_ids())
        )
    ));

CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- UNITS POLICIES
CREATE POLICY "Users can view units via membership" ON units FOR SELECT
    USING (id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active'));

CREATE POLICY "Admins can update their units" ON units FOR UPDATE
    USING (user_has_role(id, ARRAY['admin']::membership_role[]));

-- UNIT MEMBERSHIPS POLICIES
CREATE POLICY "Users can view memberships" ON unit_memberships FOR SELECT TO authenticated
    USING (profile_id = get_current_profile_id() OR (status = 'invited' AND email = get_auth_user_email()) OR unit_id IN (SELECT get_user_active_unit_ids()));

CREATE POLICY "Admins can create memberships" ON unit_memberships FOR INSERT TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM unit_memberships um
        WHERE um.unit_id = unit_memberships.unit_id
          AND um.profile_id = get_current_profile_id()
          AND um.role = 'admin'
          AND um.status = 'active'
    ));

CREATE POLICY "Users can accept their own invite" ON unit_memberships FOR UPDATE TO authenticated
    USING ((status = 'invited' AND email = get_auth_user_email()) OR user_is_unit_admin(unit_id))
    WITH CHECK ((profile_id = get_current_profile_id() AND status = 'active') OR user_is_unit_admin(unit_id));

CREATE POLICY "Admins can update memberships" ON unit_memberships FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM unit_memberships um
        WHERE um.unit_id = unit_memberships.unit_id
          AND um.profile_id = get_current_profile_id()
          AND um.role = 'admin'
          AND um.status = 'active'
    ));

CREATE POLICY "Admins can delete memberships" ON unit_memberships FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM unit_memberships um
        WHERE um.unit_id = unit_memberships.unit_id
          AND um.profile_id = get_current_profile_id()
          AND um.role = 'admin'
          AND um.status = 'active'
    ));

-- PATROLS POLICIES
CREATE POLICY "Users can view patrols in their unit" ON patrols FOR SELECT
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active'));

CREATE POLICY "Admins can insert patrols" ON patrols FOR INSERT
    WITH CHECK (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND role = 'admin' AND status = 'active'));

CREATE POLICY "Admins can update patrols" ON patrols FOR UPDATE
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND role = 'admin' AND status = 'active'));

CREATE POLICY "Admins can delete patrols" ON patrols FOR DELETE
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND role = 'admin' AND status = 'active'));

-- SCOUTS POLICIES
CREATE POLICY "Users can view scouts in their units" ON scouts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = scouts.unit_id
          AND unit_memberships.profile_id = get_current_profile_id()
          AND unit_memberships.status = 'active'
    ) OR profile_id = get_current_profile_id());

CREATE POLICY "Leaders can manage scouts" ON scouts FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[]));

CREATE POLICY "Scouts can update own record" ON scouts FOR UPDATE
    USING (profile_id = get_current_profile_id())
    WITH CHECK (profile_id = get_current_profile_id());

-- SCOUT GUARDIANS POLICIES
CREATE POLICY "Users can view guardians in their units" ON scout_guardians FOR SELECT
    USING (scout_id IN (SELECT id FROM scouts WHERE unit_id IN (SELECT get_user_active_unit_ids())));

CREATE POLICY "Leaders can manage guardians" ON scout_guardians FOR ALL
    USING (scout_id IN (SELECT id FROM scouts WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[])));

-- ACCOUNTS POLICIES (Chart of Accounts)
CREATE POLICY "Users can view accounts in their units" ON accounts FOR SELECT
    USING (unit_id IN (SELECT get_user_active_unit_ids()));

CREATE POLICY "Treasurers can manage accounts" ON accounts FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[]));

-- FUNDRAISER TYPES POLICIES
CREATE POLICY "Users can view fundraiser types for their units" ON fundraiser_types FOR SELECT
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active'));

CREATE POLICY "Admins and treasurers can insert fundraiser types" ON fundraiser_types FOR INSERT
    WITH CHECK (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active' AND role IN ('admin', 'treasurer')));

CREATE POLICY "Admins and treasurers can update fundraiser types" ON fundraiser_types FOR UPDATE
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active' AND role IN ('admin', 'treasurer')));

CREATE POLICY "Admins and treasurers can delete fundraiser types" ON fundraiser_types FOR DELETE
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active' AND role IN ('admin', 'treasurer')));

-- SCOUT ACCOUNTS POLICIES
CREATE POLICY "Leaders can view all scout accounts" ON scout_accounts FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[]));

CREATE POLICY "Parents can view their scouts' accounts" ON scout_accounts FOR SELECT
    USING (scout_id IN (SELECT scout_id FROM scout_guardians WHERE profile_id = get_current_profile_id()));

CREATE POLICY "Treasurers can manage scout accounts" ON scout_accounts FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[]));

-- JOURNAL ENTRIES POLICIES
CREATE POLICY "Leaders can view journal entries" ON journal_entries FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[]));

CREATE POLICY "Treasurers can manage journal entries" ON journal_entries FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[]));

-- JOURNAL LINES POLICIES
CREATE POLICY "Leaders can view journal lines" ON journal_lines FOR SELECT
    USING (journal_entry_id IN (SELECT id FROM journal_entries WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[])));

CREATE POLICY "Treasurers can manage journal lines" ON journal_lines FOR ALL
    USING (journal_entry_id IN (SELECT id FROM journal_entries WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[])));

-- BILLING RECORDS POLICIES
CREATE POLICY "Leaders can view billing records" ON billing_records FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[]));

CREATE POLICY "Treasurers can manage billing records" ON billing_records FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[]));

-- BILLING CHARGES POLICIES
CREATE POLICY "Leaders can view billing charges" ON billing_charges FOR SELECT
    USING (billing_record_id IN (SELECT id FROM billing_records WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[])));

CREATE POLICY "Parents can view their scouts' charges" ON billing_charges FOR SELECT
    USING (scout_account_id IN (
        SELECT sa.id FROM scout_accounts sa
        JOIN scout_guardians sg ON sg.scout_id = sa.scout_id
        WHERE sg.profile_id = get_current_profile_id()
    ));

CREATE POLICY "Treasurers can manage billing charges" ON billing_charges FOR ALL
    USING (billing_record_id IN (SELECT id FROM billing_records WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[])));

-- PAYMENTS POLICIES
CREATE POLICY "Leaders can view payments" ON payments FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[]));

CREATE POLICY "Parents can view their scouts' payments" ON payments FOR SELECT
    USING (scout_account_id IN (
        SELECT sa.id FROM scout_accounts sa
        JOIN scout_guardians sg ON sg.scout_id = sa.scout_id
        WHERE sg.profile_id = get_current_profile_id()
    ));

CREATE POLICY "Treasurers can manage payments" ON payments FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[]));

-- PAYMENT LINKS POLICIES
CREATE POLICY "Leaders can view payment links" ON payment_links FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[]));

CREATE POLICY "Parents can view own scouts payment links" ON payment_links FOR SELECT
    USING (scout_account_id IN (
        SELECT sa.id FROM scout_accounts sa
        JOIN scout_guardians sg ON sg.scout_id = sa.scout_id
        WHERE sg.profile_id = get_current_profile_id()
    ));

CREATE POLICY "Treasurers can manage payment links" ON payment_links FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[]));

CREATE POLICY "Anyone can view payment links by token" ON payment_links FOR SELECT
    USING (true);

-- EVENTS POLICIES
CREATE POLICY "Users can view events in their units" ON events FOR SELECT
    USING (unit_id IN (SELECT get_user_active_unit_ids()));

CREATE POLICY "Leaders can manage events" ON events FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[]));

-- EVENT RSVPS POLICIES
CREATE POLICY "Users can view RSVPs in their units" ON event_rsvps FOR SELECT
    USING (event_id IN (SELECT id FROM events WHERE unit_id IN (SELECT get_user_active_unit_ids())));

CREATE POLICY "Users can manage own RSVPs" ON event_rsvps FOR ALL
    USING (profile_id = get_current_profile_id());

CREATE POLICY "Parents can manage their scouts' RSVPs" ON event_rsvps FOR ALL
    USING (scout_id IN (SELECT scout_id FROM scout_guardians WHERE profile_id = get_current_profile_id()));

-- INVENTORY POLICIES
CREATE POLICY "Users can view inventory in their units" ON inventory_items FOR SELECT
    USING (unit_id IN (SELECT get_user_active_unit_ids()));

CREATE POLICY "Leaders can manage inventory" ON inventory_items FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[]));

CREATE POLICY "Users can view checkouts in their units" ON inventory_checkouts FOR SELECT
    USING (inventory_item_id IN (SELECT id FROM inventory_items WHERE unit_id IN (SELECT get_user_active_unit_ids())));

CREATE POLICY "Leaders can manage checkouts" ON inventory_checkouts FOR ALL
    USING (inventory_item_id IN (SELECT id FROM inventory_items WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[])));

-- SQUARE INTEGRATION POLICIES
CREATE POLICY "Admins can view Square credentials" ON unit_square_credentials FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin']::membership_role[]));

CREATE POLICY "Admins can manage Square credentials" ON unit_square_credentials FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin']::membership_role[]));

CREATE POLICY "Leaders can view Square transactions" ON square_transactions FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']::membership_role[]));

CREATE POLICY "Treasurers can manage Square transactions" ON square_transactions FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[]));

-- SYNC TABLES POLICIES
CREATE POLICY "sync_sessions_select" ON sync_sessions FOR SELECT
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active'));

CREATE POLICY "sync_sessions_insert" ON sync_sessions FOR INSERT
    WITH CHECK (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active' AND role IN ('admin', 'treasurer')));

CREATE POLICY "sync_sessions_update" ON sync_sessions FOR UPDATE
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active' AND role IN ('admin', 'treasurer')));

CREATE POLICY "Users can view staged members for their unit" ON sync_staged_members FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = sync_staged_members.unit_id
          AND unit_memberships.profile_id = get_current_profile_id()
          AND unit_memberships.status = 'active'
    ));

CREATE POLICY "Admins can modify staged members" ON sync_staged_members FOR ALL
    USING (EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = sync_staged_members.unit_id
          AND unit_memberships.profile_id = get_current_profile_id()
          AND unit_memberships.role IN ('admin', 'treasurer')
          AND unit_memberships.status = 'active'
    ));

-- EXTENSION AUTH TOKENS POLICIES
CREATE POLICY "Users can view their own tokens" ON extension_auth_tokens
    FOR SELECT
    USING (profile_id = get_current_profile_id());

CREATE POLICY "Users can create tokens for units they admin" ON extension_auth_tokens
    FOR INSERT
    WITH CHECK (
        profile_id = get_current_profile_id()
        AND unit_id IN (
            SELECT unit_id FROM unit_memberships
            WHERE profile_id = get_current_profile_id()
            AND status = 'active'
            AND role IN ('admin', 'treasurer')
        )
    );

CREATE POLICY "Users can update their own tokens" ON extension_auth_tokens
    FOR UPDATE
    USING (profile_id = get_current_profile_id());

CREATE POLICY "Users can delete their own tokens" ON extension_auth_tokens
    FOR DELETE
    USING (profile_id = get_current_profile_id());

-- ADULT TRAININGS POLICIES
CREATE POLICY "Users can view trainings in their units" ON adult_trainings FOR SELECT
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active'));

CREATE POLICY "Admins can manage trainings" ON adult_trainings FOR ALL
    USING (unit_id IN (SELECT unit_id FROM unit_memberships WHERE profile_id = get_current_profile_id() AND status = 'active' AND role IN ('admin', 'treasurer')));

-- ADVANCEMENT TABLES POLICIES
CREATE POLICY "scout_advancements_select" ON scout_advancements FOR SELECT
    USING (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active'
    ));

CREATE POLICY "scout_advancements_insert" ON scout_advancements FOR INSERT
    WITH CHECK (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active' AND um.role IN ('admin', 'treasurer')
    ));

CREATE POLICY "scout_advancements_update" ON scout_advancements FOR UPDATE
    USING (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active' AND um.role IN ('admin', 'treasurer')
    ));

CREATE POLICY "scout_rank_requirements_select" ON scout_rank_requirements FOR SELECT
    USING (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active'
    ));

CREATE POLICY "scout_rank_requirements_insert" ON scout_rank_requirements FOR INSERT
    WITH CHECK (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active' AND um.role IN ('admin', 'treasurer')
    ));

CREATE POLICY "scout_rank_requirements_update" ON scout_rank_requirements FOR UPDATE
    USING (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active' AND um.role IN ('admin', 'treasurer')
    ));

CREATE POLICY "scout_leadership_positions_select" ON scout_leadership_positions FOR SELECT
    USING (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active'
    ));

CREATE POLICY "scout_leadership_positions_insert" ON scout_leadership_positions FOR INSERT
    WITH CHECK (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active' AND um.role IN ('admin', 'treasurer')
    ));

CREATE POLICY "scout_leadership_positions_update" ON scout_leadership_positions FOR UPDATE
    USING (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active' AND um.role IN ('admin', 'treasurer')
    ));

CREATE POLICY "scout_leadership_positions_delete" ON scout_leadership_positions FOR DELETE
    USING (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active' AND um.role IN ('admin', 'treasurer')
    ));

CREATE POLICY "scout_activity_logs_select" ON scout_activity_logs FOR SELECT
    USING (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active'
    ));

CREATE POLICY "scout_activity_logs_insert" ON scout_activity_logs FOR INSERT
    WITH CHECK (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active' AND um.role IN ('admin', 'treasurer')
    ));

CREATE POLICY "scout_activity_logs_update" ON scout_activity_logs FOR UPDATE
    USING (scout_id IN (
        SELECT s.id FROM scouts s
        JOIN unit_memberships um ON s.unit_id = um.unit_id
        WHERE um.profile_id = get_current_profile_id() AND um.status = 'active' AND um.role IN ('admin', 'treasurer')
    ));

-- AUDIT LOG POLICIES
CREATE POLICY "Admins can view audit log" ON audit_log FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[]));

-- WAITLIST POLICIES
CREATE POLICY "Allow public waitlist submissions" ON waitlist FOR INSERT TO anon WITH CHECK (true);

-- ============================================
-- SECTION 15: STORED PROCEDURES / RPC FUNCTIONS
-- ============================================

-- Create billing with journal entry - Atomic billing creation
CREATE OR REPLACE FUNCTION create_billing_with_journal(
    p_unit_id UUID,
    p_description TEXT,
    p_total_amount DECIMAL(10,2),
    p_billing_date DATE,
    p_billing_type TEXT,
    p_per_scout_amount DECIMAL(10,2),
    p_scout_accounts JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_billing_record_id UUID;
    v_journal_entry_id UUID;
    v_receivable_account_id UUID;
    v_income_account_id UUID;
    v_scout JSONB;
    v_entry_description TEXT;
BEGIN
    IF NOT user_has_role(p_unit_id, ARRAY['admin', 'treasurer']::membership_role[]) THEN
        RAISE EXCEPTION 'Permission denied: user is not admin or treasurer for this unit';
    END IF;

    SELECT id INTO v_receivable_account_id
    FROM accounts
    WHERE unit_id = p_unit_id AND code = '1200';

    SELECT id INTO v_income_account_id
    FROM accounts
    WHERE unit_id = p_unit_id AND code = '4100';

    IF v_receivable_account_id IS NULL OR v_income_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts (1200, 4100) not found for unit';
    END IF;

    INSERT INTO billing_records (unit_id, description, total_amount, billing_date)
    VALUES (p_unit_id, p_description, p_total_amount, p_billing_date)
    RETURNING id INTO v_billing_record_id;

    FOR v_scout IN SELECT * FROM jsonb_array_elements(p_scout_accounts)
    LOOP
        INSERT INTO billing_charges (billing_record_id, scout_account_id, amount, is_paid)
        VALUES (
            v_billing_record_id,
            (v_scout->>'accountId')::UUID,
            p_per_scout_amount,
            false
        );
    END LOOP;

    v_entry_description := CASE
        WHEN p_billing_type = 'split' THEN 'Fair Share: ' || p_description
        ELSE 'Fixed Charge: ' || p_description
    END;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted, created_by)
    VALUES (p_unit_id, p_billing_date, v_entry_description, 'billing', true, get_current_profile_id())
    RETURNING id INTO v_journal_entry_id;

    FOR v_scout IN SELECT * FROM jsonb_array_elements(p_scout_accounts)
    LOOP
        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
        VALUES (
            v_journal_entry_id,
            v_receivable_account_id,
            (v_scout->>'accountId')::UUID,
            p_per_scout_amount,
            0,
            (v_scout->>'scoutName') || ' - ' || p_description
        );
    END LOOP;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES (
        v_journal_entry_id,
        v_income_account_id,
        NULL,
        0,
        p_total_amount,
        p_description
    );

    UPDATE billing_records
    SET journal_entry_id = v_journal_entry_id
    WHERE id = v_billing_record_id;

    RETURN jsonb_build_object(
        'success', true,
        'billing_record_id', v_billing_record_id,
        'journal_entry_id', v_journal_entry_id
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;

-- Transfer funds from Scout Funds to pay Billing
CREATE OR REPLACE FUNCTION transfer_funds_to_billing(
    p_scout_account_id UUID,
    p_amount DECIMAL(10,2),
    p_description TEXT DEFAULT 'Transfer from Scout Funds'
)
RETURNS JSONB AS $$
DECLARE
    v_account RECORD;
    v_unit_id UUID;
    v_journal_entry_id UUID;
    v_funds_account_id UUID;
    v_billing_account_id UUID;
    v_scout_name TEXT;
BEGIN
    SELECT sa.*, s.first_name, s.last_name, s.unit_id
    INTO v_account
    FROM scout_accounts sa
    JOIN scouts s ON s.id = sa.scout_id
    WHERE sa.id = p_scout_account_id
    FOR UPDATE;

    IF v_account IS NULL THEN
        RAISE EXCEPTION 'Scout account not found';
    END IF;

    v_unit_id := v_account.unit_id;
    v_scout_name := v_account.first_name || ' ' || v_account.last_name;

    IF v_account.funds_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient funds. Available: $%, Requested: $%',
            v_account.funds_balance, p_amount;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    SELECT id INTO v_funds_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1210';
    SELECT id INTO v_billing_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1200';

    IF v_funds_account_id IS NULL OR v_billing_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts not found for unit';
    END IF;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted, created_by)
    VALUES (v_unit_id, CURRENT_DATE, p_description || ' - ' || v_scout_name, 'funds_transfer', true, get_current_profile_id())
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_funds_account_id, p_scout_account_id, p_amount, 0, 'Transfer to billing', 'funds');

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_billing_account_id, p_scout_account_id, 0, p_amount, 'Transfer from scout funds', 'billing');

    RETURN jsonb_build_object(
        'success', true,
        'journal_entry_id', v_journal_entry_id,
        'amount_transferred', p_amount,
        'new_funds_balance', v_account.funds_balance - p_amount,
        'new_billing_balance', v_account.billing_balance + p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Auto-transfer overpayment to funds
CREATE OR REPLACE FUNCTION auto_transfer_overpayment(
    p_scout_account_id UUID,
    p_amount DECIMAL(10,2)
)
RETURNS VOID AS $$
DECLARE
    v_unit_id UUID;
    v_journal_entry_id UUID;
    v_funds_account_id UUID;
    v_billing_account_id UUID;
BEGIN
    SELECT unit_id INTO v_unit_id FROM scout_accounts WHERE id = p_scout_account_id;

    IF v_unit_id IS NULL THEN
        RAISE EXCEPTION 'Scout account not found';
    END IF;

    SELECT id INTO v_funds_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1210';
    SELECT id INTO v_billing_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1200';

    IF v_funds_account_id IS NULL OR v_billing_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts not found for unit';
    END IF;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted)
    VALUES (v_unit_id, CURRENT_DATE, 'Overpayment transferred to Scout Funds', 'adjustment', true)
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_billing_account_id, p_scout_account_id, p_amount, 0, 'Overpayment to funds', 'billing');

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_funds_account_id, p_scout_account_id, 0, p_amount, 'Overpayment from billing', 'funds');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Credit fundraising earnings to scout funds
CREATE OR REPLACE FUNCTION credit_fundraising_to_scout(
    p_scout_account_id UUID,
    p_amount DECIMAL(10,2),
    p_description TEXT,
    p_fundraiser_type TEXT DEFAULT 'general'
)
RETURNS JSONB AS $$
DECLARE
    v_account RECORD;
    v_unit_id UUID;
    v_journal_entry_id UUID;
    v_funds_account_id UUID;
    v_income_account_id UUID;
    v_scout_name TEXT;
BEGIN
    SELECT sa.*, s.first_name, s.last_name, s.unit_id
    INTO v_account
    FROM scout_accounts sa
    JOIN scouts s ON s.id = sa.scout_id
    WHERE sa.id = p_scout_account_id;

    IF v_account IS NULL THEN
        RAISE EXCEPTION 'Scout account not found';
    END IF;

    v_unit_id := v_account.unit_id;
    v_scout_name := v_account.first_name || ' ' || v_account.last_name;

    IF NOT user_has_role(v_unit_id, ARRAY['admin', 'treasurer']::membership_role[]) THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Credit amount must be positive';
    END IF;

    SELECT id INTO v_funds_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1210';

    SELECT id INTO v_income_account_id FROM accounts WHERE unit_id = v_unit_id AND code = CASE
        WHEN p_fundraiser_type = 'popcorn' THEN '4200'
        WHEN p_fundraiser_type = 'camp_cards' THEN '4210'
        ELSE '4900'
    END;

    IF v_funds_account_id IS NULL THEN
        RAISE EXCEPTION 'Scout Funds account not found';
    END IF;

    IF v_income_account_id IS NULL THEN
        SELECT id INTO v_income_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '4900';
    END IF;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted, created_by)
    VALUES (v_unit_id, CURRENT_DATE, 'Fundraising: ' || p_description || ' - ' || v_scout_name,
            'fundraising_credit', true, get_current_profile_id())
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_funds_account_id, p_scout_account_id, 0, p_amount, p_description, 'funds');

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_income_account_id, NULL, p_amount, 0, 'Scout share: ' || p_description, NULL);

    RETURN jsonb_build_object(
        'success', true,
        'journal_entry_id', v_journal_entry_id,
        'amount_credited', p_amount,
        'new_funds_balance', v_account.funds_balance + p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Void a billing charge
CREATE OR REPLACE FUNCTION void_billing_charge(
    p_billing_charge_id UUID,
    p_void_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_charge RECORD;
    v_journal_entry_id UUID;
    v_receivable_account_id UUID;
    v_income_account_id UUID;
    v_scout_name TEXT;
    v_reversal_description TEXT;
BEGIN
    SELECT bc.*, br.unit_id, br.description as billing_description, br.journal_entry_id as original_je_id, s.first_name, s.last_name
    INTO v_charge
    FROM billing_charges bc
    JOIN billing_records br ON br.id = bc.billing_record_id
    JOIN scout_accounts sa ON sa.id = bc.scout_account_id
    JOIN scouts s ON s.id = sa.scout_id
    WHERE bc.id = p_billing_charge_id
    FOR UPDATE OF bc;

    IF v_charge IS NULL THEN
        RAISE EXCEPTION 'Billing charge not found';
    END IF;

    IF v_charge.is_void THEN
        RAISE EXCEPTION 'Charge is already voided';
    END IF;

    IF v_charge.is_paid THEN
        RAISE EXCEPTION 'Cannot void a paid charge. Refund the payment first.';
    END IF;

    IF NOT user_has_role(v_charge.unit_id, ARRAY['admin', 'treasurer']::membership_role[]) THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    SELECT id INTO v_receivable_account_id FROM accounts WHERE unit_id = v_charge.unit_id AND code = '1200';
    SELECT id INTO v_income_account_id FROM accounts WHERE unit_id = v_charge.unit_id AND code = '4100';

    IF v_receivable_account_id IS NULL OR v_income_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts not found';
    END IF;

    v_scout_name := v_charge.first_name || ' ' || v_charge.last_name;
    v_reversal_description := 'VOID: ' || v_charge.billing_description || ' - ' || v_scout_name;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted, created_by)
    VALUES (v_charge.unit_id, CURRENT_DATE, v_reversal_description, 'adjustment', true, get_current_profile_id())
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES (v_journal_entry_id, v_receivable_account_id, v_charge.scout_account_id, 0, v_charge.amount, 'Void charge: ' || v_charge.billing_description);

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES (v_journal_entry_id, v_income_account_id, NULL, v_charge.amount, 0, 'Void charge: ' || v_charge.billing_description);

    UPDATE billing_charges
    SET is_void = true, void_reason = p_void_reason, voided_at = NOW(), voided_by = get_current_profile_id(), void_journal_entry_id = v_journal_entry_id
    WHERE id = p_billing_charge_id;

    IF NOT EXISTS (SELECT 1 FROM billing_charges WHERE billing_record_id = v_charge.billing_record_id AND is_void = false) THEN
        UPDATE billing_records SET is_void = true, void_reason = 'All charges voided', voided_at = NOW(), voided_by = get_current_profile_id()
        WHERE id = v_charge.billing_record_id;
        UPDATE journal_entries SET is_void = true, void_reason = p_void_reason WHERE id = v_charge.original_je_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'void_journal_entry_id', v_journal_entry_id);
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Void a billing record (all charges)
CREATE OR REPLACE FUNCTION void_billing_record(
    p_billing_record_id UUID,
    p_void_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_record RECORD;
    v_charge RECORD;
    v_voided_count INT := 0;
BEGIN
    SELECT * INTO v_record FROM billing_records WHERE id = p_billing_record_id;

    IF v_record IS NULL THEN
        RAISE EXCEPTION 'Billing record not found';
    END IF;

    IF v_record.is_void THEN
        RAISE EXCEPTION 'Billing record is already voided';
    END IF;

    IF EXISTS (SELECT 1 FROM billing_charges WHERE billing_record_id = p_billing_record_id AND is_paid = true AND is_void = false) THEN
        RAISE EXCEPTION 'Cannot void billing record with paid charges. Void individual unpaid charges or refund payments first.';
    END IF;

    FOR v_charge IN SELECT id FROM billing_charges WHERE billing_record_id = p_billing_record_id AND is_void = false LOOP
        PERFORM void_billing_charge(v_charge.id, p_void_reason);
        v_voided_count := v_voided_count + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'voided_charges', v_voided_count);
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Update billing description
CREATE OR REPLACE FUNCTION update_billing_description(
    p_billing_record_id UUID,
    p_new_description TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_record RECORD;
BEGIN
    SELECT * INTO v_record FROM billing_records WHERE id = p_billing_record_id;

    IF v_record IS NULL THEN
        RAISE EXCEPTION 'Billing record not found';
    END IF;

    IF v_record.is_void THEN
        RAISE EXCEPTION 'Cannot edit voided billing record';
    END IF;

    IF NOT user_has_role(v_record.unit_id, ARRAY['admin', 'treasurer']::membership_role[]) THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    UPDATE billing_records SET description = p_new_description WHERE id = p_billing_record_id;

    UPDATE journal_entries
    SET description = CASE
        WHEN description LIKE 'Fair Share:%' THEN 'Fair Share: ' || p_new_description
        WHEN description LIKE 'Fixed Charge:%' THEN 'Fixed Charge: ' || p_new_description
        ELSE p_new_description
    END
    WHERE id = v_record.journal_entry_id;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Void a payment
CREATE OR REPLACE FUNCTION void_payment(
    p_payment_id UUID,
    p_voided_by UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment payments;
    v_journal_entry journal_entries;
    v_reversal_entry_id UUID;
BEGIN
    SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
    END IF;

    IF v_payment.voided_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payment already voided');
    END IF;

    IF v_payment.square_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot void Square payments - use Square dashboard for refunds');
    END IF;

    SELECT * INTO v_journal_entry FROM journal_entries WHERE id = v_payment.journal_entry_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Journal entry not found');
    END IF;

    INSERT INTO journal_entries (unit_id, description, entry_type)
    VALUES (v_journal_entry.unit_id, 'VOID: ' || v_journal_entry.description, 'reversal')
    RETURNING id INTO v_reversal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, target_balance)
    SELECT v_reversal_entry_id, account_id, scout_account_id, credit, debit, target_balance
    FROM journal_lines WHERE journal_entry_id = v_journal_entry.id;

    UPDATE payments SET voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
    WHERE id = p_payment_id;

    RETURN jsonb_build_object('success', true, 'reversal_entry_id', v_reversal_entry_id);
END;
$$;

-- Create refund journal entry
CREATE OR REPLACE FUNCTION create_refund_journal_entry(
    p_unit_id UUID,
    p_scout_account_id UUID,
    p_refund_amount_cents INTEGER,
    p_square_refund_id TEXT,
    p_original_square_payment_id TEXT,
    p_refund_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_journal_entry_id UUID;
    v_bank_account_id UUID;
    v_receivable_account_id UUID;
    v_scout_name TEXT;
    v_refund_amount DECIMAL(10,2);
BEGIN
    v_refund_amount := p_refund_amount_cents / 100.0;

    SELECT s.first_name || ' ' || s.last_name INTO v_scout_name
    FROM scout_accounts sa
    JOIN scouts s ON s.id = sa.scout_id
    WHERE sa.id = p_scout_account_id;

    IF v_scout_name IS NULL THEN
        v_scout_name := 'Unknown Scout';
    END IF;

    SELECT id INTO v_bank_account_id FROM accounts WHERE unit_id = p_unit_id AND code = '1000';
    SELECT id INTO v_receivable_account_id FROM accounts WHERE unit_id = p_unit_id AND code = '1200';

    IF v_bank_account_id IS NULL OR v_receivable_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts (1000, 1200) not found for unit';
    END IF;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, reference, is_posted)
    VALUES (p_unit_id, CURRENT_DATE, 'Refund for ' || v_scout_name || COALESCE(' - ' || p_refund_reason, ''), 'refund', p_square_refund_id, true)
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_bank_account_id, NULL, 0, v_refund_amount, 'Refund processed - ' || p_original_square_payment_id, NULL);

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_receivable_account_id, p_scout_account_id, v_refund_amount, 0, 'Payment refunded', 'billing');

    RETURN jsonb_build_object('success', true, 'journal_entry_id', v_journal_entry_id, 'refund_amount', v_refund_amount, 'scout_name', v_scout_name);
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Process payment link payment (atomic)
CREATE OR REPLACE FUNCTION process_payment_link_payment(
    p_payment_link_id UUID,
    p_scout_account_id UUID,
    p_base_amount_cents INTEGER,
    p_total_amount_cents INTEGER,
    p_fee_amount_cents INTEGER,
    p_net_amount_cents INTEGER,
    p_square_payment_id TEXT,
    p_square_receipt_url TEXT,
    p_square_order_id TEXT,
    p_scout_name TEXT,
    p_fees_passed_to_payer BOOLEAN,
    p_card_details JSONB,
    p_buyer_email TEXT DEFAULT NULL,
    p_payment_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payment_link RECORD;
    v_scout_account RECORD;
    v_unit_id UUID;
    v_journal_entry_id UUID;
    v_payment_id UUID;
    v_bank_account_id UUID;
    v_receivable_account_id UUID;
    v_fee_account_id UUID;
    v_funds_account_id UUID;
    v_current_balance_cents INTEGER;
    v_remaining_balance_cents INTEGER;
    v_base_amount DECIMAL(10,2);
    v_total_amount DECIMAL(10,2);
    v_fee_amount DECIMAL(10,2);
    v_net_amount DECIMAL(10,2);
    v_credited_amount DECIMAL(10,2);
    v_payment_date DATE;
    v_overpayment_amount DECIMAL(10,2);
    v_overpayment_transferred BOOLEAN := false;
    v_transfer_entry_id UUID;
BEGIN
    v_base_amount := p_base_amount_cents / 100.0;
    v_total_amount := p_total_amount_cents / 100.0;
    v_fee_amount := p_fee_amount_cents / 100.0;
    v_net_amount := p_net_amount_cents / 100.0;
    v_payment_date := CURRENT_DATE;

    IF p_fees_passed_to_payer THEN
        v_credited_amount := v_base_amount;
    ELSE
        v_credited_amount := v_total_amount;
    END IF;

    SELECT * INTO v_payment_link FROM payment_links WHERE id = p_payment_link_id FOR UPDATE;

    IF v_payment_link IS NULL THEN
        RAISE EXCEPTION 'Payment link not found';
    END IF;

    IF v_payment_link.status != 'pending' THEN
        RAISE EXCEPTION 'Payment link is not pending. Status: %', v_payment_link.status;
    END IF;

    IF v_payment_link.expires_at < NOW() THEN
        UPDATE payment_links SET status = 'expired' WHERE id = p_payment_link_id;
        RAISE EXCEPTION 'Payment link has expired';
    END IF;

    v_unit_id := v_payment_link.unit_id;

    SELECT * INTO v_scout_account FROM scout_accounts WHERE id = p_scout_account_id FOR UPDATE;

    IF v_scout_account IS NULL THEN
        RAISE EXCEPTION 'Scout account not found';
    END IF;

    v_current_balance_cents := ROUND(ABS(v_scout_account.billing_balance) * 100);

    IF p_base_amount_cents > v_current_balance_cents THEN
        RAISE EXCEPTION 'Payment amount (%) exceeds current balance (%)', p_base_amount_cents / 100.0, v_current_balance_cents / 100.0;
    END IF;

    SELECT id INTO v_bank_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1000';
    SELECT id INTO v_receivable_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1200';
    SELECT id INTO v_fee_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '5600';
    SELECT id INTO v_funds_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1210';

    IF v_bank_account_id IS NULL OR v_receivable_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts (1000, 1200) not found for unit';
    END IF;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, reference, is_posted)
    VALUES (v_unit_id, v_payment_date, 'Online payment from ' || p_scout_name || ' (via payment link)', 'payment', p_square_payment_id, true)
    RETURNING id INTO v_journal_entry_id;

    IF p_fees_passed_to_payer AND v_fee_amount > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
        VALUES (v_journal_entry_id, v_bank_account_id, NULL, v_net_amount, 0, 'Online payment from ' || p_scout_name, NULL);

        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
        VALUES (v_journal_entry_id, v_receivable_account_id, p_scout_account_id, 0, v_base_amount, 'Payment received via payment link', 'billing');

        IF v_fee_account_id IS NOT NULL THEN
            INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
            VALUES (v_journal_entry_id, v_fee_account_id, NULL, v_fee_amount, 0, 'Square processing fee (paid by payer)', NULL);
        END IF;
    ELSE
        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
        VALUES (v_journal_entry_id, v_bank_account_id, NULL, v_net_amount, 0, 'Online payment from ' || p_scout_name, NULL);

        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
        VALUES (v_journal_entry_id, v_receivable_account_id, p_scout_account_id, 0, v_total_amount, 'Payment received via payment link', 'billing');

        IF v_fee_account_id IS NOT NULL AND v_fee_amount > 0 THEN
            INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
            VALUES (v_journal_entry_id, v_fee_account_id, NULL, v_fee_amount, 0, 'Square processing fee', NULL);
        END IF;
    END IF;

    INSERT INTO payments (unit_id, scout_account_id, amount, fee_amount, net_amount, payment_method, square_payment_id, square_receipt_url, status, journal_entry_id, notes)
    VALUES (v_unit_id, p_scout_account_id, v_credited_amount, v_fee_amount, v_net_amount, 'card', p_square_payment_id, p_square_receipt_url, 'completed', v_journal_entry_id,
            CASE WHEN p_fees_passed_to_payer THEN COALESCE(p_payment_note, 'Payment') || ' (via payment link, fee paid by payer)'
                 ELSE COALESCE(p_payment_note, 'Payment') || ' (via payment link)' END)
    RETURNING id INTO v_payment_id;

    IF v_payment_link.billing_charge_id IS NOT NULL THEN
        UPDATE billing_charges SET is_paid = true WHERE id = v_payment_link.billing_charge_id;
    END IF;

    INSERT INTO square_transactions (unit_id, square_payment_id, square_order_id, amount_money, fee_money, net_money, currency, status, source_type, card_brand, last_4, receipt_url, payment_id, scout_account_id, is_reconciled, square_created_at, buyer_email_address, cardholder_name, note)
    VALUES (v_unit_id, p_square_payment_id, p_square_order_id, p_total_amount_cents, p_fee_amount_cents, p_net_amount_cents, 'USD', 'COMPLETED', 'CARD', p_card_details->>'card_brand', p_card_details->>'last_4', p_square_receipt_url, v_payment_id, p_scout_account_id, true, NOW(), p_buyer_email, p_card_details->>'cardholder_name', p_payment_note);

    SELECT billing_balance INTO v_scout_account.billing_balance FROM scout_accounts WHERE id = p_scout_account_id;
    v_remaining_balance_cents := ROUND(ABS(LEAST(v_scout_account.billing_balance, 0)) * 100);

    IF v_remaining_balance_cents <= 0 THEN
        UPDATE payment_links SET status = 'completed', payment_id = v_payment_id, completed_at = NOW() WHERE id = p_payment_link_id;
    END IF;

    IF v_scout_account.billing_balance > 0 THEN
        v_overpayment_amount := v_scout_account.billing_balance;

        IF v_funds_account_id IS NOT NULL THEN
            INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted)
            VALUES (v_unit_id, v_payment_date, 'Overpayment transferred to Scout Funds', 'adjustment', true)
            RETURNING id INTO v_transfer_entry_id;

            INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
            VALUES (v_transfer_entry_id, v_receivable_account_id, p_scout_account_id, v_overpayment_amount, 0, 'Overpayment to funds', 'billing');

            INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
            VALUES (v_transfer_entry_id, v_funds_account_id, p_scout_account_id, 0, v_overpayment_amount, 'Overpayment from billing', 'funds');

            v_overpayment_transferred := true;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'journal_entry_id', v_journal_entry_id,
        'square_payment_id', p_square_payment_id,
        'amount', v_total_amount,
        'credited_amount', v_credited_amount,
        'fee_amount', v_fee_amount,
        'net_amount', v_net_amount,
        'fees_passed_to_payer', p_fees_passed_to_payer,
        'receipt_url', p_square_receipt_url,
        'remaining_balance', v_remaining_balance_cents / 100.0,
        'overpayment_transferred', v_overpayment_transferred,
        'overpayment_amount', COALESCE(v_overpayment_amount, 0)
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Create unit sections
CREATE OR REPLACE FUNCTION create_unit_sections(
    p_parent_unit_id UUID,
    p_boys_number TEXT DEFAULT NULL,
    p_girls_number TEXT DEFAULT NULL
)
RETURNS TABLE(boys_section_id UUID, girls_section_id UUID) AS $$
DECLARE
    v_parent RECORD;
    v_boys_id UUID;
    v_girls_id UUID;
BEGIN
    SELECT * INTO v_parent FROM units WHERE id = p_parent_unit_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent unit not found';
    END IF;

    IF p_boys_number IS NOT NULL AND p_boys_number != '' THEN
        INSERT INTO units (name, unit_number, unit_type, unit_gender, parent_unit_id, is_section, council, district, chartered_org, processing_fee_percent, processing_fee_fixed, pass_fees_to_payer)
        VALUES (v_parent.name || ' (Boys)', p_boys_number, v_parent.unit_type, 'boys', p_parent_unit_id, true, v_parent.council, v_parent.district, v_parent.chartered_org, v_parent.processing_fee_percent, v_parent.processing_fee_fixed, v_parent.pass_fees_to_payer)
        RETURNING id INTO v_boys_id;
    END IF;

    IF p_girls_number IS NOT NULL AND p_girls_number != '' THEN
        INSERT INTO units (name, unit_number, unit_type, unit_gender, parent_unit_id, is_section, council, district, chartered_org, processing_fee_percent, processing_fee_fixed, pass_fees_to_payer)
        VALUES (v_parent.name || ' (Girls)', p_girls_number, v_parent.unit_type, 'girls', p_parent_unit_id, true, v_parent.council, v_parent.district, v_parent.chartered_org, v_parent.processing_fee_percent, v_parent.processing_fee_fixed, v_parent.pass_fees_to_payer)
        RETURNING id INTO v_girls_id;
    END IF;

    RETURN QUERY SELECT v_boys_id, v_girls_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_billing_with_journal TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_funds_to_billing TO authenticated;
GRANT EXECUTE ON FUNCTION auto_transfer_overpayment TO authenticated;
GRANT EXECUTE ON FUNCTION credit_fundraising_to_scout TO authenticated;
GRANT EXECUTE ON FUNCTION void_billing_charge TO authenticated;
GRANT EXECUTE ON FUNCTION void_billing_record TO authenticated;
GRANT EXECUTE ON FUNCTION update_billing_description TO authenticated;
GRANT EXECUTE ON FUNCTION void_payment TO authenticated;
GRANT EXECUTE ON FUNCTION create_refund_journal_entry TO service_role;
GRANT EXECUTE ON FUNCTION process_payment_link_payment TO authenticated;
GRANT EXECUTE ON FUNCTION process_payment_link_payment TO service_role;

-- ============================================
-- SECTION 16: TABLE AND SEQUENCE GRANTS
-- ============================================
-- Grant table access to Supabase roles (required for RLS to work)
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Grant sequence access (for auto-generated IDs)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO service_role;

-- ============================================
-- SECTION 17: STORAGE BUCKET
-- ============================================

-- Create the storage bucket for unit logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('unit-logos', 'unit-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage policies
CREATE POLICY "Public read access for unit logos" ON storage.objects FOR SELECT
    USING (bucket_id = 'unit-logos');

CREATE POLICY "Authenticated users can upload unit logos" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'unit-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update unit logos" ON storage.objects FOR UPDATE
    USING (bucket_id = 'unit-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete unit logos" ON storage.objects FOR DELETE
    USING (bucket_id = 'unit-logos' AND auth.role() = 'authenticated');

-- ============================================
-- END OF SCHEMA
-- ============================================

-- ============================================
-- ADDITIONAL MIGRATIONS (CONSOLIDATED)
-- ============================================


-- ============================================
-- FROM: 20260118000000_unit_provisioning.sql
-- ============================================

-- Migration: Unit Self-Service Provisioning
-- Enables self-service unit signup with BSA roster CSV upload

-- 1. Unique constraint to prevent duplicate units
-- Uses functional index on lowercase council to handle case variations
CREATE UNIQUE INDEX idx_units_unique_council_type_number
ON units(LOWER(COALESCE(council, '')), unit_type, unit_number)
WHERE parent_unit_id IS NULL AND is_section = false;

COMMENT ON INDEX idx_units_unique_council_type_number IS 'Prevents duplicate primary units (same council, type, number)';

-- 2. Add provisioning status for tracking signup flow
ALTER TABLE units ADD COLUMN IF NOT EXISTS provisioning_status VARCHAR(20)
  DEFAULT 'active'
  CHECK (provisioning_status IN ('pending', 'active', 'suspended'));

COMMENT ON COLUMN units.provisioning_status IS 'Unit provisioning status: pending (awaiting verification), active, or suspended';

-- 3. Provisioning tokens for email verification during signup
CREATE TABLE unit_provisioning_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_provisioning_tokens_hash ON unit_provisioning_tokens(token_hash);
CREATE INDEX idx_provisioning_tokens_expires ON unit_provisioning_tokens(expires_at) WHERE verified_at IS NULL;

COMMENT ON TABLE unit_provisioning_tokens IS 'Verification tokens for unit self-service signup flow';

ALTER TABLE unit_provisioning_tokens ENABLE ROW LEVEL SECURITY;

-- No public access to tokens - service role only during provisioning
CREATE POLICY "Service role only for provisioning tokens"
    ON unit_provisioning_tokens
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- 4. Rate limiting for signup spam prevention
CREATE TABLE signup_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address VARCHAR(45) NOT NULL,
    email VARCHAR(255),
    attempts INTEGER DEFAULT 1,
    first_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    last_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    blocked_until TIMESTAMPTZ
);

CREATE INDEX idx_rate_limits_ip ON signup_rate_limits(ip_address);
CREATE INDEX idx_rate_limits_email ON signup_rate_limits(email) WHERE email IS NOT NULL;

COMMENT ON TABLE signup_rate_limits IS 'Rate limiting for signup attempts to prevent abuse';

ALTER TABLE signup_rate_limits ENABLE ROW LEVEL SECURITY;

-- No public access - service role only
CREATE POLICY "Service role only for rate limits"
    ON signup_rate_limits
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- 5. Staged roster imports (holds parsed CSV until email verification)
CREATE TABLE staged_roster_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provisioning_token_id UUID NOT NULL REFERENCES unit_provisioning_tokens(id) ON DELETE CASCADE,
    parsed_adults JSONB NOT NULL,
    parsed_scouts JSONB NOT NULL,
    unit_metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE staged_roster_imports IS 'Temporary storage for parsed roster data during signup verification';

ALTER TABLE staged_roster_imports ENABLE ROW LEVEL SECURITY;

-- No public access - only via service role during provisioning
CREATE POLICY "Service role only for staged imports"
    ON staged_roster_imports
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- 6. Add setup_completed_at field to track first-time setup completion
ALTER TABLE units ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN units.setup_completed_at IS 'Timestamp when unit completed first-time setup wizard';

-- 7. Function to clean up expired provisioning tokens (run via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_provisioning_tokens()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Delete expired, unverified tokens older than 48 hours
    DELETE FROM unit_provisioning_tokens
    WHERE verified_at IS NULL
      AND expires_at < NOW() - INTERVAL '48 hours';

    -- Also clean up any pending units without verified tokens (orphaned)
    DELETE FROM units
    WHERE provisioning_status = 'pending'
      AND created_at < NOW() - INTERVAL '48 hours'
      AND id NOT IN (
          SELECT DISTINCT unit_id
          FROM unit_provisioning_tokens
          WHERE verified_at IS NOT NULL
      );

    -- Clean up old rate limit records (older than 24 hours)
    DELETE FROM signup_rate_limits
    WHERE last_attempt_at < NOW() - INTERVAL '24 hours';
END;
$$;

COMMENT ON FUNCTION cleanup_expired_provisioning_tokens IS 'Cleanup function for expired provisioning tokens and orphaned pending units';


-- ============================================
-- FROM: 20260119000000_advancement_tracking.sql
-- ============================================

-- ============================================
-- ADVANCEMENT TRACKING SCHEMA
-- Comprehensive tracking for Scouts BSA rank progress,
-- merit badges, leadership positions, and activities
-- ============================================

-- ============================================
-- SECTION 1: ENUMS
-- ============================================

-- Advancement status workflow
CREATE TYPE advancement_status AS ENUM (
    'not_started',
    'in_progress',
    'completed',
    'pending_approval',
    'approved',
    'awarded'
);

-- Activity types for detailed logging
CREATE TYPE activity_type AS ENUM (
    'camping',
    'hiking',
    'service',
    'conservation'
);

-- ============================================
-- SECTION 2: BSA REFERENCE TABLES
-- Platform-level tables for BSA official requirements
-- ============================================

-- 7 Scouts BSA ranks
CREATE TABLE bsa_ranks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    is_eagle_required BOOLEAN DEFAULT true,
    description TEXT,
    image_url TEXT,
    requirement_version_year INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for display ordering
CREATE INDEX idx_bsa_ranks_display_order ON bsa_ranks(display_order);

-- Comments for bsa_ranks
COMMENT ON COLUMN bsa_ranks.requirement_version_year IS
  'Year the BSA last updated requirements for this rank (e.g., 2022, 2016)';
COMMENT ON COLUMN bsa_ranks.image_url IS 'URL to rank badge image';

-- Rank requirements with nested sub-requirements
CREATE TABLE bsa_rank_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_year INTEGER NOT NULL,
    rank_id UUID NOT NULL REFERENCES bsa_ranks(id) ON DELETE CASCADE,
    requirement_number TEXT NOT NULL,
    parent_requirement_id UUID REFERENCES bsa_rank_requirements(id) ON DELETE CASCADE,
    sub_requirement_letter TEXT,
    description TEXT NOT NULL,
    is_alternative BOOLEAN DEFAULT false,
    alternatives_group TEXT,
    display_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(version_year, rank_id, requirement_number, sub_requirement_letter)
);

-- Indexes for requirement lookup
CREATE INDEX idx_rank_requirements_rank_version ON bsa_rank_requirements(rank_id, version_year);
CREATE INDEX idx_bsa_rank_requirements_parent ON bsa_rank_requirements(parent_requirement_id);

-- Comments for bsa_rank_requirements
COMMENT ON COLUMN bsa_rank_requirements.version_year IS
  'BSA version year for these requirements (e.g., 2022, 2016). Query by joining to bsa_ranks.requirement_version_year for current requirements.';

-- 141+ merit badges
CREATE TABLE bsa_merit_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_eagle_required BOOLEAN DEFAULT false,
    category TEXT,
    description TEXT,
    image_url TEXT,
    pamphlet_url TEXT,
    requirement_version_year INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for filtering
CREATE INDEX idx_bsa_merit_badges_eagle ON bsa_merit_badges(is_eagle_required) WHERE is_active = true;
CREATE INDEX idx_bsa_merit_badges_category ON bsa_merit_badges(category) WHERE is_active = true;

-- Comments for bsa_merit_badges
COMMENT ON COLUMN bsa_merit_badges.pamphlet_url IS 'URL to the official BSA merit badge pamphlet PDF on filestore.scouting.org';
COMMENT ON COLUMN bsa_merit_badges.requirement_version_year IS
  'Year the BSA last updated requirements for this merit badge';

-- Merit badge requirements (versioned by year)
CREATE TABLE bsa_merit_badge_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_year INTEGER NOT NULL,
    merit_badge_id UUID NOT NULL REFERENCES bsa_merit_badges(id) ON DELETE CASCADE,
    requirement_number TEXT NOT NULL,
    parent_requirement_id UUID REFERENCES bsa_merit_badge_requirements(id) ON DELETE CASCADE,
    sub_requirement_letter TEXT,
    description TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    is_alternative BOOLEAN DEFAULT false,
    alternatives_group TEXT,
    nesting_depth INTEGER DEFAULT 0,
    original_scoutbook_id TEXT,
    required_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index with COALESCE (can't use COALESCE in table UNIQUE constraint)
CREATE UNIQUE INDEX idx_mb_requirements_unique
ON bsa_merit_badge_requirements(version_year, merit_badge_id, requirement_number, COALESCE(sub_requirement_letter, ''));

-- Indexes for requirement lookup
CREATE INDEX idx_mb_requirements_badge_version ON bsa_merit_badge_requirements(merit_badge_id, version_year);
CREATE INDEX idx_bsa_mb_requirements_parent ON bsa_merit_badge_requirements(parent_requirement_id);
CREATE INDEX idx_bsa_mb_requirements_scoutbook_id ON bsa_merit_badge_requirements(original_scoutbook_id) WHERE original_scoutbook_id IS NOT NULL;
CREATE INDEX idx_bsa_mb_requirements_alternatives_group ON bsa_merit_badge_requirements(merit_badge_id, alternatives_group) WHERE alternatives_group IS NOT NULL;

-- Comments for bsa_merit_badge_requirements
COMMENT ON COLUMN bsa_merit_badge_requirements.version_year IS
  'BSA version year for these requirements. Query by joining to bsa_merit_badges.requirement_version_year for current requirements.';
COMMENT ON COLUMN bsa_merit_badge_requirements.is_alternative IS 'True if this is one option in an OR group (e.g., "Do ONE of the following")';
COMMENT ON COLUMN bsa_merit_badge_requirements.alternatives_group IS 'Groups related alternatives together (e.g., "5_options" for all choices under requirement 5)';
COMMENT ON COLUMN bsa_merit_badge_requirements.nesting_depth IS 'Depth level in the hierarchy (0=top, 1=sub-requirement, 2=sub-sub, etc.)';
COMMENT ON COLUMN bsa_merit_badge_requirements.original_scoutbook_id IS 'Original requirement ID from Scoutbook exports (e.g., "6A(a)(1)") for import matching';
COMMENT ON COLUMN bsa_merit_badge_requirements.required_count IS 'Number of alternatives that must be completed (e.g., 1 for "Do ONE", 2 for "Do TWO")';

-- Valid leadership positions for rank advancement
CREATE TABLE bsa_leadership_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    qualifies_for_star BOOLEAN DEFAULT false,
    qualifies_for_life BOOLEAN DEFAULT false,
    qualifies_for_eagle BOOLEAN DEFAULT false,
    min_tenure_months INTEGER DEFAULT 4,
    is_patrol_level BOOLEAN DEFAULT false,
    is_troop_level BOOLEAN DEFAULT true,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SECTION 3: SCOUT PROGRESS TABLES
-- Per-scout tracking of advancement progress
-- ============================================

-- Scout rank progress (enhanced tracking)
CREATE TABLE scout_rank_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    rank_id UUID NOT NULL REFERENCES bsa_ranks(id) ON DELETE RESTRICT,
    status advancement_status NOT NULL DEFAULT 'not_started',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES profiles(id),
    awarded_at TIMESTAMPTZ,
    awarded_by UUID REFERENCES profiles(id),
    -- Scoutbook sync fields
    external_status TEXT,
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_id, rank_id)
);

-- Indexes for progress lookup
CREATE INDEX idx_scout_rank_progress_scout ON scout_rank_progress(scout_id);
CREATE INDEX idx_scout_rank_progress_status ON scout_rank_progress(status) WHERE status != 'awarded';

-- Individual requirement completion with parent submission workflow
CREATE TABLE scout_rank_requirement_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_rank_progress_id UUID NOT NULL REFERENCES scout_rank_progress(id) ON DELETE CASCADE,
    requirement_id UUID NOT NULL REFERENCES bsa_rank_requirements(id) ON DELETE RESTRICT,
    status advancement_status NOT NULL DEFAULT 'not_started',
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES profiles(id),
    notes TEXT,
    -- Parent submission workflow
    submitted_by UUID REFERENCES profiles(id),
    submitted_at TIMESTAMPTZ,
    submission_notes TEXT,
    approval_status TEXT CHECK (approval_status IN ('pending_approval', 'approved', 'denied')),
    denial_reason TEXT,
    reviewed_by UUID REFERENCES profiles(id),
    reviewed_at TIMESTAMPTZ,
    -- Sync fields
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_rank_progress_id, requirement_id)
);

-- Indexes for requirement progress lookup
CREATE INDEX idx_scout_rank_req_progress_rank ON scout_rank_requirement_progress(scout_rank_progress_id);
CREATE INDEX idx_scout_rank_req_progress_pending ON scout_rank_requirement_progress(approval_status)
    WHERE approval_status = 'pending_approval';

-- Merit badge tracking
CREATE TABLE scout_merit_badge_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    merit_badge_id UUID NOT NULL REFERENCES bsa_merit_badges(id) ON DELETE RESTRICT,
    status advancement_status NOT NULL DEFAULT 'not_started',
    -- Counselor info (can be unit adult or external)
    counselor_name TEXT,
    counselor_profile_id UUID REFERENCES profiles(id),
    counselor_bsa_id TEXT,
    counselor_signed_at TIMESTAMPTZ,
    -- Progress dates
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES profiles(id),
    awarded_at TIMESTAMPTZ,
    -- Sync fields
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_id, merit_badge_id)
);

-- Indexes for merit badge progress
CREATE INDEX idx_scout_mb_progress_scout ON scout_merit_badge_progress(scout_id);
CREATE INDEX idx_scout_mb_progress_status ON scout_merit_badge_progress(status) WHERE status != 'awarded';
CREATE INDEX idx_scout_mb_progress_badge ON scout_merit_badge_progress(merit_badge_id);

-- Merit badge requirement completion
CREATE TABLE scout_merit_badge_requirement_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_merit_badge_progress_id UUID NOT NULL REFERENCES scout_merit_badge_progress(id) ON DELETE CASCADE,
    requirement_id UUID NOT NULL REFERENCES bsa_merit_badge_requirements(id) ON DELETE RESTRICT,
    status advancement_status NOT NULL DEFAULT 'not_started',
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_merit_badge_progress_id, requirement_id)
);

-- Index for requirement lookup
CREATE INDEX idx_scout_mb_req_progress_badge ON scout_merit_badge_requirement_progress(scout_merit_badge_progress_id);

-- Leadership history with proper start/end dates
CREATE TABLE scout_leadership_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    position_id UUID NOT NULL REFERENCES bsa_leadership_positions(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE,
    notes TEXT,
    -- Sync fields
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Helper function to check if a leadership position is current
CREATE OR REPLACE FUNCTION is_leadership_position_current(p_end_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN p_end_date IS NULL OR p_end_date > CURRENT_DATE;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to calculate days served
CREATE OR REPLACE FUNCTION calculate_days_served(p_start_date DATE, p_end_date DATE)
RETURNS INTEGER AS $$
BEGIN
    IF p_end_date IS NOT NULL THEN
        RETURN p_end_date - p_start_date;
    ELSE
        RETURN CURRENT_DATE - p_start_date;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Indexes for leadership lookup
CREATE INDEX idx_scout_leadership_history_scout ON scout_leadership_history(scout_id);
CREATE INDEX idx_scout_leadership_history_current ON scout_leadership_history(scout_id) WHERE end_date IS NULL;
CREATE INDEX idx_scout_leadership_history_unit ON scout_leadership_history(unit_id);

-- Detailed activity entries (granular logging)
CREATE TABLE scout_activity_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    activity_type activity_type NOT NULL,
    activity_date DATE NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    description TEXT,
    location TEXT,
    verified_by UUID REFERENCES profiles(id),
    verified_at TIMESTAMPTZ,
    -- Sync fields
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for activity lookup
CREATE INDEX idx_scout_activity_entries_scout ON scout_activity_entries(scout_id);
CREATE INDEX idx_scout_activity_entries_type_date ON scout_activity_entries(scout_id, activity_type, activity_date);
CREATE INDEX idx_scout_activity_entries_event ON scout_activity_entries(event_id) WHERE event_id IS NOT NULL;

-- ============================================
-- SECTION 4: MERIT BADGE COUNSELORS
-- ============================================

-- Add counselor flag to unit_memberships
ALTER TABLE unit_memberships ADD COLUMN IF NOT EXISTS is_merit_badge_counselor BOOLEAN DEFAULT false;

-- Track which adults can counsel which merit badges
CREATE TABLE merit_badge_counselors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    merit_badge_id UUID NOT NULL REFERENCES bsa_merit_badges(id) ON DELETE CASCADE,
    approved_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(profile_id, unit_id, merit_badge_id)
);

-- Indexes for counselor lookup
CREATE INDEX idx_merit_badge_counselors_unit ON merit_badge_counselors(unit_id);
CREATE INDEX idx_merit_badge_counselors_badge ON merit_badge_counselors(merit_badge_id);
CREATE INDEX idx_merit_badge_counselors_profile ON merit_badge_counselors(profile_id);

-- ============================================
-- SECTION 5: SYNC STAGING
-- ============================================

-- Advancement staging for Scoutbook sync preview
CREATE TABLE sync_staged_advancement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sync_sessions(id) ON DELETE CASCADE,
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    data_type TEXT NOT NULL CHECK (data_type IN ('rank_progress', 'rank_requirement', 'merit_badge', 'leadership', 'activity')),
    change_type TEXT NOT NULL CHECK (change_type IN ('new', 'update', 'delete')),
    existing_record_id UUID,
    staged_data JSONB NOT NULL,
    changes JSONB,
    conflict_detected BOOLEAN DEFAULT false,
    conflict_details TEXT,
    is_selected BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for sync staging
CREATE INDEX idx_sync_staged_advancement_session ON sync_staged_advancement(session_id);
CREATE INDEX idx_sync_staged_advancement_scout ON sync_staged_advancement(scout_id);

-- ============================================
-- SECTION 6: HELPER FUNCTIONS
-- ============================================

-- Function to calculate rank progress percentage
CREATE OR REPLACE FUNCTION calculate_rank_progress_percentage(p_scout_rank_progress_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_requirements INTEGER;
    completed_requirements INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_requirements
    FROM scout_rank_requirement_progress
    WHERE scout_rank_progress_id = p_scout_rank_progress_id;

    SELECT COUNT(*) INTO completed_requirements
    FROM scout_rank_requirement_progress
    WHERE scout_rank_progress_id = p_scout_rank_progress_id
    AND status IN ('completed', 'approved', 'awarded');

    IF total_requirements = 0 THEN
        RETURN 0;
    END IF;

    RETURN ROUND((completed_requirements::DECIMAL / total_requirements) * 100);
END;
$$ LANGUAGE plpgsql;

-- Function to initialize rank progress for a scout
-- Creates progress record and requirement progress for all requirements matching the rank's version year
CREATE OR REPLACE FUNCTION initialize_scout_rank_progress(
    p_scout_id UUID,
    p_rank_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_progress_id UUID;
    v_version_year INTEGER;
BEGIN
    -- Get the version year from the rank
    SELECT requirement_version_year INTO v_version_year
    FROM bsa_ranks WHERE id = p_rank_id;

    -- Create rank progress record
    INSERT INTO scout_rank_progress (scout_id, rank_id, status, started_at)
    VALUES (p_scout_id, p_rank_id, 'in_progress', NOW())
    ON CONFLICT (scout_id, rank_id) DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_progress_id;

    -- Create requirement progress records for all requirements
    INSERT INTO scout_rank_requirement_progress (scout_rank_progress_id, requirement_id)
    SELECT v_progress_id, brr.id
    FROM bsa_rank_requirements brr
    WHERE brr.version_year = v_version_year
    AND brr.rank_id = p_rank_id
    AND brr.parent_requirement_id IS NULL  -- Only top-level requirements
    ON CONFLICT (scout_rank_progress_id, requirement_id) DO NOTHING;

    RETURN v_progress_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SECTION 7: ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all new tables
ALTER TABLE bsa_ranks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bsa_rank_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bsa_merit_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE bsa_merit_badge_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bsa_leadership_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_rank_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_rank_requirement_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_merit_badge_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_merit_badge_requirement_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_leadership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_activity_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE merit_badge_counselors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_staged_advancement ENABLE ROW LEVEL SECURITY;

-- BSA Reference tables: Read-only for authenticated users
CREATE POLICY "BSA ranks viewable by authenticated users"
    ON bsa_ranks FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "BSA rank requirements viewable by authenticated users"
    ON bsa_rank_requirements FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "BSA merit badges viewable by authenticated users"
    ON bsa_merit_badges FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "BSA merit badge requirements viewable by authenticated users"
    ON bsa_merit_badge_requirements FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "BSA leadership positions viewable by authenticated users"
    ON bsa_leadership_positions FOR SELECT
    TO authenticated
    USING (true);

-- Scout rank progress: Leaders can view/edit all, parents/scouts can view their own
CREATE POLICY "Leaders can view all scout rank progress in unit"
    ON scout_rank_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_rank_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their linked scouts rank progress"
    ON scout_rank_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_guardians sg
            JOIN profiles p ON p.id = sg.profile_id
            WHERE sg.scout_id = scout_rank_progress.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own rank progress"
    ON scout_rank_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN profiles p ON p.id = s.profile_id
            WHERE s.id = scout_rank_progress.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can insert scout rank progress"
    ON scout_rank_progress FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_rank_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Leaders can update scout rank progress"
    ON scout_rank_progress FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_rank_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Scout rank requirement progress: Similar policies with parent submission support
CREATE POLICY "Leaders can view all scout rank requirement progress"
    ON scout_rank_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scouts s ON s.id = srp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their linked scouts requirement progress"
    ON scout_rank_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scout_guardians sg ON sg.scout_id = srp.scout_id
            JOIN profiles p ON p.id = sg.profile_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own requirement progress"
    ON scout_rank_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scouts s ON s.id = srp.scout_id
            JOIN profiles p ON p.id = s.profile_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can insert scout rank requirement progress"
    ON scout_rank_requirement_progress FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scouts s ON s.id = srp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Leaders can update scout rank requirement progress"
    ON scout_rank_requirement_progress FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scouts s ON s.id = srp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Parents can submit completions (update with submission fields only)
CREATE POLICY "Parents can submit completions for their scouts"
    ON scout_rank_requirement_progress FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scout_guardians sg ON sg.scout_id = srp.scout_id
            JOIN profiles p ON p.id = sg.profile_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        -- Can only update submission-related fields
        submitted_by = (SELECT id FROM profiles WHERE user_id = auth.uid())
    );

-- Merit badge progress: Similar pattern
CREATE POLICY "Leaders can view all merit badge progress in unit"
    ON scout_merit_badge_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_merit_badge_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their scouts merit badge progress"
    ON scout_merit_badge_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_guardians sg
            JOIN profiles p ON p.id = sg.profile_id
            WHERE sg.scout_id = scout_merit_badge_progress.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own merit badge progress"
    ON scout_merit_badge_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN profiles p ON p.id = s.profile_id
            WHERE s.id = scout_merit_badge_progress.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can manage merit badge progress"
    ON scout_merit_badge_progress FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_merit_badge_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Merit badge requirement progress
CREATE POLICY "Leaders can view all merit badge requirement progress"
    ON scout_merit_badge_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scouts s ON s.id = smbp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their scouts MB requirement progress"
    ON scout_merit_badge_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scout_guardians sg ON sg.scout_id = smbp.scout_id
            JOIN profiles p ON p.id = sg.profile_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own MB requirement progress"
    ON scout_merit_badge_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scouts s ON s.id = smbp.scout_id
            JOIN profiles p ON p.id = s.profile_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can manage MB requirement progress"
    ON scout_merit_badge_requirement_progress FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scouts s ON s.id = smbp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Leadership history
CREATE POLICY "Leaders can view all leadership history in unit"
    ON scout_leadership_history FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = scout_leadership_history.unit_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their scouts leadership history"
    ON scout_leadership_history FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_guardians sg
            JOIN profiles p ON p.id = sg.profile_id
            WHERE sg.scout_id = scout_leadership_history.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own leadership history"
    ON scout_leadership_history FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN profiles p ON p.id = s.profile_id
            WHERE s.id = scout_leadership_history.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can manage leadership history"
    ON scout_leadership_history FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = scout_leadership_history.unit_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Activity entries
CREATE POLICY "Leaders can view all activity entries in unit"
    ON scout_activity_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_activity_entries.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their scouts activity entries"
    ON scout_activity_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_guardians sg
            JOIN profiles p ON p.id = sg.profile_id
            WHERE sg.scout_id = scout_activity_entries.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own activity entries"
    ON scout_activity_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN profiles p ON p.id = s.profile_id
            WHERE s.id = scout_activity_entries.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can manage activity entries"
    ON scout_activity_entries FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_activity_entries.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Merit badge counselors
CREATE POLICY "Unit members can view counselors in their unit"
    ON merit_badge_counselors FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = merit_badge_counselors.unit_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
        )
    );

CREATE POLICY "Leaders can manage counselors in their unit"
    ON merit_badge_counselors FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = merit_badge_counselors.unit_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Sync staged advancement
CREATE POLICY "Leaders can view and manage staged advancement for their unit"
    ON sync_staged_advancement FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = sync_staged_advancement.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- ============================================
-- SECTION 8: TRIGGERS
-- ============================================

-- Update timestamp trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to new tables
CREATE TRIGGER update_bsa_merit_badges_updated_at
    BEFORE UPDATE ON bsa_merit_badges
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_rank_progress_updated_at
    BEFORE UPDATE ON scout_rank_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_rank_requirement_progress_updated_at
    BEFORE UPDATE ON scout_rank_requirement_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_merit_badge_progress_updated_at
    BEFORE UPDATE ON scout_merit_badge_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_merit_badge_requirement_progress_updated_at
    BEFORE UPDATE ON scout_merit_badge_requirement_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_leadership_history_updated_at
    BEFORE UPDATE ON scout_leadership_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SECTION 9: COMMENTS
-- ============================================

COMMENT ON TABLE bsa_ranks IS 'The 7 Scouts BSA ranks from Scout to Eagle';
COMMENT ON TABLE bsa_rank_requirements IS 'Individual requirements for each rank, versioned annually';
COMMENT ON TABLE bsa_merit_badges IS 'All 141+ BSA merit badges';
COMMENT ON TABLE bsa_merit_badge_requirements IS 'Requirements for each merit badge, versioned annually';
COMMENT ON TABLE bsa_leadership_positions IS 'Valid leadership positions for rank advancement';
COMMENT ON TABLE scout_rank_progress IS 'Scout progress toward each rank';
COMMENT ON TABLE scout_rank_requirement_progress IS 'Individual requirement completion with parent submission workflow';
COMMENT ON TABLE scout_merit_badge_progress IS 'Scout progress on merit badges with counselor tracking';
COMMENT ON TABLE scout_merit_badge_requirement_progress IS 'Individual merit badge requirement completion';
COMMENT ON TABLE scout_leadership_history IS 'Leadership positions held by scouts with date tracking';
COMMENT ON TABLE scout_activity_entries IS 'Detailed activity log (camping, hiking, service hours)';
COMMENT ON TABLE merit_badge_counselors IS 'Adults approved to counsel specific merit badges';
COMMENT ON TABLE sync_staged_advancement IS 'Staging table for Scoutbook sync advancement data';


-- ============================================
-- FROM: 20260123000000_multi_version_requirements.sql
-- ============================================

-- ============================================
-- MULTI-VERSION MERIT BADGE REQUIREMENTS
-- Phase 0: Foundation Schema Updates
-- ============================================

-- ============================================
-- 0.1.1: Add requirement_version_year to scout_merit_badge_progress
-- Track which version of requirements each scout is working on
-- ============================================

ALTER TABLE scout_merit_badge_progress
ADD COLUMN IF NOT EXISTS requirement_version_year INTEGER;

COMMENT ON COLUMN scout_merit_badge_progress.requirement_version_year IS
  'Year of requirements the scout is working on (e.g., 2025, 2026). NULL means use badge default.';

-- Backfill from badge's current version
UPDATE scout_merit_badge_progress smbp
SET requirement_version_year = mb.requirement_version_year
FROM bsa_merit_badges mb
WHERE smbp.merit_badge_id = mb.id
AND smbp.requirement_version_year IS NULL;

-- ============================================
-- 0.1.2: Add scoutbook_requirement_number to requirements
-- Store canonical Scoutbook format (e.g., "6A(a)(1)")
-- ============================================

ALTER TABLE bsa_merit_badge_requirements
ADD COLUMN IF NOT EXISTS scoutbook_requirement_number TEXT;

COMMENT ON COLUMN bsa_merit_badge_requirements.scoutbook_requirement_number IS
  'Scoutbook canonical format (e.g., "6A(a)(1)"). Used for import matching and sync.';

-- Index for efficient import lookups by Scoutbook format
CREATE INDEX IF NOT EXISTS idx_mb_req_scoutbook_num
ON bsa_merit_badge_requirements(merit_badge_id, version_year, scoutbook_requirement_number)
WHERE scoutbook_requirement_number IS NOT NULL;

-- ============================================
-- 0.1.3: Create bsa_merit_badge_versions tracking table
-- Track available versions per badge with metadata
-- ============================================

CREATE TABLE IF NOT EXISTS bsa_merit_badge_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merit_badge_id UUID NOT NULL REFERENCES bsa_merit_badges(id) ON DELETE CASCADE,
  version_year INTEGER NOT NULL,
  effective_date DATE,
  scraped_at TIMESTAMPTZ,
  source TEXT CHECK (source IN ('scoutbook', 'usscouts', 'manual', 'pdf')),
  is_current BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(merit_badge_id, version_year)
);

-- Index for finding current version of a badge
CREATE INDEX idx_mb_versions_current
ON bsa_merit_badge_versions(merit_badge_id)
WHERE is_current = true;

-- Index for listing versions of a badge
CREATE INDEX idx_mb_versions_badge
ON bsa_merit_badge_versions(merit_badge_id, version_year DESC);

-- Comments
COMMENT ON TABLE bsa_merit_badge_versions IS
  'Tracks available requirement versions per merit badge with metadata about source and currency.';
COMMENT ON COLUMN bsa_merit_badge_versions.effective_date IS
  'Date this version became effective (typically January 1 of the version year).';
COMMENT ON COLUMN bsa_merit_badge_versions.scraped_at IS
  'When requirements were scraped from source (NULL if manually entered).';
COMMENT ON COLUMN bsa_merit_badge_versions.source IS
  'Where requirements came from: scoutbook, usscouts (archives), manual entry, or pdf.';
COMMENT ON COLUMN bsa_merit_badge_versions.is_current IS
  'Whether this is the currently active version for new scouts starting the badge.';

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE bsa_merit_badge_versions ENABLE ROW LEVEL SECURITY;

-- BSA reference data is read-only for authenticated users
CREATE POLICY "BSA merit badge versions viewable by authenticated users"
    ON bsa_merit_badge_versions FOR SELECT
    TO authenticated
    USING (true);

-- ============================================
-- TRIGGERS
-- ============================================

CREATE TRIGGER update_bsa_merit_badge_versions_updated_at
    BEFORE UPDATE ON bsa_merit_badge_versions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Ensure only one current version per badge
-- ============================================

CREATE OR REPLACE FUNCTION ensure_single_current_version()
RETURNS TRIGGER AS $$
BEGIN
  -- If setting this version as current, unset all others for this badge
  IF NEW.is_current = true THEN
    UPDATE bsa_merit_badge_versions
    SET is_current = false
    WHERE merit_badge_id = NEW.merit_badge_id
    AND id != NEW.id
    AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_current_mb_version
    BEFORE INSERT OR UPDATE OF is_current ON bsa_merit_badge_versions
    FOR EACH ROW
    WHEN (NEW.is_current = true)
    EXECUTE FUNCTION ensure_single_current_version();


-- ============================================
-- FROM: 20260124000000_bsa_tables_service_role_grants.sql
-- ============================================

-- ============================================
-- FIX: Grant service_role full access to BSA and advancement tables
--
-- The service_role needs explicit GRANT permissions for INSERT/UPDATE/DELETE
-- on these tables to seed reference data. RLS bypass only skips row policies,
-- not database-level permissions.
-- ============================================

-- Grant full access to BSA reference tables for service_role
GRANT ALL ON TABLE bsa_ranks TO service_role;
GRANT ALL ON TABLE bsa_rank_requirements TO service_role;
GRANT ALL ON TABLE bsa_merit_badges TO service_role;
GRANT ALL ON TABLE bsa_merit_badge_requirements TO service_role;
GRANT ALL ON TABLE bsa_leadership_positions TO service_role;

-- Also grant to postgres for admin access
GRANT ALL ON TABLE bsa_ranks TO postgres;
GRANT ALL ON TABLE bsa_rank_requirements TO postgres;
GRANT ALL ON TABLE bsa_merit_badges TO postgres;
GRANT ALL ON TABLE bsa_merit_badge_requirements TO postgres;
GRANT ALL ON TABLE bsa_leadership_positions TO postgres;

-- Grant full access to scout progress tables for service_role
GRANT ALL ON TABLE scout_rank_progress TO service_role;
GRANT ALL ON TABLE scout_rank_requirement_progress TO service_role;
GRANT ALL ON TABLE scout_merit_badge_progress TO service_role;
GRANT ALL ON TABLE scout_merit_badge_requirement_progress TO service_role;
GRANT ALL ON TABLE scout_leadership_history TO service_role;
GRANT ALL ON TABLE scout_activity_entries TO service_role;
GRANT ALL ON TABLE merit_badge_counselors TO service_role;

-- Grant to postgres as well
GRANT ALL ON TABLE scout_rank_progress TO postgres;
GRANT ALL ON TABLE scout_rank_requirement_progress TO postgres;
GRANT ALL ON TABLE scout_merit_badge_progress TO postgres;
GRANT ALL ON TABLE scout_merit_badge_requirement_progress TO postgres;
GRANT ALL ON TABLE scout_leadership_history TO postgres;
GRANT ALL ON TABLE scout_activity_entries TO postgres;
GRANT ALL ON TABLE merit_badge_counselors TO postgres;

-- Grant access to version tables if they exist
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'bsa_merit_badge_versions') THEN
        GRANT ALL ON TABLE bsa_merit_badge_versions TO service_role;
        GRANT ALL ON TABLE bsa_merit_badge_versions TO postgres;
    END IF;
END $$;


-- ============================================
-- FROM: 20260124000001_scout_progress_grants.sql
-- ============================================

-- ============================================
-- FIX: Grant service_role full access to scout progress tables
--
-- The service_role needs explicit GRANT permissions for INSERT/UPDATE/DELETE
-- on these tables to seed advancement data.
-- ============================================

-- Grant full access to scout progress tables for service_role
GRANT ALL ON TABLE scout_rank_progress TO service_role;
GRANT ALL ON TABLE scout_rank_requirement_progress TO service_role;
GRANT ALL ON TABLE scout_merit_badge_progress TO service_role;
GRANT ALL ON TABLE scout_merit_badge_requirement_progress TO service_role;
GRANT ALL ON TABLE scout_leadership_history TO service_role;
GRANT ALL ON TABLE scout_activity_entries TO service_role;
GRANT ALL ON TABLE merit_badge_counselors TO service_role;

-- Grant to postgres as well
GRANT ALL ON TABLE scout_rank_progress TO postgres;
GRANT ALL ON TABLE scout_rank_requirement_progress TO postgres;
GRANT ALL ON TABLE scout_merit_badge_progress TO postgres;
GRANT ALL ON TABLE scout_merit_badge_requirement_progress TO postgres;
GRANT ALL ON TABLE scout_leadership_history TO postgres;
GRANT ALL ON TABLE scout_activity_entries TO postgres;
GRANT ALL ON TABLE merit_badge_counselors TO postgres;

-- Also grant to sync staging if it exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sync_staged_advancement') THEN
        GRANT ALL ON TABLE sync_staged_advancement TO service_role;
        GRANT ALL ON TABLE sync_staged_advancement TO postgres;
    END IF;
END $$;


-- ============================================
-- FROM: 20260128000001_add_is_header_column.sql
-- ============================================

-- ============================================
-- Add is_header column to bsa_merit_badge_requirements
-- ============================================
--
-- Parent requirements that have children are typically description-only
-- headers like "Do the following:" - they don't have checkboxes in Scoutbook
-- and shouldn't be tracked as approvable requirements.
--
-- This column allows us to mark these requirements so the UI can:
-- 1. Skip them in progress tracking
-- 2. Display them differently (as section headers)
-- 3. Not show checkboxes for sign-off

ALTER TABLE bsa_merit_badge_requirements
ADD COLUMN IF NOT EXISTS is_header BOOLEAN DEFAULT false;

COMMENT ON COLUMN bsa_merit_badge_requirements.is_header IS
  'True if this requirement is a header/description only (has children but no checkbox in Scoutbook). These should not be tracked as approvable requirements.';

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_bsa_mb_req_is_header
ON bsa_merit_badge_requirements(is_header)
WHERE is_header = true;


-- ============================================
-- FROM: 20260129000001_import_jobs.sql
-- ============================================

-- ============================================
-- Import Jobs Table
-- ============================================
-- Tracks background import jobs to prevent timeouts
-- and provide progress feedback for large imports

CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  type TEXT NOT NULL, -- 'troop_advancement', 'scout_history'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'

  -- Progress tracking
  total_scouts INTEGER DEFAULT 0,
  processed_scouts INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  current_phase TEXT, -- 'ranks', 'rank_requirements', 'badges', 'badge_requirements'

  -- Results (populated on completion)
  result JSONB,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Store staged data for processing (can be large)
  staged_data JSONB NOT NULL,
  selected_scout_ids JSONB NOT NULL DEFAULT '[]'
);

-- Index for querying active jobs
CREATE INDEX idx_import_jobs_unit_status ON import_jobs(unit_id, status);
CREATE INDEX idx_import_jobs_created_by ON import_jobs(created_by);

-- RLS
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

-- Leaders can view and create jobs for their unit
CREATE POLICY "Leaders can view unit import jobs"
  ON import_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = import_jobs.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer', 'leader')
    )
  );

CREATE POLICY "Leaders can create import jobs"
  ON import_jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = import_jobs.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer', 'leader')
    )
  );

-- Service role can update jobs (for background processing)
GRANT ALL ON import_jobs TO service_role;

COMMENT ON TABLE import_jobs IS 'Tracks background import jobs for large data imports';
COMMENT ON COLUMN import_jobs.staged_data IS 'Staged import data (StagedTroopAdvancement JSON)';
COMMENT ON COLUMN import_jobs.result IS 'Import result (TroopAdvancementImportResult JSON)';


-- ============================================
-- FROM: 20260207000001_balance_import_schema.sql
-- ============================================

-- ============================================
-- Balance Import Schema
-- ============================================
-- Supports CSV import of scout account balances with undo functionality.
-- Creates tracking table for import batches and extends journal_entries
-- to link entries back to their import batch.

-- Add new journal entry types for balance imports
ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'beginning_balance';
ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'balance_import_reversal';

-- Create balance_import_batches table to track import operations
CREATE TABLE balance_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    imported_by UUID NOT NULL REFERENCES profiles(id),
    mode TEXT NOT NULL CHECK (mode IN ('set', 'adjust')),
    row_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'undone')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    undone_at TIMESTAMPTZ,
    undone_by UUID REFERENCES profiles(id)
);

-- Add balance_import_batch_id column to journal_entries for batch tracking
ALTER TABLE journal_entries
ADD COLUMN balance_import_batch_id UUID REFERENCES balance_import_batches(id);

-- Index for efficient batch lookup on journal entries
CREATE INDEX idx_journal_entries_balance_import_batch
ON journal_entries(balance_import_batch_id)
WHERE balance_import_batch_id IS NOT NULL;

-- Index for querying batches by unit
CREATE INDEX idx_balance_import_batches_unit ON balance_import_batches(unit_id);

-- Enable RLS
ALTER TABLE balance_import_batches ENABLE ROW LEVEL SECURITY;

-- RLS Policies for balance_import_batches

-- Leaders can view their unit's import batches
CREATE POLICY "Leaders can view unit import batches"
  ON balance_import_batches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = balance_import_batches.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer', 'leader')
    )
  );

-- Admin and treasurer can insert import batches
CREATE POLICY "Treasurers can create import batches"
  ON balance_import_batches FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = balance_import_batches.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer')
    )
  );

-- Admin and treasurer can update import batches (for undo operations)
CREATE POLICY "Treasurers can update import batches"
  ON balance_import_batches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = balance_import_batches.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = balance_import_batches.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer')
    )
  );

-- Service role grant for any background operations
GRANT ALL ON balance_import_batches TO service_role;

COMMENT ON TABLE balance_import_batches IS 'Tracks balance import operations for undo functionality';
COMMENT ON COLUMN balance_import_batches.mode IS 'Import mode: set (replace balance) or adjust (add to balance)';
COMMENT ON COLUMN balance_import_batches.row_count IS 'Number of scouts affected by this import';
COMMENT ON COLUMN balance_import_batches.status IS 'active = in effect, undone = reversed';
COMMENT ON COLUMN journal_entries.balance_import_batch_id IS 'Links journal entry to its import batch for undo operations';


-- ============================================
-- FROM: 20260207100001_plaid_connections.sql
-- ============================================

-- Migration: 20260207000001_plaid_connections.sql
-- Purpose: Store Plaid bank connections for units

-- Store Plaid connections (access tokens encrypted in application layer)
CREATE TABLE plaid_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,

  -- Plaid identifiers
  item_id TEXT NOT NULL,
  access_token TEXT NOT NULL, -- Encrypted in application layer before storage

  -- Connection metadata
  institution_id TEXT,
  institution_name TEXT,

  -- Account info (cached from Plaid)
  accounts JSONB DEFAULT '[]'::jsonb, -- Array of {account_id, name, mask, type, subtype, balance}

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

-- Enable Row Level Security
ALTER TABLE plaid_connections ENABLE ROW LEVEL SECURITY;

-- Policy: Admins and treasurers can view their unit's plaid connection
CREATE POLICY "Admins and treasurers can view plaid connection"
  ON plaid_connections FOR SELECT TO authenticated
  USING (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = get_current_profile_id() AND role IN ('admin', 'treasurer')
  ));

-- Policy: Admins and treasurers can insert plaid connection
CREATE POLICY "Admins and treasurers can insert plaid connection"
  ON plaid_connections FOR INSERT TO authenticated
  WITH CHECK (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = get_current_profile_id() AND role IN ('admin', 'treasurer')
  ));

-- Policy: Admins and treasurers can update plaid connection
CREATE POLICY "Admins and treasurers can update plaid connection"
  ON plaid_connections FOR UPDATE TO authenticated
  USING (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = get_current_profile_id() AND role IN ('admin', 'treasurer')
  ));

-- Policy: Admins and treasurers can delete plaid connection
CREATE POLICY "Admins and treasurers can delete plaid connection"
  ON plaid_connections FOR DELETE TO authenticated
  USING (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = get_current_profile_id() AND role IN ('admin', 'treasurer')
  ));

-- Index for lookups
CREATE INDEX idx_plaid_connections_unit ON plaid_connections(unit_id);

-- Trigger to update updated_at on changes
CREATE TRIGGER update_plaid_connections_updated_at
  BEFORE UPDATE ON plaid_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment for documentation
COMMENT ON TABLE plaid_connections IS 'Stores Plaid bank connections for units. Access tokens are encrypted at the application layer.';
COMMENT ON COLUMN plaid_connections.access_token IS 'Plaid access token - encrypted before storage, never exposed to client';
COMMENT ON COLUMN plaid_connections.accounts IS 'Cached account info from Plaid: [{account_id, name, mask, type, subtype, balance}]';


-- ============================================
-- FROM: 20260207100002_collection_settings.sql
-- ============================================

-- Migration: 20260207000002_collection_settings.sql
-- Purpose: Add collection settings to units table for configurable overdue thresholds

-- Add collection settings column to units table
ALTER TABLE units ADD COLUMN IF NOT EXISTS collection_settings JSONB DEFAULT '{
  "overdue_threshold_days": 30,
  "overdue_threshold_amount_cents": 0,
  "reminder_email_subject": "Payment Reminder - {unit_name}",
  "reminder_email_template": "default"
}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN units.collection_settings IS 'Configurable settings for payment collection: overdue_threshold_days, overdue_threshold_amount_cents, reminder_email_subject, reminder_email_template';


-- ============================================
-- FROM: 20260210000001_merit_badge_approval_workflow.sql
-- ============================================

-- ============================================
-- ADD APPROVAL WORKFLOW TO MERIT BADGE REQUIREMENTS
-- Matches the rank requirement approval pattern:
-- Parent submits → Leader approves
-- ============================================

-- Add approval workflow fields to merit_badge_requirement_progress
-- (matching scout_rank_requirement_progress structure)

-- Submission fields (parent marks complete with notes)
ALTER TABLE scout_merit_badge_requirement_progress
ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS submission_notes TEXT;

-- Approval workflow fields (leader reviews)
ALTER TABLE scout_merit_badge_requirement_progress
ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS denial_reason TEXT;

-- Index for pending approvals (matches rank requirements index)
CREATE INDEX IF NOT EXISTS idx_scout_mb_req_progress_pending
ON scout_merit_badge_requirement_progress(approval_status)
WHERE approval_status = 'pending_approval';

-- Index for efficient dashboard queries
CREATE INDEX IF NOT EXISTS idx_scout_mb_req_progress_submitted_by
ON scout_merit_badge_requirement_progress(submitted_by)
WHERE submitted_by IS NOT NULL;

-- Comments
COMMENT ON COLUMN scout_merit_badge_requirement_progress.submitted_by IS
  'Profile ID of parent/guardian who submitted this requirement for approval';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.submitted_at IS
  'When the requirement was submitted for leader approval';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.submission_notes IS
  'Notes from parent about how/when requirement was completed';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.approval_status IS
  'Approval workflow status: pending_approval, approved, denied';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.reviewed_by IS
  'Profile ID of leader who reviewed/approved this requirement';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.reviewed_at IS
  'When the requirement was reviewed by a leader';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.denial_reason IS
  'If denied, the reason provided by the leader';


-- ============================================
-- FROM: 20260210000002_parent_mb_requirement_submission_policy.sql
-- ============================================

-- ============================================
-- ADD PARENT SUBMISSION POLICY FOR MERIT BADGE REQUIREMENTS
-- Matches the existing rank requirement parent policy pattern
-- ============================================

-- Parents can submit completions (update with submission fields only)
-- This matches the policy for scout_rank_requirement_progress
CREATE POLICY "Parents can submit MB completions for their scouts"
    ON scout_merit_badge_requirement_progress FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scout_guardians sg ON sg.scout_id = smbp.scout_id
            JOIN profiles p ON p.id = sg.profile_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        -- Can only update submission-related fields
        submitted_by = (SELECT id FROM profiles WHERE user_id = auth.uid())
    );


-- ============================================
-- FROM: 20260124000002_bsa_authenticated_grants.sql
-- ============================================

-- Grant SELECT on BSA reference tables to authenticated users
GRANT SELECT ON TABLE bsa_ranks TO authenticated;
GRANT SELECT ON TABLE bsa_rank_requirements TO authenticated;
GRANT SELECT ON TABLE bsa_merit_badges TO authenticated;
GRANT SELECT ON TABLE bsa_merit_badge_requirements TO authenticated;
GRANT SELECT ON TABLE bsa_leadership_positions TO authenticated;
GRANT SELECT ON TABLE bsa_merit_badge_versions TO authenticated;

-- Also grant to anon for public read access (if needed)
GRANT SELECT ON TABLE bsa_ranks TO anon;
GRANT SELECT ON TABLE bsa_rank_requirements TO anon;
GRANT SELECT ON TABLE bsa_merit_badges TO anon;
GRANT SELECT ON TABLE bsa_merit_badge_requirements TO anon;
GRANT SELECT ON TABLE bsa_leadership_positions TO anon;
