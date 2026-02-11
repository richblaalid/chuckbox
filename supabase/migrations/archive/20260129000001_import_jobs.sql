-- ============================================
-- Import Jobs Table
-- ============================================
-- Tracks background import jobs to prevent timeouts
-- and provide progress feedback for large imports

CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  type TEXT NOT NULL, -- 'troop_advancement', 'scout_history'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'

  -- Progress tracking
  total_scouts INTEGER DEFAULT 0,
  processed_scouts INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  current_phase TEXT, -- 'ranks', 'rank_requirements', 'badges', 'badge_requirements'

  -- Results (populated on completion)
  result JSONB,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Store staged data for processing (can be large)
  staged_data JSONB NOT NULL,
  selected_scout_ids JSONB NOT NULL DEFAULT '[]'
);

-- Index for querying active jobs
CREATE INDEX idx_import_jobs_unit_status ON import_jobs(unit_id, status);
CREATE INDEX idx_import_jobs_created_by ON import_jobs(created_by);

-- RLS
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

-- Leaders can view and create jobs for their unit
CREATE POLICY "Leaders can view unit import jobs"
  ON import_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = import_jobs.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer', 'leader')
    )
  );

CREATE POLICY "Leaders can create import jobs"
  ON import_jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM unit_memberships um
      WHERE um.unit_id = import_jobs.unit_id
      AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND um.status = 'active'
      AND um.role IN ('admin', 'treasurer', 'leader')
    )
  );

-- Service role can update jobs (for background processing)
GRANT ALL ON import_jobs TO service_role;

COMMENT ON TABLE import_jobs IS 'Tracks background import jobs for large data imports';
COMMENT ON COLUMN import_jobs.staged_data IS 'Staged import data (StagedTroopAdvancement JSON)';
COMMENT ON COLUMN import_jobs.result IS 'Import result (TroopAdvancementImportResult JSON)';
