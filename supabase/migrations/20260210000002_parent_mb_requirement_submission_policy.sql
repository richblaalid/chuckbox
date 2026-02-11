-- ============================================
-- ADD PARENT SUBMISSION POLICY FOR MERIT BADGE REQUIREMENTS
-- Matches the existing rank requirement parent policy pattern
-- ============================================

-- Parents can submit completions (update with submission fields only)
-- This matches the policy for scout_rank_requirement_progress
CREATE POLICY "Parents can submit MB completions for their scouts"
    ON scout_merit_badge_requirement_progress FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM scout_merit_badge_progress smbp
            JOIN scout_guardians sg ON sg.scout_id = smbp.scout_id
            JOIN profiles p ON p.id = sg.profile_id
            WHERE smbp.id = scout_merit_badge_requirement_progress.scout_merit_badge_progress_id
            AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        -- Can only update submission-related fields
        submitted_by = (SELECT id FROM profiles WHERE user_id = auth.uid())
    );
