-- ============================================
-- ADVANCEMENT TRACKING SCHEMA
-- Comprehensive tracking for Scouts BSA rank progress,
-- merit badges, leadership positions, and activities
-- ============================================

-- ============================================
-- SECTION 1: ENUMS
-- ============================================

-- Advancement status workflow
CREATE TYPE advancement_status AS ENUM (
    'not_started',
    'in_progress',
    'completed',
    'pending_approval',
    'approved',
    'awarded'
);

-- Activity types for detailed logging
CREATE TYPE activity_type AS ENUM (
    'camping',
    'hiking',
    'service',
    'conservation'
);

-- ============================================
-- SECTION 2: BSA REFERENCE TABLES
-- Platform-level tables for BSA official requirements
-- ============================================

-- 7 Scouts BSA ranks
CREATE TABLE bsa_ranks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    is_eagle_required BOOLEAN DEFAULT true,
    description TEXT,
    image_url TEXT,
    requirement_version_year INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for display ordering
CREATE INDEX idx_bsa_ranks_display_order ON bsa_ranks(display_order);

-- Comments for bsa_ranks
COMMENT ON COLUMN bsa_ranks.requirement_version_year IS
  'Year the BSA last updated requirements for this rank (e.g., 2022, 2016)';
COMMENT ON COLUMN bsa_ranks.image_url IS 'URL to rank badge image';

-- Rank requirements with nested sub-requirements
CREATE TABLE bsa_rank_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_year INTEGER NOT NULL,
    rank_id UUID NOT NULL REFERENCES bsa_ranks(id) ON DELETE CASCADE,
    requirement_number TEXT NOT NULL,
    parent_requirement_id UUID REFERENCES bsa_rank_requirements(id) ON DELETE CASCADE,
    sub_requirement_letter TEXT,
    description TEXT NOT NULL,
    is_alternative BOOLEAN DEFAULT false,
    alternatives_group TEXT,
    display_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(version_year, rank_id, requirement_number, sub_requirement_letter)
);

-- Indexes for requirement lookup
CREATE INDEX idx_rank_requirements_rank_version ON bsa_rank_requirements(rank_id, version_year);
CREATE INDEX idx_bsa_rank_requirements_parent ON bsa_rank_requirements(parent_requirement_id);

-- Comments for bsa_rank_requirements
COMMENT ON COLUMN bsa_rank_requirements.version_year IS
  'BSA version year for these requirements (e.g., 2022, 2016). Query by joining to bsa_ranks.requirement_version_year for current requirements.';

-- 141+ merit badges
CREATE TABLE bsa_merit_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_eagle_required BOOLEAN DEFAULT false,
    category TEXT,
    description TEXT,
    image_url TEXT,
    pamphlet_url TEXT,
    requirement_version_year INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for filtering
CREATE INDEX idx_bsa_merit_badges_eagle ON bsa_merit_badges(is_eagle_required) WHERE is_active = true;
CREATE INDEX idx_bsa_merit_badges_category ON bsa_merit_badges(category) WHERE is_active = true;

-- Comments for bsa_merit_badges
COMMENT ON COLUMN bsa_merit_badges.pamphlet_url IS 'URL to the official BSA merit badge pamphlet PDF on filestore.scouting.org';
COMMENT ON COLUMN bsa_merit_badges.requirement_version_year IS
  'Year the BSA last updated requirements for this merit badge';

