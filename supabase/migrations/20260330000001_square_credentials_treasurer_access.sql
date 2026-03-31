-- Allow treasurers to view Square credentials (not just admins)
-- This fixes the bug where treasurers couldn't see the payments tab
-- because RLS blocked their SELECT on unit_square_credentials

DROP POLICY IF EXISTS "Admins can view Square credentials" ON unit_square_credentials;

CREATE POLICY "Admins and treasurers can view Square credentials"
    ON unit_square_credentials FOR SELECT
    USING (user_has_role(unit_id, ARRAY['admin', 'treasurer']::membership_role[]));
