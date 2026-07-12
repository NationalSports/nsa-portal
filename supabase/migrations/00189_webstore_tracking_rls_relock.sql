-- ═══════════════════════════════════════════════════════════════════
-- 00189 — Re-close the anon read hole on the team-store tracking tables
--
-- Migration 070 (repo root: supabase_migration_070_webstore_tracking_anon_read.sql)
-- added `for select to anon using (true)` on webstores, webstore_orders,
-- webstore_order_items and webstore_roster so the login-free coach portal
-- (/?portal=<tag>) could read store tracking. That re-exposed, table-wide,
-- what 00134 had locked down: every buyer's name, email, phone, full ship
-- address, Stripe PI id — and webstore_orders.status_token, the bearer
-- credential for the public /shop/order/<token> page and its message thread.
-- Anyone holding the shipped anon key could dump all of it in one REST call.
-- (Found by OMG_TRACKING_AUDIT_2026-07-11.md.)
--
-- Fix — same shape as webstores_public in 00134: curated SECURITY DEFINER
-- views exposing only the columns the coach portal actually renders (traced
-- through CoachPortal.js and BuildStore.js), then drop the blanket policies.
-- Deliberately excluded from the views: status_token, stripe_pi_id,
-- buyer_email, buyer_phone, label_data, notes, and the street lines of
-- ship_address (the coach card shows only name/city/state/zip).
--
-- The parent tracking pages are unaffected: OrderTrack.js and the storefront
-- order page read through the service-role webstore-checkout function.
-- webstore_roster is intentionally untouched — the coach portal writes it as
-- anon and its redesign is tracked separately (RLS_LOCKDOWN_STEP4 §2).
--
-- ⚠ ORDER OF OPERATIONS: the views are additive and safe to create any time,
-- but the DROP POLICY statements at the bottom break the old base-table reads.
-- Apply this migration only AFTER deploying the code that points
-- CoachPortal.js / BuildStore.js at the new views.
-- ═══════════════════════════════════════════════════════════════════

-- Coach portal: the stores belonging to the coach's customer(s).
-- Includes drafts (the coach sees their own submissions as "pending review");
-- archived stores are filtered client-side as before.
drop view if exists public.coach_webstores;
create view public.coach_webstores
with (security_invoker = off) as
select
  id, customer_id, name, slug, status, created_via, close_at,
  fundraise_goal, delivery_mode
from public.webstores;

grant select on public.coach_webstores to anon, authenticated;

-- Coach portal: per-store parent orders. No contact info, no token, no Stripe
-- id; ship_address reduced to the display fields the card renders.
drop view if exists public.coach_webstore_orders;
create view public.coach_webstore_orders
with (security_invoker = off) as
select
  id, store_id, so_id, created_at, status,
  omg_order_number, order_number, buyer_name,
  payment_mode, fundraise_amt, total,
  shipped_at, tracking_number, carrier, ship_method,
  case when ship_address is null then null else jsonb_build_object(
    'name',  ship_address->>'name',
    'city',  ship_address->>'city',
    'state', ship_address->>'state',
    'zip',   ship_address->>'zip'
  ) end as ship_address
from public.webstore_orders;

grant select on public.coach_webstore_orders to anon, authenticated;

-- Coach portal: line items for those orders.
drop view if exists public.coach_webstore_order_items;
create view public.coach_webstore_order_items
with (security_invoker = off) as
select
  id, order_id, name, sku, size, qty, unit_price,
  line_status, missing_qty, backorder_eta,
  player_name, player_number, is_bundle_parent
from public.webstore_order_items;

grant select on public.coach_webstore_order_items to anon, authenticated;

-- Coach store builder: template picker (BuildStore.js reads id/name of
-- template stores anonymously).
drop view if exists public.webstore_templates_public;
create view public.webstore_templates_public
with (security_invoker = off) as
select id, name
from public.webstores
where is_template = true;

grant select on public.webstore_templates_public to anon, authenticated;

-- Now close the hole. (webstore_roster_anon_read intentionally kept — see
-- header.)
drop policy if exists webstores_anon_read on public.webstores;
drop policy if exists webstore_orders_anon_read on public.webstore_orders;
drop policy if exists webstore_order_items_anon_read on public.webstore_order_items;