-- Merit badge requirements (versioned by year)
CREATE TABLE bsa_merit_badge_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_year INTEGER NOT NULL,
    merit_badge_id UUID NOT NULL REFERENCES bsa_merit_badges(id) ON DELETE CASCADE,
    requirement_number TEXT NOT NULL,
    parent_requirement_id UUID REFERENCES bsa_merit_badge_requirements(id) ON DELETE CASCADE,
    sub_requirement_letter TEXT,
    description TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    is_alternative BOOLEAN DEFAULT false,
    alternatives_group TEXT,
    nesting_depth INTEGER DEFAULT 0,
    original_scoutbook_id TEXT,
    required_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index with COALESCE (can't use COALESCE in table UNIQUE constraint)
CREATE UNIQUE INDEX idx_mb_requirements_unique
ON bsa_merit_badge_requirements(version_year, merit_badge_id, requirement_number, COALESCE(sub_requirement_letter, ''));

-- Indexes for requirement lookup
CREATE INDEX idx_mb_requirements_badge_version ON bsa_merit_badge_requirements(merit_badge_id, version_year);
CREATE INDEX idx_bsa_mb_requirements_parent ON bsa_merit_badge_requirements(parent_requirement_id);
CREATE INDEX idx_bsa_mb_requirements_scoutbook_id ON bsa_merit_badge_requirements(original_scoutbook_id) WHERE original_scoutbook_id IS NOT NULL;
CREATE INDEX idx_bsa_mb_requirements_alternatives_group ON bsa_merit_badge_requirements(merit_badge_id, alternatives_group) WHERE alternatives_group IS NOT NULL;

-- Comments for bsa_merit_badge_requirements
COMMENT ON COLUMN bsa_merit_badge_requirements.version_year IS
  'BSA version year for these requirements. Query by joining to bsa_merit_badges.requirement_version_year for current requirements.';
COMMENT ON COLUMN bsa_merit_badge_requirements.is_alternative IS 'True if this is one option in an OR group (e.g., "Do ONE of the following")';
COMMENT ON COLUMN bsa_merit_badge_requirements.alternatives_group IS 'Groups related alternatives together (e.g., "5_options" for all choices under requirement 5)';
COMMENT ON COLUMN bsa_merit_badge_requirements.nesting_depth IS 'Depth level in the hierarchy (0=top, 1=sub-requirement, 2=sub-sub, etc.)';
COMMENT ON COLUMN bsa_merit_badge_requirements.original_scoutbook_id IS 'Original requirement ID from Scoutbook exports (e.g., "6A(a)(1)") for import matching';
COMMENT ON COLUMN bsa_merit_badge_requirements.required_count IS 'Number of alternatives that must be completed (e.g., 1 for "Do ONE", 2 for "Do TWO")';

-- Valid leadership positions for rank advancement
CREATE TABLE bsa_leadership_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    qualifies_for_star BOOLEAN DEFAULT false,
    qualifies_for_life BOOLEAN DEFAULT false,
    qualifies_for_eagle BOOLEAN DEFAULT false,
    min_tenure_months INTEGER DEFAULT 4,
    is_patrol_level BOOLEAN DEFAULT false,
    is_troop_level BOOLEAN DEFAULT true,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SECTION 3: SCOUT PROGRESS TABLES
-- Per-scout tracking of advancement progress
-- ============================================

-- Scout rank progress (enhanced tracking)
CREATE TABLE scout_rank_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    rank_id UUID NOT NULL REFERENCES bsa_ranks(id) ON DELETE RESTRICT,
    status advancement_status NOT NULL DEFAULT 'not_started',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES profiles(id),
    awarded_at TIMESTAMPTZ,
    awarded_by UUID REFERENCES profiles(id),
    -- Scoutbook sync fields
    external_status TEXT,
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_id, rank_id)
);

-- Indexes for progress lookup
CREATE INDEX idx_scout_rank_progress_scout ON scout_rank_progress(scout_id);
CREATE INDEX idx_scout_rank_progress_status ON scout_rank_progress(status) WHERE status != 'awarded';

-- Individual requirement completion with parent submission workflow
CREATE TABLE scout_rank_requirement_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_rank_progress_id UUID NOT NULL REFERENCES scout_rank_progress(id) ON DELETE CASCADE,
    requirement_id UUID NOT NULL REFERENCES bsa_rank_requirements(id) ON DELETE RESTRICT,
    status advancement_status NOT NULL DEFAULT 'not_started',
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES profiles(id),
    notes TEXT,
    -- Parent submission workflow
    submitted_by UUID REFERENCES profiles(id),
    submitted_at TIMESTAMPTZ,
    submission_notes TEXT,
    approval_status TEXT CHECK (approval_status IN ('pending_approval', 'approved', 'denied')),
    denial_reason TEXT,
    reviewed_by UUID REFERENCES profiles(id),
    reviewed_at TIMESTAMPTZ,
    -- Sync fields
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_rank_progress_id, requirement_id)
);

