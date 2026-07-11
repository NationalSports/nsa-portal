-- Webstore batch identity (2026-07-07)
--
-- A "batch" IS the Sales Order created from a set of webstore orders (they link via
-- webstore_orders.so_id). These columns give each batch a stable per-store number, an
-- optional label, and the order-date cutoff used when it was created, so batches stay
-- identifiable in reporting while the store keeps taking orders.
--
-- webstore_batch_no is assigned by trigger at INSERT (not by the client) so numbering
-- can't race or drift; the client only writes the label/cutoff it chose in the modal.

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS webstore_batch_no integer;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS webstore_batch_label text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS webstore_batch_cutoff timestamptz;

CREATE OR REPLACE FUNCTION assign_webstore_batch_no() RETURNS trigger AS $$
BEGIN
  -- Serialize concurrent batch creation per store: lock the parent webstore row so two
  -- simultaneous inserts can't both read the same MAX and collide on the unique index.
  PERFORM 1 FROM webstores WHERE id = NEW.webstore_id FOR UPDATE;
  SELECT COALESCE(MAX(webstore_batch_no), 0) + 1 INTO NEW.webstore_batch_no
    FROM sales_orders WHERE webstore_id = NEW.webstore_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_webstore_batch_no ON sales_orders;
CREATE TRIGGER trg_assign_webstore_batch_no
  BEFORE INSERT ON sales_orders
  FOR EACH ROW
  WHEN (NEW.webstore_id IS NOT NULL AND NEW.webstore_batch_no IS NULL)
  EXECUTE FUNCTION assign_webstore_batch_no();

-- Backfill existing webstore SOs: number per store in creation order. sales_orders.created_at
-- is a locale-formatted TEXT string (not sortable), so order by the id's numeric part —
-- SO numbers are strictly increasing at creation (nextSOId).
--
-- This one-shot UPDATE fires the existing BEFORE UPDATE triggers (set_updated_at, _version
-- bump) on the backfilled rows, so any staff tab holding an older copy of one of these SOs
-- will hit the version-conflict/stale-save path on its next save of THAT SO. That was worth
-- suppressing via session_replication_role, but Supabase's `postgres` role isn't a superuser
-- and can't set that parameter — and there are only a handful of pre-existing webstore SOs,
-- so the one-time bump is negligible. Left as a plain UPDATE.
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY webstore_id
           ORDER BY NULLIF(regexp_replace(id, '\D', '', 'g'), '')::bigint NULLS LAST, id
         ) AS rn
  FROM sales_orders
  WHERE webstore_id IS NOT NULL AND webstore_batch_no IS NULL
)
UPDATE sales_orders s SET webstore_batch_no = n.rn
FROM numbered n WHERE s.id = n.id;

-- One number per store, enforced loudly (a race becomes a hard insert error the rep
-- sees and retries, never a silent duplicate batch number).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_orders_webstore_batch_no
  ON sales_orders (webstore_id, webstore_batch_no)
  WHERE webstore_id IS NOT NULL AND webstore_batch_no IS NOT NULL;

-- Post-condition: the backfill must not leave any webstore SO unnumbered.
DO $$
DECLARE missing int;
BEGIN
  SELECT COUNT(*) INTO missing FROM sales_orders
   WHERE webstore_id IS NOT NULL AND webstore_batch_no IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'webstore batch backfill left % sales_orders unnumbered', missing;
  END IF;
END $$;
