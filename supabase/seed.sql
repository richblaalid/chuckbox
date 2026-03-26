-- ============================================
-- CHUCKBOX SEED DATA
-- Run this in Supabase SQL Editor after migrations
-- ============================================
--
-- STEP 1: First create test users in Supabase Dashboard:
--   Go to Authentication > Users > Add user
--   Create these users (all with password: use magic link):
--     - richard.blaalid+admin@withcaldera.com
--     - richard.blaalid+treasurer@withcaldera.com
--     - richard.blaalid+parent@withcaldera.com
--
-- STEP 2: Run this entire file in SQL Editor
-- ============================================

-- ============================================
-- UPDATE PROFILES FROM AUTH USERS
-- (Profiles are auto-created by handle_new_user trigger)
-- ============================================
UPDATE profiles SET
  full_name = 'Admin User',
  first_name = 'Admin',
  last_name = 'User',
  phone_home = '555-123-4567'
WHERE email = 'richard.blaalid+admin@withcaldera.com';

UPDATE profiles SET
  full_name = 'Treasurer User',
  first_name = 'Treasurer',
  last_name = 'User',
  phone_home = '555-123-4567'
WHERE email = 'richard.blaalid+treasurer@withcaldera.com';

UPDATE profiles SET
  full_name = 'Parent User',
  first_name = 'Parent',
  last_name = 'User',
  phone_home = '555-123-4567'
WHERE email = 'richard.blaalid+parent@withcaldera.com';

-- ============================================
-- 1. CREATE TEST UNIT
-- ============================================
INSERT INTO units (id, name, unit_number, unit_type, council, district, chartered_org)
VALUES (
    '10000000-0000-4000-a000-000000000001',
    'Troop 123',
    '123',
    'troop',
    'Test Council',
    'Test District',
    'Test Chartered Org'
) ON CONFLICT DO NOTHING;

-- Note: Default chart of accounts is auto-created by trigger

-- ============================================
-- 1b. CREATE UNIT MEMBERSHIPS
-- ============================================
-- Admin (use profile.id, not auth.users.id)
INSERT INTO unit_memberships (unit_id, profile_id, role, status)
SELECT '10000000-0000-4000-a000-000000000001', p.id, 'admin', 'active'
FROM profiles p WHERE p.email = 'richard.blaalid+admin@withcaldera.com'
ON CONFLICT DO NOTHING;

-- Treasurer
INSERT INTO unit_memberships (unit_id, profile_id, role, status)
SELECT '10000000-0000-4000-a000-000000000001', p.id, 'treasurer', 'active'
FROM profiles p WHERE p.email = 'richard.blaalid+treasurer@withcaldera.com'
ON CONFLICT DO NOTHING;

-- Parent
INSERT INTO unit_memberships (unit_id, profile_id, role, status)
SELECT '10000000-0000-4000-a000-000000000001', p.id, 'parent', 'active'
FROM profiles p WHERE p.email = 'richard.blaalid+parent@withcaldera.com'
ON CONFLICT DO NOTHING;

