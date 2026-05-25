-- Drop stale overloads of transfer_funds_to_billing.
--
-- Background: Postgres treats different parameter lists as different functions.
-- Migrations 20260519000001 (added p_allocations) and 20260519000002 (added
-- p_entry_date) used CREATE OR REPLACE but with new parameter lists, so they
-- created new function overloads instead of replacing the original. Result:
-- three overloads of transfer_funds_to_billing existed simultaneously, each
-- with its own body, and callers were routed by parameter count to potentially
-- stale implementations (including the original that lacked allocation/date
-- handling — perpetuating Bug 5).
--
-- After this migration, only the 5-parameter signature remains. All callers
-- benefit from the latest implementation; missing parameters use defaults
-- (p_allocations defaults to NULL, p_entry_date defaults to CURRENT_DATE).

DROP FUNCTION IF EXISTS transfer_funds_to_billing(uuid, numeric, text);
DROP FUNCTION IF EXISTS transfer_funds_to_billing(uuid, numeric, text, jsonb);
