-- ============================================
-- FIX: Grant service_role full access to scout progress tables
--
-- The service_role needs explicit GRANT permissions for INSERT/UPDATE/DELETE
-- on these tables to seed advancement data.
-- ============================================

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

-- Also grant to sync staging if it exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sync_staged_advancement') THEN
        GRANT ALL ON TABLE sync_staged_advancement TO service_role;
        GRANT ALL ON TABLE sync_staged_advancement TO postgres;
    END IF;
END $$;
