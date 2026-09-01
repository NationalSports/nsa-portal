-- Estimate lines are self-contained: SKU, description, pricing, quantities, and decorations live on
-- estimate_items. product_id is an optional catalog link, but an open browser tab can retain an ID after
-- that product is deleted/replaced. Without this guard the FK rejects the entire atomic estimate save.
--
-- Detach only a stale link immediately before the FK check. Existing products remain linked and no
-- estimate, line-item, pricing, quantity, or decoration data is deleted or rewritten.

CREATE OR REPLACE FUNCTION public.detach_stale_estimate_item_product_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.product_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.products WHERE id = NEW.product_id) THEN
    NEW.product_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.detach_stale_estimate_item_product_link() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detach_stale_estimate_item_product_link()
  TO postgres, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS detach_stale_estimate_item_product_link
  ON public.estimate_items;

CREATE TRIGGER detach_stale_estimate_item_product_link
BEFORE INSERT OR UPDATE OF product_id ON public.estimate_items
FOR EACH ROW
EXECUTE FUNCTION public.detach_stale_estimate_item_product_link();
