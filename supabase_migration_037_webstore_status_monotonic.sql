-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 037: monotonic webstore status sync
-- Run in the Supabase SQL Editor. Replaces the migration-020 trigger
-- function with a safer, advance-only version. PURELY a function/trigger
-- replacement — no table/data changes.
--
-- WHY:
--   The migration-020 trigger mapped the Sales Order's *stored* status column
--   straight onto every linked webstore_order_items.line_status, with an ELSE
--   branch that reset lines to 'pending'. Native webstore SOs are created with
--   status='need_order' (an ELSE value), so every SO save forced their player
--   lines back to 'pending' — clobbering the granular received → in production →
--   bagging → shipped stages the app pushes per item (pushWebstoreStatusSync).
--   It could also over-advance: 'waiting_receive' (goods not in yet) mapped to
--   'in_production'.
--
-- FIX:
--   • MONOTONIC: only ever advances a line to a higher stage, never downgrades.
--     The app's per-item push and this coarse SO-level net now cooperate — the
--     furthest-along stage wins — so an early stored status can't reset a line.
--   • Accurate coarse mapping: only true production statuses advance to
--     'in_production'; pre-production ('waiting_receive','booking') no longer do.
--     'items_received' attests 'received'. Everything else is a no-op (the app
--     push supplies received/bagging from real receiving + job signals).
--   • Never touches a 'cancelled' line.
--   • search_path pinned (clears the function_search_path_mutable advisor).
--
-- Stage order: pending/on_order(0) < received(1) < in_production(2)
--            < bagging(3) < shipped(4) = complete(4).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION webstore_sync_status() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  ls TEXT;
  target_idx INT;
BEGIN
  IF NEW.webstore_id IS NULL THEN RETURN NEW; END IF;

  -- The coarse stage the Sales Order itself can attest to. NULL = "nothing to
  -- advance to from the SO header" — the per-item app push owns received/bagging.
  ls := CASE
    WHEN COALESCE(NEW._shipped, false)
      OR NEW._shipping_status ILIKE 'ship%'
      OR NEW._shipping_status ILIKE 'deliver%'                       THEN 'shipped'
    WHEN NEW.status IN ('complete','completed','done')               THEN 'complete'
    WHEN NEW.status IN ('in_production','needs_pull','staging','in_process') THEN 'in_production'
    WHEN NEW.status IN ('items_received')                            THEN 'received'
    ELSE NULL
  END;
  IF ls IS NULL THEN RETURN NEW; END IF;

  target_idx := CASE ls
    WHEN 'received'      THEN 1
    WHEN 'in_production' THEN 2
    WHEN 'bagging'       THEN 3
    WHEN 'shipped'       THEN 4
    WHEN 'complete'      THEN 4
    ELSE 0
  END;

  -- Advance only: update lines whose current stage is strictly lower than the
  -- target, and never disturb a cancelled line.
  UPDATE webstore_order_items i
     SET line_status = ls
   WHERE i.order_id IN (SELECT id FROM webstore_orders WHERE so_id = NEW.id)
     AND COALESCE(i.line_status, 'pending') <> 'cancelled'
     AND (CASE COALESCE(i.line_status, 'pending')
            WHEN 'received'      THEN 1
            WHEN 'in_production' THEN 2
            WHEN 'bagging'       THEN 3
            WHEN 'shipped'       THEN 4
            WHEN 'complete'      THEN 4
            ELSE 0
          END) < target_idx;

  RETURN NEW;
END;
$$;

-- Re-assert the trigger binding (idempotent; matches migration 020).
DROP TRIGGER IF EXISTS trg_webstore_sync_status ON sales_orders;
CREATE TRIGGER trg_webstore_sync_status
  AFTER INSERT OR UPDATE OF status, _shipping_status, _shipped ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION webstore_sync_status();
