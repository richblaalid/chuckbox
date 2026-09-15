-- CHUCK-9 (PLATFORM-025): one-time repair of unbalanced journal entries, then
-- DB-level enforcement of the balance invariant (Σdebit = Σcredit per entry).
--
-- DR-2026-07-09-custom-double-entry-ledger-v1, obligation 1. The repair and the
-- constraint ship in one migration (one transaction): the constraint must land
-- on a clean ledger or it blocks legitimate writes and voids of historical
-- entries. A fail-loud guard between the repair passes and the trigger aborts
-- the whole migration if any entry remains unbalanced.
--
-- Known unbalanced classes at authoring time (dev diagnostic, 2026-07-12):
--   1. Balance imports and their reversals — single-sided lines, no contra
--      (57 + 1 entries). Repaired against 3000 Opening Balance Equity.
--   2. Reconciled card payments — missing the fee-expense debit (5 entries,
--      gap = payment fee). Repaired with a 5600 debit.
--   3. Fees-passed payment-link payments — missing the surcharge credit
--      (1 entry, gap = surcharge). Repaired with a 5600 credit.
-- Writers were fixed in PLATFORM-021/022/023 before this migration.

-- ============================================================
-- Pass 1: balance imports → Opening Balance Equity contra
-- ============================================================
WITH gaps AS (
    SELECT je.id AS entry_id, je.unit_id, SUM(jl.debit) - SUM(jl.credit) AS gap
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.entry_type IN ('beginning_balance', 'balance_import_reversal')
       OR je.balance_import_batch_id IS NOT NULL
    GROUP BY je.id, je.unit_id
    HAVING SUM(jl.debit) <> SUM(jl.credit)
)
INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
SELECT g.entry_id,
       a.id,
       NULL,
       CASE WHEN g.gap < 0 THEN -g.gap ELSE 0 END,
       CASE WHEN g.gap > 0 THEN g.gap ELSE 0 END,
       'Opening balance contra (CHUCK-9 repair)',
       NULL
FROM gaps g
JOIN accounts a ON a.unit_id = g.unit_id AND a.code = '3000';

-- ============================================================
-- Pass 2: reconciled card payments → missing fee-expense debit
-- ============================================================
WITH gaps AS (
    SELECT je.id AS entry_id, je.unit_id, SUM(jl.debit) - SUM(jl.credit) AS gap
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    JOIN payments p ON p.journal_entry_id = je.id
    WHERE p.reconciliation_status IN ('reconciled', 'not_scout_related')
      AND p.fee_amount > 0
    GROUP BY je.id, je.unit_id, p.fee_amount
    HAVING SUM(jl.debit) - SUM(jl.credit) = -p.fee_amount
)
INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
SELECT g.entry_id, a.id, NULL, -g.gap, 0, 'Square processing fee (CHUCK-9 repair)', NULL
FROM gaps g
JOIN accounts a ON a.unit_id = g.unit_id AND a.code = '5600';

-- ============================================================
-- Pass 3: fees-passed payment links → missing surcharge credit
-- ============================================================
WITH gaps AS (
    SELECT je.id AS entry_id, je.unit_id, SUM(jl.debit) - SUM(jl.credit) AS gap
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    JOIN payments p ON p.journal_entry_id = je.id
    WHERE p.notes LIKE '%fee paid by payer%'
    GROUP BY je.id, je.unit_id
    HAVING SUM(jl.debit) - SUM(jl.credit) > 0
)
INSERT INTO journal_lines (journal_entry_id, account_id, scout_account_id, debit, credit, memo, target_balance)
SELECT g.entry_id, a.id, NULL, 0, g.gap, 'Card surcharge collected from payer (CHUCK-9 repair)', NULL
FROM gaps g
JOIN accounts a ON a.unit_id = g.unit_id AND a.code = '5600';

-- ============================================================
-- Guard: abort if anything remains unbalanced
-- ============================================================
DO $$
DECLARE
    v_count INTEGER;
    v_examples TEXT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM (
        SELECT jl.journal_entry_id
        FROM journal_lines jl
        GROUP BY jl.journal_entry_id
        HAVING SUM(jl.debit) <> SUM(jl.credit)
    ) unbalanced;

    IF v_count > 0 THEN
        SELECT string_agg(journal_entry_id::text, ', ') INTO v_examples
        FROM (
            SELECT jl.journal_entry_id
            FROM journal_lines jl
            GROUP BY jl.journal_entry_id
            HAVING SUM(jl.debit) <> SUM(jl.credit)
            LIMIT 10
        ) examples;
        RAISE EXCEPTION 'CHUCK-9 repair incomplete: % journal entries remain unbalanced (first ids: %). Migration rolled back.', v_count, v_examples;
    END IF;
END $$;

-- ============================================================
-- Constraint: deferred trigger enforcing Σdebit = Σcredit
-- ============================================================
-- Fires on journal_lines (not journal_entries) so writers that create the
-- entry header and its lines in separate transactions keep working: an
-- entry-only transaction touches no lines, and every transaction that does
-- touch lines must leave its entries balanced at COMMIT.
CREATE OR REPLACE FUNCTION enforce_journal_entry_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT validate_journal_entry_balance(COALESCE(NEW.journal_entry_id, OLD.journal_entry_id)) THEN
        RAISE EXCEPTION 'Journal entry % is unbalanced: sum of debits must equal sum of credits', COALESCE(NEW.journal_entry_id, OLD.journal_entry_id)
            USING ERRCODE = 'check_violation';
    END IF;

    -- An UPDATE that moves a line between entries must leave both balanced
    IF TG_OP = 'UPDATE' AND OLD.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id THEN
        IF NOT validate_journal_entry_balance(OLD.journal_entry_id) THEN
            RAISE EXCEPTION 'Journal entry % is unbalanced: sum of debits must equal sum of credits', OLD.journal_entry_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
-- SECURITY DEFINER: the balance check must sum ALL lines of the entry, not
-- just the subset visible to the writing role under RLS
SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS journal_entry_balance_check ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_entry_balance_check
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_journal_entry_balance();
