-- Fix void_payment: only reverse overpayment if payment actually caused one.
--
-- Previous logic checked billing_balance < 0 AND funds_balance > 0, which
-- incorrectly pulled from funds that came from unrelated sources (fundraising).
-- Now we calculate the actual overpayment: payment amount minus total allocations.
-- Only if there was a surplus (overpayment) do we reverse the funds transfer.

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
