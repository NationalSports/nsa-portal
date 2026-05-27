-- Migration 020: auto-sync Sales Order status down to linked webstore order
-- items' line_status (drives coach/player order timelines).
CREATE OR REPLACE FUNCTION webstore_sync_status() RETURNS trigger AS $$
DECLARE ls TEXT;
BEGIN
  IF NEW.webstore_id IS NULL THEN RETURN NEW; END IF;
  ls := CASE
    WHEN COALESCE(NEW._shipped, false) OR NEW._shipping_status ILIKE 'ship%' OR NEW._shipping_status ILIKE 'deliver%' THEN 'shipped'
    WHEN NEW.status IN ('complete','completed','done') THEN 'complete'
    WHEN NEW.status IN ('in_production','needs_pull','waiting_receive','booking','staging','in_process') THEN 'in_production'
    ELSE 'pending'
  END;
  UPDATE webstore_order_items SET line_status = ls
   WHERE order_id IN (SELECT id FROM webstore_orders WHERE so_id = NEW.id)
     AND line_status IS DISTINCT FROM ls;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_webstore_sync_status ON sales_orders;
CREATE TRIGGER trg_webstore_sync_status
  AFTER INSERT OR UPDATE OF status, _shipping_status, _shipped ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION webstore_sync_status();
