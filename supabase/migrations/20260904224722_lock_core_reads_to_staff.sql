-- Close direct public reads of the core order book after portal-data is live.
-- Staff keep their current direct access through is_team_member(); public coach
-- traffic is served by the family-scoped Netlify gateway using service_role.

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'customers','customer_contacts','customer_credits','customer_credit_usage',
    'customer_promo_periods','customer_promo_programs','customer_promo_usage',
    'estimates','estimate_items','estimate_art_files','estimate_item_decorations',
    'sales_orders','so_items','so_jobs','so_art_files','so_item_decorations',
    'so_item_pick_lines','so_item_po_lines','so_firm_dates',
    'invoices','invoice_items','invoice_payments'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception 'core read lockdown: required table public.% is missing', t;
    end if;

    execute format('alter table public.%I enable row level security', t);
    -- Policy names changed several times. Remove the actual live set rather than
    -- assuming migration 00174 is the only history applied in production.
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;

    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()))',
      t || '_staff_all', t
    );

    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- search_customers returns alpha_tag and customer metadata and was explicitly
-- executable by anon. Table RLS would currently suppress its rows because it is
-- security-invoker, but revoke the route as defense in depth and to keep it from
-- silently reopening if its function security changes later.
revoke all on function public.search_customers(text, text, boolean, integer, integer) from public, anon;
grant execute on function public.search_customers(text, text, boolean, integer, integer) to authenticated, service_role;

-- Fail the migration if an anonymous table grant or policy survived.
do $$
declare
  exposed text;
  t text;
begin
  foreach t in array array[
      'customers','customer_contacts','customer_credits','customer_credit_usage',
      'customer_promo_periods','customer_promo_programs','customer_promo_usage',
      'estimates','estimate_items','estimate_art_files','estimate_item_decorations',
      'sales_orders','so_items','so_jobs','so_art_files','so_item_decorations',
      'so_item_pick_lines','so_item_po_lines','so_firm_dates',
      'invoices','invoice_items','invoice_payments'
  ] loop
    if has_table_privilege('anon', format('public.%I', t), 'SELECT') then
      raise exception 'core read lockdown left effective anon SELECT on public.%', t;
    end if;
  end loop;

  select string_agg(tablename || ':' || policyname, ', ' order by tablename, policyname) into exposed
  from pg_policies
  where schemaname = 'public'
    and tablename = any(array[
      'customers','customer_contacts','customer_credits','customer_credit_usage',
      'customer_promo_periods','customer_promo_programs','customer_promo_usage',
      'estimates','estimate_items','estimate_art_files','estimate_item_decorations',
      'sales_orders','so_items','so_jobs','so_art_files','so_item_decorations',
      'so_item_pick_lines','so_item_po_lines','so_firm_dates',
      'invoices','invoice_items','invoice_payments'
    ])
    and ('anon' = any(roles) or 'public' = any(roles));
  if exposed is not null then
    raise exception 'core read lockdown left public RLS policy/policies: %', exposed;
  end if;
end $$;
