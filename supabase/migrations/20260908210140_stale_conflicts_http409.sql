-- Business version conflicts are terminal HTTP 409 responses, not retryable
-- transaction serialization failures. PostgREST versions that retry 40001 can
-- loop inside one HTTP request and exhaust the pool before the client sees it.
-- Preserve function bodies, ownership, security mode, grants and all guards.
DO $migration$
DECLARE sig text; definition text; patched text; expected integer; actual integer;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.save_sales_order_atomic(text,text,jsonb)',
    'public.save_estimate(jsonb,jsonb,integer,boolean,jsonb,jsonb,jsonb,text)'
  ] LOOP
    definition := pg_get_functiondef(sig::regprocedure);
    expected := CASE WHEN sig LIKE '%save_sales_order_atomic%' THEN 3 ELSE 1 END;
    SELECT count(*) INTO actual FROM regexp_matches(definition,
      '(RAISE EXCEPTION ''STALE_(SO|ESTIMATE)_WRITE:[^'']*'' USING ERRCODE[[:space:]]*=[[:space:]]*)''40001''', 'gi');
    IF actual <> expected THEN
      RAISE EXCEPTION 'Expected % stale conflict sites in %, found %; review definition', expected, sig, actual;
    END IF;
    patched := regexp_replace(definition,
      '(RAISE EXCEPTION ''STALE_(SO|ESTIMATE)_WRITE:[^'']*'' USING ERRCODE[[:space:]]*=[[:space:]]*)''40001''',
      E'\\1''PT409''', 'gi');
    EXECUTE patched;
  END LOOP;
END
$migration$;

-- Non-writing regression probes. Unexpected success raises and rolls back the
-- entire migration. Existing documents are selected rather than hardcoded.
DO $verify$
DECLARE doc text; token_before text;
BEGIN
  SELECT id INTO doc FROM public.sales_orders
  WHERE id NOT IN (SELECT document_id FROM public.save_storm_quarantine) ORDER BY id LIMIT 1;
  IF doc IS NOT NULL THEN
    token_before := public.sales_order_save_token(doc);
    BEGIN
      PERFORM public.save_sales_order_atomic(doc,'stale-conflict-regression',
        jsonb_build_object('base_version',-1,'write_header',true));
      RAISE EXCEPTION 'Stale sales order unexpectedly accepted';
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      IF SQLERRM NOT LIKE 'STALE_SO_WRITE:%' THEN RAISE; END IF;
    END;
    IF public.sales_order_save_token(doc) IS DISTINCT FROM token_before THEN
      RAISE EXCEPTION 'Stale sales order changed persisted data';
    END IF;
  END IF;
  SELECT id INTO doc FROM public.estimates ORDER BY id LIMIT 1;
  IF doc IS NOT NULL THEN
    BEGIN
      PERFORM public.save_estimate(jsonb_build_object('id',doc),'[]'::jsonb,-1,false,
        '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'stale-conflict-regression');
      RAISE EXCEPTION 'Stale estimate unexpectedly accepted';
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      IF SQLERRM NOT LIKE 'STALE_ESTIMATE_WRITE:%' THEN RAISE; END IF;
    END;
  END IF;
END
$verify$;
NOTIFY pgrst, 'reload schema';