-- Indexes for requirement progress lookup
CREATE INDEX idx_scout_rank_req_progress_rank ON scout_rank_requirement_progress(scout_rank_progress_id);
CREATE INDEX idx_scout_rank_req_progress_pending ON scout_rank_requirement_progress(approval_status)
    WHERE approval_status = 'pending_approval';

-- Merit badge tracking
CREATE TABLE scout_merit_badge_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    merit_badge_id UUID NOT NULL REFERENCES bsa_merit_badges(id) ON DELETE RESTRICT,
    status advancement_status NOT NULL DEFAULT 'not_started',
    -- Counselor info (can be unit adult or external)
    counselor_name TEXT,
    counselor_profile_id UUID REFERENCES profiles(id),
    counselor_bsa_id TEXT,
    counselor_signed_at TIMESTAMPTZ,
    -- Progress dates
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES profiles(id),
    awarded_at TIMESTAMPTZ,
    -- Sync fields
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_id, merit_badge_id)
);

-- Indexes for merit badge progress
CREATE INDEX idx_scout_mb_progress_scout ON scout_merit_badge_progress(scout_id);
CREATE INDEX idx_scout_mb_progress_status ON scout_merit_badge_progress(status) WHERE status != 'awarded';
CREATE INDEX idx_scout_mb_progress_badge ON scout_merit_badge_progress(merit_badge_id);

-- Merit badge requirement completion
CREATE TABLE scout_merit_badge_requirement_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_merit_badge_progress_id UUID NOT NULL REFERENCES scout_merit_badge_progress(id) ON DELETE CASCADE,
    requirement_id UUID NOT NULL REFERENCES bsa_merit_badge_requirements(id) ON DELETE RESTRICT,
    status advancement_status NOT NULL DEFAULT 'not_started',
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scout_merit_badge_progress_id, requirement_id)
);

-- Index for requirement lookup
CREATE INDEX idx_scout_mb_req_progress_badge ON scout_merit_badge_requirement_progress(scout_merit_badge_progress_id);

