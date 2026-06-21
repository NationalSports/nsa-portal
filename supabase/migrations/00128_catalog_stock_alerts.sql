-- Back-in-stock alert signups from the public catalog (/adidas). Inserted by
-- the catalog-stock-alert function (service role; RLS locked — rows carry
-- coach emails). The scheduled catalog-stock-alert-check function emails and
-- deactivates alerts once stock lands.
CREATE TABLE IF NOT EXISTS public.catalog_stock_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  brand TEXT NOT NULL DEFAULT 'adidas',
  email TEXT NOT NULL,
  sku TEXT NOT NULL,
  size TEXT,                -- null = any size
  style_name TEXT,
  color TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  notified_at TIMESTAMPTZ
);

ALTER TABLE public.catalog_stock_alerts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_catalog_stock_alerts_active
  ON public.catalog_stock_alerts (sku) WHERE active;

-- One live alert per email+sku+size
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_stock_alerts_live
  ON public.catalog_stock_alerts (email, sku, COALESCE(size, '*')) WHERE active;
