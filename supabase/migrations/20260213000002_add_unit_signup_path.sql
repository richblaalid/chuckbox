-- Add signup_path to track how units were created for analytics
-- Values: 'csv' (uploaded roster), 'manual' (skipped CSV)

ALTER TABLE units ADD COLUMN IF NOT EXISTS signup_path TEXT;

COMMENT ON COLUMN units.signup_path IS 'How the unit was created: csv (with roster upload) or manual (skip for now)';