-- Leadership history with proper start/end dates
CREATE TABLE scout_leadership_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    position_id UUID NOT NULL REFERENCES bsa_leadership_positions(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE,
    notes TEXT,
    -- Sync fields
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Helper function to check if a leadership position is current
CREATE OR REPLACE FUNCTION is_leadership_position_current(p_end_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN p_end_date IS NULL OR p_end_date > CURRENT_DATE;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to calculate days served
CREATE OR REPLACE FUNCTION calculate_days_served(p_start_date DATE, p_end_date DATE)
RETURNS INTEGER AS $$
BEGIN
    IF p_end_date IS NOT NULL THEN
        RETURN p_end_date - p_start_date;
    ELSE
        RETURN CURRENT_DATE - p_start_date;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Indexes for leadership lookup
CREATE INDEX idx_scout_leadership_history_scout ON scout_leadership_history(scout_id);
CREATE INDEX idx_scout_leadership_history_current ON scout_leadership_history(scout_id) WHERE end_date IS NULL;
CREATE INDEX idx_scout_leadership_history_unit ON scout_leadership_history(unit_id);

-- Detailed activity entries (granular logging)
CREATE TABLE scout_activity_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    activity_type activity_type NOT NULL,
    activity_date DATE NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    description TEXT,
    location TEXT,
    verified_by UUID REFERENCES profiles(id),
    verified_at TIMESTAMPTZ,
    -- Sync fields
    synced_at TIMESTAMPTZ,
    sync_session_id UUID REFERENCES sync_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for activity lookup
CREATE INDEX idx_scout_activity_entries_scout ON scout_activity_entries(scout_id);
CREATE INDEX idx_scout_activity_entries_type_date ON scout_activity_entries(scout_id, activity_type, activity_date);
CREATE INDEX idx_scout_activity_entries_event ON scout_activity_entries(event_id) WHERE event_id IS NOT NULL;

-- ============================================
-- SECTION 4: MERIT BADGE COUNSELORS
-- ============================================

-- Add counselor flag to unit_memberships
ALTER TABLE unit_memberships ADD COLUMN IF NOT EXISTS is_merit_badge_counselor BOOLEAN DEFAULT false;

-- Track which adults can counsel which merit badges
CREATE TABLE merit_badge_counselors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    merit_badge_id UUID NOT NULL REFERENCES bsa_merit_badges(id) ON DELETE CASCADE,
    approved_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(profile_id, unit_id, merit_badge_id)
);

-- Indexes for counselor lookup
CREATE INDEX idx_merit_badge_counselors_unit ON merit_badge_counselors(unit_id);
CREATE INDEX idx_merit_badge_counselors_badge ON merit_badge_counselors(merit_badge_id);
CREATE INDEX idx_merit_badge_counselors_profile ON merit_badge_counselors(profile_id);

-- ============================================
-- SECTION 5: SYNC STAGING
-- ============================================

-- Advancement staging for Scoutbook sync preview
CREATE TABLE sync_staged_advancement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sync_sessions(id) ON DELETE CASCADE,
    scout_id UUID NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
    data_type TEXT NOT NULL CHECK (data_type IN ('rank_progress', 'rank_requirement', 'merit_badge', 'leadership', 'activity')),
    change_type TEXT NOT NULL CHECK (change_type IN ('new', 'update', 'delete')),
    existing_record_id UUID,
    staged_data JSONB NOT NULL,
    changes JSONB,
    conflict_detected BOOLEAN DEFAULT false,
    conflict_details TEXT,
    is_selected BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for sync staging
CREATE INDEX idx_sync_staged_advancement_session ON sync_staged_advancement(session_id);
CREATE INDEX idx_sync_staged_advancement_scout ON sync_staged_advancement(scout_id);

-- ============================================
-- SECTION 6: HELPER FUNCTIONS
-- ============================================

-- Function to calculate rank progress percentage
CREATE OR REPLACE FUNCTION calculate_rank_progress_percentage(p_scout_rank_progress_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_requirements INTEGER;
    completed_requirements INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_requirements
    FROM scout_rank_requirement_progress
    WHERE scout_rank_progress_id = p_scout_rank_progress_id;

    SELECT COUNT(*) INTO completed_requirements
    FROM scout_rank_requirement_progress
    WHERE scout_rank_progress_id = p_scout_rank_progress_id
    AND status IN ('completed', 'approved', 'awarded');

    IF total_requirements = 0 THEN
        RETURN 0;
    END IF;

    RETURN ROUND((completed_requirements::DECIMAL / total_requirements) * 100);
END;
$$ LANGUAGE plpgsql;

-- Function to initialize rank progress for a scout
-- Creates progress record and requirement progress for all requirements matching the rank's version year
CREATE OR REPLACE FUNCTION initialize_scout_rank_progress(
    p_scout_id UUID,
    p_rank_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_progress_id UUID;
    v_version_year INTEGER;
BEGIN
    -- Get the version year from the rank
    SELECT requirement_version_year INTO v_version_year
    FROM bsa_ranks WHERE id = p_rank_id;

    -- Create rank progress record
    INSERT INTO scout_rank_progress (scout_id, rank_id, status, started_at)
    VALUES (p_scout_id, p_rank_id, 'in_progress', NOW())
    ON CONFLICT (scout_id, rank_id) DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_progress_id;

    -- Create requirement progress records for all requirements
    INSERT INTO scout_rank_requirement_progress (scout_rank_progress_id, requirement_id)
    SELECT v_progress_id, brr.id
    FROM bsa_rank_requirements brr
    WHERE brr.version_year = v_version_year
    AND brr.rank_id = p_rank_id
    AND brr.parent_requirement_id IS NULL  -- Only top-level requirements
    ON CONFLICT (scout_rank_progress_id, requirement_id) DO NOTHING;

    RETURN v_progress_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SECTION 7: ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all new tables
ALTER TABLE bsa_ranks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bsa_rank_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bsa_merit_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE bsa_merit_badge_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bsa_leadership_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_rank_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_rank_requirement_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_merit_badge_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_merit_badge_requirement_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_leadership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_activity_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE merit_badge_counselors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_staged_advancement ENABLE ROW LEVEL SECURITY;

-- BSA Reference tables: Read-only for authenticated users
CREATE POLICY "BSA ranks viewable by authenticated users"
    ON bsa_ranks FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "BSA rank requirements viewable by authenticated users"
    ON bsa_rank_requirements FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "BSA merit badges viewable by authenticated users"
    ON bsa_merit_badges FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "BSA merit badge requirements viewable by authenticated users"
    ON bsa_merit_badge_requirements FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "BSA leadership positions viewable by authenticated users"
    ON bsa_leadership_positions FOR SELECT
    TO authenticated
    USING (true);

-- Scout rank progress: Leaders can view/edit all, parents/scouts can view their own
CREATE POLICY "Leaders can view all scout rank progress in unit"
    ON scout_rank_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_rank_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their linked scouts rank progress"
    ON scout_rank_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_guardians sg
            JOIN profiles p ON p.id = sg.profile_id
            WHERE sg.scout_id = scout_rank_progress.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own rank progress"
    ON scout_rank_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN profiles p ON p.id = s.profile_id
            WHERE s.id = scout_rank_progress.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can insert scout rank progress"
    ON scout_rank_progress FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_rank_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Leaders can update scout rank progress"
    ON scout_rank_progress FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_rank_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Scout rank requirement progress: Similar policies with parent submission support
CREATE POLICY "Leaders can view all scout rank requirement progress"
    ON scout_rank_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scouts s ON s.id = srp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their linked scouts requirement progress"
    ON scout_rank_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scout_guardians sg ON sg.scout_id = srp.scout_id
            JOIN profiles p ON p.id = sg.profile_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own requirement progress"
    ON scout_rank_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scouts s ON s.id = srp.scout_id
            JOIN profiles p ON p.id = s.profile_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can insert scout rank requirement progress"
    ON scout_rank_requirement_progress FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scouts s ON s.id = srp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Leaders can update scout rank requirement progress"
    ON scout_rank_requirement_progress FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scouts s ON s.id = srp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Parents can submit completions (update with submission fields only)
CREATE POLICY "Parents can submit completions for their scouts"
    ON scout_rank_requirement_progress FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_rank_progress srp
            JOIN scout_guardians sg ON sg.scout_id = srp.scout_id
            JOIN profiles p ON p.id = sg.profile_id
            WHERE srp.id = scout_rank_requirement_progress.scout_rank_progress_id
            AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        -- Can only update submission-related fields
        submitted_by = (SELECT id FROM profiles WHERE user_id = auth.uid())
    );

-- Merit badge progress: Similar pattern
CREATE POLICY "Leaders can view all merit badge progress in unit"
    ON scout_merit_badge_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_merit_badge_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their scouts merit badge progress"
    ON scout_merit_badge_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_guardians sg
            JOIN profiles p ON p.id = sg.profile_id
            WHERE sg.scout_id = scout_merit_badge_progress.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own merit badge progress"
    ON scout_merit_badge_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN profiles p ON p.id = s.profile_id
            WHERE s.id = scout_merit_badge_progress.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can manage merit badge progress"
    ON scout_merit_badge_progress FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_merit_badge_progress.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Merit badge requirement progress
CREATE POLICY "Leaders can view all merit badge requirement progress"
    ON scout_merit_badge_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scouts s ON s.id = smbp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their scouts MB requirement progress"
    ON scout_merit_badge_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scout_guardians sg ON sg.scout_id = smbp.scout_id
            JOIN profiles p ON p.id = sg.profile_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own MB requirement progress"
    ON scout_merit_badge_requirement_progress FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scouts s ON s.id = smbp.scout_id
            JOIN profiles p ON p.id = s.profile_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can manage MB requirement progress"
    ON scout_merit_badge_requirement_progress FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scouts s ON s.id = smbp.scout_id
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Leadership history
CREATE POLICY "Leaders can view all leadership history in unit"
    ON scout_leadership_history FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = scout_leadership_history.unit_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their scouts leadership history"
    ON scout_leadership_history FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_guardians sg
            JOIN profiles p ON p.id = sg.profile_id
            WHERE sg.scout_id = scout_leadership_history.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own leadership history"
    ON scout_leadership_history FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN profiles p ON p.id = s.profile_id
            WHERE s.id = scout_leadership_history.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can manage leadership history"
    ON scout_leadership_history FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = scout_leadership_history.unit_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Activity entries
CREATE POLICY "Leaders can view all activity entries in unit"
    ON scout_activity_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_activity_entries.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

CREATE POLICY "Parents can view their scouts activity entries"
    ON scout_activity_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_guardians sg
            JOIN profiles p ON p.id = sg.profile_id
            WHERE sg.scout_id = scout_activity_entries.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Scouts can view their own activity entries"
    ON scout_activity_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN profiles p ON p.id = s.profile_id
            WHERE s.id = scout_activity_entries.scout_id
            AND p.user_id = auth.uid()
        )
    );

