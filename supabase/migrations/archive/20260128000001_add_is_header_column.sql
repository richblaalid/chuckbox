-- ============================================
-- Add is_header column to bsa_merit_badge_requirements
-- ============================================
--
-- Parent requirements that have children are typically description-only
-- headers like "Do the following:" - they don't have checkboxes in Scoutbook
-- and shouldn't be tracked as approvable requirements.
--
-- This column allows us to mark these requirements so the UI can:
-- 1. Skip them in progress tracking
-- 2. Display them differently (as section headers)
-- 3. Not show checkboxes for sign-off

ALTER TABLE bsa_merit_badge_requirements
ADD COLUMN IF NOT EXISTS is_header BOOLEAN DEFAULT false;

COMMENT ON COLUMN bsa_merit_badge_requirements.is_header IS
  'True if this requirement is a header/description only (has children but no checkbox in Scoutbook). These should not be tracked as approvable requirements.';

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_bsa_mb_req_is_header
ON bsa_merit_badge_requirements(is_header)
WHERE is_header = true;
