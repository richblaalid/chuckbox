-- ============================================
-- ADD is_header COLUMN TO bsa_rank_requirements
--
-- Header requirements (like Scout req 2 and 6, Star req 6) should not
-- be completable - they only organize child requirements.
-- ============================================

-- Add is_header column (default false for existing data)
ALTER TABLE bsa_rank_requirements
ADD COLUMN IF NOT EXISTS is_header BOOLEAN DEFAULT false;

-- Update the start_rank_progress function to exclude headers
CREATE OR REPLACE FUNCTION start_rank_progress(
    p_scout_id UUID,
    p_rank_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_progress_id UUID;
    v_version_year INTEGER;
BEGIN
    -- Get the version year from the rank
    SELECT requirement_version_year INTO v_version_year
    FROM bsa_ranks WHERE id = p_rank_id;

    -- Create rank progress record
    INSERT INTO scout_rank_progress (scout_id, rank_id, status, started_at)
    VALUES (p_scout_id, p_rank_id, 'in_progress', NOW())
    ON CONFLICT (scout_id, rank_id) DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_progress_id;

    -- Create requirement progress records for all completable requirements
    -- (excluding headers which only organize child requirements)
    INSERT INTO scout_rank_requirement_progress (scout_rank_progress_id, requirement_id)
    SELECT v_progress_id, brr.id
    FROM bsa_rank_requirements brr
    WHERE brr.version_year = v_version_year
    AND brr.rank_id = p_rank_id
    AND (brr.is_header = false OR brr.is_header IS NULL)  -- Exclude headers
    ON CONFLICT (scout_rank_progress_id, requirement_id) DO NOTHING;

    RETURN v_progress_id;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON COLUMN bsa_rank_requirements.is_header IS
  'True if this requirement is a header that organizes child requirements and should not be completable';
