-- Lock down the public webstore_* tables.
--
-- Until now every webstore_* table carried the migration-011 dev placeholder
-- ("Allow all" FOR ALL TO public USING (true) WITH CHECK (true)), which the
-- migration itself flagged as "HARDENING REQUIRED BEFORE PUBLIC LAUNCH". The
-- storefront ships the anon key to every visitor, so anyone could, straight
-- from the browser console: read every order's buyer PII, dump coupon codes,
-- and INSERT/UPDATE/DELETE any order -- e.g. forge a fully "paid" order that
-- never went through Stripe, bypassing the hardened webstore-checkout function
-- entirely.
--
-- New access model:
--   authenticated -- staff portal (signInWithPassword) and coach magic-link
--                    sessions (signInWithOtp): full access, as today.
--   service role  -- the netlify checkout/finalize/tracking functions: bypass
--                    RLS, unchanged.
--   anon          -- public storefront: NO base-table access. The reads/writes
--                    the shop needs go through SECURITY DEFINER views
--                    (webstores_public, webstore_storefront_products) and the
--                    webstore-checkout function (check_coupon, get_order,
--                    track_order, update_ship).
--
-- Note: webstore_storefront_products / webstore_product_eta stay SECURITY
-- DEFINER on purpose -- that is what lets anon read the retail catalog without
-- any base-table grant. They expose only retail-facing columns.

begin;

-- 1. Replace the blanket public policy with an authenticated-only policy on
--    every webstore_* base table. With RLS enabled and no anon policy, anon is
--    denied all base-table access.
do $$
declare t text;
begin
  foreach t in array array[
    'webstores','webstore_products','webstore_bundle_items','webstore_orders',
    'webstore_order_items','webstore_number_claims','webstore_coupons',
    'webstore_roster','webstore_shipments','webstore_transfers'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "Allow all" on public.%I;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_authenticated_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all', t);
  end loop;
end $$;

-- 2. Anon renders package (bundle) pages by reading the bundle layout directly.
--    These rows carry no PII (product_id, sku, sizes, upcharges) -- read-only.
drop policy if exists webstore_bundle_items_anon_read on public.webstore_bundle_items;
create policy webstore_bundle_items_anon_read
  on public.webstore_bundle_items for select to anon using (true);

-- 3. Trimmed public store view. The storefront previously did select('*') on
--    webstores, exposing director name/email/phone, coach contact email,
--    ShipStation config, customer/rep ids and the OMG sale code. Expose only
--    browse-safe columns. security_invoker = off (the default) -> the view runs
--    as its owner (postgres) and reads the base table without anon needing
--    base-table access.
drop view if exists public.webstores_public;
create view public.webstores_public
with (security_invoker = off) as
select
  id, slug, name, status, open_at, close_at, payment_mode, require_login,
  number_enabled, number_unique, number_min, number_max,
  fundraise_enabled, fundraise_show_parents,
  logo_url, banner_url, primary_color, accent_color, hero_blurb, theme,
  ship_home_enabled, deliver_club_enabled, delivery_mode, flat_shipping
from public.webstores
where status <> 'archived';

grant select on public.webstores_public to anon, authenticated;

commit;
