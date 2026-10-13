-- One race-safe source for SO-#### numbers.
--
-- 2026-10-08..13: ten orders were saved as SO-20261009..SO-20261019. The client's
-- collision re-mint (dbEngine _refreshSoMaxId) read the first digit run of every
-- 'SO-%' id, so the saved test row SO-TEST-SAVE-20261008 counted as 20261008 and
-- every later re-mint climbed from there. The normal path had already been fixed
-- (20261008193918) but that re-mint path had not.
--
-- Every SO-#### mint now goes through public.mint_sales_order_number(): the
-- app_counters 'sales_order' row (already used by the uniform converter), bumped
-- under its row lock, and never below the highest canonical SO-#### in the table.
-- The greatest() keeps it safe even if some legacy path inserts a max+1 id.
-- 247-#### (Club / All School) numbering is separate and untouched.

create or replace function public.mint_sales_order_number()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v bigint;
begin
  insert into public.app_counters(key, value)
  select 'sales_order',
         greatest(coalesce(max(substring(id from 4)::bigint) filter (where id ~ '^SO-[0-9]{4,7}$'), 0), 1000) + 1
    from public.sales_orders
  on conflict (key) do update
    set value = greatest(public.app_counters.value + 1, excluded.value)
  returning value into v;
  return v;
end $function$;

revoke all on function public.mint_sales_order_number() from public, anon, authenticated;
grant execute on function public.mint_sales_order_number() to service_role;

-- Staff-facing RPC used by the portal for every SO it creates.
create or replace function public.next_sales_order_id()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_team_member() then
    raise exception 'next_sales_order_id: staff only';
  end if;
  return 'SO-' || public.mint_sales_order_number();
end $function$;

revoke all on function public.next_sales_order_id() from public, anon;
grant execute on function public.next_sales_order_id() to authenticated, service_role;

-- Route the two server-side SO converters through the same mint.
do $migration$
declare
  definition text;
  ts_old_mint text := $old$  perform pg_advisory_xact_lock(hashtext('nsa_sales_orders_id_mint'));
  select greatest(coalesce(max(substring(id from 4)::bigint) filter (where id ~ '^SO-[0-9]{4,7}$'), 0), 1000) + 1
    into v_num
    from sales_orders;$old$;
  ts_new_mint text := $new$  v_num := public.mint_sales_order_number();$new$;
  -- 20261008193918 also rewrote the invoice mint with the SO filter, so it never
  -- matches an INV- id and would always return INV-1001 (already taken).
  ts_old_inv text := $old$select greatest(coalesce(max(substring(id from 4)::bigint) filter (where id ~ '^SO-[0-9]{4,7}$'), 0), 1000) + 1 into v_inv_num from invoices;$old$;
  ts_new_inv text := $new$select greatest(coalesce(max(substring(id from 5)::bigint) filter (where id ~ '^INV-[0-9]{4,7}$'), 0), 1000) + 1 into v_inv_num from invoices;$new$;
  uni_old_mint text := $old$  insert into public.app_counters(key, value)
  select 'sales_order', coalesce(max(substring(id from 4)::bigint) filter (where id ~ '^SO-[0-9]{4,7}$'), 1000) + 1
  from public.sales_orders
  on conflict (key) do update
    set value = greatest(public.app_counters.value + 1, excluded.value)
  returning value into v_counter;$old$;
  uni_new_mint text := $new$  v_counter := public.mint_sales_order_number();$new$;
begin
  definition := pg_get_functiondef('public.create_teamshop_sales_order(uuid)'::regprocedure);
  if position(ts_new_mint in definition) = 0 then
    if position(ts_old_mint in definition) = 0 or position(ts_old_inv in definition) = 0 then
      raise exception 'Expected SO/INV mint blocks missing from create_teamshop_sales_order (so %, inv %)',
        position(ts_old_mint in definition), position(ts_old_inv in definition);
    end if;
    execute replace(replace(definition, ts_old_mint, ts_new_mint), ts_old_inv, ts_new_inv);
  end if;

  definition := pg_get_functiondef('public.convert_uniform_order_to_sales_order(uuid,text,text)'::regprocedure);
  if position(uni_new_mint in definition) = 0 then
    if position(uni_old_mint in definition) = 0 then
      raise exception 'Expected SO mint block missing from convert_uniform_order_to_sales_order';
    end if;
    execute replace(definition, uni_old_mint, uni_new_mint);
  end if;
end
$migration$;

-- Seed the counter now so the first portal mint doesn't depend on the lazy insert.
insert into public.app_counters(key, value)
select 'sales_order', greatest(coalesce(max(substring(id from 4)::bigint) filter (where id ~ '^SO-[0-9]{4,7}$'), 0), 1000)
  from public.sales_orders
on conflict (key) do update
  set value = greatest(public.app_counters.value, excluded.value);
