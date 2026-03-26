-- ============================================================================
-- CHUCKBOX CONSOLIDATED SCHEMA
-- ============================================================================
-- This file contains the complete database schema for a fresh Supabase database.
-- Generated from migrations 20240101000001 through 20240101000036.
--
-- Run this file on a fresh Supabase database to create all tables, indexes,
-- functions, triggers, and RLS policies.
-- ============================================================================

-- ############################################################################
-- PART 1: CORE TABLES
-- ############################################################################

-- ============================================
-- UNITS (Troops/Packs)
-- ============================================
CREATE TABLE units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    unit_number VARCHAR(20) NOT NULL,
    unit_type VARCHAR(20) NOT NULL CHECK (unit_type IN ('troop', 'pack', 'crew', 'ship')),
    council VARCHAR(255),
    district VARCHAR(255),
    chartered_org VARCHAR(255),
    -- Payment fee settings (from migration 18)
    processing_fee_percent DECIMAL(5,4) DEFAULT 0.0260,
    processing_fee_fixed DECIMAL(10,2) DEFAULT 0.10,
    pass_fees_to_payer BOOLEAN DEFAULT false,
    -- Branding (from migration 25)
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN units.processing_fee_percent IS 'Card processing fee percentage (e.g., 0.0260 = 2.6%)';
COMMENT ON COLUMN units.processing_fee_fixed IS 'Fixed card processing fee amount in dollars (e.g., 0.10 = $0.10)';
COMMENT ON COLUMN units.pass_fees_to_payer IS 'If true, processing fees are added to payment amount instead of deducted from unit proceeds';

-- ============================================
-- PROFILES (extends Supabase auth.users)
-- ============================================
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    -- Extended fields (from migration 15)
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone_home VARCHAR(20),
    phone_mobile VARCHAR(20),
    email_secondary VARCHAR(255),
    address_street VARCHAR(255),
    address_city VARCHAR(100),
    address_state VARCHAR(50),
    address_zip VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    -- Gender (from migration 31)
    gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN profiles.is_active IS 'Soft delete flag - false means account is deactivated';
COMMENT ON COLUMN profiles.gender IS 'Used for auto-assigning members to boys/girls sections in coed troops';

-- ============================================
-- UNIT MEMBERSHIPS (links users to units with roles)
-- Includes invite functionality (from migration 12)
-- ============================================
CREATE TABLE unit_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,  -- Nullable for invites
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'treasurer', 'leader', 'parent', 'scout')),
    is_active BOOLEAN DEFAULT true,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    -- Invite functionality (from migration 12)
    email VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('invited', 'active', 'inactive')),
    scout_ids UUID[] DEFAULT NULL,
    invited_by UUID REFERENCES profiles(id),
    invited_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);

-- Unique constraints for memberships
CREATE UNIQUE INDEX idx_unit_memberships_unit_profile
    ON unit_memberships(unit_id, profile_id)
    WHERE profile_id IS NOT NULL AND status != 'inactive';

CREATE UNIQUE INDEX idx_unit_memberships_unit_email_invited
    ON unit_memberships(unit_id, email)
    WHERE profile_id IS NULL AND status = 'invited';

-- ============================================
-- PATROLS (from migration 24)
-- ============================================
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

-- ============================================
-- SCOUTS (youth members)
-- ============================================
CREATE TABLE scouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    bsa_member_id VARCHAR(20),
    patrol VARCHAR(100),  -- Legacy text field
    patrol_id UUID REFERENCES patrols(id) ON DELETE SET NULL,  -- FK to patrols (from migration 24)
    rank VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SCOUT-GUARDIAN RELATIONSHIPS
-- ============================================
CREATE TABLE scout_guardians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    relationship VARCHAR(50) DEFAULT 'parent',
    is_primary BOOLEAN DEFAULT false,
    UNIQUE(scout_id, profile_id)
);


-- ############################################################################
-- PART 2: FINANCIAL TABLES
-- ############################################################################

-- ============================================
-- CHART OF ACCOUNTS
-- ============================================
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50) NOT NULL CHECK (account_type IN (
        'asset', 'liability', 'equity', 'income', 'expense'
    )),
    parent_id UUID REFERENCES accounts(id),
    is_system BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(unit_id, code)
);

-- ============================================
-- SCOUT INDIVIDUAL ACCOUNTS (sub-ledger)
-- With dual balances (from migration 35)
-- ============================================
CREATE TABLE scout_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    billing_balance DECIMAL(10,2) DEFAULT 0.00,  -- Renamed from balance (migration 35)
    funds_balance DECIMAL(10,2) DEFAULT 0.00 NOT NULL,  -- Added in migration 35
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_id),
    CONSTRAINT funds_balance_non_negative CHECK (funds_balance >= 0)
);

COMMENT ON COLUMN scout_accounts.billing_balance IS 'Amount owed by scout to unit (negative = owes money, zero = paid up)';
COMMENT ON COLUMN scout_accounts.funds_balance IS 'Scout funds from fundraising/overpayments (always >= 0, parent must authorize usage)';

