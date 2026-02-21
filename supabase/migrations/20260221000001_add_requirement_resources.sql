-- Resources linked to merit badge requirements
-- Stores structured resource links (videos, websites, PDFs) extracted from Scoutbook
CREATE TABLE bsa_requirement_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES bsa_merit_badge_requirements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_req_resources_requirement ON bsa_requirement_resources(requirement_id);

-- Resources linked to rank requirements
CREATE TABLE bsa_rank_requirement_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES bsa_rank_requirements(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rank_req_resources_requirement ON bsa_rank_requirement_resources(requirement_id);

-- RLS: Read-only for authenticated users (same pattern as other BSA reference tables)
ALTER TABLE bsa_requirement_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE bsa_rank_requirement_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "BSA requirement resources viewable by authenticated users"
    ON bsa_requirement_resources FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "BSA rank requirement resources viewable by authenticated users"
    ON bsa_rank_requirement_resources FOR SELECT
    TO authenticated
    USING (true);

-- Grant service_role and postgres full access (for seeding)
GRANT ALL ON TABLE bsa_requirement_resources TO service_role;
GRANT ALL ON TABLE bsa_requirement_resources TO postgres;
GRANT ALL ON TABLE bsa_rank_requirement_resources TO service_role;
GRANT ALL ON TABLE bsa_rank_requirement_resources TO postgres;

-- Grant authenticated users SELECT access
GRANT SELECT ON TABLE bsa_requirement_resources TO authenticated;
GRANT SELECT ON TABLE bsa_rank_requirement_resources TO authenticated;
