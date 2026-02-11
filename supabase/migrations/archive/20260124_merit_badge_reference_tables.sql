
-- Merit Badge Reference Data Schema
-- Stores canonical Scoutbook requirement IDs for matching and validation

-- Table: merit_badge_versions
-- Tracks all known merit badge versions and their canonical data status
CREATE TABLE IF NOT EXISTS merit_badge_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_name TEXT NOT NULL,
  badge_slug TEXT NOT NULL,
  version_year INTEGER NOT NULL,
  is_eagle_required BOOLEAN DEFAULT FALSE,
  has_canonical_data BOOLEAN DEFAULT FALSE,
  requirement_count INTEGER DEFAULT 0,
  id_format TEXT,  -- Detected format pattern (e.g., '2026_parenthetical', 'pre2026_simple')
  canonical_source TEXT,  -- Where the canonical data came from (e.g., 'csv_export_2026-01-24')
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(badge_name, version_year)
);

-- Table: merit_badge_requirements
-- Stores the canonical requirement IDs and text for each badge version
CREATE TABLE IF NOT EXISTS merit_badge_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_version_id UUID NOT NULL REFERENCES merit_badge_versions(id) ON DELETE CASCADE,
  scoutbook_id TEXT NOT NULL,  -- The canonical Scoutbook requirement ID
  display_label TEXT,          -- What's shown in the UI (e.g., "(a)", "(1)")
  description TEXT,            -- Requirement text
  parent_id UUID REFERENCES merit_badge_requirements(id),  -- For hierarchical display
  depth INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_header BOOLEAN DEFAULT FALSE,  -- True for option/section headers

  -- Hierarchy position for ID construction
  main_req TEXT,
  option_name TEXT,
  option_letter TEXT,
  section TEXT,
  item TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(badge_version_id, scoutbook_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_merit_badge_versions_badge_name ON merit_badge_versions(badge_name);
CREATE INDEX IF NOT EXISTS idx_merit_badge_versions_year ON merit_badge_versions(version_year);
CREATE INDEX IF NOT EXISTS idx_merit_badge_versions_has_canonical ON merit_badge_versions(has_canonical_data);
CREATE INDEX IF NOT EXISTS idx_merit_badge_requirements_version ON merit_badge_requirements(badge_version_id);
CREATE INDEX IF NOT EXISTS idx_merit_badge_requirements_scoutbook_id ON merit_badge_requirements(scoutbook_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_merit_badge_versions_updated_at ON merit_badge_versions;
CREATE TRIGGER update_merit_badge_versions_updated_at
  BEFORE UPDATE ON merit_badge_versions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_merit_badge_requirements_updated_at ON merit_badge_requirements;
CREATE TRIGGER update_merit_badge_requirements_updated_at
  BEFORE UPDATE ON merit_badge_requirements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE merit_badge_versions IS 'Tracks all known merit badge versions and canonical data availability';
COMMENT ON TABLE merit_badge_requirements IS 'Stores canonical Scoutbook requirement IDs for each badge version';
COMMENT ON COLUMN merit_badge_requirements.scoutbook_id IS 'The canonical ID used by Scoutbook (e.g., "4 Option A (1)(a)")';
COMMENT ON COLUMN merit_badge_versions.id_format IS 'Detected ID format pattern for this version';