-- ============================================
-- JOURNAL ENTRIES (transaction headers)
-- ============================================
CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL,
    description TEXT NOT NULL,
    reference VARCHAR(100),
    entry_type VARCHAR(50),
    is_posted BOOLEAN DEFAULT false,
    is_void BOOLEAN DEFAULT false,
    void_reason TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    posted_at TIMESTAMPTZ
);

-- ============================================
-- JOURNAL ENTRY LINES (debits and credits)
-- With target_balance for dual balance support (from migration 35)
-- ============================================
CREATE TABLE journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id),
    scout_account_id UUID REFERENCES scout_accounts(id),
    debit DECIMAL(10,2) DEFAULT 0.00,
    credit DECIMAL(10,2) DEFAULT 0.00,
    memo TEXT,
    target_balance VARCHAR(20) DEFAULT 'billing',  -- From migration 35
    CHECK (debit >= 0 AND credit >= 0),
    CHECK (NOT (debit > 0 AND credit > 0))
);

COMMENT ON COLUMN journal_lines.target_balance IS 'Which scout balance to affect: billing or funds';


-- ############################################################################
-- PART 3: EVENTS AND BILLING TABLES
-- ############################################################################

-- ============================================
-- EVENTS (campouts, meetings, etc.)
-- ============================================
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
    max_participants INTEGER,
    rsvp_deadline TIMESTAMPTZ,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- EVENT RSVPs
-- ============================================
CREATE TABLE event_rsvps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    scout_id UUID REFERENCES scouts(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('going', 'not_going', 'maybe')),
    is_driver BOOLEAN DEFAULT false,
    vehicle_seats INTEGER,
    notes TEXT,
    responded_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (scout_id IS NOT NULL OR profile_id IS NOT NULL)
);

-- ============================================
-- FAIR SHARE BILLING RECORDS
-- With void support (from migration 33)
-- ============================================
CREATE TABLE billing_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    billing_date DATE NOT NULL,
    journal_entry_id UUID REFERENCES journal_entries(id),
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Void support (from migration 33)
    is_void BOOLEAN DEFAULT false,
    void_reason TEXT,
    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES profiles(id)
);

-- ============================================
-- INDIVIDUAL CHARGES FROM BILLING
-- With void support (from migration 33)
-- ============================================
CREATE TABLE billing_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_record_id UUID NOT NULL REFERENCES billing_records(id) ON DELETE CASCADE,
    scout_account_id UUID NOT NULL REFERENCES scout_accounts(id),
    amount DECIMAL(10,2) NOT NULL,
    is_paid BOOLEAN DEFAULT false,
    -- Void support (from migration 33)
    is_void BOOLEAN DEFAULT false,
    void_reason TEXT,
    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES profiles(id),
    void_journal_entry_id UUID REFERENCES journal_entries(id)
);


-- ############################################################################
-- PART 4: PAYMENTS AND AUDIT TABLES
-- ############################################################################

-- ============================================
-- PAYMENTS
-- ============================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    scout_account_id UUID REFERENCES scout_accounts(id),
    amount DECIMAL(10,2) NOT NULL,
    fee_amount DECIMAL(10,2) DEFAULT 0.00,
    net_amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50),
    square_payment_id VARCHAR(255),
    square_receipt_url TEXT,
    status VARCHAR(20) DEFAULT 'completed',
    journal_entry_id UUID REFERENCES journal_entries(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN payments.payment_method IS 'Payment method: card, cash, check, transfer, balance';

-- ============================================
-- INVENTORY ITEMS (Fundraising)
-- ============================================
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

-- ============================================
-- INVENTORY CHECKOUTS
-- ============================================
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
-- AUDIT LOG
-- ============================================
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


-- ############################################################################
-- PART 5: SQUARE INTEGRATION TABLES (from migration 16)
-- ############################################################################

-- ============================================
-- UNIT SQUARE CREDENTIALS
-- ============================================
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

-- ============================================
-- SQUARE TRANSACTIONS
-- With customer info (from migration 36)
-- ============================================
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
    square_created_at TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Customer info (from migration 36)
    buyer_email_address TEXT,
    cardholder_name TEXT,
    note TEXT,
    order_line_items JSONB,
    UNIQUE(unit_id, square_payment_id)
);

COMMENT ON COLUMN square_transactions.order_line_items IS 'JSON array of line items: [{name: string, quantity: number, amount: number}]';
COMMENT ON COLUMN square_transactions.note IS 'Payment note/memo from Square - typically contains scout name for ChuckBox payments';

-- ============================================
-- PAYMENT LINKS
-- With fee fields (from migration 19)
-- ============================================
CREATE TABLE payment_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    scout_account_id UUID REFERENCES scout_accounts(id),
    billing_charge_id UUID REFERENCES billing_charges(id),
    amount INTEGER NOT NULL,
    description TEXT,
    token VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),
    payment_id UUID REFERENCES payments(id),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Fee fields (from migration 19)
    base_amount INTEGER,
    fee_amount INTEGER DEFAULT 0,
    fees_passed_to_payer BOOLEAN DEFAULT false
);

COMMENT ON COLUMN payment_links.base_amount IS 'Original amount owed in cents (before any fees)';
COMMENT ON COLUMN payment_links.fee_amount IS 'Processing fee amount in cents';
COMMENT ON COLUMN payment_links.fees_passed_to_payer IS 'Whether the processing fee is added to the total (true) or absorbed by unit (false)';


