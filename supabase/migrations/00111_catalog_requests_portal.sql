-- Wire catalog order requests into the portal rep workflow:
-- linkage columns (matched customer, created estimate, auto-created todo)
-- and RLS policies so the logged-in portal can read/update them. Inserts
-- remain service-role-only (the public catalog goes through the
-- catalog-order-request function).
ALTER TABLE public.catalog_order_requests ADD COLUMN IF NOT EXISTS customer_id TEXT;
ALTER TABLE public.catalog_order_requests ADD COLUMN IF NOT EXISTS estimate_id TEXT;
ALTER TABLE public.catalog_order_requests ADD COLUMN IF NOT EXISTS todo_id TEXT;
ALTER TABLE public.catalog_order_requests ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE public.catalog_order_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

DROP POLICY IF EXISTS "catalog_order_requests_portal_read" ON public.catalog_order_requests;
CREATE POLICY "catalog_order_requests_portal_read" ON public.catalog_order_requests
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "catalog_order_requests_portal_update" ON public.catalog_order_requests;
CREATE POLICY "catalog_order_requests_portal_update" ON public.catalog_order_requests
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
