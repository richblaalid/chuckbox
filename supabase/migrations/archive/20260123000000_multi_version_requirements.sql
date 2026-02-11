-- ============================================
-- MULTI-VERSION MERIT BADGE REQUIREMENTS
-- Phase 0: Foundation Schema Updates
-- ============================================

-- ============================================
-- 0.1.1: Add requirement_version_year to scout_merit_badge_progress
-- Track which version of requirements each scout is working on
-- ============================================

ALTER TABLE scout_merit_badge_progress
ADD COLUMN IF NOT EXISTS requirement_version_year INTEGER;

COMMENT ON COLUMN scout_merit_badge_progress.requirement_version_year IS
  'Year of requirements the scout is working on (e.g., 2025, 2026). NULL means use badge default.';

-- Backfill from badge's current version
UPDATE scout_merit_badge_progress smbp
SET requirement_version_year = mb.requirement_version_year
FROM bsa_merit_badges mb
WHERE smbp.merit_badge_id = mb.id
AND smbp.requirement_version_year IS NULL;

-- ============================================
-- 0.1.2: Add scoutbook_requirement_number to requirements
-- Store canonical Scoutbook format (e.g., "6A(a)(1)")
-- ============================================

ALTER TABLE bsa_merit_badge_requirements
ADD COLUMN IF NOT EXISTS scoutbook_requirement_number TEXT;

COMMENT ON COLUMN bsa_merit_badge_requirements.scoutbook_requirement_number IS
  'Scoutbook canonical format (e.g., "6A(a)(1)"). Used for import matching and sync.';

-- Index for efficient import lookups by Scoutbook format
CREATE INDEX IF NOT EXISTS idx_mb_req_scoutbook_num
ON bsa_merit_badge_requirements(merit_badge_id, version_year, scoutbook_requirement_number)
WHERE scoutbook_requirement_number IS NOT NULL;

-- ============================================
-- 0.1.3: Create bsa_merit_badge_versions tracking table
-- Track available versions per badge with metadata
-- ============================================

CREATE TABLE IF NOT EXISTS bsa_merit_badge_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merit_badge_id UUID NOT NULL REFERENCES bsa_merit_badges(id) ON DELETE CASCADE,
  version_year INTEGER NOT NULL,
  effective_date DATE,
  scraped_at TIMESTAMPTZ,
  source TEXT CHECK (source IN ('scoutbook', 'usscouts', 'manual', 'pdf')),
  is_current BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(merit_badge_id, version_year)
);

-- Index for finding current version of a badge
CREATE INDEX idx_mb_versions_current
ON bsa_merit_badge_versions(merit_badge_id)
WHERE is_current = true;

-- Index for listing versions of a badge
CREATE INDEX idx_mb_versions_badge
ON bsa_merit_badge_versions(merit_badge_id, version_year DESC);

-- Comments
COMMENT ON TABLE bsa_merit_badge_versions IS
  'Tracks available requirement versions per merit badge with metadata about source and currency.';
COMMENT ON COLUMN bsa_merit_badge_versions.effective_date IS
  'Date this version became effective (typically January 1 of the version year).';
COMMENT ON COLUMN bsa_merit_badge_versions.scraped_at IS
  'When requirements were scraped from source (NULL if manually entered).';
COMMENT ON COLUMN bsa_merit_badge_versions.source IS
  'Where requirements came from: scoutbook, usscouts (archives), manual entry, or pdf.';
COMMENT ON COLUMN bsa_merit_badge_versions.is_current IS
  'Whether this is the currently active version for new scouts starting the badge.';

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE bsa_merit_badge_versions ENABLE ROW LEVEL SECURITY;

-- BSA reference data is read-only for authenticated users
CREATE POLICY "BSA merit badge versions viewable by authenticated users"
    ON bsa_merit_badge_versions FOR SELECT
    TO authenticated
    USING (true);

-- ============================================
-- TRIGGERS
-- ============================================

CREATE TRIGGER update_bsa_merit_badge_versions_updated_at
    BEFORE UPDATE ON bsa_merit_badge_versions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Ensure only one current version per badge
-- ============================================

CREATE OR REPLACE FUNCTION ensure_single_current_version()
RETURNS TRIGGER AS $$
BEGIN
  -- If setting this version as current, unset all others for this badge
  IF NEW.is_current = true THEN
    UPDATE bsa_merit_badge_versions
    SET is_current = false
    WHERE merit_badge_id = NEW.merit_badge_id
    AND id != NEW.id
    AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_current_mb_version
    BEFORE INSERT OR UPDATE OF is_current ON bsa_merit_badge_versions
    FOR EACH ROW
    WHEN (NEW.is_current = true)
    EXECUTE FUNCTION ensure_single_current_version();
