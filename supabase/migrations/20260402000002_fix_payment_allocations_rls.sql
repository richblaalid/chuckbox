-- Fix payment_allocations RLS policies: use get_current_profile_id() instead of auth.uid()
-- auth.uid() returns the auth user ID, but unit_memberships.profile_id is the profile ID.

DROP POLICY IF EXISTS "Users can view payment allocations for their unit" ON payment_allocations;
DROP POLICY IF EXISTS "Financial roles can insert payment allocations" ON payment_allocations;

CREATE POLICY "Users can view payment allocations for their unit"
  ON payment_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payments p
      JOIN unit_memberships um ON um.unit_id = p.unit_id
      WHERE p.id = payment_allocations.payment_id
        AND um.profile_id = get_current_profile_id()
        AND um.status = 'active'
    )
  );

CREATE POLICY "Financial roles can insert payment allocations"
  ON payment_allocations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payments p
      JOIN unit_memberships um ON um.unit_id = p.unit_id
      WHERE p.id = payment_allocations.payment_id
        AND um.profile_id = get_current_profile_id()
        AND um.status = 'active'
        AND um.role IN ('admin', 'treasurer')
    )
  );
