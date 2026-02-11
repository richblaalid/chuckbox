-- ============================================
-- FIX: Update unique constraint for merit badge requirements
--
-- The original constraint was (version_year, merit_badge_id, requirement_number, sub_requirement_letter)
-- This fails for badges with Option A/B/C patterns where the same requirement number
-- appears multiple times under the same parent (e.g., Animal Science has 6 different "6(1)"
-- requirements for different animal options).
--
-- New constraint uses display_order as the unique discriminator since each requirement
-- has a unique position in the badge.
-- ============================================

-- Drop the old unique index
DROP INDEX IF EXISTS idx_mb_requirements_unique;

-- Create new unique index using display_order as discriminator
-- This allows duplicate requirement_numbers as long as they have different display positions
CREATE UNIQUE INDEX idx_mb_requirements_unique
ON bsa_merit_badge_requirements(
  version_year,
  merit_badge_id,
  display_order
);

-- Add comment explaining the constraint
COMMENT ON INDEX idx_mb_requirements_unique IS
  'Unique constraint per version/badge/display_order - allows duplicate requirement numbers for Option A/B/C patterns';
