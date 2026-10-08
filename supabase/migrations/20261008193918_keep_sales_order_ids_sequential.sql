-- A saved test row (SO-TEST-SAVE-20261008) was counted by the old first-digit-run
-- expression. That made the next ordinary order SO-20261009 and contaminated
-- every later max-based mint. Only canonical 4-7 digit SO IDs are sequence IDs.
-- This range permits SO-9999 -> SO-10000 while excluding current date-like IDs.
do $migration$
declare
  function_row record;
  definition text;
  old_rule text := $rule$max((regexp_match(id, '(\d+)'))[1]::bigint)$rule$;
  uniform_old_rule text := $rule$max((regexp_match(id, '^SO-([0-9]+)$'))[1]::bigint)$rule$;
  new_rule text := $rule$max(substring(id from 4)::bigint) filter (where id ~ '^SO-[0-9]{4,7}$')$rule$;
begin
  for function_row in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_teamshop_sales_order',
        'create_club_sales_order',
        'create_all_school_sales_order',
        'convert_uniform_order_to_sales_order'
      )
  loop
    definition := pg_get_functiondef(function_row.oid);
    if function_row.proname = 'convert_uniform_order_to_sales_order' then
      if strpos(definition, uniform_old_rule) = 0 then
        raise exception 'Expected SO ID mint rule missing from %', function_row.proname;
      end if;
      execute replace(definition, uniform_old_rule, new_rule);
    else
      if strpos(definition, old_rule) = 0 then
        raise exception 'Expected SO ID mint rule missing from %', function_row.proname;
      end if;
      execute replace(definition, old_rule, new_rule);
    end if;
  end loop;

  -- Fail closed if an expected converter is absent rather than leaving one
  -- workflow on the old numbering rule.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('create_teamshop_sales_order','create_club_sales_order',
       'create_all_school_sales_order','convert_uniform_order_to_sales_order')) <> 4 then
    raise exception 'Expected four sales order conversion functions';
  end if;

  -- Uniform conversions use this persistent counter. Repair an already-poisoned
  -- counter, if one exists, without touching ordinary sequence values.
  update public.app_counters
  set value = greatest(1000, coalesce((
    select max(substring(id from 4)::bigint)
    from public.sales_orders
    where id ~ '^SO-[0-9]{4,7}$'
  ), 0))
  where key = 'sales_order' and value >= 10000000;
end
$migration$;
