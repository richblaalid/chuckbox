-- CHUCK-7 (audit P0-2): add internal authorization to the three money-moving
-- SECURITY DEFINER RPCs that had none. All are granted TO authenticated and
-- reachable via PostgREST by any logged-in user of any unit; without these
-- checks a cross-unit caller can move any scout's funds or void any payment.
--
-- Policy (see docs/grounding/tickets/CHUCK-7-plan.md):
--   transfer_funds_to_billing  service_role OR admin/treasurer in the scout's
--                              unit OR guardian of the scout (parent-facing
--                              use-funds modal calls this from the browser)
--   auto_transfer_overpayment  service_role OR admin/treasurer (no live callers)
--   void_payment               service_role OR admin/treasurer in payment's unit
--
-- service_role passes because the pay-with-balance route calls
-- transfer_funds_to_billing with the service client after validating the
-- payment-link token server-side; the service key never reaches browsers.

-- ============================================================
-- transfer_funds_to_billing (body from 20260519000002 + authz)
-- ============================================================
CREATE OR REPLACE FUNCTION transfer_funds_to_billing(
    p_scout_account_id UUID,
    p_amount DECIMAL(10,2),
    p_description TEXT DEFAULT 'Transfer from Scout Funds',
    p_allocations JSONB DEFAULT NULL,
    p_entry_date DATE DEFAULT NULL
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
    v_entry_date DATE;
BEGIN
    v_entry_date := COALESCE(p_entry_date, CURRENT_DATE);

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

    -- Authorization: unit admin/treasurer, a guardian of this scout
    -- (use-funds modal), or the service role (pay-with-balance route).
    IF NOT (
        auth.role() = 'service_role'
        OR user_has_role(v_unit_id, ARRAY['admin', 'treasurer']::membership_role[])
        OR EXISTS (
            SELECT 1 FROM scout_guardians sg
            JOIN profiles p ON p.id = sg.profile_id
            WHERE sg.scout_id = v_account.scout_id
              AND p.user_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    IF v_account.funds_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient funds. Available: $%, Requested: $%',
            v_account.funds_balance, p_amount;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    IF p_allocations IS NOT NULL THEN
        SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
          INTO v_alloc_sum
          FROM jsonb_array_elements(p_allocations) AS elem;

        IF ABS(v_alloc_sum - p_amount) > 0.01 THEN
            RAISE EXCEPTION 'Allocation sum (%) does not match transfer amount (%)',
                v_alloc_sum, p_amount;
        END IF;

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
    VALUES (v_unit_id, v_entry_date, p_description || ' - ' || v_scout_name, 'funds_transfer', true, get_current_profile_id())
    RETURNING id INTO v_journal_entry_id;

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_funds_account_id, p_scout_account_id, p_amount, 0, 'Transfer to billing', 'funds');

    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
    VALUES (v_journal_entry_id, v_billing_account_id, p_scout_account_id, 0, p_amount, 'Transfer from scout funds', 'billing');

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

-- ============================================================
-- auto_transfer_overpayment (body from 00000000000000 + authz)
-- ============================================================
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

    -- Authorization: unit admin/treasurer or the service role.
    IF NOT (
        auth.role() = 'service_role'
        OR user_has_role(v_unit_id, ARRAY['admin', 'treasurer']::membership_role[])
    ) THEN
        RAISE EXCEPTION 'Permission denied';
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

-- ============================================================
-- void_payment (body from 20260402000004 + authz)
-- ============================================================
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
    v_alloc RECORD;
    v_scout_account RECORD;
    v_total_allocated DECIMAL(10,2);
    v_overpayment_amount DECIMAL(10,2);
    v_transfer_amount DECIMAL(10,2);
    v_transfer_entry_id UUID;
    v_funds_account_id UUID;
    v_billing_account_id UUID;
BEGIN
    -- Prevent reconcile trigger from re-marking charges during void
    PERFORM set_config('app.void_in_progress', 'true', true);

    SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
    END IF;

    -- Authorization: unit admin/treasurer or the service role.
    IF NOT (
        auth.role() = 'service_role'
        OR user_has_role(v_payment.unit_id, ARRAY['admin', 'treasurer']::membership_role[])
    ) THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    IF v_payment.voided_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payment already voided');
    END IF;

    IF v_payment.square_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot void Square payments - use Square dashboard for refunds');
    END IF;

    -- Step 1: Always reverse the payment journal entry (if it exists)
    IF v_payment.journal_entry_id IS NOT NULL THEN
        SELECT * INTO v_journal_entry FROM journal_entries WHERE id = v_payment.journal_entry_id;

        IF FOUND THEN
            INSERT INTO journal_entries (unit_id, entry_date, description, entry_type)
            VALUES (v_journal_entry.unit_id, CURRENT_DATE, 'VOID: ' || v_journal_entry.description, 'reversal')
            RETURNING id INTO v_reversal_entry_id;

            INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, target_balance)
            SELECT v_reversal_entry_id, account_id, scout_account_id, credit, debit, target_balance
            FROM journal_lines WHERE journal_entry_id = v_journal_entry.id;
        END IF;
    END IF;

    -- Step 2: Reverse billing charge allocations
    FOR v_alloc IN
        SELECT pa.billing_charge_id, pa.amount
        FROM payment_allocations pa
        WHERE pa.payment_id = p_payment_id
    LOOP
        UPDATE billing_charges
        SET paid_amount = GREATEST(0, COALESCE(paid_amount, 0) - v_alloc.amount),
            is_paid = false
        WHERE id = v_alloc.billing_charge_id;
    END LOOP;

    -- Step 3: Reverse overpayment-to-funds transfer ONLY if payment actually caused one.
    -- Overpayment = payment amount minus what was allocated to charges.
    -- If the full payment was allocated to charges, there was no overpayment.
    IF v_payment.scout_account_id IS NOT NULL THEN
        -- Calculate total allocated to charges
        SELECT COALESCE(SUM(pa.amount), 0) INTO v_total_allocated
        FROM payment_allocations pa
        WHERE pa.payment_id = p_payment_id;

        v_overpayment_amount := v_payment.amount - v_total_allocated;

        IF v_overpayment_amount > 0 THEN
            -- There was an overpayment that was transferred to funds.
            -- Reverse it: pull from funds back to billing.
            SELECT billing_balance, funds_balance, unit_id
            INTO v_scout_account
            FROM scout_accounts
            WHERE id = v_payment.scout_account_id;

            -- Only transfer what's actually in funds (may have been spent)
            v_transfer_amount := LEAST(v_overpayment_amount, GREATEST(0, v_scout_account.funds_balance));

            IF v_transfer_amount > 0 THEN
                SELECT id INTO v_billing_account_id
                FROM accounts WHERE unit_id = v_scout_account.unit_id AND code = '1200';
                SELECT id INTO v_funds_account_id
                FROM accounts WHERE unit_id = v_scout_account.unit_id AND code = '1210';

                IF v_billing_account_id IS NOT NULL AND v_funds_account_id IS NOT NULL THEN
                    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted)
                    VALUES (v_scout_account.unit_id, CURRENT_DATE, 'VOID: Reverse overpayment transfer', 'adjustment', true)
                    RETURNING id INTO v_transfer_entry_id;

                    -- Credit billing (increase billing_balance toward 0)
                    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
                    VALUES (v_transfer_entry_id, v_billing_account_id, v_payment.scout_account_id, 0, v_transfer_amount, 'Void: reverse overpayment from funds', 'billing');

                    -- Debit funds (decrease funds_balance)
                    INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
                    VALUES (v_transfer_entry_id, v_funds_account_id, v_payment.scout_account_id, v_transfer_amount, 0, 'Void: reverse overpayment to billing', 'funds');
                END IF;
            END IF;
        END IF;
    END IF;

    -- Step 4: Mark payment as voided
    UPDATE payments SET voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
    WHERE id = p_payment_id;

    RETURN jsonb_build_object('success', true, 'reversal_entry_id', v_reversal_entry_id);
END;
$$;
