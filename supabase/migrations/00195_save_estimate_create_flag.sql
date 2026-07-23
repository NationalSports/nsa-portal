-- Close the estimate-id-collision silent overwrite — APPLIED to production 2026-07-20 via MCP
-- (migration name: save_estimate_create_flag; ACL replicated: PUBLIC revoked, postgres/anon/authenticated/service_role EXECUTE).
--
-- Same class as the SO-1514 incident fixed client-side in dbEngine (_dbSaveSOInner now INSERTs
-- brand-new sales orders instead of upserting): nextEstId mints ids from _dbMaxIds, which is only
-- synced at page load, so a stale tab can re-mint an id another session already saved. save_estimate
-- upserts the estimate row with ON CONFLICT (id) DO UPDATE, so a brand-new estimate whose id collides
-- silently REPLACES the existing estimate's row (and then replaces its items) — no error, no trace.
--
-- Fix: a new p_is_new flag (default false — existing callers keep exact current behavior). When the
-- client marks the save as a CREATE, the estimate row is inserted plainly (no ON CONFLICT); a
-- duplicate id raises the distinctive ESTIMATE_ID_EXISTS, which the client handles by re-minting a
-- fresh id from the DB-wide max and retrying once (mirroring the SO-side pattern from dec9892).
--
-- The old 3-arg function is dropped first: keeping both signatures would make PostgREST's named-arg
-- dispatch ambiguous for 3-arg calls (both would match, p_is_new having a default). Old clients
-- calling with 3 named args still resolve to this function via the default.
--
-- Body is otherwise byte-for-byte 00156's (stale-signal return, catalog column pre-fetch,
-- idempotent item/decoration replacement).

DROP FUNCTION IF EXISTS public.save_estimate(jsonb, jsonb, integer);

CREATE OR REPLACE FUNCTION public.save_estimate(p_estimate jsonb, p_items jsonb, p_base_version integer DEFAULT NULL::integer, p_is_new boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_estimate_id   text := p_estimate->>'id';
  v_customer_id   text := p_estimate->>'customer_id';
  v_user          text;
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

  -- Optimistic concurrency: a write based on a stale _version (a copy older than the DB now holds) is refused
  -- so a long-open / echo-looping tab can't clobber a newer save. Instead of raising (which an out-of-date tab
  -- retries into a CPU storm), RETURN a stale signal: cheap, unloggable, non-retryable into load. The write is
  -- refused either way — we return before any upsert. Fail-open when no base version is supplied (older client).
  IF p_base_version IS NOT NULL THEN
    SELECT _version INTO v_cur_version FROM estimates WHERE id = v_estimate_id;
    IF v_cur_version IS NOT NULL AND v_cur_version > p_base_version THEN
      v_user := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', 'unknown');
      PERFORM public._log_stale_save(v_user, v_estimate_id, p_base_version, v_cur_version);
      RETURN jsonb_build_object('estimate_id', v_estimate_id, 'version', v_cur_version,
                                'item_count', 0, 'stale', true);
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

  -- ---- Write the estimate row (only real columns present in the payload) ----
  SELECT string_agg(quote_ident(c), ',') INTO v_cols
  FROM unnest(v_est_all_cols) c
  WHERE c <> '_version' AND p_estimate ? c;

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'ESTIMATE_PAYLOAD_EMPTY';
  END IF;

  IF p_is_new THEN
    -- CREATE: a brand-new estimate must never adopt an existing row. Plain INSERT — a client-minted
    -- id that collides raises ESTIMATE_ID_EXISTS instead of silently overwriting the other estimate.
    BEGIN
      EXECUTE format(
        'INSERT INTO estimates (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::estimates, $1)',
        v_cols
      ) USING p_estimate;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'ESTIMATE_ID_EXISTS:%', v_estimate_id;
    END;
  ELSE
    SELECT string_agg(format('%I=EXCLUDED.%I', c, c), ',') INTO v_set
    FROM unnest(v_est_all_cols) c
    WHERE c NOT IN ('id','_version','updated_at') AND p_estimate ? c;

    EXECUTE format(
      'INSERT INTO estimates (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::estimates, $1) %2$s',
      v_cols,
      CASE WHEN v_set IS NULL THEN 'ON CONFLICT (id) DO NOTHING'
           ELSE 'ON CONFLICT (id) DO UPDATE SET ' || v_set END
    ) USING p_estimate;
  END IF;

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
