-- Fix void_payment: only create reversal journal entry if payment had charge allocations
-- Payments without allocations (not tied to billing) should not create a receivable
-- debt when voided, since there's no charge to restore.
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
    v_has_allocations BOOLEAN;
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

    -- Check if payment has charge allocations
    SELECT EXISTS(
        SELECT 1 FROM payment_allocations WHERE payment_id = p_payment_id
    ) INTO v_has_allocations;

    -- Create reversal journal entry only if:
    -- 1. Original journal entry exists, AND
    -- 2. Payment had charge allocations (was tied to billing)
    -- Payments without allocations are "general" payments — voiding them
    -- should not create a new receivable/debt for the scout.
    IF v_payment.journal_entry_id IS NOT NULL AND v_has_allocations THEN
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

    -- Reverse billing charge allocations
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

    -- Void the payment
    UPDATE payments SET voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
    WHERE id = p_payment_id;

    RETURN jsonb_build_object('success', true, 'reversal_entry_id', v_reversal_entry_id);
END;
$$;
