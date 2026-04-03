-- Add columns for unified payments page
ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES profiles(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reconciliation_status VARCHAR(50);

-- Add comment for allowed values
COMMENT ON COLUMN payments.reconciliation_status IS 'Values: reconciled, not_scout_related, NULL (not applicable or not yet reconciled)';

-- Backfill recorded_by from the journal entry creator or unit admin as fallback
UPDATE payments p
SET recorded_by = COALESCE(
  -- Try to get the profile who created the associated journal entry
  (SELECT je.created_by FROM journal_entries je WHERE je.id = p.journal_entry_id),
  -- Fallback: unit admin
  (SELECT um.profile_id FROM unit_memberships um
   WHERE um.unit_id = p.unit_id AND um.role = 'admin' AND um.status = 'active'
   LIMIT 1)
)
WHERE p.recorded_by IS NULL;

-- Index for filtering by reconciliation status
CREATE INDEX IF NOT EXISTS idx_payments_reconciliation_status ON payments(reconciliation_status) WHERE reconciliation_status IS NOT NULL;
