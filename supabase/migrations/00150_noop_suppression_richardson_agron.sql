-- Extend no-op UPDATE suppression to the two vendor-synced inventory tables
-- that were missed in 00148: richardson_inventory and agron_inventory.
--
-- Same pattern as 00148: the BEFORE UPDATE trigger returns NULL (no-op) when only
-- last_synced/updated_at changed, preventing WAL generation for unchanged rows.
-- The Richardson sync runs daily at 14:30 UTC and writes every SKU even when stock
-- hasn't changed, generating ~N_rows of WAL that Realtime's WAL decoder must process.
-- Agron syncs similarly via the Cowork bot. Without this trigger those syncs drive
-- the same CPU spike that 00148 fixed for the other 7 vendor tables.
CREATE TRIGGER trg_richardson_inventory_skip_noop
  BEFORE UPDATE ON public.richardson_inventory
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();

CREATE TRIGGER trg_agron_inventory_skip_noop
  BEFORE UPDATE ON public.agron_inventory
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();
