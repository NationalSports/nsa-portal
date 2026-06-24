-- Replace information_schema.columns queries inside save_estimate item/decoration loops
-- with a single pg_attribute pre-fetch per table.
--
-- Old: 2 + N×2 + N×M information_schema queries per call (e.g. 22 for 5 items × 2 decos)
-- New: 3 pg_attribute queries per call (all loop queries use unnest() over in-memory arrays)
--
-- pg_attribute is a direct catalog table; information_schema joins several catalog tables.
-- Under 24 concurrent save_estimate calls this dropped ~528 heavy info_schema scans → 72
-- fast single-table lookups, resolving the CPU spike that caused PostgREST schema cache
-- timeouts and 503 errors.
--
-- Replay-safety: the migration numbering is out of order — 00128 (optimistic _version) drops
-- the legacy 2-arg save_estimate(jsonb,jsonb) and creates the 3-arg function, but 00133
-- (atomic_rpc) re-creates the 2-arg overload. Live applied them by timestamp (00133 then
-- 00128) so only the 3-arg survives, but a fresh `db reset` replays by filename (00128 then
-- 00133) and would leave the expensive 2-arg overload in place. This migration runs last, so
-- dropping the 2-arg here guarantees the optimized 3-arg is the only save_estimate after any
-- rebuild. No-op on the live DB, where the 2-arg no longer exists.
DROP FUNCTION IF EXISTS public.save_estimate(jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.save_estimate(
  p_estimate jsonb,
  p_items jsonb,
  p_base_version integer DEFAULT NULL::integer
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_estimate_id   text := p_estimate->>'id';
  v_customer_id   text := p_estimate->>'customer_id';
  v_cols          text;
  v_set           text;
  v_item          jsonb;
  v_item_full     jsonb;
  v_item_id       int;
  v_idx           int;
  v_keep          int[] := ARRAY[]::int[];
  v_icols         text;
  v_iset          text;
  v_deco          jsonb;
  v_dcols         text;
  v_di            int;
  v_count         int := 0;
  v_cur_version   int;
  v_est_all_cols  text[];
  v_item_all_cols text[];
  v_deco_all_cols text[];
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

  -- Pre-fetch column lists ONCE using pg_attribute (direct catalog, much faster than information_schema).
  -- These replace the per-item and per-decoration information_schema.columns queries.
  SELECT array_agg(attname::text ORDER BY attnum)
  INTO v_est_all_cols
  FROM pg_attribute
  WHERE attrelid = 'public.estimates'::regclass
    AND attnum > 0 AND NOT attisdropped;

  SELECT array_agg(attname::text ORDER BY attnum)
  INTO v_item_all_cols
  FROM pg_attribute
  WHERE attrelid = 'public.estimate_items'::regclass
    AND attnum > 0 AND NOT attisdropped;

  SELECT array_agg(attname::text ORDER BY attnum)
  INTO v_deco_all_cols
  FROM pg_attribute
  WHERE attrelid = 'public.estimate_item_decorations'::regclass
    AND attnum > 0 AND NOT attisdropped;

  -- ---- Upsert the estimate row (only real columns present in the payload) ----
  SELECT string_agg(quote_ident(c), ',') INTO v_cols
  FROM unnest(v_est_all_cols) c
  WHERE c <> '_version' AND p_estimate ? c;

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'ESTIMATE_PAYLOAD_EMPTY';
  END IF;

  SELECT string_agg(format('%I=EXCLUDED.%I', c, c), ',') INTO v_set
  FROM unnest(v_est_all_cols) c
  WHERE c NOT IN ('id','_version','updated_at') AND p_estimate ? c;

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

      SELECT string_agg(quote_ident(c), ',') INTO v_icols
      FROM unnest(v_item_all_cols) c
      WHERE c <> 'id' AND v_item_full ? c;

      SELECT string_agg(format('%I=EXCLUDED.%I', c, c), ',') INTO v_iset
      FROM unnest(v_item_all_cols) c
      WHERE c NOT IN ('id','estimate_id','item_index') AND v_item_full ? c;

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

          SELECT string_agg(quote_ident(c), ',') INTO v_dcols
          FROM unnest(v_deco_all_cols) c
          WHERE c <> 'id' AND v_deco ? c;

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
$function$;

-- Re-affirm execute grants so the function is callable after a fresh replay regardless of
-- which historical migration last (re)created it.
GRANT EXECUTE ON FUNCTION public.save_estimate(jsonb, jsonb, integer) TO anon, authenticated, service_role;
