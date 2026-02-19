-- Cost sharing table for parent-to-parent expense splitting
-- This is peer-to-peer only - NO journal entries, NO troop ledger impact

CREATE TYPE cost_share_status AS ENUM ('pending', 'paid', 'declined');

CREATE TABLE expense_cost_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,

    -- Organizer (person who paid initially)
    organizer_id UUID NOT NULL REFERENCES profiles(id),

    -- Share details
    description TEXT NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount > 0),
    total_scouts INTEGER NOT NULL CHECK (total_scouts > 0),
    per_scout_amount DECIMAL(10,2) NOT NULL CHECK (per_scout_amount > 0),
    share_amount DECIMAL(10,2) NOT NULL CHECK (share_amount > 0),
    scout_count INTEGER NOT NULL CHECK (scout_count > 0),

    -- Participant owing money
    participant_id UUID NOT NULL REFERENCES profiles(id),

    -- Payment info
    status cost_share_status NOT NULL DEFAULT 'pending',
    paid_at TIMESTAMPTZ,

    -- Venmo info for organizer (snapshot at creation time)
    organizer_venmo TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_expense_cost_shares_organizer ON expense_cost_shares(organizer_id);
CREATE INDEX idx_expense_cost_shares_participant ON expense_cost_shares(participant_id);
CREATE INDEX idx_expense_cost_shares_unit ON expense_cost_shares(unit_id);
CREATE INDEX idx_expense_cost_shares_status ON expense_cost_shares(status);

-- RLS Policies
ALTER TABLE expense_cost_shares ENABLE ROW LEVEL SECURITY;

-- Organizer can view their own cost shares
CREATE POLICY "Organizers can view own cost shares"
ON expense_cost_shares FOR SELECT
USING (
    organizer_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
);

-- Participants can view shares assigned to them
CREATE POLICY "Participants can view assigned cost shares"
ON expense_cost_shares FOR SELECT
USING (
    participant_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
);

-- Admins/treasurers can view all unit cost shares
CREATE POLICY "Admins can view unit cost shares"
ON expense_cost_shares FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_cost_shares.unit_id
        AND unit_memberships.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
        AND unit_memberships.role IN ('admin', 'treasurer')
        AND unit_memberships.status = 'active'
    )
);

-- Organizer can create cost shares for their unit
CREATE POLICY "Organizers can create cost shares"
ON expense_cost_shares FOR INSERT
WITH CHECK (
    organizer_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_cost_shares.unit_id
        AND unit_memberships.profile_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
        AND unit_memberships.status = 'active'
    )
);

-- Organizer can update their own cost shares (e.g., mark paid)
CREATE POLICY "Organizers can update own cost shares"
ON expense_cost_shares FOR UPDATE
USING (
    organizer_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
);

-- Organizer can delete their own pending cost shares
CREATE POLICY "Organizers can delete own pending cost shares"
ON expense_cost_shares FOR DELETE
USING (
    organizer_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status = 'pending'
);

-- Updated_at trigger
CREATE TRIGGER set_expense_cost_shares_updated_at
    BEFORE UPDATE ON expense_cost_shares
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