-- ============================================
-- 2. CREATE TEST PATROLS
-- ============================================
INSERT INTO patrols (id, unit_id, name) VALUES
    ('60000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'Eagle'),
    ('60000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', 'Wolf'),
    ('60000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000001', 'Bear')
ON CONFLICT DO NOTHING;

-- ============================================
-- 3. CREATE TEST SCOUTS
-- Scout accounts are auto-created by trigger
-- ============================================
INSERT INTO scouts (id, unit_id, first_name, last_name, patrol_id, rank, is_active, date_of_birth, bsa_member_id) VALUES
    ('20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'Alex', 'Anderson', '60000000-0000-4000-a000-000000000001', 'First Class', true, '2012-03-15', '123456001'),
    ('20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001', 'Ben', 'Baker', '60000000-0000-4000-a000-000000000001', 'Star', true, '2011-07-22', '123456002'),
    ('20000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000001', 'Charlie', 'Chen', '60000000-0000-4000-a000-000000000001', 'Life', true, '2010-11-08', '123456003'),
    ('20000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001', 'David', 'Davis', '60000000-0000-4000-a000-000000000002', 'Tenderfoot', true, '2013-01-30', '123456004'),
    ('20000000-0000-4000-a000-000000000005', '10000000-0000-4000-a000-000000000001', 'Ethan', 'Evans', '60000000-0000-4000-a000-000000000002', 'Second Class', true, '2012-05-17', '123456005'),
    ('20000000-0000-4000-a000-000000000006', '10000000-0000-4000-a000-000000000001', 'Frank', 'Fisher', '60000000-0000-4000-a000-000000000002', 'Scout', true, '2013-09-03', '123456006'),
    ('20000000-0000-4000-a000-000000000007', '10000000-0000-4000-a000-000000000001', 'George', 'Garcia', '60000000-0000-4000-a000-000000000003', 'First Class', true, '2011-12-25', '123456007'),
    ('20000000-0000-4000-a000-000000000008', '10000000-0000-4000-a000-000000000001', 'Henry', 'Harris', '60000000-0000-4000-a000-000000000003', 'Star', true, '2010-08-14', '123456008'),
    ('20000000-0000-4000-a000-000000000009', '10000000-0000-4000-a000-000000000001', 'Isaac', 'Irwin', '60000000-0000-4000-a000-000000000003', 'Life', true, '2010-02-28', '123456009'),
    ('20000000-0000-4000-a000-000000000010', '10000000-0000-4000-a000-000000000001', 'Jake', 'Johnson', '60000000-0000-4000-a000-000000000003', 'Eagle', true, '2009-06-10', '123456010')
ON CONFLICT DO NOTHING;

-- ============================================
-- 2b. LINK PARENT TO SCOUTS (Guardian relationships)
-- ============================================
INSERT INTO scout_guardians (scout_id, profile_id, relationship, is_primary)
SELECT '20000000-0000-4000-a000-000000000001', p.id, 'parent', true
FROM profiles p WHERE p.email = 'richard.blaalid+parent@withcaldera.com'
ON CONFLICT DO NOTHING;

INSERT INTO scout_guardians (scout_id, profile_id, relationship, is_primary)
SELECT '20000000-0000-4000-a000-000000000002', p.id, 'parent', true
FROM profiles p WHERE p.email = 'richard.blaalid+parent@withcaldera.com'
ON CONFLICT DO NOTHING;

-- ============================================
-- 3. CREATE SAMPLE TRANSACTIONS
-- ============================================
DO $$
DECLARE
    v_unit_id UUID := '10000000-0000-4000-a000-000000000001';
    v_receivable_account_id UUID;
    v_income_account_id UUID;
    v_dues_income_id UUID;
    v_bank_account_id UUID;
    v_fee_account_id UUID;
    v_journal_id UUID;
    v_scout_account_id UUID;
    v_scout_record RECORD;
BEGIN
    -- Get account IDs
    SELECT id INTO v_receivable_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1200';
    SELECT id INTO v_income_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '4100';
    SELECT id INTO v_dues_income_id FROM accounts WHERE unit_id = v_unit_id AND code = '4000';
    SELECT id INTO v_bank_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1000';
    SELECT id INTO v_fee_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '5600';

    -- Skip if accounts don't exist or already have data
    IF v_receivable_account_id IS NULL THEN
        RAISE NOTICE 'Accounts not found, skipping transaction seed';
        RETURN;
    END IF;

    -- Check if we already have journal entries
    IF EXISTS (SELECT 1 FROM journal_entries WHERE unit_id = v_unit_id) THEN
        RAISE NOTICE 'Journal entries already exist, skipping transaction seed';
        RETURN;
    END IF;

    -- ============================================
    -- 4. CREATE SAMPLE BILLING: Summer Camp ($300 total, 10 scouts = $30 each)
    -- ============================================
    INSERT INTO journal_entries (id, unit_id, entry_date, description, entry_type, is_posted, posted_at)
    VALUES (
        '30000000-0000-4000-a000-000000000001',
        v_unit_id,
        '2024-06-01',
        'Summer Camp 2024 - Fair Share',
        'billing',
        true,
        NOW()
    );

    INSERT INTO billing_records (id, unit_id, description, total_amount, billing_date, journal_entry_id)
    VALUES (
        '40000000-0000-4000-a000-000000000001',
        v_unit_id,
        'Summer Camp 2024',
        300.00,
        '2024-06-01',
        '30000000-0000-4000-a000-000000000001'
    );

    -- Debit each scout $30 (they owe money)
    FOR v_scout_record IN
        SELECT sa.id as account_id, s.first_name, s.last_name
        FROM scout_accounts sa
        JOIN scouts s ON s.id = sa.scout_id
        WHERE sa.unit_id = v_unit_id
    LOOP
        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
        VALUES (
            '30000000-0000-4000-a000-000000000001',
            v_receivable_account_id,
            v_scout_record.account_id,
            30.00,
            0,
            v_scout_record.first_name || ' ' || v_scout_record.last_name || ' - Summer Camp'
        );

        INSERT INTO billing_charges (billing_record_id, scout_account_id, amount, is_paid)
        VALUES (
            '40000000-0000-4000-a000-000000000001',
            v_scout_record.account_id,
            30.00,
            false
        );
    END LOOP;

    -- Credit income (we earned $300)
    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES (
        '30000000-0000-4000-a000-000000000001',
        v_income_account_id,
        NULL,
        0,
        300.00,
        'Summer Camp 2024 - Camping Fees Income'
    );

    -- ============================================
    -- 5. CREATE SAMPLE BILLING: Monthly Dues ($50 total, 10 scouts = $5 each)
    -- ============================================
    INSERT INTO journal_entries (id, unit_id, entry_date, description, entry_type, is_posted, posted_at)
    VALUES (
        '30000000-0000-4000-a000-000000000002',
        v_unit_id,
        '2024-07-01',
        'July Monthly Dues',
        'billing',
        true,
        NOW()
    );

    INSERT INTO billing_records (id, unit_id, description, total_amount, billing_date, journal_entry_id)
    VALUES (
        '40000000-0000-4000-a000-000000000002',
        v_unit_id,
        'July Monthly Dues',
        50.00,
        '2024-07-01',
        '30000000-0000-4000-a000-000000000002'
    );

    FOR v_scout_record IN
        SELECT sa.id as account_id, s.first_name, s.last_name
        FROM scout_accounts sa
        JOIN scouts s ON s.id = sa.scout_id
        WHERE sa.unit_id = v_unit_id
    LOOP
        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
        VALUES (
            '30000000-0000-4000-a000-000000000002',
            v_receivable_account_id,
            v_scout_record.account_id,
            5.00,
            0,
            v_scout_record.first_name || ' ' || v_scout_record.last_name || ' - July Dues'
        );

        INSERT INTO billing_charges (billing_record_id, scout_account_id, amount, is_paid)
        VALUES (
            '40000000-0000-4000-a000-000000000002',
            v_scout_record.account_id,
            5.00,
            false
        );
    END LOOP;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES (
        '30000000-0000-4000-a000-000000000002',
        v_dues_income_id,
        NULL,
        0,
        50.00,
        'July Monthly Dues'
    );

    -- ============================================
    -- 6. CREATE SAMPLE PAYMENTS (some scouts paid)
    -- ============================================

    -- Alex Anderson pays $35 cash (covers Summer Camp + July Dues)
    SELECT id INTO v_scout_account_id FROM scout_accounts WHERE scout_id = '20000000-0000-4000-a000-000000000001';

    INSERT INTO journal_entries (id, unit_id, entry_date, description, entry_type, reference, is_posted, posted_at)
    VALUES (
        '30000000-0000-4000-a000-000000000003',
        v_unit_id,
        '2024-07-05',
        'Payment from Alex Anderson',
        'payment',
        'CASH-001',
        true,
        NOW()
    );

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES
        ('30000000-0000-4000-a000-000000000003', v_bank_account_id, NULL, 35.00, 0, 'Cash payment'),
        ('30000000-0000-4000-a000-000000000003', v_receivable_account_id, v_scout_account_id, 0, 35.00, 'Payment received');

    INSERT INTO payments (unit_id, scout_account_id, amount, fee_amount, net_amount, payment_method, status, journal_entry_id, notes)
    VALUES (v_unit_id, v_scout_account_id, 35.00, 0, 35.00, 'cash', 'completed', '30000000-0000-4000-a000-000000000003', 'Full payment for Summer Camp and July Dues');

    -- Ben Baker pays $30 by check (partial - Summer Camp only)
    SELECT id INTO v_scout_account_id FROM scout_accounts WHERE scout_id = '20000000-0000-4000-a000-000000000002';

    INSERT INTO journal_entries (id, unit_id, entry_date, description, entry_type, reference, is_posted, posted_at)
    VALUES (
        '30000000-0000-4000-a000-000000000004',
        v_unit_id,
        '2024-07-10',
        'Payment from Ben Baker',
        'payment',
        'CHK-1234',
        true,
        NOW()
    );

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES
        ('30000000-0000-4000-a000-000000000004', v_bank_account_id, NULL, 30.00, 0, 'Check #1234'),
        ('30000000-0000-4000-a000-000000000004', v_receivable_account_id, v_scout_account_id, 0, 30.00, 'Payment received');

    INSERT INTO payments (unit_id, scout_account_id, amount, fee_amount, net_amount, payment_method, status, journal_entry_id, notes)
    VALUES (v_unit_id, v_scout_account_id, 30.00, 0, 30.00, 'check', 'completed', '30000000-0000-4000-a000-000000000004', 'Check #1234 - Summer Camp');

    -- Charlie Chen pays $35 by card (with fee)
    SELECT id INTO v_scout_account_id FROM scout_accounts WHERE scout_id = '20000000-0000-4000-a000-000000000003';

    INSERT INTO journal_entries (id, unit_id, entry_date, description, entry_type, reference, is_posted, posted_at)
    VALUES (
        '30000000-0000-4000-a000-000000000005',
        v_unit_id,
        '2024-07-12',
        'Payment from Charlie Chen',
        'payment',
        'CARD-5678',
        true,
        NOW()
    );

    -- Card payment: $35 amount, $1.01 fee (2.6% + $0.10), $33.99 net
    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES
        ('30000000-0000-4000-a000-000000000005', v_bank_account_id, NULL, 33.99, 0, 'Card payment (net)'),
        ('30000000-0000-4000-a000-000000000005', v_fee_account_id, NULL, 1.01, 0, 'Card processing fee'),
        ('30000000-0000-4000-a000-000000000005', v_receivable_account_id, v_scout_account_id, 0, 35.00, 'Payment received');

    INSERT INTO payments (unit_id, scout_account_id, amount, fee_amount, net_amount, payment_method, status, journal_entry_id, notes)
    VALUES (v_unit_id, v_scout_account_id, 35.00, 1.01, 33.99, 'card', 'completed', '30000000-0000-4000-a000-000000000005', 'Card payment - Full balance');

    -- George Garcia pays $50 cash (overpayment - creates credit)
    SELECT id INTO v_scout_account_id FROM scout_accounts WHERE scout_id = '20000000-0000-4000-a000-000000000007';

    INSERT INTO journal_entries (id, unit_id, entry_date, description, entry_type, reference, is_posted, posted_at)
    VALUES (
        '30000000-0000-4000-a000-000000000006',
        v_unit_id,
        '2024-07-15',
        'Payment from George Garcia',
        'payment',
        'CASH-002',
        true,
        NOW()
    );

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo)
    VALUES
        ('30000000-0000-4000-a000-000000000006', v_bank_account_id, NULL, 50.00, 0, 'Cash payment'),
        ('30000000-0000-4000-a000-000000000006', v_receivable_account_id, v_scout_account_id, 0, 50.00, 'Payment received');

    INSERT INTO payments (unit_id, scout_account_id, amount, fee_amount, net_amount, payment_method, status, journal_entry_id, notes)
    VALUES (v_unit_id, v_scout_account_id, 50.00, 0, 50.00, 'cash', 'completed', '30000000-0000-4000-a000-000000000006', 'Prepayment for upcoming events');

    RAISE NOTICE 'Seed data created successfully!';
END $$;

-- ============================================
-- 7. CREATE TEST EVENTS
-- ============================================
INSERT INTO events (id, unit_id, title, description, event_type, location, start_date, end_date, cost_per_scout, cost_per_adult)
VALUES (
    '50000000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000001',
    'Summer Camp 2024',
    'Week-long summer camp at Camp Adventure',
    'campout',
    'Camp Adventure, Mountain View',
    '2024-07-14 08:00:00',
    '2024-07-20 12:00:00',
    250.00,
    50.00
) ON CONFLICT DO NOTHING;

INSERT INTO events (id, unit_id, title, description, event_type, location, start_date, end_date, cost_per_scout)
VALUES (
    '50000000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-000000000001',
    'Fall Campout',
    'Weekend camping trip',
    'campout',
    'State Park',
    '2024-10-18 17:00:00',
    '2024-10-20 12:00:00',
    35.00
) ON CONFLICT DO NOTHING;

-- ============================================
-- SUMMARY OF SEED DATA
-- ============================================
-- Unit: Troop 123
-- 10 Scouts (3 patrols: Eagle, Wolf, Bear)
-- 2 Billing Records:
--   - Summer Camp: $300 total ($30/scout)
--   - July Dues: $50 total ($5/scout)
-- 4 Payments:
--   - Alex Anderson: $35 cash (paid in full, balance = $0)
--   - Ben Baker: $30 check (partial, balance = -$5)
--   - Charlie Chen: $35 card (paid in full, balance = $0)
--   - George Garcia: $50 cash (overpaid, balance = +$15)
-- Remaining 6 scouts: balance = -$35 each (owe money)
--
-- Expected balances after seed:
--   Alex Anderson: $0 (paid in full)
--   Ben Baker: -$5 (partial payment)
--   Charlie Chen: $0 (paid in full)
--   David Davis: -$35 (owes)
--   Ethan Evans: -$35 (owes)
--   Frank Fisher: -$35 (owes)
--   George Garcia: +$15 (credit - overpaid)
--   Henry Harris: -$35 (owes)
--   Isaac Irwin: -$35 (owes)
--   Jake Johnson: -$35 (owes)
-- ============================================

-- Verify balances
SELECT
    s.first_name || ' ' || s.last_name as scout_name,
    p.name as patrol,
    sa.billing_balance
FROM scouts s
JOIN scout_accounts sa ON sa.scout_id = s.id
LEFT JOIN patrols p ON p.id = s.patrol_id
WHERE s.unit_id = '10000000-0000-4000-a000-000000000001'
ORDER BY s.last_name;
