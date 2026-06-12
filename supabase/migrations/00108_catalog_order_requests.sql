-- Coach order requests from the public catalog pages (/adidas today; brand
-- column keeps it open for Sanmar/Momentec catalogs later). Inserted by the
-- catalog-order-request Netlify function via service role; RLS stays locked
-- (no anon policies) because rows carry coach contact info.
CREATE TABLE IF NOT EXISTS public.catalog_order_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  brand TEXT NOT NULL DEFAULT 'adidas',
  coach_name TEXT NOT NULL,
  coach_email TEXT NOT NULL,
  coach_phone TEXT,
  team_name TEXT,
  notes TEXT,
  -- [{sku,name,color,size,qty,price,inbound}] as built on the catalog page
  lines JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  emailed BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE public.catalog_order_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_catalog_order_requests_created
  ON public.catalog_order_requests (created_at DESC);
