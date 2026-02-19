-- Add conflict resolution columns to sync_staged_members
-- These enable per-field override when syncing from Scoutbook

-- conflicts: Array of detected conflicts where Chuckbox would win by default
-- Structure: [{field, chuckboxValue, scoutbookValue, reason, resolution}]
ALTER TABLE sync_staged_members
ADD COLUMN IF NOT EXISTS conflicts JSONB;

-- field_resolutions: Per-field override preferences (chuckbox or scoutbook)
-- Structure: {field_name: 'chuckbox' | 'scoutbook'}
ALTER TABLE sync_staged_members
ADD COLUMN IF NOT EXISTS field_resolutions JSONB;

COMMENT ON COLUMN sync_staged_members.conflicts IS 'Detected conflicts where Chuckbox value would win by default. Array of {field, chuckboxValue, scoutbookValue, reason, resolution}';
COMMENT ON COLUMN sync_staged_members.field_resolutions IS 'Per-field resolution preferences: {field_name: chuckbox|scoutbook}';
