-- Part 1: Storage — restrict list/download on the three public buckets to authenticated users.
-- Public URL access via /storage/v1/object/public/<bucket>/<path> bypasses RLS when bucket.public=true,
-- so <img src="..."> tags etc. keep working for everyone. This only blocks anonymous listing/enumeration.
ALTER POLICY public_read_artwork ON storage.objects TO authenticated;
ALTER POLICY public_read_documents ON storage.objects TO authenticated;
ALTER POLICY public_read_product_images ON storage.objects TO authenticated;

-- Part 2: Drop redundant duplicate policy on adidas_inventory (keeps "Allow all access to adidas_inventory")
DROP POLICY IF EXISTS adidas_inventory_all ON public.adidas_inventory;

-- Part 3: For every public-schema "Allow all"-style policy (cmd=ALL, qual=true, with_check=true, role=public):
--   (a) restrict the existing policy to 'authenticated' — blocks anon writes
--   (b) add a SELECT policy for 'anon' so pre-login reads still work (matches current app behavior)
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'ALL'
      AND qual = 'true'
      AND with_check = 'true'
      AND roles::text = '{public}'
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated',
                   pol.policyname, pol.schemaname, pol.tablename);
    EXECUTE format('CREATE POLICY %I ON %I.%I FOR SELECT TO anon USING (true)',
                   pol.tablename || '_anon_read', pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- Part 4: Restrict slack_notifications insert from public → authenticated
ALTER POLICY slack_notif_insert ON public.slack_notifications TO authenticated;
