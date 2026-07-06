-- 00175 — RLS lockdown step 3: lock coach/authenticated write surface (audit #2/#3/#4/#11)
--
-- Context from live-verified analysis (see RLS_MATRIX_TODO.md):
--   * The core order book (customers/estimates/sales_orders/invoices/so_*/messages)
--     is ALREADY staff-locked on production — untouched here.
--   * These remaining tables still had a permissive write policy
--     (ALL/INSERT/UPDATE/DELETE with USING(true)/WITH CHECK(true) for `authenticated`),
--     so any magic-link coach — who shares the `authenticated` role — could write them.
--   * Confirmed via source that the ONLY tables a real magic-link coach client
--     (supabaseCoach, used only in src/storefront/AdidasInventory.js) writes are
--     coach_saved_orders and coach_favorite_items, which are ALREADY correctly
--     coach-scoped (coach_accounts join) — so they are NOT touched here.
--   * The public storefront (Storefront.js) writes nothing directly; webstore
--     checkout and vendor sync run as the service role, which BYPASSES RLS — so
--     locking client writes to staff does not affect those paths.
--
-- Transform (per table): drop the permissive write policy, ADD a staff-only write
-- (is_team_member()), and LEAVE ALL EXISTING READ POLICIES UNCHANGED so coach/anon
-- catalog reads keep working. Reads are never modified by this migration.
--
-- Deferred (NOT in this migration — need product decisions, see RLS_MATRIX_TODO.md):
--   * roster_* family (#11) — anon-writable public portal with NO DB identity;
--     needs a capability-token or service-role redesign, not a policy predicate.
--   * catalog_order_requests (portal UPDATE) and quote_request_items / quote_requests
--     (public/coach INSERT paths) — may have legitimate non-staff writers.
--   * coach-invite.js hardening (#3) is an application-code change, handled separately.
--   * adidas_inventory anon write (COWORK sync) — move sync to service role first.

begin;

-- Tables whose writes should be STAFF-ONLY. Drop every permissive (true/true)
-- non-SELECT policy on each, then add a single is_team_member() write policy.
-- Read policies are deliberately left intact.
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
    -- Drop any permissive write policy that grants unconditional access.
    -- Only non-SELECT policies whose USING/CHECK are effectively `true` are removed;
    -- scoped policies and SELECT (read) policies are preserved.
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

    -- Add the staff-only write policy (idempotent).
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (is_team_member()) with check (is_team_member())',
      t || '_staff_write', t
    );
  end loop;
end $$;

-- coach_customer_access (#4): the loop above removed the self-grant ALL policy and
-- added coach_customer_access_staff_write. Only staff UI (CoachCatalogAccess.js,
-- RosterOrders.js — both the staff client) and the service-role invite function
-- touch this table, so staff-only write is correct and closes the self-escalation.
-- (Service role bypasses RLS, so coach-invite.js keeps working.)

commit;
