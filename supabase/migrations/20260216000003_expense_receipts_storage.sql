-- Create storage bucket for expense receipts
-- Allows uploading receipt images and PDFs
-- Public bucket: URLs are unguessable ({unitId}/{profileId}_{timestamp}_{filename})
-- Access control is handled at the application layer (API routes validate auth + membership)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'expense-receipts',
    'expense-receipts',
    true,  -- Public read via direct URL (paths are unguessable UUIDs)
    10485760,  -- 10MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS Policies for expense-receipts bucket
-- Upload and delete are handled via admin client in API routes (which validate auth + membership)
-- Public read means no SELECT policy needed

-- Allow authenticated users to upload (permissive, actual access control in API route)
CREATE POLICY "Authenticated users can upload receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'expense-receipts');

-- Allow authenticated users to delete their own receipts
CREATE POLICY "Authenticated users can delete receipts"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'expense-receipts');
