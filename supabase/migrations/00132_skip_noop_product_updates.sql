-- Phase 4 (DB CPU): suppress no-op UPDATEs on products so the daily vendor catalog syncs
-- stop flooding realtime.
--
-- The 7 vendor catalog syncs (richardson, sanmar-brands, sanmar-nike, ss-brands, ss-adidas,
-- ss-ua, momentec) re-upsert ~17k product rows every run regardless of whether anything changed
-- (resolution=merge-duplicates). Each rewrite produced a new tuple => a WAL record => a realtime
-- event, which made every open client re-download the entire catalog and bloated
-- realtime.list_changes / WAL decode — a large slice of the >80% DB CPU.
--
-- This BEFORE UPDATE trigger drops any update whose row is identical to what is already stored
-- apart from updated_at, so unchanged rows produce no new tuple, no WAL, and no realtime event.
-- Genuine changes pass through untouched and still get updated_at bumped by trg_products_updated.
-- Comparing to_jsonb(NEW) - 'updated_at' to to_jsonb(OLD) - 'updated_at' makes the check independent
-- of BEFORE-trigger firing order and is provably zero-staleness: it only ever skips byte-identical
-- rows. INSERTs (new products) are unaffected.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.skip_noop_product_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_skip_noop ON public.products;
CREATE TRIGGER trg_products_skip_noop
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.skip_noop_product_update();
