-- Add needs_setup flag to track units that need post-login setup
-- This is set to true when users skip CSV upload during signup

ALTER TABLE units ADD COLUMN IF NOT EXISTS needs_setup BOOLEAN DEFAULT false;

COMMENT ON COLUMN units.needs_setup IS 'True if unit was created without CSV roster and needs setup wizard completion';
