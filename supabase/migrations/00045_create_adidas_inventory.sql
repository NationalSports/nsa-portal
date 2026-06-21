-- Adidas B2B inventory table — stores per-SKU per-size stock data
-- synced via CSV upload from Adidas Cowork portal
CREATE TABLE IF NOT EXISTS public.adidas_inventory (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL,
  size TEXT NOT NULL,
  stock_qty INTEGER DEFAULT 0,
  future_delivery_date TEXT,
  future_delivery_qty INTEGER,
  last_synced TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sku, size)
);

-- RLS
ALTER TABLE public.adidas_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adidas_inventory_all" ON public.adidas_inventory FOR ALL USING (true) WITH CHECK (true);

-- Index for bulk lookups
CREATE INDEX IF NOT EXISTS idx_adidas_inventory_sku ON public.adidas_inventory(sku);
