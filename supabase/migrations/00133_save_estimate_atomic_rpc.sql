-- Make estimate saves atomic & idempotent.
--
-- Root cause this fixes: the client saved an estimate's parent row and its line items / decorations in
-- separate calls, and a failed parent write didn't stop the child writes. Combined with an inline-created
-- customer that only existed in local state, an estimate could be written against a customer_id the DB
-- never had — producing a foreign-key error (or, with the trg_ensure_estimate_exists band-aid, an orphaned
-- stub estimate) and a cryptic Postgres message shown to the rep.
--
-- This migration moves the whole write into one transactional RPC so a partial write is impossible.

-- 1) Clean pre-existing phantom duplicate items (from the old multi-call save) so a unique
--    (estimate_id,item_index) constraint can be added. Keep the best row per slot: most decorations,
--    tie-broken by highest id. Decorations of dropped rows cascade-delete.
DELETE FROM estimate_items i
WHERE EXISTS (
  SELECT 1 FROM estimate_items j
  WHERE j.estimate_id = i.estimate_id AND j.item_index = i.item_index AND j.id <> i.id
    AND ( (SELECT count(*) FROM estimate_item_decorations d WHERE d.estimate_item_id = j.id), j.id )
      > ( (SELECT count(*) FROM estimate_item_decorations d WHERE d.estimate_item_id = i.id), i.id )
);

-- 2) Idempotency key: one row per (estimate_id,item_index). Lets the RPC upsert items so a retry after a
--    dropped connection never duplicates lines.
ALTER TABLE estimate_items
  ADD CONSTRAINT estimate_items_estimate_id_item_index_key UNIQUE (estimate_id, item_index);

-- 3) Single transactional save. Upserts the estimate, then replaces its items (and their nested
--    decorations) idempotently: items are upserted on (estimate_id,item_index) and any item_index no longer
--    present is deleted (its decorations cascade). Column lists are derived per-row from the live schema, so
--    only real, present columns are written (absent columns keep their table defaults) — this also makes the
--    function tolerant of client/schema drift. updated_at and _version are left to the existing BEFORE UPDATE
--    triggers. Raises CUSTOMER_MISSING if the referenced customer doesn't exist, so nothing is written when
--    the parent is absent. Runs as the caller (SECURITY INVOKER) so existing RLS still applies.
CREATE OR REPLACE FUNCTION public.save_estimate(p_estimate jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_estimate_id text := p_estimate->>'id';
  v_customer_id text := p_estimate->>'customer_id';
  v_cols      text;
  v_set       text;
  v_item      jsonb;
  v_item_full jsonb;
  v_item_id   int;
  v_idx       int;
  v_keep      int[] := ARRAY[]::int[];
  v_icols     text;
  v_iset      text;
  v_deco      jsonb;
  v_dcols     text;
  v_di        int;
  v_count     int := 0;
BEGIN
  IF v_estimate_id IS NULL OR v_estimate_id = '' THEN
    RAISE EXCEPTION 'ESTIMATE_ID_MISSING';
  END IF;

  -- Parent guard: a referenced customer MUST already exist (NULL customer is allowed).
  IF (p_estimate ? 'customer_id') AND v_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM customers WHERE id = v_customer_id) THEN
    RAISE EXCEPTION 'CUSTOMER_MISSING';
  END IF;

  -- ---- Upsert the estimate row (only real columns present in the payload) ----
  SELECT string_agg(quote_ident(column_name), ',') INTO v_cols
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='estimates'
    AND column_name <> '_version' AND p_estimate ? column_name;

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'ESTIMATE_PAYLOAD_EMPTY';
  END IF;

  -- updated_at + _version are owned by BEFORE UPDATE triggers — never set them on conflict.
  SELECT string_agg(format('%I=EXCLUDED.%I', column_name, column_name), ',') INTO v_set
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='estimates'
    AND column_name NOT IN ('id','_version','updated_at') AND p_estimate ? column_name;

  EXECUTE format(
    'INSERT INTO estimates (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::estimates, $1) %2$s',
    v_cols,
    CASE WHEN v_set IS NULL THEN 'ON CONFLICT (id) DO NOTHING'
         ELSE 'ON CONFLICT (id) DO UPDATE SET ' || v_set END
  ) USING p_estimate;

  -- ---- Replace items idempotently (upsert by (estimate_id,item_index); prune dropped indexes) ----
  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      v_idx := (v_item->>'item_index')::int;
      -- Force the parent id; never trust the payload's estimate_id.
      v_item_full := (v_item - 'decorations') || jsonb_build_object('estimate_id', v_estimate_id, 'item_index', v_idx);

      SELECT string_agg(quote_ident(column_name), ',') INTO v_icols
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='estimate_items'
        AND column_name <> 'id' AND v_item_full ? column_name;

      SELECT string_agg(format('%I=EXCLUDED.%I', column_name, column_name), ',') INTO v_iset
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='estimate_items'
        AND column_name NOT IN ('id','estimate_id','item_index') AND v_item_full ? column_name;

      EXECUTE format(
        'INSERT INTO estimate_items (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::estimate_items, $1) '
        'ON CONFLICT (estimate_id,item_index) DO UPDATE SET %2$s RETURNING id',
        v_icols,
        COALESCE(v_iset, 'item_index=EXCLUDED.item_index')
      ) USING v_item_full INTO v_item_id;

      v_keep  := v_keep || v_idx;
      v_count := v_count + 1;

      -- Kept item's row survives, so the cascade won't clear its decorations — replace them manually.
      DELETE FROM estimate_item_decorations WHERE estimate_item_id = v_item_id;
      IF jsonb_typeof(v_item->'decorations') = 'array' THEN
        v_di := 0;
        FOR v_deco IN SELECT value FROM jsonb_array_elements(v_item->'decorations')
        LOOP
          v_deco := v_deco || jsonb_build_object('estimate_item_id', v_item_id, 'deco_index', v_di);
          SELECT string_agg(quote_ident(column_name), ',') INTO v_dcols
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='estimate_item_decorations'
            AND column_name <> 'id' AND v_deco ? column_name;
          EXECUTE format(
            'INSERT INTO estimate_item_decorations (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::estimate_item_decorations, $1)',
            v_dcols
          ) USING v_deco;
          v_di := v_di + 1;
        END LOOP;
      END IF;
    END LOOP;

    -- Remove items (and, via FK cascade, their decorations) whose item_index is no longer present.
    DELETE FROM estimate_items
    WHERE estimate_id = v_estimate_id AND NOT (item_index = ANY(v_keep));
  END IF;

  RETURN jsonb_build_object('estimate_id', v_estimate_id, 'item_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_estimate(jsonb, jsonb) TO anon, authenticated, service_role;

-- NOTE: the temporary band-aid trigger trg_ensure_estimate_exists (function ensure_estimate_exists) is
-- intentionally left in place by this migration. With save_estimate the estimate row is always upserted
-- before its items in the same transaction, so the trigger never fires from the new path — it stays only as
-- a safety net for any client still running the old multi-call save during rollout. Drop it in a follow-up
-- once the new client is fully deployed:
--   DROP TRIGGER IF EXISTS trg_ensure_estimate_exists ON estimate_items;
--   DROP FUNCTION IF EXISTS ensure_estimate_exists();
