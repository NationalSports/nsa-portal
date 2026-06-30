-- Guard: a sales order may only be tied to an estimate that belongs to the SAME
-- customer. In June 2026 several SOs were found linked to a different customer's
-- estimate (e.g. SO-1091 Mission Viejo Baseball -> EST-1113 Glitzy Event Rentals,
-- SO-1115 Concordia -> EST-1111 Mountain View, SO-1122 Servite -> EST-1147 Frontier),
-- which falsely flagged those estimates as converted and blocked reps from creating
-- the real SO. A normal conversion (convertSO) always copies est.customer_id onto the
-- SO, so a matching customer is the true invariant — this trigger enforces it at the
-- DB layer so a buggy client, import, or manual edit can never persist a wrong link.
--
-- Behaviour: on INSERT/UPDATE, if estimate_id references an estimate owned by a
-- different (non-null) customer, the link is cleared (set NULL) and a warning is
-- logged. We clear rather than RAISE so legitimate SO saves never fail; the only
-- thing ever stripped is a provably-wrong cross-customer link.

CREATE OR REPLACE FUNCTION enforce_so_estimate_customer()
RETURNS trigger AS $$
DECLARE
  est_customer text;
BEGIN
  IF NEW.estimate_id IS NOT NULL THEN
    SELECT customer_id INTO est_customer FROM estimates WHERE id = NEW.estimate_id;
    -- Only clear on a definite mismatch (both customers known and different).
    -- A missing estimate row or an SO without a customer is left untouched.
    IF est_customer IS NOT NULL
       AND NEW.customer_id IS NOT NULL
       AND est_customer <> NEW.customer_id THEN
      RAISE WARNING 'sales_orders: estimate % belongs to customer % but SO % is customer % - clearing cross-customer estimate link',
        NEW.estimate_id, est_customer, NEW.id, NEW.customer_id;
      NEW.estimate_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sales_orders_estimate_customer') THEN
    CREATE TRIGGER trg_sales_orders_estimate_customer
      BEFORE INSERT OR UPDATE ON sales_orders
      FOR EACH ROW EXECUTE FUNCTION enforce_so_estimate_customer();
  END IF;
END$$;
