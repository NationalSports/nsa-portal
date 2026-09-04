\set ON_ERROR_STOP 1

do $$
declare bad bigint;
begin
  select count(*) into bad
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT'
    and table_name in ('customers','sales_orders','invoices');
  if bad <> 0 then raise exception 'S1: anon retained % core SELECT grants', bad; end if;

  if has_table_privilege('authenticated', 'public.customers', 'SELECT') is not true then
    raise exception 'S2: authenticated role lost its table grant';
  end if;
  if has_table_privilege('service_role', 'public.customers', 'SELECT') is not true then
    raise exception 'S3: service_role lost its table grant';
  end if;
  if has_table_privilege('anon', 'public.portal_access_credentials', 'SELECT') then
    raise exception 'S4: anon can read credential hashes';
  end if;
  if has_table_privilege('authenticated', 'public.portal_access_credentials', 'SELECT') then
    raise exception 'S5: ordinary authenticated users can read credential hashes';
  end if;
  if has_function_privilege('anon', 'public.search_customers(text,text,boolean,integer,integer)', 'EXECUTE') then
    raise exception 'S6: anon can still call search_customers';
  end if;

  select count(*) into bad from pg_policies
  where schemaname = 'public' and tablename = 'customers'
    and ('anon' = any(roles) or 'public' = any(roles));
  if bad <> 0 then raise exception 'S7: public customer policy survived'; end if;

  select count(*) into bad from public.portal_access_credentials
  where credential_kind = 'legacy_alpha_tag';
  if bad <> 3 then raise exception 'S8: expected 3 legacy credential hashes, got %', bad; end if;
  if exists(select 1 from public.portal_access_credentials where credential_hash in ('EAGLES','eagles')) then
    raise exception 'S9: plaintext credential stored';
  end if;
end $$;

set app.staff = 'off';
set role authenticated;
do $$ declare n bigint; begin
  select count(*) into n from public.customers;
  if n <> 0 then raise exception 'S10: nonstaff authenticated user read % customers', n; end if;
end $$;
reset role;

set app.staff = 'on';
set role authenticated;
do $$ declare n bigint; begin
  select count(*) into n from public.customers;
  if n <> 3 then raise exception 'S11: staff expected 3 customers, got %', n; end if;
end $$;
reset role;

set role service_role;
do $$ declare n bigint; begin
  select count(*) into n from public.sales_orders;
  if n <> 2 then raise exception 'S12: service_role expected 2 orders, got %', n; end if;
end $$;
reset role;

set role anon;
do $$
declare ids text[];
begin
  select array_agg(id order by id) into ids from public.app_state;
  if ids is distinct from array['company_info','portal_settings']::text[] then
    raise exception 'S13: anon app_state rows were %', ids;
  end if;
end $$;
reset role;

set app.staff = 'off';
set role authenticated;
do $$
declare ids text[];
begin
  select array_agg(id order by id) into ids from public.app_state;
  if ids is distinct from array['company_info','portal_settings']::text[] then
    raise exception 'S14: nonstaff app_state rows were %', ids;
  end if;
end $$;
reset role;

set app.staff = 'on';
set app.admin = 'off';
set role authenticated;
do $$ declare n bigint; begin
  select count(*) into n from public.app_state;
  if n <> 4 then raise exception 'S15: staff expected 4 non-comp rows, got %', n; end if;
end $$;
reset role;

set app.admin = 'on';
set role authenticated;
do $$ declare n bigint; begin
  select count(*) into n from public.app_state;
  if n <> 5 then raise exception 'S16: admin expected all 5 app_state rows, got %', n; end if;
end $$;
reset role;

select 'ALL_PORTAL_PUBLIC_SECURITY_SCENARIOS_PASSED' as result;