-- ############################################################################
-- PART 6: UNIT INVITES TABLE (from migration 7, kept for history)
-- ############################################################################

CREATE TABLE unit_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'treasurer', 'leader', 'parent', 'scout')),
    invited_by UUID NOT NULL REFERENCES profiles(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    scout_ids UUID[] DEFAULT NULL,  -- From migration 8
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ
);

COMMENT ON COLUMN unit_invites.scout_ids IS 'Array of scout IDs to link when parent accepts invite';


-- ############################################################################
-- PART 7: WAITLIST TABLE (from migration 17)
-- ############################################################################

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


-- ############################################################################
-- PART 8: ALL INDEXES
-- ############################################################################

-- Core table indexes
CREATE INDEX idx_unit_memberships_profile ON unit_memberships(profile_id);
CREATE INDEX idx_unit_memberships_unit ON unit_memberships(unit_id);
CREATE INDEX idx_unit_memberships_email ON unit_memberships(email) WHERE email IS NOT NULL;
CREATE INDEX idx_unit_memberships_unit_status ON unit_memberships(unit_id, status);
CREATE INDEX idx_scouts_unit ON scouts(unit_id);
CREATE INDEX idx_scouts_unit_active ON scouts(unit_id, is_active);
CREATE INDEX idx_scouts_patrol_id ON scouts(patrol_id);
CREATE INDEX idx_scout_guardians_scout ON scout_guardians(scout_id);
CREATE INDEX idx_scout_guardians_profile ON scout_guardians(profile_id);
CREATE INDEX idx_patrols_unit_id ON patrols(unit_id);

