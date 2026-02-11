-- ============================================
-- Balance Import Schema
-- ============================================
-- Supports CSV import of scout account balances with undo functionality.
-- Creates tracking table for import batches and extends journal_entries
-- to link entries back to their import batch.

-- Add new journal entry types for balance imports
ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'beginning_balance';
ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'balance_import_reversal';

-- Create balance_import_batches table to track import operations
CREATE TABLE balance_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    imported_by UUID NOT NULL REFERENCES profiles(id),
    mode TEXT NOT NULL CHECK (mode IN ('set', 'adjust')),
    row_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'undone')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    undone_at TIMESTAMPTZ,
    undone_by UUID REFERENCES profiles(id)
);

-- Add balance_import_batch_id column to journal_entries for batch tracking
ALTER TABLE journal_entries
ADD COLUMN balance_import_batch_id UUID REFERENCES balance_import_batches(id);

-- Index for efficient batch lookup on journal entries
CREATE INDEX idx_journal_entries_balance_import_batch
ON journal_entries(balance_import_batch_id)
WHERE balance_import_batch_id IS NOT NULL;

-- Index for querying batches by unit
CREATE INDEX idx_balance_import_batches_unit ON balance_import_batches(unit_id);

-- Enable RLS
ALTER TABLE balance_import_batches ENABLE ROW LEVEL SECURITY;

-- RLS Policies for balance_import_batches

-- Leaders can view their unit's import batches
CREATE POLICY "Leaders can view unit import batches"
  ON balance_import_batches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = balance_import_batches.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer', 'leader')
    )
  );

-- Admin and treasurer can insert import batches
CREATE POLICY "Treasurers can create import batches"
  ON balance_import_batches FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = balance_import_batches.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer')
    )
  );

-- Admin and treasurer can update import batches (for undo operations)
CREATE POLICY "Treasurers can update import batches"
  ON balance_import_batches FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = balance_import_batches.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = balance_import_batches.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer')
    )
  );

-- Service role grant for any background operations
GRANT ALL ON balance_import_batches TO service_role;

COMMENT ON TABLE balance_import_batches IS 'Tracks balance import operations for undo functionality';
COMMENT ON COLUMN balance_import_batches.mode IS 'Import mode: set (replace balance) or adjust (add to balance)';
COMMENT ON COLUMN balance_import_batches.row_count IS 'Number of scouts affected by this import';
COMMENT ON COLUMN balance_import_batches.status IS 'active = in effect, undone = reversed';
COMMENT ON COLUMN journal_entries.balance_import_batch_id IS 'Links journal entry to its import batch for undo operations';
