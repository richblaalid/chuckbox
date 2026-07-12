-- CHUCK-9 (PLATFORM-022): Opening Balance Equity system account
--
-- Balance imports state scout balances without a real counterparty, so their
-- journal entries need a contra account to satisfy the balance invariant
-- (Σdebit = Σcredit). Standard treatment: an Opening Balance Equity account
-- (code 3000). Added to the default chart of accounts and backfilled for
-- every existing unit.

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
    -- Equity
    (p_unit_id, '3000', 'Opening Balance Equity', 'equity', true),
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

-- Backfill for existing units
INSERT INTO accounts (unit_id, code, name, account_type, is_system)
SELECT id, '3000', 'Opening Balance Equity', 'equity', true
FROM units
ON CONFLICT (unit_id, code) DO NOTHING;
