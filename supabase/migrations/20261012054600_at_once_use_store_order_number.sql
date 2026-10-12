-- Native Club and All School operational orders use the checkout's existing,
-- globally unique store order number. Existing linked orders retain their IDs.
do $migration$
declare
  f record;
  definition text;
  start_at integer;
  end_at integer;
  marker text := $m$v_so_id := '247-' || v_num;$m$;
  replacement text := $body$
  if v_ord.order_number is null then
    raise exception 'Store order % has no order number', v_ord.id;
  end if;
  v_num := v_ord.order_number;
  v_so_id := v_ord.order_number::text;
  $body$;
begin
  for f in select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('create_club_sales_order','create_all_school_sales_order')
      and p.proargtypes='2950'::oidvector
  loop
    definition := pg_get_functiondef(f.oid);
    if position('v_so_id := v_ord.order_number::text;' in definition)>0 then continue; end if;
    start_at := position($m$perform pg_advisory_xact_lock(hashtext('nsa_at_once_247_sales_orders_id_mint'));$m$ in definition);
    end_at := position(marker in definition);
    if start_at=0 or end_at<start_at then
      raise exception 'Expected 24/7 numbering block missing from %',f.proname;
    end if;
    definition := substring(definition from 1 for start_at-1) || replacement
      || substring(definition from end_at+length(marker));
    definition := replace(definition, $m$'JOB-' || v_num$m$, $m$'JOB-STORE-' || v_num$m$);
    execute definition;
  end loop;
end
$migration$;
