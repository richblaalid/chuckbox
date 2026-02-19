-- Add section_identifier column for Scoutbook-style section identifiers (e.g., "9297B", "7297G")
-- This helps map scouts to the correct section during Scoutbook sync imports

ALTER TABLE units ADD COLUMN IF NOT EXISTS section_identifier VARCHAR(20);

COMMENT ON COLUMN units.section_identifier IS 'Scoutbook-style section identifier (e.g., "9297B" for boys, "7297G" for girls). Used for matching during sync imports.';

-- Add index for faster lookups during sync matching
CREATE INDEX IF NOT EXISTS idx_units_section_identifier ON units(section_identifier) WHERE section_identifier IS NOT NULL;
