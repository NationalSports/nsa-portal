-- OMG store metadata columns that the code references but the schema didn't persist.
-- Without these, _omg_id gets stripped on every save, breaking the sync→detail flow.
ALTER TABLE public.omg_stores
  ADD COLUMN IF NOT EXISTS _omg_sale_code TEXT,
  ADD COLUMN IF NOT EXISTS subdomain TEXT,
  ADD COLUMN IF NOT EXISTS channel_type TEXT;

-- Backfill existing rows: reconstruct _omg_id from the primary key (id = 'OMG-sale_XXX')
-- and mark them as OMG-sourced so the UI treats them as synced stores.
UPDATE public.omg_stores
SET
  _omg_id     = substring(id FROM 5),  -- strip leading 'OMG-'
  _omg_source = true
WHERE id LIKE 'OMG-%'
  AND _omg_id IS NULL;
