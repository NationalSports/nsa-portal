-- 00175 — RLS lockdown step 3: lock coach/authenticated write surface (audit #2/#4)
--
-- Context from live-verified analysis (see RLS_MATRIX_TODO.md) and an adversarial
-- review of an earlier draft of this file:
--   * The core order book (customers/estimates/sales_orders/invoices/so_*/messages)
--     is ALREADY staff-locked on production — untouched here.
--   * These 24 tables still had a permissive write policy (ALL/INSERT/UPDATE/DELETE
--     with USING(true)/WITH CHECK(true) for `authenticated`), so any magic-link coach
--     — who shares the `authenticated` role — could write them.
--   * The ONLY magic-link-coach client (supabaseCoach, used solely in
--     src/storefront/AdidasInventory.js) writes only coach_saved_orders and
--     coach_favorite_items (already coach-scoped, NOT touched here). The public
--     storefront writes nothing directly; webstore checkout and vendor sync run as
--     the service role, which BYPASSES RLS. Verified: no non-staff writer to any of
--     these 24 tables, so locking writes to is_team_member() breaks no write path.
--
-- READ PRESERVATION (the subtle part a review caught): a `FOR ALL USING(true)` policy
-- was ALSO serving as the `authenticated`-role READ grant. Every one of these tables'
-- separate read policies is scoped to {anon} (or {public}) only — none to {authenticated}
-- specifically — so simply dropping the ALL policy would strip read from signed-in coaches.
-- The only authenticated-non-staff reader is the coach catalog, which reads exactly
-- `products` and `product_inventory`. We therefore restore an explicit authenticated
-- SELECT on just those two tables. All other reads are served by surviving {anon}/{public}
-- SELECT policies (used by the anon storefront) or by staff via the staff_write ALL policy;
-- coaches losing read on the other 22 internal/admin tables is intended (they never read them).
--
-- Deferred (NOT here — need product decisions, see RLS_MATRIX_TODO.md): roster_* anon portal
-- (#11), catalog_order_requests / quote_* public paths, coach_hire_leads, uniform_*,
-- adidas_inventory anon sync, coach-invite.js app-side guard (#3), and a separate READ-
-- hardening pass (several internal tables still allow anon SELECT).

begin;

do $$
declare
  t text;
  p record;
  staff_tables text[] := array[
    'products','product_inventory','vendors','deco_vendors','deco_vendor_pricing',
    'issues','assigned_todos','dismissed_todos','dismissed_notifs','todo_comments',
    'rep_csr_assignments','omg_stores','omg_store_products',
    'webstore_orders','webstore_order_items','webstore_products','webstores',
    'webstore_coupons','webstore_bundle_items','webstore_shipments','webstore_transfers',
    'webstore_settings','webstore_number_claims',
    'coach_customer_access'
  ];
begin
  foreach t in array staff_tables loop
    -- Defensive + idempotent: policies are inert unless RLS is enabled on the table.
    execute format('alter table public.%I enable row level security', t);

    -- Drop every permissive write policy (unconditional USING/CHECK). SELECT (read)
    -- policies and any scoped write policies are preserved. Verified against live
    -- pg_policies that this predicate matches every permissive write on these tables.
    for p in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and cmd <> 'SELECT'
        and coalesce(qual, 'true') = 'true'
        and coalesce(with_check, 'true') = 'true'
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    -- Staff-only write (idempotent). For an ALL policy this also grants staff their read.
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (is_team_member()) with check (is_team_member())',
      t || '_staff_write', t
    );
  end loop;
end $$;

-- Restore authenticated READ for the coach catalog. Without these, a signed-in coach
-- (role = authenticated, not staff) would get zero rows from products/product_inventory
-- and the LiveLook/adidas catalog would render empty. Anon visitors are unaffected
-- (served by products_anon_read / product_inventory_anon_read).
drop policy if exists products_auth_read on public.products;
create policy products_auth_read on public.products for select to authenticated using (true);

drop policy if exists product_inventory_auth_read on public.product_inventory;
create policy product_inventory_auth_read on public.product_inventory for select to authenticated using (true);

commit;
