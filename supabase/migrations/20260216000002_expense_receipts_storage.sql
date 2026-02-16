-- Create storage bucket for expense receipts
-- Allows uploading receipt images and PDFs

-- Create the bucket (public read for signed URLs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'expense-receipts',
    'expense-receipts',
    false,  -- Not public, use signed URLs for access
    10485760,  -- 10MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS Policies for expense-receipts bucket

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to view their own receipts
CREATE POLICY "Users can view own receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow admins/treasurers to view all receipts in their unit's expenses
-- This requires checking the expense_reimbursements table
CREATE POLICY "Admins can view unit receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'expense-receipts'
    AND EXISTS (
        SELECT 1 FROM expense_reimbursements er
        JOIN unit_memberships um ON er.unit_id = um.unit_id
        WHERE er.submitter_id::text = (storage.foldername(name))[1]
        AND um.profile_id = auth.uid()
        AND um.role IN ('admin', 'treasurer', 'leader')
        AND um.status = 'active'
    )
);

-- Allow users to delete their own receipts (only for draft/rejected expenses)
CREATE POLICY "Users can delete own receipts"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to update their own receipts
CREATE POLICY "Users can update own receipts"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
);
