-- Prevent stale or partially reconciled estimate payloads from deleting decoration rows.
--
-- New clients pass p_deco_delete_intents as {item_index:{from:n,to:n}}. Any decrease in a
-- surviving item's decoration count must exactly match one of those intents. The argument defaults
-- to NULL so older deployed clients remain compatible; for those clients only the established
-- explicit "remove last decoration" shape (zero incoming rows plus no_deco=true) is accepted.
-- Partial reductions from old clients are blocked. The check runs before the destructive DELETE and
-- inside the same transaction as the estimate save, so a rejection rolls back the parent upsert too.

DROP FUNCTION IF EXISTS public.save_estimate(jsonb, jsonb, integer, boolean);

CREATE OR REPLACE FUNCTION public.save_estimate(
  p_estimate jsonb,
  p_items jsonb,
  p_base_version integer DEFAULT NULL::integer,
  p_is_new boolean DEFAULT false,
  p_deco_delete_intents jsonb DEFAULT NULL::jsonb
)
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
  v_existing_deco_count int;
  v_incoming_deco_count int;
  v_deco_delete_intent jsonb;
BEGIN
  IF v_estimate_id IS NULL OR v_estimate_id = '' THEN
    RAISE EXCEPTION 'ESTIMATE_ID_MISSING';
  END IF;

  IF p_base_version IS NOT NULL THEN
    SELECT _version INTO v_cur_version FROM estimates WHERE id = v_estimate_id;
    IF v_cur_version IS NOT NULL AND v_cur_version > p_base_version THEN
      v_user := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', 'unknown');
      PERFORM public._log_stale_save(v_user, v_estimate_id, p_base_version, v_cur_version);
      RETURN jsonb_build_object('estimate_id', v_estimate_id, 'version', v_cur_version,
                                'item_count', 0, 'stale', true);
    END IF;
  END IF;

  IF (p_estimate ? 'customer_id') AND v_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM customers WHERE id = v_customer_id) THEN
    RAISE EXCEPTION 'CUSTOMER_MISSING';
  END IF;

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

  SELECT string_agg(quote_ident(c), ',') INTO v_cols
  FROM unnest(v_est_all_cols) c
  WHERE c <> '_version' AND p_estimate ? c;

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'ESTIMATE_PAYLOAD_EMPTY';
  END IF;

  IF p_is_new THEN
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

      SELECT count(*)::int INTO v_existing_deco_count
      FROM estimate_item_decorations
      WHERE estimate_item_id = v_item_id;
      v_incoming_deco_count := CASE
        WHEN jsonb_typeof(v_item->'decorations') = 'array' THEN jsonb_array_length(v_item->'decorations')
        ELSE 0
      END;

      IF v_incoming_deco_count < v_existing_deco_count THEN
        v_deco_delete_intent := CASE
          WHEN jsonb_typeof(p_deco_delete_intents) = 'object'
          THEN p_deco_delete_intents->(v_idx::text)
          ELSE NULL
        END;

        IF NOT (
          (p_deco_delete_intents IS NULL
           AND v_incoming_deco_count = 0
           AND coalesce((v_item->>'no_deco')::boolean, false))
          OR
          (jsonb_typeof(v_deco_delete_intent) = 'object'
           AND (v_deco_delete_intent->>'from')::int = v_existing_deco_count
           AND (v_deco_delete_intent->>'to')::int = v_incoming_deco_count)
        ) THEN
          RAISE EXCEPTION 'ESTIMATE_DECORATION_SHRINK_BLOCKED:%:%:%:%',
            v_estimate_id, v_idx, v_existing_deco_count, v_incoming_deco_count;
        END IF;
      END IF;

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

    DELETE FROM estimate_items
    WHERE estimate_id = v_estimate_id AND NOT (item_index = ANY(v_keep));
  END IF;

  SELECT _version INTO v_cur_version FROM estimates WHERE id = v_estimate_id;
  RETURN jsonb_build_object('estimate_id', v_estimate_id, 'item_count', v_count, 'version', v_cur_version);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_estimate(jsonb, jsonb, integer, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_estimate(jsonb, jsonb, integer, boolean, jsonb) TO postgres, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
