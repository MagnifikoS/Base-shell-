
-- Add logo_url column to invoice_suppliers
ALTER TABLE public.invoice_suppliers
ADD COLUMN logo_url TEXT DEFAULT NULL;

-- Create storage bucket for supplier logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('supplier-logos', 'supplier-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload supplier logos
CREATE POLICY "Authenticated users can upload supplier logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'supplier-logos');

-- Allow authenticated users to update supplier logos
CREATE POLICY "Authenticated users can update supplier logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'supplier-logos');

-- Allow authenticated users to delete supplier logos
CREATE POLICY "Authenticated users can delete supplier logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'supplier-logos');

-- Allow public read access to supplier logos
CREATE POLICY "Public read access to supplier logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'supplier-logos');
