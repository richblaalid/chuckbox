-- Expense Reimbursements table for tracking expense requests
-- Adults submit expenses, treasurers approve, creates journal entries

-- Expense categories enum
DO $$ BEGIN
    CREATE TYPE expense_category AS ENUM ('supplies', 'food', 'travel', 'other');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Expense status enum
DO $$ BEGIN
    CREATE TYPE expense_status AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'paid');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Main expense reimbursements table
CREATE TABLE IF NOT EXISTS expense_reimbursements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    submitter_id UUID NOT NULL REFERENCES profiles(id),

    -- Expense details
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    expense_date DATE NOT NULL,
    category expense_category NOT NULL DEFAULT 'other',
    vendor TEXT,

    -- Receipt
    receipt_url TEXT,
    receipt_filename TEXT,

    -- AI extraction metadata (optional)
    ai_extracted BOOLEAN DEFAULT FALSE,
    ai_extraction_data JSONB,

    -- Workflow status
    status expense_status NOT NULL DEFAULT 'draft',

    -- Submission
    submitted_at TIMESTAMPTZ,

    -- Review
    reviewed_by UUID REFERENCES profiles(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    rejection_reason TEXT,

    -- Payment
    paid_at TIMESTAMPTZ,
    paid_by UUID REFERENCES profiles(id),
    payment_method TEXT,
    payment_reference TEXT,

    -- Journal entry (created on approval)
    journal_entry_id UUID REFERENCES journal_entries(id),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expense_reimbursements_unit ON expense_reimbursements(unit_id);
CREATE INDEX IF NOT EXISTS idx_expense_reimbursements_submitter ON expense_reimbursements(submitter_id);
CREATE INDEX IF NOT EXISTS idx_expense_reimbursements_status ON expense_reimbursements(status);
CREATE INDEX IF NOT EXISTS idx_expense_reimbursements_unit_status ON expense_reimbursements(unit_id, status);

-- RLS Policies
ALTER TABLE expense_reimbursements ENABLE ROW LEVEL SECURITY;

-- Users can view their own expenses
CREATE POLICY "Users can view own expenses"
ON expense_reimbursements FOR SELECT
USING (submitter_id = auth.uid());

-- Admins/treasurers can view all unit expenses
CREATE POLICY "Admins can view unit expenses"
ON expense_reimbursements FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_reimbursements.unit_id
        AND unit_memberships.profile_id = auth.uid()
        AND unit_memberships.role IN ('admin', 'treasurer')
        AND unit_memberships.status = 'active'
    )
);

-- Leaders can view all unit expenses (read-only for oversight)
CREATE POLICY "Leaders can view unit expenses"
ON expense_reimbursements FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_reimbursements.unit_id
        AND unit_memberships.profile_id = auth.uid()
        AND unit_memberships.role = 'leader'
        AND unit_memberships.status = 'active'
    )
);

-- Adults can insert their own expenses
CREATE POLICY "Users can create expenses"
ON expense_reimbursements FOR INSERT
WITH CHECK (
    submitter_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_reimbursements.unit_id
        AND unit_memberships.profile_id = auth.uid()
        AND unit_memberships.status = 'active'
    )
);

-- Users can update their own draft/rejected expenses
CREATE POLICY "Users can update own draft expenses"
ON expense_reimbursements FOR UPDATE
USING (
    submitter_id = auth.uid()
    AND status IN ('draft', 'rejected')
)
WITH CHECK (
    submitter_id = auth.uid()
    AND status IN ('draft', 'rejected', 'submitted')
);

-- Admins/treasurers can update any unit expense (for approval/rejection/payment)
CREATE POLICY "Admins can update unit expenses"
ON expense_reimbursements FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM unit_memberships
        WHERE unit_memberships.unit_id = expense_reimbursements.unit_id
        AND unit_memberships.profile_id = auth.uid()
        AND unit_memberships.role IN ('admin', 'treasurer')
        AND unit_memberships.status = 'active'
    )
);

-- Updated_at trigger (reuse existing function if available)
DO $$ BEGIN
    CREATE TRIGGER set_expense_reimbursements_updated_at
        BEFORE UPDATE ON expense_reimbursements
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Comment on table
COMMENT ON TABLE expense_reimbursements IS 'Expense reimbursement requests from adults, approved by treasurers';
