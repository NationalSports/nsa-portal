-- Scenarios for migration 00177 (webstore batch numbering trigger + backfill).
-- Self-contained: run AFTER schema_fixture.sql, from the repo root — this file seeds
-- pre-migration SOs, applies supabase/migrations/00177_webstore_batches.sql itself
-- (via \i), then asserts backfill + trigger behavior:
--
--   psql ... -f scripts/pgtest/schema_fixture.sql
--   psql ... -f scripts/pgtest/webstore_batches_scenarios.sql
--
-- Expected output ends with ALL_WEBSTORE_BATCH_SCENARIOS_PASSED.

\set ON_ERROR_STOP on

-- Columns 00177 assumes exist but the shared fixture stubs out: the webstore link
-- (supabase_migration_011) and memo (base schema), used by the upsert simulation.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS webstore_id uuid REFERENCES webstores(id);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS memo text;

-- Two stores + pre-migration SOs (unnumbered), inserted out of id order for store A
-- to prove the backfill numbers by the id's numeric part, not insertion order.
INSERT INTO webstores (id, slug, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'store-a', 'Store A'),
  ('22222222-2222-2222-2222-222222222222', 'store-b', 'Store B');
INSERT INTO sales_orders (id, webstore_id) VALUES
  ('SO-1010', '11111111-1111-1111-1111-111111111111'),
  ('SO-1002', '11111111-1111-1111-1111-111111111111'),
  ('SO-1005', '22222222-2222-2222-2222-222222222222'),
  ('SO-1001', NULL); -- non-webstore SO: must stay untouched

\i supabase/migrations/00177_webstore_batches.sql

DO $$
DECLARE n int; l text;
BEGIN
  -- 1. Backfill: store A numbered 1,2 by id numeric order (SO-1002 → 1, SO-1010 → 2).
  SELECT webstore_batch_no INTO n FROM sales_orders WHERE id = 'SO-1002';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'S1a: SO-1002 expected batch 1, got %', n; END IF;
  SELECT webstore_batch_no INTO n FROM sales_orders WHERE id = 'SO-1010';
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'S1b: SO-1010 expected batch 2, got %', n; END IF;
  -- 2. Backfill is per-store: store B starts at 1.
  SELECT webstore_batch_no INTO n FROM sales_orders WHERE id = 'SO-1005';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'S2: SO-1005 expected batch 1, got %', n; END IF;
  -- 3. Non-webstore SOs untouched.
  SELECT webstore_batch_no INTO n FROM sales_orders WHERE id = 'SO-1001';
  IF n IS NOT NULL THEN RAISE EXCEPTION 'S3: non-webstore SO-1001 got batch %', n; END IF;

  -- 4. Trigger: a new webstore SO continues the store''s sequence and keeps its label/cutoff.
  INSERT INTO sales_orders (id, webstore_id, webstore_batch_label, webstore_batch_cutoff)
  VALUES ('SO-1020', '11111111-1111-1111-1111-111111111111', 'Spring round 1', '2026-07-07T23:59:59Z');
  SELECT webstore_batch_no, webstore_batch_label INTO n, l FROM sales_orders WHERE id = 'SO-1020';
  IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'S4a: SO-1020 expected batch 3, got %', n; END IF;
  IF l IS DISTINCT FROM 'Spring round 1' THEN RAISE EXCEPTION 'S4b: label lost, got %', l; END IF;

  -- 5. Trigger: per-store isolation — store B''s next is 2, unaffected by store A.
  INSERT INTO sales_orders (id, webstore_id) VALUES ('SO-1021', '22222222-2222-2222-2222-222222222222');
  SELECT webstore_batch_no INTO n FROM sales_orders WHERE id = 'SO-1021';
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'S5: SO-1021 expected batch 2, got %', n; END IF;

  -- 6. Trigger fires on INSERT only: the app''s save path is an UPSERT that omits the batch
  --    columns on conflict-update, so an update must not renumber. Simulate the app upsert.
  INSERT INTO sales_orders (id, webstore_id, memo) VALUES ('SO-1020', '11111111-1111-1111-1111-111111111111', 'edited')
  ON CONFLICT (id) DO UPDATE SET memo = EXCLUDED.memo, webstore_id = EXCLUDED.webstore_id;
  SELECT webstore_batch_no, webstore_batch_label INTO n, l FROM sales_orders WHERE id = 'SO-1020';
  IF n IS DISTINCT FROM 3 OR l IS DISTINCT FROM 'Spring round 1' THEN
    RAISE EXCEPTION 'S6: upsert clobbered batch identity (no=%, label=%)', n, l;
  END IF;

  -- 7. A non-webstore SO insert is untouched by the trigger.
  INSERT INTO sales_orders (id) VALUES ('SO-1022');
  SELECT webstore_batch_no INTO n FROM sales_orders WHERE id = 'SO-1022';
  IF n IS NOT NULL THEN RAISE EXCEPTION 'S7: non-webstore SO-1022 got batch %', n; END IF;

  -- 8. Duplicate numbers are impossible: forcing a collision must error (unique index).
  BEGIN
    INSERT INTO sales_orders (id, webstore_id, webstore_batch_no)
    VALUES ('SO-1023', '22222222-2222-2222-2222-222222222222', 2);
    RAISE EXCEPTION 'S8: duplicate batch number was allowed';
  EXCEPTION WHEN unique_violation THEN NULL; -- expected
  END;
END $$;

\echo ALL_WEBSTORE_BATCH_SCENARIOS_PASSED
