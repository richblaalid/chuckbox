-- ============================================
-- FIX: Grant service_role full access to BSA and advancement tables
--
-- The service_role needs explicit GRANT permissions for INSERT/UPDATE/DELETE
-- on these tables to seed reference data. RLS bypass only skips row policies,
-- not database-level permissions.
-- ============================================

-- Grant full access to BSA reference tables for service_role
GRANT ALL ON TABLE bsa_ranks TO service_role;
GRANT ALL ON TABLE bsa_rank_requirements TO service_role;
GRANT ALL ON TABLE bsa_merit_badges TO service_role;
GRANT ALL ON TABLE bsa_merit_badge_requirements TO service_role;
GRANT ALL ON TABLE bsa_leadership_positions TO service_role;

-- Also grant to postgres for admin access
GRANT ALL ON TABLE bsa_ranks TO postgres;
GRANT ALL ON TABLE bsa_rank_requirements TO postgres;
GRANT ALL ON TABLE bsa_merit_badges TO postgres;
GRANT ALL ON TABLE bsa_merit_badge_requirements TO postgres;
GRANT ALL ON TABLE bsa_leadership_positions TO postgres;

-- Grant full access to scout progress tables for service_role
GRANT ALL ON TABLE scout_rank_progress TO service_role;
GRANT ALL ON TABLE scout_rank_requirement_progress TO service_role;
GRANT ALL ON TABLE scout_merit_badge_progress TO service_role;
GRANT ALL ON TABLE scout_merit_badge_requirement_progress TO service_role;
GRANT ALL ON TABLE scout_leadership_history TO service_role;
GRANT ALL ON TABLE scout_activity_entries TO service_role;
GRANT ALL ON TABLE merit_badge_counselors TO service_role;

-- Grant to postgres as well
GRANT ALL ON TABLE scout_rank_progress TO postgres;
GRANT ALL ON TABLE scout_rank_requirement_progress TO postgres;
GRANT ALL ON TABLE scout_merit_badge_progress TO postgres;
GRANT ALL ON TABLE scout_merit_badge_requirement_progress TO postgres;
GRANT ALL ON TABLE scout_leadership_history TO postgres;
GRANT ALL ON TABLE scout_activity_entries TO postgres;
GRANT ALL ON TABLE merit_badge_counselors TO postgres;

-- Grant access to version tables if they exist
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'bsa_merit_badge_versions') THEN
        GRANT ALL ON TABLE bsa_merit_badge_versions TO service_role;
        GRANT ALL ON TABLE bsa_merit_badge_versions TO postgres;
    END IF;
END $$;
