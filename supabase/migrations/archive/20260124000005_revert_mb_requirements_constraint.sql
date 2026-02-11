-- ============================================
-- REVERT: Restore original unique constraint for merit badge requirements
--
-- Migration 20260124000003 changed the constraint to include parent_requirement_id,
-- but this broke imports because level 1+ requirements need to be inserted before
-- their parent_requirement_id can be set (chicken-and-egg problem).
--
-- The original constraint works correctly because the import script processes
-- levels in order and the constraint doesn't depend on parent_requirement_id.
-- ============================================

-- Drop the broken unique index
DROP INDEX IF EXISTS idx_mb_requirements_unique;

-- Restore the original unique index
CREATE UNIQUE INDEX idx_mb_requirements_unique
ON bsa_merit_badge_requirements(
  version_year,
  merit_badge_id,
  requirement_number,
  COALESCE(sub_requirement_letter, '')
);

-- Add comment
COMMENT ON INDEX idx_mb_requirements_unique IS
  'Unique constraint per version/badge/requirement_number/sub_letter';
