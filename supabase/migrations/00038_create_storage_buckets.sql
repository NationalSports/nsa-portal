-- Create storage buckets referenced by the app
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('artwork', 'artwork', true, 52428800, NULL),
  ('product-images', 'product-images', true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml']),
  ('documents', 'documents', true, 52428800, NULL),
  ('imports', 'imports', false, 10485760, ARRAY['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "auth_upload_artwork" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'artwork');
CREATE POLICY "auth_update_artwork" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'artwork');
CREATE POLICY "auth_delete_artwork" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'artwork');
CREATE POLICY "public_read_artwork" ON storage.objects FOR SELECT USING (bucket_id = 'artwork');

CREATE POLICY "auth_upload_product_images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "auth_update_product_images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'product-images');
CREATE POLICY "auth_delete_product_images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'product-images');
CREATE POLICY "public_read_product_images" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');

CREATE POLICY "auth_upload_documents" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
CREATE POLICY "auth_update_documents" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'documents');
CREATE POLICY "auth_delete_documents" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents');
CREATE POLICY "public_read_documents" ON storage.objects FOR SELECT USING (bucket_id = 'documents');

CREATE POLICY "auth_upload_imports" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'imports');
CREATE POLICY "auth_update_imports" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'imports');
CREATE POLICY "auth_delete_imports" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'imports');
CREATE POLICY "auth_read_imports" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'imports');