CREATE POLICY "Leaders can manage activity entries"
    ON scout_activity_entries FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = scout_activity_entries.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Merit badge counselors
CREATE POLICY "Unit members can view counselors in their unit"
    ON merit_badge_counselors FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = merit_badge_counselors.unit_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
        )
    );

CREATE POLICY "Leaders can manage counselors in their unit"
    ON merit_badge_counselors FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM unit_memberships um
            WHERE um.unit_id = merit_badge_counselors.unit_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- Sync staged advancement
CREATE POLICY "Leaders can view and manage staged advancement for their unit"
    ON sync_staged_advancement FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scouts s
            JOIN unit_memberships um ON um.unit_id = s.unit_id
            WHERE s.id = sync_staged_advancement.scout_id
            AND um.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
            AND um.status = 'active'
            AND um.role IN ('admin', 'treasurer', 'leader')
        )
    );

-- ============================================
-- SECTION 8: TRIGGERS
-- ============================================

-- Update timestamp trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to new tables
CREATE TRIGGER update_bsa_merit_badges_updated_at
    BEFORE UPDATE ON bsa_merit_badges
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_rank_progress_updated_at
    BEFORE UPDATE ON scout_rank_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_rank_requirement_progress_updated_at
    BEFORE UPDATE ON scout_rank_requirement_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_merit_badge_progress_updated_at
    BEFORE UPDATE ON scout_merit_badge_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_merit_badge_requirement_progress_updated_at
    BEFORE UPDATE ON scout_merit_badge_requirement_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scout_leadership_history_updated_at
    BEFORE UPDATE ON scout_leadership_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SECTION 9: COMMENTS
