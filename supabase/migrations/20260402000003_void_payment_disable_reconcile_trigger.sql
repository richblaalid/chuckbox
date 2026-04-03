-- Fix void_payment: disable reconcile_billing_charges trigger during void.
--
-- The reconcile trigger fires when billing_balance changes and re-marks
-- charges as paid based on the balance. During a void, the journal reversal
-- changes billing_balance, which triggers reconciliation BEFORE we can
-- mark charges as unpaid. The trigger undoes our unpaid changes.
--
-- Solution: use a session variable to signal the trigger to skip during voids.

-- Update the reconcile trigger to check for void-in-progress flag
CREATE OR REPLACE FUNCTION reconcile_billing_charges()
RETURNS TRIGGER AS $$
DECLARE
    v_total_unpaid DECIMAL(10,2);
    v_remaining_debt DECIMAL(10,2);
    v_amount_covered DECIMAL(10,2);
    v_running_total DECIMAL(10,2) := 0;
    v_charge RECORD;
BEGIN
    -- Skip reconciliation during void operations
    IF current_setting('app.void_in_progress', true) = 'true' THEN
        RETURN NEW;
    END IF;

    -- Only act when billing_balance changes
    IF NEW.billing_balance IS NOT DISTINCT FROM OLD.billing_balance THEN
        RETURN NEW;
    END IF;

    -- If balance is >= 0, all charges are covered — mark all unpaid as paid
    IF NEW.billing_balance >= 0 THEN
        UPDATE billing_charges
        SET is_paid = true
        WHERE scout_account_id = NEW.id
        AND (is_paid = false OR is_paid IS NULL)
        AND (is_void = false OR is_void IS NULL);

        RETURN NEW;
    END IF;

    -- If balance improved (less negative) but still negative,
    -- mark oldest charges as paid up to the covered amount
    IF NEW.billing_balance > OLD.billing_balance THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_total_unpaid
        FROM billing_charges
        WHERE scout_account_id = NEW.id
        AND (is_paid = false OR is_paid IS NULL)
        AND (is_void = false OR is_void IS NULL);

        v_remaining_debt := ABS(NEW.billing_balance);
        v_amount_covered := v_total_unpaid - v_remaining_debt;

        IF v_amount_covered > 0 THEN
            FOR v_charge IN
                SELECT bc.id, bc.amount
                FROM billing_charges bc
                JOIN billing_records br ON br.id = bc.billing_record_id
                WHERE bc.scout_account_id = NEW.id
                AND (bc.is_paid = false OR bc.is_paid IS NULL)
                AND (bc.is_void = false OR bc.is_void IS NULL)
                ORDER BY br.billing_date ASC, bc.id ASC
            LOOP
                v_running_total := v_running_total + v_charge.amount;
                IF v_running_total <= v_amount_covered THEN
                    UPDATE billing_charges
                    SET is_paid = true
                    WHERE id = v_charge.id;
                ELSE
                    EXIT;
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

-- Update void_payment to set the flag before doing work
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

    -- Step 3: Reverse overpayment-to-funds transfers
    IF v_payment.scout_account_id IS NOT NULL THEN
        SELECT billing_balance, funds_balance, unit_id
        INTO v_scout_account
        FROM scout_accounts
        WHERE id = v_payment.scout_account_id;

        IF v_scout_account.billing_balance < 0 AND v_scout_account.funds_balance > 0 THEN
            v_transfer_amount := LEAST(ABS(v_scout_account.billing_balance), v_scout_account.funds_balance);

            SELECT id INTO v_billing_account_id
            FROM accounts WHERE unit_id = v_scout_account.unit_id AND code = '1200';
            SELECT id INTO v_funds_account_id
            FROM accounts WHERE unit_id = v_scout_account.unit_id AND code = '1210';

            IF v_billing_account_id IS NOT NULL AND v_funds_account_id IS NOT NULL THEN
                INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted)
                VALUES (v_scout_account.unit_id, CURRENT_DATE, 'VOID: Reverse overpayment transfer', 'adjustment', true)
                RETURNING id INTO v_transfer_entry_id;

                INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
                VALUES (v_transfer_entry_id, v_billing_account_id, v_payment.scout_account_id, 0, v_transfer_amount, 'Void: reverse overpayment from funds', 'billing');

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
