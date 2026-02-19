-- Add section_unit_map column to staged_roster_imports for linked troops support
-- This stores the mapping of section identifiers to unit IDs (e.g., {"9297B": "uuid-1", "7297G": "uuid-2"})

ALTER TABLE staged_roster_imports ADD COLUMN IF NOT EXISTS section_unit_map JSONB DEFAULT '{}';

COMMENT ON COLUMN staged_roster_imports.section_unit_map IS 'Mapping of section identifiers to unit IDs for linked troops (e.g., {"9297B": "uuid-1", "7297G": "uuid-2"})';