-- Financial table indexes
CREATE INDEX idx_accounts_unit ON accounts(unit_id);
CREATE INDEX idx_scout_accounts_scout ON scout_accounts(scout_id);
CREATE INDEX idx_scout_accounts_unit ON scout_accounts(unit_id);
CREATE INDEX idx_journal_entries_unit ON journal_entries(unit_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_entries_unit_date ON journal_entries(unit_id, entry_date DESC);
CREATE INDEX idx_journal_lines_entry ON journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_scout_account ON journal_lines(scout_account_id);

-- Events and billing indexes
CREATE INDEX idx_events_unit ON events(unit_id);
CREATE INDEX idx_events_dates ON events(start_date, end_date);
CREATE INDEX idx_event_rsvps_event ON event_rsvps(event_id);
CREATE INDEX idx_billing_records_unit ON billing_records(unit_id);
CREATE INDEX idx_billing_records_event ON billing_records(event_id);
CREATE INDEX idx_billing_records_void ON billing_records(is_void) WHERE is_void = false;
CREATE INDEX idx_billing_charges_record ON billing_charges(billing_record_id);
CREATE INDEX idx_billing_charges_scout ON billing_charges(scout_account_id);
CREATE INDEX idx_billing_charges_void ON billing_charges(is_void) WHERE is_void = false;

-- Payment and audit indexes
CREATE INDEX idx_payments_unit ON payments(unit_id);
CREATE INDEX idx_payments_scout_account ON payments(scout_account_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_unit_created ON payments(unit_id, created_at DESC);
CREATE INDEX idx_payments_balance ON payments(payment_method) WHERE payment_method = 'balance';
CREATE INDEX idx_inventory_items_unit ON inventory_items(unit_id);
CREATE INDEX idx_inventory_checkouts_item ON inventory_checkouts(inventory_item_id);
CREATE INDEX idx_inventory_checkouts_scout ON inventory_checkouts(scout_id);
CREATE INDEX idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_unit ON audit_log(unit_id);
CREATE INDEX idx_audit_log_performed_at ON audit_log(performed_at);

-- Square integration indexes
CREATE INDEX idx_square_credentials_unit ON unit_square_credentials(unit_id);
CREATE INDEX idx_square_credentials_merchant ON unit_square_credentials(merchant_id);
CREATE INDEX idx_square_transactions_unit ON square_transactions(unit_id);
CREATE INDEX idx_square_transactions_payment ON square_transactions(square_payment_id);
CREATE INDEX idx_square_transactions_reconciled ON square_transactions(unit_id, is_reconciled);
CREATE INDEX idx_square_transactions_created ON square_transactions(square_created_at);
CREATE INDEX idx_square_transactions_buyer_email ON square_transactions(buyer_email_address) WHERE buyer_email_address IS NOT NULL;
CREATE INDEX idx_payment_links_unit ON payment_links(unit_id);
CREATE INDEX idx_payment_links_token ON payment_links(token);
CREATE INDEX idx_payment_links_status ON payment_links(status, expires_at);

-- Unit invites indexes
CREATE INDEX idx_unit_invites_email_status ON unit_invites(email, status);
CREATE INDEX idx_unit_invites_unit_id ON unit_invites(unit_id);
CREATE UNIQUE INDEX idx_unit_invites_unique_pending ON unit_invites(unit_id, email) WHERE status = 'pending';

-- Waitlist indexes
CREATE INDEX idx_waitlist_email ON waitlist(email);
CREATE INDEX idx_waitlist_created_at ON waitlist(created_at DESC);


-- ############################################################################
-- PART 9: ENABLE ROW LEVEL SECURITY
-- ############################################################################

ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE scouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_square_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE square_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrols ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;


-- ############################################################################
-- PART 10: HELPER FUNCTIONS (FINAL VERSIONS)
-- ############################################################################

-- ============================================
-- get_user_units - Returns user's active unit IDs
-- Final version from migration 32 (no sections)
-- ============================================
CREATE OR REPLACE FUNCTION get_user_units()
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = auth.uid() AND status = 'active';
END;
$$;

-- ============================================
-- get_user_active_unit_ids - Alias for RLS policies
-- From migration 14/23
-- ============================================
CREATE OR REPLACE FUNCTION get_user_active_unit_ids()
RETURNS SETOF UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT unit_id
    FROM unit_memberships
    WHERE profile_id = auth.uid()
        AND status = 'active'
$$;

-- ============================================
-- user_has_role - Check if user has role in unit
-- Final version from migration 32 (no sections)
-- ============================================
CREATE OR REPLACE FUNCTION user_has_role(unit UUID, required_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_id = unit
        AND profile_id = auth.uid()
        AND status = 'active'
        AND role = ANY(required_roles)
    );
END;
$$;

-- ============================================
-- user_is_unit_admin - Check if user is admin of unit
-- From migration 14/23
-- ============================================
CREATE OR REPLACE FUNCTION user_is_unit_admin(check_unit_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE profile_id = auth.uid()
            AND unit_id = check_unit_id
            AND role = 'admin'
            AND status = 'active'
    )
$$;


-- ############################################################################
-- PART 11: TRIGGER FUNCTIONS (FINAL VERSIONS)
-- ############################################################################

-- ============================================
-- update_updated_at - Auto-update timestamps
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ============================================
-- update_square_updated_at - For Square tables
-- ============================================
CREATE OR REPLACE FUNCTION update_square_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ============================================
-- update_scout_account_balance - Dual balance support
-- Final version from migration 35
-- ============================================
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
SET search_path = public;

-- ============================================
-- reverse_scout_account_balance - For journal line delete
-- Final version from migration 35
-- ============================================
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
SET search_path = public;

-- ============================================
-- handle_new_user - Auto-create profile on signup
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
    );
    RETURN NEW;
END;
$$;

-- ============================================
-- create_scout_account - Auto-create account for scout
-- Final version from migration 35
-- ============================================
CREATE OR REPLACE FUNCTION create_scout_account()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO scout_accounts (scout_id, unit_id, billing_balance, funds_balance)
    VALUES (NEW.id, NEW.unit_id, 0.00, 0.00);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

-- ============================================
-- log_audit_event - Audit logging
-- ============================================
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    INSERT INTO audit_log (
        unit_id,
        table_name,
        record_id,
        action,
        old_values,
        new_values,
        performed_by
    ) VALUES (
        v_unit_id,
        TG_TABLE_NAME,
        (v_record_jsonb->>'id')::UUID,
        TG_OP,
        v_old_values,
        v_new_values,
        auth.uid()
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- ============================================
-- validate_journal_entry_balance
-- ============================================
CREATE OR REPLACE FUNCTION validate_journal_entry_balance(entry_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    total_debits DECIMAL(10,2);
    total_credits DECIMAL(10,2);
BEGIN
    SELECT
        COALESCE(SUM(debit), 0),
        COALESCE(SUM(credit), 0)
    INTO total_debits, total_credits
    FROM journal_lines
    WHERE journal_entry_id = entry_id;

    RETURN total_debits = total_credits;
END;
$$;

-- ============================================
-- create_default_accounts - Chart of accounts for new units
-- Final version from migration 35 (includes Scout Funds accounts)
-- ============================================
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
SET search_path = public;

-- ============================================
-- setup_new_unit - Auto-setup on unit creation
-- ============================================
CREATE OR REPLACE FUNCTION setup_new_unit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    PERFORM create_default_accounts(NEW.id);
    RETURN NEW;
END;
$$;


-- ############################################################################
-- PART 12: BILLING AND FINANCIAL RPC FUNCTIONS
-- ############################################################################

-- ============================================
-- create_billing_with_journal - Atomic billing creation
-- From migration 22/23
-- ============================================
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
    IF NOT user_has_role(p_unit_id, ARRAY['admin', 'treasurer']) THEN
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
    VALUES (p_unit_id, p_billing_date, v_entry_description, 'charge', true, auth.uid())
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

-- ============================================
-- void_billing_charge - Void a single charge
-- From migration 33
-- ============================================
CREATE OR REPLACE FUNCTION void_billing_charge(
    p_billing_charge_id UUID,
    p_void_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_charge RECORD;
    v_billing_record RECORD;
    v_journal_entry_id UUID;
    v_receivable_account_id UUID;
    v_income_account_id UUID;
    v_scout_name TEXT;
    v_reversal_description TEXT;
BEGIN
    SELECT
        bc.*,
        br.unit_id,
        br.description as billing_description,
        br.journal_entry_id as original_je_id,
        s.first_name,
        s.last_name
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

    IF NOT user_has_role(v_charge.unit_id, ARRAY['admin', 'treasurer']) THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    SELECT id INTO v_receivable_account_id
    FROM accounts WHERE unit_id = v_charge.unit_id AND code = '1200';

    SELECT id INTO v_income_account_id
    FROM accounts WHERE unit_id = v_charge.unit_id AND code = '4100';

    IF v_receivable_account_id IS NULL OR v_income_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts not found';
    END IF;

    v_scout_name := v_charge.first_name || ' ' || v_charge.last_name;
    v_reversal_description := 'VOID: ' || v_charge.billing_description || ' - ' || v_scout_name;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted, created_by)
    VALUES (v_charge.unit_id, CURRENT_DATE, v_reversal_description, 'adjustment', true, auth.uid())
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES (
        v_journal_entry_id,
        v_receivable_account_id,
        v_charge.scout_account_id,
        0,
        v_charge.amount,
        'Void charge: ' || v_charge.billing_description
    );

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES (
        v_journal_entry_id,
        v_income_account_id,
        NULL,
        v_charge.amount,
        0,
        'Void charge: ' || v_charge.billing_description
    );

    UPDATE billing_charges
    SET is_void = true,
        void_reason = p_void_reason,
        voided_at = NOW(),
        voided_by = auth.uid(),
        void_journal_entry_id = v_journal_entry_id
    WHERE id = p_billing_charge_id;

    IF NOT EXISTS (
        SELECT 1 FROM billing_charges
        WHERE billing_record_id = v_charge.billing_record_id
        AND is_void = false
    ) THEN
        UPDATE billing_records
        SET is_void = true,
            void_reason = 'All charges voided',
            voided_at = NOW(),
            voided_by = auth.uid()
        WHERE id = v_charge.billing_record_id;

        UPDATE journal_entries
        SET is_void = true, void_reason = p_void_reason
        WHERE id = v_charge.original_je_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'void_journal_entry_id', v_journal_entry_id
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- ============================================
-- void_billing_record - Void entire billing record
-- From migration 33
-- ============================================
CREATE OR REPLACE FUNCTION void_billing_record(
    p_billing_record_id UUID,
    p_void_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_record RECORD;
    v_charge RECORD;
    v_result JSONB;
    v_voided_count INT := 0;
BEGIN
    SELECT * INTO v_record FROM billing_records WHERE id = p_billing_record_id;

    IF v_record IS NULL THEN
        RAISE EXCEPTION 'Billing record not found';
    END IF;

    IF v_record.is_void THEN
        RAISE EXCEPTION 'Billing record is already voided';
    END IF;

    IF EXISTS (
        SELECT 1 FROM billing_charges
        WHERE billing_record_id = p_billing_record_id
        AND is_paid = true
        AND is_void = false
    ) THEN
        RAISE EXCEPTION 'Cannot void billing record with paid charges. Void individual unpaid charges or refund payments first.';
    END IF;

    FOR v_charge IN
        SELECT id FROM billing_charges
        WHERE billing_record_id = p_billing_record_id
        AND is_void = false
    LOOP
        PERFORM void_billing_charge(v_charge.id, p_void_reason);
        v_voided_count := v_voided_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'voided_charges', v_voided_count
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- ============================================
-- update_billing_description
-- From migration 33
-- ============================================
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

    IF NOT user_has_role(v_record.unit_id, ARRAY['admin', 'treasurer']) THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    UPDATE billing_records SET description = p_new_description WHERE id = p_billing_record_id;

    UPDATE journal_entries
    SET description =
        CASE
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
SET search_path = public;


-- ############################################################################
-- PART 13: SCOUT FUNDS RPC FUNCTIONS (from migration 35)
-- ############################################################################

-- ============================================
-- transfer_funds_to_billing
-- ============================================
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

    IF v_funds_account_id IS NULL THEN
        RAISE EXCEPTION 'Scout Funds account (1210) not found for unit';
    END IF;

    IF v_billing_account_id IS NULL THEN
        RAISE EXCEPTION 'Scout Billing account (1200) not found for unit';
    END IF;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted, created_by)
    VALUES (v_unit_id, CURRENT_DATE, p_description || ' - ' || v_scout_name, 'funds_transfer', true, auth.uid())
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
SET search_path = public;

-- ============================================
-- auto_transfer_overpayment
-- ============================================
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
SET search_path = public;

-- ============================================
-- credit_fundraising_to_scout
-- ============================================
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

    IF NOT user_has_role(v_unit_id, ARRAY['admin', 'treasurer']) THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Credit amount must be positive';
    END IF;

    SELECT id INTO v_funds_account_id
    FROM accounts WHERE unit_id = v_unit_id AND code = '1210';

    SELECT id INTO v_income_account_id
    FROM accounts WHERE unit_id = v_unit_id AND code = CASE
        WHEN p_fundraiser_type = 'popcorn' THEN '4200'
        WHEN p_fundraiser_type = 'camp_cards' THEN '4210'
        ELSE '4900'
    END;

    IF v_funds_account_id IS NULL THEN
        RAISE EXCEPTION 'Scout Funds account not found';
    END IF;

    IF v_income_account_id IS NULL THEN
        SELECT id INTO v_income_account_id
        FROM accounts WHERE unit_id = v_unit_id AND code = '4900';
    END IF;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted, created_by)
    VALUES (v_unit_id, CURRENT_DATE, 'Fundraising: ' || p_description || ' - ' || v_scout_name,
            'fundraising_credit', true, auth.uid())
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_funds_account_id, p_scout_account_id, 0, p_amount,
            p_description, 'funds');

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_income_account_id, NULL, p_amount, 0,
            'Scout share: ' || p_description, NULL);

    RETURN jsonb_build_object(
        'success', true,
        'journal_entry_id', v_journal_entry_id,
        'amount_credited', p_amount,
        'new_funds_balance', v_account.funds_balance + p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;


-- ############################################################################
-- PART 14: TRIGGERS
-- ############################################################################

-- Updated_at triggers
CREATE TRIGGER trigger_units_updated_at
    BEFORE UPDATE ON units
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_scouts_updated_at
    BEFORE UPDATE ON scouts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_scout_accounts_updated_at
    BEFORE UPDATE ON scout_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_patrols_updated_at
    BEFORE UPDATE ON patrols
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_update_square_credentials_timestamp
    BEFORE UPDATE ON unit_square_credentials
    FOR EACH ROW EXECUTE FUNCTION update_square_updated_at();

CREATE TRIGGER trigger_update_square_transactions_timestamp
    BEFORE UPDATE ON square_transactions
    FOR EACH ROW EXECUTE FUNCTION update_square_updated_at();

CREATE TRIGGER trigger_update_payment_links_timestamp
    BEFORE UPDATE ON payment_links
    FOR EACH ROW EXECUTE FUNCTION update_square_updated_at();

-- Scout account balance triggers
CREATE TRIGGER trigger_update_scout_balance_insert
    AFTER INSERT ON journal_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_scout_account_balance();

CREATE TRIGGER trigger_reverse_scout_balance_delete
    BEFORE DELETE ON journal_lines
    FOR EACH ROW
    EXECUTE FUNCTION reverse_scout_account_balance();

-- Auth user created trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-create scout account
CREATE TRIGGER trigger_create_scout_account
    AFTER INSERT ON scouts
    FOR EACH ROW
    EXECUTE FUNCTION create_scout_account();

-- Setup new unit (create default accounts)
CREATE TRIGGER trigger_setup_new_unit
    AFTER INSERT ON units
    FOR EACH ROW
    EXECUTE FUNCTION setup_new_unit();

-- Audit triggers
CREATE TRIGGER audit_journal_entries
    AFTER INSERT OR UPDATE OR DELETE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_journal_lines
    AFTER INSERT OR UPDATE OR DELETE ON journal_lines
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_payments
    AFTER INSERT OR UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_billing_records
    AFTER INSERT OR UPDATE OR DELETE ON billing_records
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_scout_accounts
    AFTER INSERT OR UPDATE OR DELETE ON scout_accounts
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();


-- ############################################################################
-- PART 15: RLS POLICIES
-- ############################################################################

-- ============================================
-- PROFILES POLICIES
-- ============================================
CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (id = auth.uid());

CREATE POLICY "Users can view profiles in their units"
    ON profiles FOR SELECT
    USING (
        id IN (
            SELECT profile_id FROM unit_memberships
            WHERE unit_id IN (SELECT get_user_units())
        )
    );

-- ============================================
-- UNITS POLICIES
-- ============================================
CREATE POLICY "Users can view their units"
    ON units FOR SELECT
    USING (id IN (SELECT get_user_units()));

CREATE POLICY "Admins can update their units"
    ON units FOR UPDATE
    USING (user_has_role(id, ARRAY['admin']));

-- ============================================
-- UNIT MEMBERSHIPS POLICIES (from migration 12/14)
-- ============================================
CREATE POLICY "Users can view memberships"
    ON unit_memberships
    FOR SELECT
    TO authenticated
    USING (
        profile_id = auth.uid()
        OR (
            status = 'invited'
            AND email = (SELECT email FROM profiles WHERE id = auth.uid())
        )
        OR unit_id IN (SELECT get_user_active_unit_ids())
    );

CREATE POLICY "Admins can create memberships"
    ON unit_memberships
    FOR INSERT
    TO authenticated
    WITH CHECK (user_is_unit_admin(unit_id));

CREATE POLICY "Users can accept their own invite"
    ON unit_memberships
    FOR UPDATE
    TO authenticated
    USING (
        status = 'invited'
        AND email = (SELECT email FROM profiles WHERE id = auth.uid())
    )
    WITH CHECK (
        profile_id = auth.uid()
        AND status = 'active'
    );

CREATE POLICY "Admins can update memberships"
    ON unit_memberships
    FOR UPDATE
    TO authenticated
    USING (user_is_unit_admin(unit_id));

CREATE POLICY "Admins can delete memberships"
    ON unit_memberships
    FOR DELETE
    TO authenticated
    USING (user_is_unit_admin(unit_id));

-- ============================================
-- SCOUTS POLICIES
-- ============================================
CREATE POLICY "Users can view scouts in their units"
    ON scouts FOR SELECT
    USING (unit_id IN (SELECT get_user_units()));

CREATE POLICY "Leaders can manage scouts"
    ON scouts FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']));

-- ============================================
-- SCOUT GUARDIANS POLICIES
-- ============================================
CREATE POLICY "Users can view guardians in their units"
    ON scout_guardians FOR SELECT
    USING (
        scout_id IN (
            SELECT id FROM scouts WHERE unit_id IN (SELECT get_user_units())
        )
    );

CREATE POLICY "Leaders can manage guardians"
    ON scout_guardians FOR ALL
    USING (
        scout_id IN (
            SELECT id FROM scouts
            WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader'])
        )
    );

CREATE POLICY "Users can create own guardian links via invite"
    ON scout_guardians
    FOR INSERT
    TO authenticated
    WITH CHECK (
        profile_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM unit_invites ui
            WHERE ui.email = (SELECT email FROM profiles WHERE id = auth.uid())
                AND ui.status = 'pending'
                AND ui.expires_at > NOW()
                AND scout_guardians.scout_id = ANY(ui.scout_ids)
        )
    );

