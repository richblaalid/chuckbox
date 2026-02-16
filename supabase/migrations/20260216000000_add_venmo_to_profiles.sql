-- Add Venmo username to profiles for payment facilitation
-- Used in expense reimbursement cost sharing (Phase 4)

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS venmo_username TEXT;

COMMENT ON COLUMN profiles.venmo_username IS 'User Venmo username for receiving reimbursements and cost-sharing payments';
