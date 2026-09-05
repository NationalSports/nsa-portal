begin;
-- Display indexes change whenever a line is removed/reordered. Persist a distinct
-- line identity, scoped to its document, so a pants line never inherits a polo's
-- decoration requirements just because it moved into that polo's old slot.
alter table public.estimate_items add column line_id text not null default gen_random_uuid()::text;
alter table public.so_items add column line_id text not null default gen_random_uuid()::text;
alter table public.estimate_items add constraint estimate_items_line_identity unique(estimate_id,line_id);
-- Full SO replacement briefly has old+new generations INSIDE one transaction.
alter table public.so_items add constraint so_items_line_identity unique(so_id,line_id) deferrable initially deferred;

create or replace function public.estimate_save_token(p_estimate_id text)
returns text language sql security invoker set search_path='' as $$
select md5(jsonb_build_object(
  'header',(select to_jsonb(e) from public.estimates e where id=p_estimate_id),
  'items',(select jsonb_agg(to_jsonb(i) order by id) from public.estimate_items i where estimate_id=p_estimate_id),
  'decos',(select jsonb_agg(to_jsonb(d) order by d.id) from public.estimate_item_decorations d join public.estimate_items i on i.id=d.estimate_item_id where i.estimate_id=p_estimate_id),
  'art',(select jsonb_agg(to_jsonb(a) order by id) from public.estimate_art_files a where estimate_id=p_estimate_id)
)::text);
$$;
revoke all on function public.estimate_save_token(text) from public;
grant execute on function public.estimate_save_token(text) to anon,authenticated,service_role;

