-- ============================================================
-- Migration 00107: adidas_size_maps  (durable size-label maps)
-- ============================================================
-- The Adidas inventory sync translates each conversionId's numeric size
-- codes (e.g. "370") into apparel labels (e.g. "3XL") via maps learned from
-- the B2B product pages. Those maps were only persisted to a file in the
-- (read-only) skill folder and to browser localStorage, so every fresh
-- run/machine started cold: the first pass then wrote raw numeric codes
-- before the maps finished learning, leaving duplicate "370"-style rows
-- that double-counted in the portal's B2B totals (the conflict key is
-- (sku,size), so a later relabel writes a NEW row instead of replacing the
-- raw one).
--
-- This table gives the maps a durable, machine-independent home. The sync
-- loads it BEFORE processing (so the first write is a label, never a raw
-- code) and upserts each conversionId after (re)learning a richer example.
-- One row per conversionId; code_labels is { "<code>": "<label>", ... }.

CREATE TABLE IF NOT EXISTS public.adidas_size_maps (
  conversion_id TEXT PRIMARY KEY,
  code_labels   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS — match the sibling adidas_inventory table (the sync uses the anon key;
-- these rows are non-sensitive code→label mappings, no PII).
ALTER TABLE public.adidas_size_maps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "adidas_size_maps_all" ON public.adidas_size_maps;
CREATE POLICY "adidas_size_maps_all" ON public.adidas_size_maps FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.adidas_size_maps TO anon, authenticated;
