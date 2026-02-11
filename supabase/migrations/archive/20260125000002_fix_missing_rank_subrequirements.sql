-- Fix missing rank sub-requirements
-- The seeder created header rows without the sub-requirements

-- First, get the rank IDs
DO $$
DECLARE
  scout_rank_id UUID;
  tenderfoot_rank_id UUID;
BEGIN
  SELECT id INTO scout_rank_id FROM bsa_ranks WHERE code = 'scout';
  SELECT id INTO tenderfoot_rank_id FROM bsa_ranks WHERE code = 'tenderfoot';

  -- Delete duplicate Scout requirement 2 entries (keep none, we'll add proper ones)
  DELETE FROM bsa_rank_requirements
  WHERE rank_id = scout_rank_id
  AND requirement_number = '2';

  -- Delete Scout requirement 6 (we'll add proper sub-requirements)
  DELETE FROM bsa_rank_requirements
  WHERE rank_id = scout_rank_id
  AND requirement_number = '6';

  -- Add Scout 2a, 2b, 2c, 2d
  INSERT INTO bsa_rank_requirements (rank_id, requirement_number, description, version_year, display_order)
  VALUES
    (scout_rank_id, '2a', 'Describe how the Scouts in the troop provide its leadership.', 2022, 8),
    (scout_rank_id, '2b', 'Describe the four steps of Scout advancement.', 2022, 9),
    (scout_rank_id, '2c', 'Describe what the troop expects of you and what you can expect from the troop.', 2022, 10),
    (scout_rank_id, '2d', 'Explain the patrol method.', 2022, 11)
  ON CONFLICT DO NOTHING;

  -- Add Scout 6a, 6b
  INSERT INTO bsa_rank_requirements (rank_id, requirement_number, description, version_year, display_order)
  VALUES
    (scout_rank_id, '6a', 'Earn the Cyber Chip award for your grade.', 2022, 17),
    (scout_rank_id, '6b', 'Complete the exercises in the pamphlet How to Protect Your Children From Child Abuse: A Parent''s Guide.', 2022, 18)
  ON CONFLICT DO NOTHING;

  -- Add Tenderfoot 5d (if missing)
  INSERT INTO bsa_rank_requirements (rank_id, requirement_number, description, version_year, display_order)
  VALUES (tenderfoot_rank_id, '5d', 'Explain the importance of the "order of rescue" - reach, throw, row, and go - and demonstrate reaching and throwing rescues.', 2022, 19)
  ON CONFLICT DO NOTHING;

END $$;
