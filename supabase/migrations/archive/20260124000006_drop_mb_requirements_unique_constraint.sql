-- ============================================
-- Drop the unique constraint on merit badge requirements
--
-- The original constraint (version_year, merit_badge_id, requirement_number, sub_requirement_letter)
-- is too restrictive for hierarchical requirement data where Option A/B patterns
-- have the same requirement number under different parent requirements.
--
-- Example: A badge may have:
--   5A -> 5A(a) -> 5A(a)(1)
--   5B -> 5B(a) -> 5B(a)(1)
-- Both "5A(a)" rows have the same requirement_number="5A(a)" but different parents.
--
-- The constraint prevented importing this valid data structure.
-- ============================================

DROP INDEX IF EXISTS idx_mb_requirements_unique;

-- The data model allows duplicates when distinguished by parent_requirement_id
-- We rely on application logic to ensure data integrity rather than DB constraint
