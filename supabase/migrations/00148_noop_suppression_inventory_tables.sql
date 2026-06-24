-- Suppress no-op UPDATE writes on vendor-synced inventory tables.
-- last_synced and updated_at are always written by the sync even when data is unchanged,
-- so we exclude them from the comparison; a change to any other column still passes through.
CREATE OR REPLACE FUNCTION public.skip_noop_inventory_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['last_synced', 'updated_at'])
   = (to_jsonb(OLD) - ARRAY['last_synced', 'updated_at']) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sanmar_inventory_skip_noop
  BEFORE UPDATE ON public.sanmar_inventory
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();

CREATE TRIGGER trg_adidas_inventory_skip_noop
  BEFORE UPDATE ON public.adidas_inventory
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();

CREATE TRIGGER trg_momentec_inventory_skip_noop
  BEFORE UPDATE ON public.momentec_inventory
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();

CREATE TRIGGER trg_ss_inventory_skip_noop
  BEFORE UPDATE ON public.ss_inventory
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();

CREATE TRIGGER trg_ua_inventory_skip_noop
  BEFORE UPDATE ON public.ua_inventory
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();

CREATE TRIGGER trg_nike_inventory_skip_noop
  BEFORE UPDATE ON public.nike_inventory
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();

CREATE TRIGGER trg_product_inventory_skip_noop
  BEFORE UPDATE ON public.product_inventory
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();

CREATE TRIGGER trg_app_state_skip_noop
  BEFORE UPDATE ON public.app_state
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_inventory_update();
