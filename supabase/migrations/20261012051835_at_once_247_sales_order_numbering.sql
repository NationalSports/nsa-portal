-- Native 24/7 Club and All School checkouts share the 247-#### SO namespace.
-- Ordinary Team Shop, uniform, and directly entered sales orders retain SO-####.
-- Historical sales order IDs are never rewritten.
do $migration$
declare
  function_row record;
  definition text;
  old_lock text := $old$pg_advisory_xact_lock(hashtext('nsa_sales_orders_id_mint'))$old$;
  old_max text := $old$max(substring(id from 4)::bigint) filter (where id ~ '^SO-[0-9]{4,7}$')$old$;
  old_assignment text := $old$v_so_id := 'SO-' || v_num;$old$;
  new_lock text := $new$pg_advisory_xact_lock(hashtext('nsa_at_once_247_sales_orders_id_mint'))$new$;
  new_max text := $new$max(substring(id from 5)::bigint) filter (where id ~ '^247-[0-9]{4,7}$')$new$;
  new_assignment text := $new$v_so_id := '247-' || v_num;$new$;
begin
  for function_row in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('create_club_sales_order', 'create_all_school_sales_order')
       and p.proargtypes = '2950'::oidvector -- uuid
  loop
    definition := pg_get_functiondef(function_row.oid);
    if position(new_assignment in definition) > 0 then
      continue;
    end if;
    if position(old_lock in definition) = 0
       or position(old_max in definition) = 0
       or position(old_assignment in definition) = 0 then
      raise exception 'Expected SO ID mint block missing from % (lock %, max %, assignment %)',
        function_row.proname, position(old_lock in definition), position(old_max in definition),
        position(old_assignment in definition);
    end if;
    definition := replace(definition, old_lock, new_lock);
    definition := replace(definition, old_max, new_max);
    definition := replace(definition, old_assignment, new_assignment);
    execute definition;
  end loop;

  if (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('create_club_sales_order', 'create_all_school_sales_order')
        and p.proargtypes = '2950'::oidvector) <> 2 then
    raise exception 'Expected Club and All School sales order converters';
  end if;
end
$migration$;