-- ============================================
-- PATROLS POLICIES (from migration 30)
-- ============================================
CREATE POLICY "Users can view patrols in their unit"
    ON patrols FOR SELECT
    USING (unit_id IN (SELECT get_user_units()));

CREATE POLICY "Admins can manage patrols"
    ON patrols FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin']));

-- ============================================
-- ACCOUNTS POLICIES (Chart of Accounts)
-- ============================================
CREATE POLICY "Users can view accounts in their units"
    ON accounts FOR SELECT
    USING (unit_id IN (SELECT get_user_units()));

CREATE POLICY "Treasurers can manage accounts"
    ON accounts FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']));

-- ============================================
-- SCOUT ACCOUNTS POLICIES
-- ============================================
CREATE POLICY "Leaders can view all scout accounts"
    ON scout_accounts FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']));

CREATE POLICY "Parents can view own scouts accounts"
    ON scout_accounts FOR SELECT
    USING (
        scout_id IN (
            SELECT scout_id FROM scout_guardians WHERE profile_id = auth.uid()
        )
    );

CREATE POLICY "Treasurers can manage scout accounts"
    ON scout_accounts FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']));

-- ============================================
-- JOURNAL ENTRIES POLICIES
-- ============================================
CREATE POLICY "Leaders can view journal entries"
    ON journal_entries FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']));

