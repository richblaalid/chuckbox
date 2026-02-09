-- Migration: 20260207000001_plaid_connections.sql
-- Purpose: Store Plaid bank connections for units

-- Store Plaid connections (access tokens encrypted in application layer)
CREATE TABLE plaid_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,

  -- Plaid identifiers
  item_id TEXT NOT NULL,
  access_token TEXT NOT NULL, -- Encrypted in application layer before storage

  -- Connection metadata
  institution_id TEXT,
  institution_name TEXT,

  -- Account info (cached from Plaid)
  accounts JSONB DEFAULT '[]'::jsonb, -- Array of {account_id, name, mask, type, subtype, balance}

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'disconnected')),
  error_code TEXT,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,

  -- Constraints
  UNIQUE(unit_id) -- One connection per unit initially
);

-- Enable Row Level Security
ALTER TABLE plaid_connections ENABLE ROW LEVEL SECURITY;

-- Policy: Admins and treasurers can view their unit's plaid connection
CREATE POLICY "Admins and treasurers can view plaid connection"
  ON plaid_connections FOR SELECT TO authenticated
  USING (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = get_current_profile_id() AND role IN ('admin', 'treasurer')
  ));

-- Policy: Admins and treasurers can insert plaid connection
CREATE POLICY "Admins and treasurers can insert plaid connection"
  ON plaid_connections FOR INSERT TO authenticated
  WITH CHECK (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = get_current_profile_id() AND role IN ('admin', 'treasurer')
  ));

-- Policy: Admins and treasurers can update plaid connection
CREATE POLICY "Admins and treasurers can update plaid connection"
  ON plaid_connections FOR UPDATE TO authenticated
  USING (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = get_current_profile_id() AND role IN ('admin', 'treasurer')
  ));

-- Policy: Admins and treasurers can delete plaid connection
CREATE POLICY "Admins and treasurers can delete plaid connection"
  ON plaid_connections FOR DELETE TO authenticated
  USING (unit_id IN (
    SELECT unit_id FROM unit_memberships
    WHERE profile_id = get_current_profile_id() AND role IN ('admin', 'treasurer')
  ));

-- Index for lookups
CREATE INDEX idx_plaid_connections_unit ON plaid_connections(unit_id);

-- Trigger to update updated_at on changes
CREATE TRIGGER update_plaid_connections_updated_at
  BEFORE UPDATE ON plaid_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comment for documentation
COMMENT ON TABLE plaid_connections IS 'Stores Plaid bank connections for units. Access tokens are encrypted at the application layer.';
COMMENT ON COLUMN plaid_connections.access_token IS 'Plaid access token - encrypted before storage, never exposed to client';
COMMENT ON COLUMN plaid_connections.accounts IS 'Cached account info from Plaid: [{account_id, name, mask, type, subtype, balance}]';
