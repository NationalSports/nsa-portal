-- Defense in depth for the authenticated coach/staff split.
--
-- Coaches and staff both use PostgREST's `authenticated` role. Sensitive
-- webstore base tables therefore require is_team_member(); customer and coach
-- access goes through the narrowly scoped server endpoints instead.

begin;

do $$
declare
  t text;
  sensitive_tables text[] := array[
    'webstores',
    'webstore_orders',
    'webstore_order_items',
    'webstore_number_claims',
    'webstore_coupons',
    'webstore_roster',
    'webstore_shipments',
    'webstore_transfers',
    'webstore_settings'
  ];
  catalog_tables text[] := array[
    'webstore_products',
    'webstore_bundle_items'
  ];
  all_tables text[];
begin
  all_tables := sensitive_tables || catalog_tables;

  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Allow all" on public.%I', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()))',
      t || '_staff_all', t
    );
  end loop;

  -- UUID/status-token reads and writes are server-side only. Revoking the base
  -- grants means a future permissive RLS mistake still cannot expose these rows.
  foreach t in array sensitive_tables loop
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant all on public.%I to authenticated, service_role', t);
  end loop;

  -- The public package renderer needs only SELECT on these catalog tables.
  foreach t in array catalog_tables loop
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select on public.%I to anon', t);
    execute format('grant all on public.%I to authenticated, service_role', t);
  end loop;
end $$;

-- The storefront now reads only checkout_message through webstore-checkout's
-- `settings` action. Internal placement memory is no longer table-public.
drop policy if exists webstore_settings_read on public.webstore_settings;

commit;