CREATE POLICY "Treasurers can manage journal entries"
    ON journal_entries FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']));

-- ============================================
-- JOURNAL LINES POLICIES
-- ============================================
CREATE POLICY "Leaders can view journal lines"
    ON journal_lines FOR SELECT
    USING (
        journal_entry_id IN (
            SELECT id FROM journal_entries
            WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader'])
        )
    );

CREATE POLICY "Treasurers can manage journal lines"
    ON journal_lines FOR ALL
    USING (
        journal_entry_id IN (
            SELECT id FROM journal_entries
            WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer'])
        )
    );

-- ============================================
-- EVENTS POLICIES
-- ============================================
CREATE POLICY "Users can view events in their units"
    ON events FOR SELECT
    USING (unit_id IN (SELECT get_user_units()));

CREATE POLICY "Leaders can manage events"
    ON events FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']));

-- ============================================
-- EVENT RSVPS POLICIES
-- ============================================
CREATE POLICY "Users can view RSVPs in their units"
    ON event_rsvps FOR SELECT
    USING (
        event_id IN (
            SELECT id FROM events WHERE unit_id IN (SELECT get_user_units())
        )
    );

CREATE POLICY "Users can manage own RSVPs"
    ON event_rsvps FOR ALL
    USING (profile_id = auth.uid());

