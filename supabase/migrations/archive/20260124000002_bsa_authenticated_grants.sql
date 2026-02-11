-- ============================================
-- FIX: Grant authenticated role SELECT access to BSA reference tables
--
-- RLS policies define row-level access, but roles also need base table
-- privileges to query tables at all. This grants SELECT to authenticated
-- users on read-only BSA reference tables.
-- ============================================

-- Grant SELECT on BSA reference tables to authenticated users
GRANT SELECT ON TABLE bsa_ranks TO authenticated;
GRANT SELECT ON TABLE bsa_rank_requirements TO authenticated;
GRANT SELECT ON TABLE bsa_merit_badges TO authenticated;
GRANT SELECT ON TABLE bsa_merit_badge_requirements TO authenticated;
GRANT SELECT ON TABLE bsa_leadership_positions TO authenticated;

-- Grant SELECT on version tables if they exist
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'bsa_merit_badge_versions') THEN
        GRANT SELECT ON TABLE bsa_merit_badge_versions TO authenticated;
    END IF;
END $$;

-- Also grant to anon for public read access (if needed)
GRANT SELECT ON TABLE bsa_ranks TO anon;
GRANT SELECT ON TABLE bsa_rank_requirements TO anon;
GRANT SELECT ON TABLE bsa_merit_badges TO anon;
GRANT SELECT ON TABLE bsa_merit_badge_requirements TO anon;
GRANT SELECT ON TABLE bsa_leadership_positions TO anon;
