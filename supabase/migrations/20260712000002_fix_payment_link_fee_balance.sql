-- CHUCK-9 (PLATFORM-023): balance the fees-passed branch of process_payment_link_payment
--
-- The fees-passed branch debited bank (net) + fee expense (Square fee) but
-- credited only the base amount, leaving every fees-passed payment-link entry
-- unbalanced by the payer's surcharge (total − base). The surcharge the payer
-- contributed is now credited to 5600 Payment Processing Fees (contra-expense),
-- netting fee expense to (Square fee − collected surcharge) ≈ 0.
--
-- Also: a missing fee account used to silently skip fee lines (producing an
-- unbalanced entry); now it raises a clear exception whenever a fee line is due.
--
-- Everything else — validation, payment/square_transactions inserts, the inline
-- overpayment sweep (slated for removal by CHUCK-12) — is unchanged.

CREATE OR REPLACE FUNCTION process_payment_link_payment(
    p_payment_link_id UUID,
    p_scout_account_id UUID,
    p_base_amount_cents INTEGER,
    p_total_amount_cents INTEGER,
    p_fee_amount_cents INTEGER,
    p_net_amount_cents INTEGER,
    p_square_payment_id TEXT,
    p_square_receipt_url TEXT,
    p_square_order_id TEXT,
    p_scout_name TEXT,
    p_fees_passed_to_payer BOOLEAN,
    p_card_details JSONB,
    p_buyer_email TEXT DEFAULT NULL,
    p_payment_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_payment_link RECORD;
    v_scout_account RECORD;
    v_unit_id UUID;
    v_journal_entry_id UUID;
    v_payment_id UUID;
    v_bank_account_id UUID;
    v_receivable_account_id UUID;
    v_fee_account_id UUID;
    v_funds_account_id UUID;
    v_current_balance_cents INTEGER;
    v_remaining_balance_cents INTEGER;
    v_base_amount DECIMAL(10,2);
    v_total_amount DECIMAL(10,2);
    v_fee_amount DECIMAL(10,2);
    v_net_amount DECIMAL(10,2);
    v_surcharge_amount DECIMAL(10,2);
    v_credited_amount DECIMAL(10,2);
    v_payment_date DATE;
    v_overpayment_amount DECIMAL(10,2);
    v_overpayment_transferred BOOLEAN := false;
    v_transfer_entry_id UUID;
BEGIN
    v_base_amount := p_base_amount_cents / 100.0;
    v_total_amount := p_total_amount_cents / 100.0;
    v_fee_amount := p_fee_amount_cents / 100.0;
    v_net_amount := p_net_amount_cents / 100.0;
    v_surcharge_amount := v_total_amount - v_base_amount;
    v_payment_date := CURRENT_DATE;

    IF p_fees_passed_to_payer THEN
        v_credited_amount := v_base_amount;
    ELSE
        v_credited_amount := v_total_amount;
    END IF;

    SELECT * INTO v_payment_link FROM payment_links WHERE id = p_payment_link_id FOR UPDATE;

    IF v_payment_link IS NULL THEN
        RAISE EXCEPTION 'Payment link not found';
    END IF;

    IF v_payment_link.status != 'pending' THEN
        RAISE EXCEPTION 'Payment link is not pending. Status: %', v_payment_link.status;
    END IF;

    IF v_payment_link.expires_at < NOW() THEN
        UPDATE payment_links SET status = 'expired' WHERE id = p_payment_link_id;
        RAISE EXCEPTION 'Payment link has expired';
    END IF;

    v_unit_id := v_payment_link.unit_id;

    SELECT * INTO v_scout_account FROM scout_accounts WHERE id = p_scout_account_id FOR UPDATE;

    IF v_scout_account IS NULL THEN
        RAISE EXCEPTION 'Scout account not found';
    END IF;

    v_current_balance_cents := ROUND(ABS(v_scout_account.billing_balance) * 100);

    IF p_base_amount_cents > v_current_balance_cents THEN
        RAISE EXCEPTION 'Payment amount (%) exceeds current balance (%)', p_base_amount_cents / 100.0, v_current_balance_cents / 100.0;
    END IF;

    SELECT id INTO v_bank_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1000';
    SELECT id INTO v_receivable_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1200';
    SELECT id INTO v_fee_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '5600';
    SELECT id INTO v_funds_account_id FROM accounts WHERE unit_id = v_unit_id AND code = '1210';

    IF v_bank_account_id IS NULL OR v_receivable_account_id IS NULL THEN
        RAISE EXCEPTION 'Required accounts (1000, 1200) not found for unit';
    END IF;

    -- The fee account is required whenever a fee or surcharge line is due;
    -- silently skipping those lines would break the balance invariant
    IF v_fee_account_id IS NULL AND (v_fee_amount > 0 OR (p_fees_passed_to_payer AND v_surcharge_amount > 0)) THEN
        RAISE EXCEPTION 'Required account (5600 Payment Processing Fees) not found for unit';
    END IF;

    INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, reference, is_posted)
    VALUES (v_unit_id, v_payment_date, 'Online payment from ' || p_scout_name || ' (via payment link)', 'payment', p_square_payment_id, true)
    RETURNING id INTO v_journal_entry_id;

    IF p_fees_passed_to_payer AND v_fee_amount > 0 THEN
        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
        VALUES (v_journal_entry_id, v_bank_account_id, NULL, v_net_amount, 0, 'Online payment from ' || p_scout_name, NULL);

        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
        VALUES (v_journal_entry_id, v_receivable_account_id, p_scout_account_id, 0, v_base_amount, 'Payment received via payment link', 'billing');

        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
        VALUES (v_journal_entry_id, v_fee_account_id, NULL, v_fee_amount, 0, 'Square processing fee (paid by payer)', NULL);

        -- Surcharge collected from the payer offsets the fee expense so the
        -- entry balances: net + fee (debits) = base + surcharge (credits)
        IF v_surcharge_amount > 0 THEN
            INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
            VALUES (v_journal_entry_id, v_fee_account_id, NULL, 0, v_surcharge_amount, 'Card surcharge collected from payer', NULL);
        END IF;
    ELSE
        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
        VALUES (v_journal_entry_id, v_bank_account_id, NULL, v_net_amount, 0, 'Online payment from ' || p_scout_name, NULL);

        INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
        VALUES (v_journal_entry_id, v_receivable_account_id, p_scout_account_id, 0, v_total_amount, 'Payment received via payment link', 'billing');

        IF v_fee_amount > 0 THEN
            INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
            VALUES (v_journal_entry_id, v_fee_account_id, NULL, v_fee_amount, 0, 'Square processing fee', NULL);
        END IF;
    END IF;

    INSERT INTO payments (unit_id, scout_account_id, amount, fee_amount, net_amount, payment_method, square_payment_id, square_receipt_url, status, journal_entry_id, notes)
    VALUES (v_unit_id, p_scout_account_id, v_credited_amount, v_fee_amount, v_net_amount, 'card', p_square_payment_id, p_square_receipt_url, 'completed', v_journal_entry_id,
            CASE WHEN p_fees_passed_to_payer THEN COALESCE(p_payment_note, 'Payment') || ' (via payment link, fee paid by payer)'
                 ELSE COALESCE(p_payment_note, 'Payment') || ' (via payment link)' END)
    RETURNING id INTO v_payment_id;

    IF v_payment_link.billing_charge_id IS NOT NULL THEN
        UPDATE billing_charges SET is_paid = true WHERE id = v_payment_link.billing_charge_id;
    END IF;

    INSERT INTO square_transactions (unit_id, square_payment_id, square_order_id, amount_money, fee_money, net_money, currency, status, source_type, card_brand, last_4, receipt_url, payment_id, scout_account_id, is_reconciled, square_created_at, buyer_email_address, cardholder_name, note)
    VALUES (v_unit_id, p_square_payment_id, p_square_order_id, p_total_amount_cents, p_fee_amount_cents, p_net_amount_cents, 'USD', 'COMPLETED', 'CARD', p_card_details->>'card_brand', p_card_details->>'last_4', p_square_receipt_url, v_payment_id, p_scout_account_id, true, NOW(), p_buyer_email, p_card_details->>'cardholder_name', p_payment_note);

    SELECT billing_balance INTO v_scout_account.billing_balance FROM scout_accounts WHERE id = p_scout_account_id;
    v_remaining_balance_cents := ROUND(ABS(LEAST(v_scout_account.billing_balance, 0)) * 100);

    IF v_remaining_balance_cents <= 0 THEN
        UPDATE payment_links SET status = 'completed', payment_id = v_payment_id, completed_at = NOW() WHERE id = p_payment_link_id;
    END IF;

    IF v_scout_account.billing_balance > 0 THEN
        v_overpayment_amount := v_scout_account.billing_balance;

        IF v_funds_account_id IS NOT NULL THEN
            INSERT INTO journal_entries (unit_id, entry_date, description, entry_type, is_posted)
            VALUES (v_unit_id, v_payment_date, 'Overpayment transferred to Scout Funds', 'adjustment', true)
            RETURNING id INTO v_transfer_entry_id;

            INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
            VALUES (v_transfer_entry_id, v_receivable_account_id, p_scout_account_id, v_overpayment_amount, 0, 'Overpayment to funds', 'billing');

            INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
            VALUES (v_transfer_entry_id, v_funds_account_id, p_scout_account_id, 0, v_overpayment_amount, 'Overpayment from billing', 'funds');

            v_overpayment_transferred := true;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'journal_entry_id', v_journal_entry_id,
        'square_payment_id', p_square_payment_id,
        'amount', v_total_amount,
        'credited_amount', v_credited_amount,
        'fee_amount', v_fee_amount,
        'net_amount', v_net_amount,
        'fees_passed_to_payer', p_fees_passed_to_payer,
        'receipt_url', p_square_receipt_url,
        'remaining_balance', v_remaining_balance_cents / 100.0,
        'overpayment_transferred', v_overpayment_transferred,
        'overpayment_amount', COALESCE(v_overpayment_amount, 0)
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;