-- ============================================

COMMENT ON TABLE bsa_ranks IS 'The 7 Scouts BSA ranks from Scout to Eagle';
COMMENT ON TABLE bsa_rank_requirements IS 'Individual requirements for each rank, versioned annually';
COMMENT ON TABLE bsa_merit_badges IS 'All 141+ BSA merit badges';
COMMENT ON TABLE bsa_merit_badge_requirements IS 'Requirements for each merit badge, versioned annually';
COMMENT ON TABLE bsa_leadership_positions IS 'Valid leadership positions for rank advancement';
COMMENT ON TABLE scout_rank_progress IS 'Scout progress toward each rank';
COMMENT ON TABLE scout_rank_requirement_progress IS 'Individual requirement completion with parent submission workflow';
COMMENT ON TABLE scout_merit_badge_progress IS 'Scout progress on merit badges with counselor tracking';
COMMENT ON TABLE scout_merit_badge_requirement_progress IS 'Individual merit badge requirement completion';
COMMENT ON TABLE scout_leadership_history IS 'Leadership positions held by scouts with date tracking';
COMMENT ON TABLE scout_activity_entries IS 'Detailed activity log (camping, hiking, service hours)';
COMMENT ON TABLE merit_badge_counselors IS 'Adults approved to counsel specific merit badges';
COMMENT ON TABLE sync_staged_advancement IS 'Staging table for Scoutbook sync advancement data';
