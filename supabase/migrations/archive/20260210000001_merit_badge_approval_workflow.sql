-- ============================================
-- ADD APPROVAL WORKFLOW TO MERIT BADGE REQUIREMENTS
-- Matches the rank requirement approval pattern:
-- Parent submits → Leader approves
-- ============================================

-- Add approval workflow fields to merit_badge_requirement_progress
-- (matching scout_rank_requirement_progress structure)

-- Submission fields (parent marks complete with notes)
ALTER TABLE scout_merit_badge_requirement_progress
ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS submission_notes TEXT;

-- Approval workflow fields (leader reviews)
ALTER TABLE scout_merit_badge_requirement_progress
ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS denial_reason TEXT;

-- Index for pending approvals (matches rank requirements index)
CREATE INDEX IF NOT EXISTS idx_scout_mb_req_progress_pending
ON scout_merit_badge_requirement_progress(approval_status)
WHERE approval_status = 'pending_approval';

-- Index for efficient dashboard queries
CREATE INDEX IF NOT EXISTS idx_scout_mb_req_progress_submitted_by
ON scout_merit_badge_requirement_progress(submitted_by)
WHERE submitted_by IS NOT NULL;

-- Comments
COMMENT ON COLUMN scout_merit_badge_requirement_progress.submitted_by IS
  'Profile ID of parent/guardian who submitted this requirement for approval';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.submitted_at IS
  'When the requirement was submitted for leader approval';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.submission_notes IS
  'Notes from parent about how/when requirement was completed';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.approval_status IS
  'Approval workflow status: pending_approval, approved, denied';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.reviewed_by IS
  'Profile ID of leader who reviewed/approved this requirement';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.reviewed_at IS
  'When the requirement was reviewed by a leader';
COMMENT ON COLUMN scout_merit_badge_requirement_progress.denial_reason IS
  'If denied, the reason provided by the leader';
