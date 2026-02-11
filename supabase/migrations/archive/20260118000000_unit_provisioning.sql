-- Migration: Unit Self-Service Provisioning
-- Enables self-service unit signup with BSA roster CSV upload

-- 1. Unique constraint to prevent duplicate units
-- Uses functional index on lowercase council to handle case variations
CREATE UNIQUE INDEX idx_units_unique_council_type_number
ON units(LOWER(COALESCE(council, '')), unit_type, unit_number)
WHERE parent_unit_id IS NULL AND is_section = false;

COMMENT ON INDEX idx_units_unique_council_type_number IS 'Prevents duplicate primary units (same council, type, number)';

-- 2. Add provisioning status for tracking signup flow
ALTER TABLE units ADD COLUMN IF NOT EXISTS provisioning_status VARCHAR(20)
  DEFAULT 'active'
  CHECK (provisioning_status IN ('pending', 'active', 'suspended'));

COMMENT ON COLUMN units.provisioning_status IS 'Unit provisioning status: pending (awaiting verification), active, or suspended';

-- 3. Provisioning tokens for email verification during signup
CREATE TABLE unit_provisioning_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_provisioning_tokens_hash ON unit_provisioning_tokens(token_hash);
CREATE INDEX idx_provisioning_tokens_expires ON unit_provisioning_tokens(expires_at) WHERE verified_at IS NULL;

COMMENT ON TABLE unit_provisioning_tokens IS 'Verification tokens for unit self-service signup flow';

ALTER TABLE unit_provisioning_tokens ENABLE ROW LEVEL SECURITY;

-- No public access to tokens - service role only during provisioning
CREATE POLICY "Service role only for provisioning tokens"
    ON unit_provisioning_tokens
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- 4. Rate limiting for signup spam prevention
CREATE TABLE signup_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address VARCHAR(45) NOT NULL,
    email VARCHAR(255),
    attempts INTEGER DEFAULT 1,
    first_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    last_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    blocked_until TIMESTAMPTZ
);

CREATE INDEX idx_rate_limits_ip ON signup_rate_limits(ip_address);
CREATE INDEX idx_rate_limits_email ON signup_rate_limits(email) WHERE email IS NOT NULL;

COMMENT ON TABLE signup_rate_limits IS 'Rate limiting for signup attempts to prevent abuse';

ALTER TABLE signup_rate_limits ENABLE ROW LEVEL SECURITY;

-- No public access - service role only
CREATE POLICY "Service role only for rate limits"
    ON signup_rate_limits
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- 5. Staged roster imports (holds parsed CSV until email verification)
CREATE TABLE staged_roster_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provisioning_token_id UUID NOT NULL REFERENCES unit_provisioning_tokens(id) ON DELETE CASCADE,
    parsed_adults JSONB NOT NULL,
    parsed_scouts JSONB NOT NULL,
    unit_metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE staged_roster_imports IS 'Temporary storage for parsed roster data during signup verification';

ALTER TABLE staged_roster_imports ENABLE ROW LEVEL SECURITY;

-- No public access - only via service role during provisioning
CREATE POLICY "Service role only for staged imports"
    ON staged_roster_imports
    FOR ALL
    USING (false)
    WITH CHECK (false);

-- 6. Add setup_completed_at field to track first-time setup completion
ALTER TABLE units ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN units.setup_completed_at IS 'Timestamp when unit completed first-time setup wizard';

-- 7. Function to clean up expired provisioning tokens (run via cron)
CREATE OR REPLACE FUNCTION cleanup_expired_provisioning_tokens()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Delete expired, unverified tokens older than 48 hours
    DELETE FROM unit_provisioning_tokens
    WHERE verified_at IS NULL
      AND expires_at < NOW() - INTERVAL '48 hours';

    -- Also clean up any pending units without verified tokens (orphaned)
    DELETE FROM units
    WHERE provisioning_status = 'pending'
      AND created_at < NOW() - INTERVAL '48 hours'
      AND id NOT IN (
          SELECT DISTINCT unit_id
          FROM unit_provisioning_tokens
          WHERE verified_at IS NOT NULL
      );

    -- Clean up old rate limit records (older than 24 hours)
    DELETE FROM signup_rate_limits
    WHERE last_attempt_at < NOW() - INTERVAL '24 hours';
END;
$$;

COMMENT ON FUNCTION cleanup_expired_provisioning_tokens IS 'Cleanup function for expired provisioning tokens and orphaned pending units';
