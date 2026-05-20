-- Extend transfer_funds_to_billing RPC to optionally accept per-charge allocations.
-- When p_allocations is provided, increments billing_charges.paid_amount alongside
-- the journal entries. Existing callers passing no p_allocations get current behavior
-- (NULL default, allocation block skipped).

CREATE OR REPLACE FUNCTION transfer_funds_to_billing(
    p_scout_account_id UUID,
    p_amount DECIMAL(10,2),
    p_description TEXT DEFAULT 'Transfer from Scout Funds',
    p_allocations JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_account RECORD;
    v_unit_id UUID;
    v_journal_entry_id UUID;
    v_funds_account_id UUID;
    v_billing_account_id UUID;
    v_scout_name TEXT;
    v_alloc JSONB;
    v_alloc_sum NUMERIC := 0;
    v_charge_id UUID;
    v_alloc_amount NUMERIC;
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

    -- If allocations supplied, validate them before doing any work
    IF p_allocations IS NOT NULL THEN
        SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
          INTO v_alloc_sum
          FROM jsonb_array_elements(p_allocations) AS elem;

        IF ABS(v_alloc_sum - p_amount) > 0.01 THEN
            RAISE EXCEPTION 'Allocation sum (%) does not match transfer amount (%)',
                v_alloc_sum, p_amount;
        END IF;

        -- Verify every allocation references a charge owned by this scout account
        FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
        LOOP
            v_charge_id := (v_alloc->>'charge_id')::UUID;
            IF NOT EXISTS (
                SELECT 1 FROM billing_charges
                WHERE id = v_charge_id
                  AND scout_account_id = p_scout_account_id
                  AND (is_void IS NULL OR is_void = false)
            ) THEN
                RAISE EXCEPTION 'Charge % not found or not owned by scout account %',
                    v_charge_id, p_scout_account_id;
            END IF;
        END LOOP;
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

    -- Apply per-charge paid_amount increments
    IF p_allocations IS NOT NULL THEN
        FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
        LOOP
            v_charge_id := (v_alloc->>'charge_id')::UUID;
            v_alloc_amount := (v_alloc->>'amount')::NUMERIC;

            UPDATE billing_charges
                SET paid_amount = COALESCE(paid_amount, 0) + v_alloc_amount
                WHERE id = v_charge_id;
        END LOOP;
    END IF;

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
