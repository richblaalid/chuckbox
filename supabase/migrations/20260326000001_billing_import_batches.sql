-- ============================================
-- Billing Import Batches
--
-- Tracks CSV imports of billing charges for undo
-- capability and batch notification support.
-- ============================================

CREATE TABLE IF NOT EXISTS billing_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES profiles(id),
    filename TEXT,
    total_records INTEGER NOT NULL DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    notifications_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_import_batches_unit ON billing_import_batches(unit_id);

ALTER TABLE billing_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and treasurers can view billing import batches"
ON billing_import_batches FOR SELECT
USING (EXISTS (
    SELECT 1 FROM unit_memberships
    WHERE unit_memberships.unit_id = billing_import_batches.unit_id
    AND unit_memberships.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND unit_memberships.role IN ('admin', 'treasurer')
    AND unit_memberships.status = 'active'
));

CREATE POLICY "Admins and treasurers can create billing import batches"
ON billing_import_batches FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM unit_memberships
    WHERE unit_memberships.unit_id = billing_import_batches.unit_id
    AND unit_memberships.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND unit_memberships.role IN ('admin', 'treasurer')
    AND unit_memberships.status = 'active'
));

CREATE POLICY "Admins and treasurers can update billing import batches"
ON billing_import_batches FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM unit_memberships
    WHERE unit_memberships.unit_id = billing_import_batches.unit_id
    AND unit_memberships.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND unit_memberships.role IN ('admin', 'treasurer')
    AND unit_memberships.status = 'active'
));

-- Add batch reference to billing_records for grouping imported charges
ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS billing_import_batch_id UUID REFERENCES billing_import_batches(id);

CREATE INDEX IF NOT EXISTS idx_billing_records_import_batch ON billing_records(billing_import_batch_id) WHERE billing_import_batch_id IS NOT NULL;
