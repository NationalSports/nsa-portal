-- Drops the broad SELECT policies on storage.objects for the artwork,
-- documents, and product-images buckets. The Supabase advisor flagged
-- these because they let any authenticated user enumerate every file in
-- the bucket via .list(), including files attached to customers they
-- shouldn't see.
--
-- Public-URL access to these buckets continues to work — public buckets
-- bypass RLS for direct object URLs, so images and documents loaded by
-- href/src still render. The app does not call .list() on any of these
-- buckets (verified by grep across src/, scripts/, netlify/,
-- supabase/functions/ — only daily-backup edge fn uses storage, with a
-- different bucket).
--
-- INSERT/UPDATE/DELETE policies are unchanged so uploads, replacements,
-- and deletes by authenticated users still work.
--
-- service_role bypasses RLS on storage.objects, so the Supabase
-- dashboard file browser, edge functions using SUPABASE_SERVICE_ROLE_KEY,
-- and Netlify functions are unaffected.
--
-- Rollback (run via SQL editor if needed):
--   CREATE POLICY public_read_artwork        ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'artwork');
--   CREATE POLICY public_read_documents      ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documents');
--   CREATE POLICY public_read_product_images ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS public_read_artwork        ON storage.objects;
DROP POLICY IF EXISTS public_read_documents      ON storage.objects;
DROP POLICY IF EXISTS public_read_product_images ON storage.objects;
