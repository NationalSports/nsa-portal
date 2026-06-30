-- Stop the recurring "a stale browser tab melts the database" CPU storm at the root.
--
-- BACKGROUND: save_estimate enforces optimistic concurrency — if a tab's _version is behind the DB the
-- write is rejected. Until now that rejection was `RAISE EXCEPTION 'STALE_ESTIMATE_WRITE ...'`. A browser
-- tab running JS old enough to predate the client-side stale cooldown (src/App.js _dbStaleCooldown) retries
-- that rejected save instantly, with no backoff — thousands of times per second. Each rejection is a logged
-- ERROR and an aborted transaction, so a single forgotten overnight tab pegs the database CPU past 100% and
-- buries the logs. Client-side guards cannot fix this: the offending tabs run code too old to have them.
--
-- FIX: on a stale write, RETURN a `{stale:true}` signal instead of raising. A returned result is cheap — no
-- exception, no error-log flood, no aborted transaction — so a runaway tab can no longer generate load. The
-- current client treats `stale:true` exactly as it treated the STALE_ESTIMATE_WRITE error (shows the "reload"
-- notice and backs off via the cooldown). An old looping tab reads the returned `version`, advances its base,
-- and stops re-POSTing on its own. The write is still refused — we RETURN before any upsert — so optimistic
-- concurrency, and every data-loss guard built on it, is unchanged.
--
-- Stale hits are recorded in stale_save_log (who / which estimate / how many) so a drifting tab can be
-- identified with a SELECT instead of log-spelunking. Recording is best-effort and can never break a save.

-- 1. Private recorder table. RLS on with no policies => unreachable via the API; only the definer helper writes.
CREATE UNLOGGED TABLE IF NOT EXISTS public.stale_save_log (
  k            text PRIMARY KEY,           -- user email | estimate_id
  est          text,
  usr          text,
  base_version int,
  cur_version  int,
  first_at     timestamptz NOT NULL DEFAULT now(),
  last_at      timestamptz NOT NULL DEFAULT now(),
  hits         bigint      NOT NULL DEFAULT 1
);
ALTER TABLE public.stale_save_log ENABLE ROW LEVEL SECURITY;

-- 2. Best-effort recorder. SECURITY DEFINER so save_estimate (which runs as the calling role) can record
--    without granting that role direct table access. Never raises — auditing must not break saving.
CREATE OR REPLACE FUNCTION public._log_stale_save(p_user text, p_est text, p_base int, p_cur int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.stale_save_log AS s (k, est, usr, base_version, cur_version, first_at, last_at, hits)
  VALUES (coalesce(p_user,'unknown') || '|' || p_est, p_est, coalesce(p_user,'unknown'), p_base, p_cur, now(), now(), 1)
  ON CONFLICT (k) DO UPDATE
    SET last_at = now(), cur_version = EXCLUDED.cur_version, base_version = EXCLUDED.base_version,
        hits = s.hits + 1;
EXCEPTION WHEN OTHERS THEN
  NULL; -- recording is best-effort; a failure here must never block a save
END;
$$;
REVOKE ALL ON FUNCTION public._log_stale_save(text,text,int,int) FROM public;
GRANT EXECUTE ON FUNCTION public._log_stale_save(text,text,int,int) TO authenticated, anon;

-- 3. save_estimate: stale write now RETURNS a signal instead of RAISEing. The body is otherwise byte-for-byte
--    the prior version — same optimistic-concurrency check, parent guard, column pre-fetch and atomic upserts.
CREATE OR REPLACE FUNCTION public.save_estimate(p_estimate jsonb, p_items jsonb, p_base_version integer DEFAULT NULL::integer)
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
