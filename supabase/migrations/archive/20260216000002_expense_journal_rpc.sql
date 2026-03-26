-- RPC function to create journal entry for approved expense reimbursement
-- This follows the same pattern as credit_fundraising_to_scout

-- Add expense_reimbursement to journal_entry_type enum
ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'expense_reimbursement';

CREATE OR REPLACE FUNCTION create_expense_journal_entry(
    p_expense_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_expense RECORD;
    v_unit_id UUID;
    v_journal_entry_id UUID;
    v_expense_account_id UUID;
    v_payable_account_id UUID;
    v_expense_code TEXT;
    v_submitter_name TEXT;
BEGIN
    -- Get the expense with submitter info
    SELECT
        er.*,
        p.full_name AS submitter_name
    INTO v_expense
    FROM expense_reimbursements er
    JOIN profiles p ON p.id = er.submitter_id
    WHERE er.id = p_expense_id;

    IF v_expense IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Expense not found');
    END IF;

    -- Must be approved to create journal entry
    IF v_expense.status != 'approved' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Expense must be approved');
    END IF;

    -- Already has journal entry
    IF v_expense.journal_entry_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Journal entry already exists');
    END IF;

    v_unit_id := v_expense.unit_id;
    v_submitter_name := COALESCE(v_expense.submitter_name, 'Unknown');

    -- Check permission
    IF NOT user_has_role(v_unit_id, ARRAY['admin', 'treasurer']::membership_role[]) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Permission denied');
    END IF;

    -- Map expense category to account code
    v_expense_code := CASE v_expense.category
        WHEN 'supplies' THEN '5100'  -- Equipment & Supplies
        WHEN 'food' THEN '5000'      -- Camping Expenses (includes food for events)
        WHEN 'travel' THEN '5900'    -- Other Expenses (travel category)
        ELSE '5900'                  -- Other Expenses (catch-all)
    END;

    -- Get expense account
    SELECT id INTO v_expense_account_id
    FROM accounts
    WHERE unit_id = v_unit_id AND code = v_expense_code;

    IF v_expense_account_id IS NULL THEN
        -- Fall back to Other Expenses
        SELECT id INTO v_expense_account_id
        FROM accounts
        WHERE unit_id = v_unit_id AND code = '5900';
    END IF;

    IF v_expense_account_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Expense account not found');
    END IF;

    -- Get Accounts Payable account
    SELECT id INTO v_payable_account_id
    FROM accounts
    WHERE unit_id = v_unit_id AND code = '2100';

    IF v_payable_account_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Accounts Payable account not found');
    END IF;

    -- Create journal entry
    INSERT INTO journal_entries (
        unit_id,
        entry_date,
        description,
        entry_type,
        is_posted,
        created_by
    )
    VALUES (
        v_unit_id,
        CURRENT_DATE,
        'Expense Reimbursement: ' || v_expense.description || ' - ' || v_submitter_name,
        'expense_reimbursement',
        true,
        get_current_profile_id()
    )
    RETURNING id INTO v_journal_entry_id;

    -- Debit expense account (increase expense)
    INSERT INTO journal_lines (
        journal_entry_id,
        account_id,
        debit,
        credit,
        memo
    )
    VALUES (
        v_journal_entry_id,
        v_expense_account_id,
        v_expense.amount,
        0,
        v_expense.description
    );

    -- Credit accounts payable (increase liability - owe money to submitter)
    INSERT INTO journal_lines (
        journal_entry_id,
        account_id,
        debit,
        credit,
        memo
    )
    VALUES (
        v_journal_entry_id,
        v_payable_account_id,
        0,
        v_expense.amount,
        'Payable to ' || v_submitter_name
    );

    -- Link journal entry to expense
    UPDATE expense_reimbursements
    SET journal_entry_id = v_journal_entry_id
    WHERE id = p_expense_id;

    RETURN jsonb_build_object(
        'success', true,
        'journal_entry_id', v_journal_entry_id,
        'expense_id', p_expense_id,
        'amount', v_expense.amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_expense_journal_entry(UUID) TO authenticated;

-- Comment on function
COMMENT ON FUNCTION create_expense_journal_entry IS 'Creates a journal entry for an approved expense reimbursement. Debits expense account, credits accounts payable.';
