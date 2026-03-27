-- ============================================
-- Reconcile billing_charges.is_paid when billing_balance changes
--
-- When a scout's billing_balance reaches >= 0 (no longer owes money),
-- mark all unpaid billing_charges as paid.
-- When balance improves but is still negative, mark oldest charges
-- as paid up to the covered amount.
--
-- This catches all payment paths: Square, scout funds, cash/check,
-- balance imports, etc.
-- ============================================

CREATE OR REPLACE FUNCTION reconcile_billing_charges()
RETURNS TRIGGER AS $$
DECLARE
    v_total_unpaid DECIMAL(10,2);
    v_remaining_debt DECIMAL(10,2);
    v_amount_covered DECIMAL(10,2);
    v_running_total DECIMAL(10,2) := 0;
    v_charge RECORD;
BEGIN
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
        -- Total of all unpaid, non-voided charges for this account
        SELECT COALESCE(SUM(amount), 0) INTO v_total_unpaid
        FROM billing_charges
        WHERE scout_account_id = NEW.id
        AND (is_paid = false OR is_paid IS NULL)
        AND (is_void = false OR is_void IS NULL);

        -- Remaining debt (billing_balance is negative when owing)
        v_remaining_debt := ABS(NEW.billing_balance);

        -- Amount of charges now covered = total unpaid minus what's still owed
        v_amount_covered := v_total_unpaid - v_remaining_debt;

        IF v_amount_covered > 0 THEN
            -- Mark charges as paid, oldest first, up to amount covered
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

-- Fire after the balance update completes
DO $$ BEGIN
    CREATE TRIGGER trigger_reconcile_billing_charges
        AFTER UPDATE OF billing_balance ON scout_accounts
        FOR EACH ROW
        EXECUTE FUNCTION reconcile_billing_charges();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
