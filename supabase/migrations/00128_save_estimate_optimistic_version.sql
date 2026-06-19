-- Optimistic-concurrency guard for estimate saves — the durable cure for the multi-tab / realtime-echo
-- "fight" that corrupted estimates (EST-1316 sizes wiped, EST-1314 items deleted, EST-1276 customer
-- dropped / row churned). A long-open or echo-looping browser tab re-saves its stale in-memory copy on a
-- timer; because save_estimate writes whatever it's given, the stale copy clobbers a newer one.
--
-- This adds a third arg, p_base_version: the _version the client's edit was based on. The estimate row's
-- _version is bumped by the existing trigger on every UPDATE, so if the DB has already advanced past
-- p_base_version, this write is stale and is REJECTED (STALE_ESTIMATE_WRITE) instead of allowed to clobber.
-- The function also RETURNS the new version so the client can advance its base without a refetch.
--
-- Backward compatible: p_base_version DEFAULTs to NULL, and when NULL the check is skipped (old clients,
-- and the brief rollout window, behave exactly as before). The old 2-arg overload is dropped so a 2-arg
-- call resolves unambiguously to this function with the default. SECURITY INVOKER — existing RLS applies.

DROP FUNCTION IF EXISTS public.save_estimate(jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.save_estimate(p_estimate jsonb, p_items jsonb, p_base_version int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_estimate_id text := p_estimate->>'id';
  v_customer_id text := p_estimate->>'customer_id';
  v_cols        text;
  v_set         text;
  v_item        jsonb;
  v_item_full   jsonb;
  v_item_id     int;
  v_idx         int;
  v_keep        int[] := ARRAY[]::int[];
  v_icols       text;
  v_iset        text;
  v_deco        jsonb;
  v_dcols       text;
  v_di          int;
  v_count       int := 0;
  v_cur_version int;
BEGIN
  IF v_estimate_id IS NULL OR v_estimate_id = '' THEN
    RAISE EXCEPTION 'ESTIMATE_ID_MISSING';
  END IF;

  -- Optimistic concurrency: reject a write based on a stale _version (a copy older than the DB now holds)
  -- so a long-open / echo-looping tab can't silently clobber a newer save. Fail-open when no base version
  -- is supplied (older client during rollout) — behaviour is then unchanged.
  IF p_base_version IS NOT NULL THEN
    SELECT _version INTO v_cur_version FROM estimates WHERE id = v_estimate_id;
    IF v_cur_version IS NOT NULL AND v_cur_version > p_base_version THEN
      RAISE EXCEPTION 'STALE_ESTIMATE_WRITE base=% current=%', p_base_version, v_cur_version
        USING ERRCODE = '40001';
    END IF;
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

  -- Return the new _version (bumped by the BEFORE UPDATE trigger) so the client can advance its base.
  SELECT _version INTO v_cur_version FROM estimates WHERE id = v_estimate_id;
  RETURN jsonb_build_object('estimate_id', v_estimate_id, 'item_count', v_count, 'version', v_cur_version);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_estimate(jsonb, jsonb, int) TO anon, authenticated, service_role;