CREATE POLICY "Parents can manage their scouts RSVPs"
    ON event_rsvps FOR ALL
    USING (
        scout_id IN (
            SELECT scout_id FROM scout_guardians WHERE profile_id = auth.uid()
        )
    );

-- ============================================
-- BILLING RECORDS POLICIES
-- ============================================
CREATE POLICY "Leaders can view billing records"
    ON billing_records FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']));

CREATE POLICY "Treasurers can manage billing records"
    ON billing_records FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']));

-- ============================================
-- BILLING CHARGES POLICIES
-- ============================================
CREATE POLICY "Leaders can view billing charges"
    ON billing_charges FOR SELECT
    USING (
        billing_record_id IN (
            SELECT id FROM billing_records
            WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader'])
        )
    );

CREATE POLICY "Parents can view own scouts billing charges"
    ON billing_charges FOR SELECT
    USING (
        scout_account_id IN (
            SELECT sa.id FROM scout_accounts sa
            JOIN scout_guardians sg ON sg.scout_id = sa.scout_id
            WHERE sg.profile_id = auth.uid()
        )
    );

CREATE POLICY "Treasurers can manage billing charges"
    ON billing_charges FOR ALL
    USING (
        billing_record_id IN (
            SELECT id FROM billing_records
            WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer'])
        )
    );

-- ============================================
-- PAYMENTS POLICIES
-- ============================================
CREATE POLICY "Leaders can view payments"
    ON payments FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']));

CREATE POLICY "Parents can view own scouts payments"
    ON payments FOR SELECT
    USING (
        scout_account_id IN (
            SELECT sa.id FROM scout_accounts sa
            JOIN scout_guardians sg ON sg.scout_id = sa.scout_id
            WHERE sg.profile_id = auth.uid()
        )
    );