drop function public.save_estimate(jsonb,jsonb,integer,boolean,jsonb);
CREATE OR REPLACE FUNCTION public.save_estimate(
  p_estimate jsonb,
  p_items jsonb,
  p_base_version integer DEFAULT NULL::integer,
  p_is_new boolean DEFAULT false,
  p_deco_delete_intents jsonb DEFAULT NULL::jsonb,
  p_art_upserts jsonb DEFAULT NULL::jsonb,
  p_art_delete_ids jsonb DEFAULT NULL::jsonb,
  p_expected_token text DEFAULT NULL::text
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
  v_old_items jsonb; v_match_count integer; v_line_id text; v_old_index integer;
  v_legacy_key text; v_art jsonb; v_art_ids text[];
  v_request_hash text; v_result jsonb;
BEGIN
  IF v_estimate_id IS NULL OR v_estimate_id = '' THEN
    RAISE EXCEPTION 'ESTIMATE_ID_MISSING';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('estimate-save:'||v_estimate_id,0));
  IF p_expected_token IS NOT NULL THEN
    v_request_hash:=md5(p_expected_token||jsonb_build_array(p_estimate,p_items,p_base_version,p_is_new,p_deco_delete_intents,p_art_upserts,p_art_delete_ids)::text);
    SELECT result INTO v_result FROM public.document_save_receipts WHERE document_id=v_estimate_id AND request_hash=v_request_hash;
    IF FOUND THEN RETURN v_result; END IF;
  END IF;
  PERFORM 1 FROM estimates WHERE id=v_estimate_id FOR UPDATE;
  PERFORM 1 FROM estimate_items WHERE estimate_id=v_estimate_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM estimate_item_decorations WHERE estimate_item_id IN
    (SELECT id FROM estimate_items WHERE estimate_id=v_estimate_id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM estimate_art_files WHERE estimate_id=v_estimate_id ORDER BY id FOR UPDATE;
  IF p_expected_token IS NOT NULL AND public.estimate_save_token(v_estimate_id) IS DISTINCT FROM p_expected_token THEN
    RAISE EXCEPTION 'STALE_ESTIMATE_WRITE: changed during preparation' USING ERRCODE='40001';
  END IF;
  IF p_base_version IS NOT NULL THEN
    SELECT _version INTO v_cur_version FROM estimates WHERE id = v_estimate_id;
    IF v_cur_version IS NOT NULL AND (v_cur_version > p_base_version OR (p_expected_token IS NOT NULL AND v_cur_version<>p_base_version)) THEN
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
    SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) INTO v_old_items FROM estimate_items i WHERE estimate_id=v_estimate_id;
    IF jsonb_array_length(v_old_items)>0 AND jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'ESTIMATE_EMPTY_ITEMS_BLOCKED'; END IF;
    -- Free display positions inside the transaction. Real identity is line_id;
    -- temporary indexes cannot become visible or survive a rejected save.
    UPDATE estimate_items SET item_index=-id-1 WHERE estimate_id=v_estimate_id;
    IF (SELECT count(distinct (value->>'item_index')::integer) FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN
      RAISE EXCEPTION 'ESTIMATE_ITEM_INDEX_INVALID';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      v_idx := (v_item->>'item_index')::int;
      IF v_idx<0 THEN RAISE EXCEPTION 'ESTIMATE_ITEM_INDEX_INVALID'; END IF;
      v_line_id:=nullif(v_item->>'line_id','');
      IF v_line_id IS NULL THEN
        -- Compatibility for an offline draft captured before stable IDs existed.
        -- Never infer identity from the position the rep moved this garment TO.
        SELECT count(*),min(x->>'line_id') INTO v_match_count,v_line_id
        FROM jsonb_array_elements(v_old_items) x
        WHERE coalesce(x->>'sku','')=coalesce(v_item->>'sku','')
          AND coalesce(x->>'color','')=coalesce(v_item->>'color','')
          AND coalesce(x->>'product_id','')=coalesce(v_item->>'product_id','')
          AND (coalesce(v_item->>'sku',v_item->>'product_id','')<>'' OR coalesce(x->>'name','')=coalesce(v_item->>'name',''));
        IF v_match_count>1 THEN RAISE EXCEPTION 'ESTIMATE_LINE_ID_AMBIGUOUS: reload this estimate'; END IF;
        v_line_id:=coalesce(v_line_id,gen_random_uuid()::text);
      END IF;
      SELECT (x->>'item_index')::integer INTO v_old_index FROM jsonb_array_elements(v_old_items) x WHERE x->>'line_id'=v_line_id;
      v_item_full := (v_item - 'decorations') || jsonb_build_object('estimate_id', v_estimate_id, 'item_index', v_idx,'line_id',v_line_id);

      SELECT string_agg(quote_ident(c), ',') INTO v_icols
      FROM unnest(v_item_all_cols) c
      WHERE c <> 'id' AND v_item_full ? c;

      SELECT string_agg(format('%I=EXCLUDED.%I', c, c), ',') INTO v_iset
      FROM unnest(v_item_all_cols) c
      WHERE c NOT IN ('id','estimate_id','line_id') AND v_item_full ? c;

      EXECUTE format(
        'INSERT INTO estimate_items (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::estimate_items, $1) '
        'ON CONFLICT (estimate_id,line_id) DO UPDATE SET %2$s RETURNING id',
        v_icols,
        COALESCE(v_iset, 'item_index=EXCLUDED.item_index')
      ) USING v_item_full INTO v_item_id;

      IF v_item_id=ANY(v_keep) THEN RAISE EXCEPTION 'ESTIMATE_DUPLICATE_LINE_ID'; END IF;
      v_keep  := v_keep || v_item_id;
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
          THEN coalesce(p_deco_delete_intents->('line:'||v_line_id),
            p_deco_delete_intents->('garment:'||array_to_json(array[coalesce(v_item->>'sku',''),coalesce(v_item->>'color',''),coalesce(v_item->>'product_id',''),case when coalesce(v_item->>'sku','')<>'' or coalesce(v_item->>'product_id','')<>'' then '' else coalesce(v_item->>'name',v_item->>'custom_desc','') end])::text),
            case when v_old_index=v_idx then p_deco_delete_intents->(v_idx::text) else null end)
          ELSE NULL
        END;

        IF NOT coalesce((
          (p_deco_delete_intents IS NULL
           AND v_incoming_deco_count = 0
           AND coalesce((v_item->>'no_deco')::boolean, false))
          OR
          (jsonb_typeof(v_deco_delete_intent) = 'object'
           AND (v_deco_delete_intent->>'from')::int = v_existing_deco_count
           AND (v_deco_delete_intent->>'to')::int = v_incoming_deco_count)
        ),false) THEN
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
    WHERE estimate_id = v_estimate_id AND NOT (id = ANY(v_keep));
  END IF;

  IF jsonb_typeof(p_art_upserts)='array' THEN
    FOR v_art IN SELECT value FROM jsonb_array_elements(p_art_upserts) LOOP
      PERFORM public._so_save_row('estimate_art_files',v_art||jsonb_build_object('estimate_id',v_estimate_id),true);
    END LOOP;
  END IF;
  IF jsonb_typeof(p_art_delete_ids)='array' THEN
    SELECT array_agg(value) INTO v_art_ids FROM jsonb_array_elements_text(p_art_delete_ids);
    DELETE FROM estimate_art_files WHERE estimate_id=v_estimate_id AND id=ANY(v_art_ids);
    GET DIAGNOSTICS v_match_count=ROW_COUNT;
    IF v_match_count<>coalesce(cardinality(v_art_ids),0) THEN RAISE EXCEPTION 'ESTIMATE_ART_DELETE_NOT_CONFIRMED'; END IF;
  END IF;
  SELECT _version INTO v_cur_version FROM estimates WHERE id = v_estimate_id;
  v_result:=jsonb_build_object('estimate_id', v_estimate_id, 'item_count', v_count, 'version', v_cur_version,'line_ids',(SELECT jsonb_agg(jsonb_build_object('item_index',item_index,'line_id',line_id)) FROM estimate_items WHERE estimate_id=v_estimate_id));
  IF v_request_hash IS NOT NULL THEN INSERT INTO public.document_save_receipts(document_id,request_hash,result) VALUES(v_estimate_id,v_request_hash,v_result); END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_estimate(jsonb, jsonb, integer, boolean, jsonb, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_estimate(jsonb, jsonb, integer, boolean, jsonb, jsonb, jsonb, text) TO postgres, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

commit;
