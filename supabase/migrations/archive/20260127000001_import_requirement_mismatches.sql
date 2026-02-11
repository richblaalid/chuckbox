-- Migration: Create import_requirement_mismatches table
-- Purpose: Log unmatched requirements during CSV imports for admin review

CREATE TABLE IF NOT EXISTS import_requirement_mismatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Import context
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  import_type TEXT NOT NULL CHECK (import_type IN ('troop_advancement', 'scout_history')),
  import_file_name TEXT,
  imported_by UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Scout context (if applicable)
  scout_id UUID REFERENCES scouts(id) ON DELETE CASCADE,
  bsa_member_id TEXT,
  scout_name TEXT,

  -- Requirement details from CSV
  advancement_type TEXT NOT NULL, -- 'rank_requirement', 'badge_requirement', 'rank', 'badge'
  badge_or_rank_name TEXT NOT NULL,
  version_year INTEGER,
  requirement_id TEXT NOT NULL, -- The ID from the CSV that didn't match

  -- Additional context
  csv_row_data JSONB, -- Full row data for debugging
  error_reason TEXT, -- Why it didn't match

  -- Resolution tracking
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_notes TEXT
);

-- Indexes for efficient queries
CREATE INDEX idx_import_mismatches_unit_id ON import_requirement_mismatches(unit_id);
CREATE INDEX idx_import_mismatches_created_at ON import_requirement_mismatches(created_at DESC);
CREATE INDEX idx_import_mismatches_unresolved ON import_requirement_mismatches(unit_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_import_mismatches_badge_version ON import_requirement_mismatches(badge_or_rank_name, version_year);

-- RLS policies
ALTER TABLE import_requirement_mismatches ENABLE ROW LEVEL SECURITY;

-- Admins and treasurers can view/manage import mismatches for their unit
CREATE POLICY "Unit admins can view import mismatches"
  ON import_requirement_mismatches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = import_requirement_mismatches.unit_id
        AND um.profile_id = get_current_profile_id()
        AND um.role IN ('admin', 'treasurer')
        AND um.status = 'active'
    )
  );

CREATE POLICY "Unit admins can insert import mismatches"
  ON import_requirement_mismatches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = import_requirement_mismatches.unit_id
        AND um.profile_id = get_current_profile_id()
        AND um.role IN ('admin', 'treasurer')
        AND um.status = 'active'
    )
  );

CREATE POLICY "Unit admins can update import mismatches"
  ON import_requirement_mismatches
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = import_requirement_mismatches.unit_id
        AND um.profile_id = get_current_profile_id()
        AND um.role IN ('admin', 'treasurer')
        AND um.status = 'active'
    )
  );

-- Grant permissions to service role for server-side imports
GRANT ALL ON import_requirement_mismatches TO service_role;

-- Comment for documentation
COMMENT ON TABLE import_requirement_mismatches IS 'Logs requirement IDs from CSV imports that could not be matched to database records. Allows admins to review and potentially fix data issues.';
COMMENT ON COLUMN import_requirement_mismatches.requirement_id IS 'The requirement ID from the CSV that did not match any database record';
COMMENT ON COLUMN import_requirement_mismatches.error_reason IS 'Explanation of why the match failed (e.g., "No matching requirement found for version", "Badge version is estimated")';
