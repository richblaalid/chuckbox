-- Add new entry type for fund adjustments
ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'funds_adjustment';

-- Debit funds from scout account (reverse of credit_fundraising_to_scout)
CREATE OR REPLACE FUNCTION debit_funds_from_scout(
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
        RAISE EXCEPTION 'Debit amount must be positive';
    END IF;

    IF p_amount > v_account.funds_balance THEN
        RAISE EXCEPTION 'Amount % exceeds current funds balance of %', p_amount, v_account.funds_balance;
    END IF;

    -- Get Scout Funds account (1210)
    SELECT id INTO v_funds_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1210';

    -- Get income account based on fundraiser type
    SELECT id INTO v_income_account_id FROM accounts WHERE unit_id = v_unit_id AND code = CASE
        WHEN p_fundraiser_type = 'popcorn' THEN '4200'
        WHEN p_fundraiser_type = 'camp_cards' THEN '4210'
        ELSE '4900'
    END;

    IF v_funds_account_id IS NULL THEN
        RAISE EXCEPTION 'Scout Funds account not found';
    END IF;

    -- Fallback to general income if specific type account not found
    IF v_income_account_id IS NULL THEN
        SELECT id INTO v_income_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '4900';
    END IF;

    IF v_income_account_id IS NULL THEN
        RAISE EXCEPTION 'Income account not found for unit';
    END IF;

    -- Create journal entry
    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted, created_by)
    VALUES (v_unit_id, CURRENT_DATE, 'Funds removal: ' || p_description || ' - ' || v_scout_name,
            'funds_adjustment', true, get_current_profile_id())
    RETURNING id INTO v_journal_entry_id;

    -- Debit Scout Funds (1210) — reduces funds_balance via trigger
    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_funds_account_id, p_scout_account_id, p_amount, 0, p_description, 'funds');

    -- Credit income account — reverses the original revenue recognition
    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_income_account_id, NULL, 0, p_amount, 'Funds removal reversal: ' || p_description, NULL);

    RETURN jsonb_build_object(
        'success', true,
        'journal_entry_id', v_journal_entry_id,
        'amount_debited', p_amount,
        'new_funds_balance', v_account.funds_balance - p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION debit_funds_from_scout TO authenticated;
