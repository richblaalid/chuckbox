-- Void payment: always reverse journal entries and overpayment-to-funds transfers.
--
-- Previous versions skipped journal reversal when no charge allocations existed.
-- Now every void fully reverses all balance effects:
--   1. Reverse the payment journal entry (restores billing_balance)
--   2. Reverse charge allocations (marks charges unpaid)
--   3. Reverse overpayment-to-funds transfers (pulls funds back to billing)

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
    v_transfer_amount DECIMAL(10,2);
    v_transfer_entry_id UUID;
    v_funds_account_id UUID;
    v_billing_account_id UUID;
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

    -- Step 1: Always reverse the payment journal entry (if it exists)
    IF v_payment.journal_entry_id IS NOT NULL THEN
        SELECT * INTO v_journal_entry FROM journal_entries WHERE id = v_payment.journal_entry_id;

        IF FOUND THEN
            INSERT INTO journal_entries (unit_id, entry_date, description, entry_type)
            VALUES (v_journal_entry.unit_id, CURRENT_DATE, 'VOID: ' || v_journal_entry.description, 'reversal')
            RETURNING id INTO v_reversal_entry_id;

            -- Swap debit/credit; preserve target_balance so triggers update the correct balance
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

    -- Step 3: Reverse overpayment-to-funds transfers
    -- After the journal reversal, if billing_balance < 0 (scout owes) and
    -- funds_balance > 0 (from the original overpayment transfer), pull funds
    -- back to billing to restore the pre-payment state.
    IF v_payment.scout_account_id IS NOT NULL THEN
        SELECT billing_balance, funds_balance, unit_id
        INTO v_scout_account
        FROM scout_accounts
        WHERE id = v_payment.scout_account_id;

        IF v_scout_account.billing_balance < 0 AND v_scout_account.funds_balance > 0 THEN
            v_transfer_amount := LEAST(ABS(v_scout_account.billing_balance), v_scout_account.funds_balance);

            -- Get the accounts needed for the reverse transfer
            SELECT id INTO v_billing_account_id
            FROM accounts WHERE unit_id = v_scout_account.unit_id AND code = '1200';
            SELECT id INTO v_funds_account_id
            FROM accounts WHERE unit_id = v_scout_account.unit_id AND code = '1210';

            IF v_billing_account_id IS NOT NULL AND v_funds_account_id IS NOT NULL THEN
                INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted)
                VALUES (v_scout_account.unit_id, CURRENT_DATE, 'VOID: Reverse overpayment transfer', 'adjustment', true)
                RETURNING id INTO v_transfer_entry_id;

                -- Reverse the overpayment: debit billing (increase billing_balance toward 0)
                INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
                VALUES (v_transfer_entry_id, v_billing_account_id, v_payment.scout_account_id, 0, v_transfer_amount, 'Void: reverse overpayment from funds', 'billing');

                -- Reverse the overpayment: credit funds (decrease funds_balance)
                INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
                VALUES (v_transfer_entry_id, v_funds_account_id, v_payment.scout_account_id, v_transfer_amount, 0, 'Void: reverse overpayment to billing', 'funds');
            END IF;
        END IF;
    END IF;

    -- Step 4: Mark payment as voided
    UPDATE payments SET voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
    WHERE id = p_payment_id;

    RETURN jsonb_build_object('success', true, 'reversal_entry_id', v_reversal_entry_id);
END;
$$;
