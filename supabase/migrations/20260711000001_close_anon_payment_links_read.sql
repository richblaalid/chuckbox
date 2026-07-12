-- CHUCK-8: Close anonymous read of payment_links (token harvesting; audit P0-3)
--
-- "Anyone can view payment links by token" was FOR SELECT USING (true) with no
-- TO clause, so combined with the blanket GRANT ALL ... TO anon any holder of
-- the public anon key could dump every payment link (tokens, amounts,
-- scout_account_ids) via PostgREST. The public /pay/[token] routes resolve
-- tokens with the service-role client and never rely on this policy; the
-- authenticated leader/parent/treasurer SELECT policies remain.
DROP POLICY IF EXISTS "Anyone can view payment links by token" ON payment_links;

-- Audit outcome (CHUCK-8): nothing in the app uses anon-role table access —
-- the pay page and waitlist form both go through service-role API routes, and
-- the browser client only runs under authenticated sessions. Revoke the
-- blanket anon grants so a future policy written without a TO clause can't
-- re-expose its table to the anon key. Schema USAGE for anon is kept
-- (expected by PostgREST; harmless without table privileges).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Tables created by future migrations would re-acquire anon grants through
-- the default privileges Supabase configures for the postgres role; close
-- that recurrence path too.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