CREATE POLICY "Treasurers can manage payments"
    ON payments FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']));

-- ============================================
-- INVENTORY POLICIES
-- ============================================
CREATE POLICY "Users can view inventory in their units"
    ON inventory_items FOR SELECT
    USING (unit_id IN (SELECT get_user_units()));

CREATE POLICY "Leaders can manage inventory"
    ON inventory_items FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']));

CREATE POLICY "Users can view checkouts in their units"
    ON inventory_checkouts FOR SELECT
    USING (
        inventory_item_id IN (
            SELECT id FROM inventory_items WHERE unit_id IN (SELECT get_user_units())
        )
    );

CREATE POLICY "Leaders can manage checkouts"
    ON inventory_checkouts FOR ALL
    USING (
        inventory_item_id IN (
            SELECT id FROM inventory_items
            WHERE user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader'])
        )
    );

-- ============================================
-- AUDIT LOG POLICIES
-- ============================================
CREATE POLICY "Admins can view audit log"
    ON audit_log FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']));

-- ============================================
-- UNIT SQUARE CREDENTIALS POLICIES
-- ============================================
CREATE POLICY "Admins can view Square credentials"
    ON unit_square_credentials FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin']));

CREATE POLICY "Admins can manage Square credentials"
    ON unit_square_credentials FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin']));

-- ============================================
-- SQUARE TRANSACTIONS POLICIES
-- ============================================
CREATE POLICY "Leaders can view Square transactions"
    ON square_transactions FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']));

CREATE POLICY "Treasurers can manage Square transactions"
    ON square_transactions FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']));

-- ============================================
-- PAYMENT LINKS POLICIES
-- ============================================
CREATE POLICY "Leaders can view payment links"
    ON payment_links FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer', 'leader']));

CREATE POLICY "Parents can view own scouts payment links"
    ON payment_links FOR SELECT
    USING (
        scout_account_id IN (
            SELECT sa.id FROM scout_accounts sa
            JOIN scout_guardians sg ON sg.scout_id = sa.scout_id
            WHERE sg.profile_id = auth.uid()
        )
    );

CREATE POLICY "Treasurers can manage payment links"
    ON payment_links FOR ALL
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']));

CREATE POLICY "Anyone can view payment links by token"
    ON payment_links FOR SELECT
    USING (true);

-- ============================================
-- UNIT INVITES POLICIES
-- ============================================
CREATE POLICY "Admins can view unit invites"
    ON unit_invites
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = unit_invites.unit_id
                AND um.profile_id = auth.uid()
                AND um.role = 'admin'
                AND um.status = 'active'
        )
    );

CREATE POLICY "Admins can create unit invites"
    ON unit_invites
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = unit_invites.unit_id
                AND um.profile_id = auth.uid()
                AND um.role = 'admin'
                AND um.status = 'active'
        )
    );

CREATE POLICY "Admins can update unit invites"
    ON unit_invites
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = unit_invites.unit_id
                AND um.profile_id = auth.uid()
                AND um.role = 'admin'
                AND um.status = 'active'
        )
    );

CREATE POLICY "Admins can delete unit invites"
    ON unit_invites
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = unit_invites.unit_id
                AND um.profile_id = auth.uid()
                AND um.role = 'admin'
                AND um.status = 'active'
        )
    );

CREATE POLICY "Users can view own pending invites"
    ON unit_invites
    FOR SELECT
    TO authenticated
    USING (
        email = (SELECT email FROM profiles WHERE id = auth.uid())
        AND status = 'pending'
    );

CREATE POLICY "Users can accept own invites"
    ON unit_invites
    FOR UPDATE
    TO authenticated
    USING (
        email = (SELECT email FROM profiles WHERE id = auth.uid())
        AND status = 'pending'
    )
    WITH CHECK (
        email = (SELECT email FROM profiles WHERE id = auth.uid())
        AND status = 'accepted'
    );

-- ============================================
-- WAITLIST POLICIES
-- ============================================
CREATE POLICY "Allow public waitlist submissions" ON waitlist
    FOR INSERT
    TO anon
    WITH CHECK (true);


-- ############################################################################
-- PART 16: STORAGE BUCKET AND POLICIES (from migration 26)
-- ############################################################################

-- Create the storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('unit-logos', 'unit-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage policies
CREATE POLICY "Public read access for unit logos"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'unit-logos');

CREATE POLICY "Authenticated users can upload unit logos"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'unit-logos'
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "Authenticated users can update unit logos"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'unit-logos'
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "Authenticated users can delete unit logos"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'unit-logos'
        AND auth.role() = 'authenticated'
    );


-- ############################################################################
-- PART 17: GRANT EXECUTE PERMISSIONS
-- ############################################################################

GRANT EXECUTE ON FUNCTION create_billing_with_journal TO authenticated;
GRANT EXECUTE ON FUNCTION void_billing_charge TO authenticated;
GRANT EXECUTE ON FUNCTION void_billing_record TO authenticated;
GRANT EXECUTE ON FUNCTION update_billing_description TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_funds_to_billing TO authenticated;
GRANT EXECUTE ON FUNCTION auto_transfer_overpayment TO authenticated;
GRANT EXECUTE ON FUNCTION credit_fundraising_to_scout TO authenticated;
