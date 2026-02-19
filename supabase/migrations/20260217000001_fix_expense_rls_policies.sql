-- Fix expense_reimbursements RLS policies
-- auth.uid() returns auth.users.id, but submitter_id and profile_id reference profiles.id
-- Need to resolve profile_id from auth.uid() via subquery

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view own expenses" ON expense_reimbursements;
DROP POLICY IF EXISTS "Admins can view unit expenses" ON expense_reimbursements;
DROP POLICY IF EXISTS "Leaders can view unit expenses" ON expense_reimbursements;
DROP POLICY IF EXISTS "Users can create expenses" ON expense_reimbursements;
DROP POLICY IF EXISTS "Users can update own draft expenses" ON expense_reimbursements;
DROP POLICY IF EXISTS "Admins can update unit expenses" ON expense_reimbursements;

-- Users can view their own expenses
CREATE POLICY "Users can view own expenses"
ON expense_reimbursements FOR SELECT
USING (
    submitter_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
);

-- Admins/treasurers can view all unit expenses
CREATE POLICY "Admins can view unit expenses"
ON expense_reimbursements FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_reimbursements.unit_id
        AND unit_memberships.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
        AND unit_memberships.role IN ('admin', 'treasurer')
        AND unit_memberships.status = 'active'
    )
);

-- Leaders can view all unit expenses (read-only for oversight)
CREATE POLICY "Leaders can view unit expenses"
ON expense_reimbursements FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_reimbursements.unit_id
        AND unit_memberships.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
        AND unit_memberships.role = 'leader'
        AND unit_memberships.status = 'active'
    )
);

-- Users can create expenses for themselves
CREATE POLICY "Users can create expenses"
ON expense_reimbursements FOR INSERT
WITH CHECK (
    submitter_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_reimbursements.unit_id
        AND unit_memberships.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
        AND unit_memberships.status = 'active'
    )
);

-- Users can update their own draft/rejected expenses
CREATE POLICY "Users can update own draft expenses"
ON expense_reimbursements FOR UPDATE
USING (
    submitter_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status IN ('draft', 'rejected')
)
WITH CHECK (
    submitter_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status IN ('draft', 'rejected', 'submitted')
);

-- Admins/treasurers can update any unit expense (for approval/rejection/payment)
CREATE POLICY "Admins can update unit expenses"
ON expense_reimbursements FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_reimbursements.unit_id
        AND unit_memberships.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
        AND unit_memberships.role IN ('admin', 'treasurer')
        AND unit_memberships.status = 'active'
    )
);
