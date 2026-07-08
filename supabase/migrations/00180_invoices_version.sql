-- Optimistic concurrency for invoices — mirrors the _version pattern 00049 put on
-- estimates/sales_orders/customers (and 00103 on the art-file tables). Invoices were
-- the only money-carrying entity without it: two tabs editing the same invoice were
-- silent last-write-wins on total/paid/status. The client (_dbSaveInvoiceInner) now
-- passes its base _version through _checkVersion before saving, and the poll/realtime
-- merges keep a strictly-newer local copy. The trigger owns the counter — clients
-- never write _version directly (it is not in _invCols).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='_version') THEN
    ALTER TABLE invoices ADD COLUMN _version INT NOT NULL DEFAULT 1;
  END IF;
END$$;

-- increment_version() already exists (created by 00049).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_invoices_version') THEN
    CREATE TRIGGER trg_invoices_version BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION increment_version();
  END IF;
END$$;
