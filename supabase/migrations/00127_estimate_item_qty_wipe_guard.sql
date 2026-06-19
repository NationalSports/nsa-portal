-- Server-side backstop for the per-item quantity-wipe data loss (EST-1316/1314/...).
--
-- Root cause: a long-lived/stale client (a browser tab running the app's background auto-save on a
-- timer) re-saves an estimate from an out-of-date in-memory snapshot. The save_estimate RPC writes each
-- item's `sizes` verbatim, and the client-side guard (businessLogic.itemsWithWipedQty) only protects the
-- live editor — bulk scripts, the RPC, and stale tabs all bypass it. Because the row is UPSERTed (never
-- DELETEd) when only its sizes change, no estimate_items_audit snapshot is written either, so the loss is
-- silent. Observed signature: EST-1316 saved a 53-unit jersey down to sizes:{}, reading $0 everywhere,
-- and re-wiped within minutes of each manual repair.
--
-- This BEFORE UPDATE trigger protects EVERY writer: if a write would drop a still-priced, same-identity
-- line's size total from >0 to 0 (and the quantity is NOT intentionally moving to est_qty / qty_only), it
-- PRESERVES the prior sizes instead of letting them be wiped. Removing a line is a DELETE (never seen by
-- this trigger), not an in-place zeroing of every size, so a full in-place wipe is treated as unintended.
-- Preserve (rather than RAISE) keeps the atomic estimate save's other legitimate changes intact while
-- neutralizing only the erroneous wipe; a RAISE warning records each save for visibility in the logs.
--
-- NOTE: this guards the size-wipe failure mode only. Whole-item deletion by a stale save (EST-1314) is a
-- separate vector handled by the client item-count guards + the estimate_items_audit recovery trail.

CREATE OR REPLACE FUNCTION public.guard_estimate_item_qty_wipe()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  old_qty numeric := 0;
  new_qty numeric := 0;
  v text;
BEGIN
  IF OLD.sizes IS NOT NULL AND jsonb_typeof(OLD.sizes) = 'object' THEN
    FOR v IN SELECT value FROM jsonb_each_text(OLD.sizes) LOOP
      IF v ~ '^-?[0-9]+(\.[0-9]+)?$' THEN old_qty := old_qty + GREATEST(v::numeric, 0); END IF;
    END LOOP;
  END IF;

  IF old_qty <= 0 THEN RETURN NEW; END IF;  -- line had no quantities — nothing to protect

  IF NEW.sizes IS NOT NULL AND jsonb_typeof(NEW.sizes) = 'object' THEN
    FOR v IN SELECT value FROM jsonb_each_text(NEW.sizes) LOOP
      IF v ~ '^-?[0-9]+(\.[0-9]+)?$' THEN new_qty := new_qty + GREATEST(v::numeric, 0); END IF;
    END LOOP;
  END IF;

  IF new_qty = 0
     AND COALESCE(NEW.qty_only, false) = false
     AND COALESCE(NEW.est_qty, 0) = 0
     AND COALESCE(NEW.unit_sell, 0) > 0
     AND COALESCE(NEW.sku, '') = COALESCE(OLD.sku, '')
  THEN
    NEW.sizes := OLD.sizes;
    RAISE WARNING 'guard_estimate_item_qty_wipe: preserved % unit(s) on estimate_items id=% (estimate %, sku %) — incoming write had empty sizes',
      old_qty, OLD.id, OLD.estimate_id, COALESCE(NEW.sku, '');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estimate_item_qty_wipe_guard ON public.estimate_items;
CREATE TRIGGER trg_estimate_item_qty_wipe_guard
  BEFORE UPDATE ON public.estimate_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_estimate_item_qty_wipe();
