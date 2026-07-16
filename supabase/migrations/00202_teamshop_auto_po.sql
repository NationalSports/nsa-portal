-- Team Shop auto-purchase-order engine (Phase 3) — SCHEMA ONLY.
--
-- Goal (owner): when a converted Team Shop order needs blank garments we don't
-- stock, DRAFT purchase orders to the right supplier (SanMar / S&S / Momentec)
-- are created automatically instead of a person keying them. PO creation goes
-- through the EXISTING 00193 create_purchase_order RPC (client_ref replay,
-- shared 00161 NSA number space, integer cents) — this migration adds only the
-- per-vendor settings and the needs/audit queue around it. The evaluation
-- logic lives in netlify/functions/teamshop-auto-po.js (service role), which
-- is called best-effort from the conversion flow (teamshop-checkout
-- convert_order / stripe-webhook / teamshop-po-review approve) the same way
-- create_teamshop_sales_order is.
--
-- AUTO-SUBMIT IS OFF BY DEFAULT. Nothing in this pass talks to a supplier API:
-- auto_submit_enabled=false on every seeded vendor, and POs land as 'draft'
-- for staff review in the Team Shop queue's Auto POs tab. Live submission
-- ships later behind that flag (the manual API submission path already exists:
-- OrderEditor's buildApiOrderFromPO → sanmar/ss/momentec proxies).
--
-- Idempotency (the core requirement — the same converted order can NEVER
-- double-order, no matter how many times any trigger fires):
--   1. create_purchase_order client_ref = 'tsauto:<so_id>:<vendor>' — a replay
--      returns the existing PO, never new lines (00193's unique client_ref).
--   2. teamshop_auto_po_needs rows mark an order as evaluated: the generator
--      returns replayed:true when any row exists for the so_id, so zero-need
--      orders are stable too (re-fires don't re-evaluate against newer stock).
--   3. The needs unique key (so_id, so_item_id, size) makes the row insert
--      itself replay-safe (upsert, ignore duplicates).

-- ── purchase_orders: record who marked a draft as submitted ─────────────────
-- (00193 already has submitted_at; the review tab's mark-as-submitted action
-- records who. Additive, nullable — untouched rows are unaffected.)
alter table public.purchase_orders add column if not exists submitted_by text;

-- ── Per-vendor auto-PO settings ─────────────────────────────────────────────
-- vendor is the canonical supplier name written to purchase_orders.vendor.
-- inventory_sources maps products.inventory_source (the vocabulary
-- inventory_unified uses: click/agron/ua/nike/sanmar/ss_activewear/momentec/
-- richardson) to that supplier. Sources deliberately NOT mapped here (agron,
-- richardson, manual, null) surface in the needs queue as
-- skip_reason='no_vendor_mapping' for manual ordering.
create table if not exists public.teamshop_auto_po_settings (
  vendor              text primary key,
  auto_submit_enabled boolean not null default false,  -- future live-submission gate; OFF
  inventory_sources   text[] not null default '{}',
  supplier_account    text,
  min_order_cents     bigint,        -- informational threshold (recorded in threshold_eval)
  contact_email       text,
  notes               text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Staff read + staff insert/update (mirrors 00198 teamshop_deco_rates — a
-- rep/manager can tune thresholds without an engineering ticket). No DELETE:
-- disable a vendor by emptying inventory_sources / leaving auto_submit off.
alter table public.teamshop_auto_po_settings enable row level security;
drop policy if exists teamshop_auto_po_settings_staff_read on public.teamshop_auto_po_settings;
create policy teamshop_auto_po_settings_staff_read on public.teamshop_auto_po_settings
  for select to authenticated using (public.is_team_member());
drop policy if exists teamshop_auto_po_settings_staff_insert on public.teamshop_auto_po_settings;
create policy teamshop_auto_po_settings_staff_insert on public.teamshop_auto_po_settings
  for insert to authenticated with check (public.is_team_member());
drop policy if exists teamshop_auto_po_settings_staff_update on public.teamshop_auto_po_settings;
create policy teamshop_auto_po_settings_staff_update on public.teamshop_auto_po_settings
  for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
revoke select, insert, update, delete on public.teamshop_auto_po_settings from anon;

-- Seed the three Phase-3 suppliers, auto-submit OFF. Source mapping notes:
--   * sanmar + nike        → SanMar (nike_inventory is synced FROM SanMar
--                            PromoStandards — sanmar-nike-sync-background.js);
--   * ss_activewear        → S&S Activewear;
--   * click                → adidas CLICK, ua → UA ArmourHouse. Their
--                            INVENTORY FEEDS sync from S&S warehouses
--                            (ss-ua/ss-adidas-sync-background.js), but the
--                            owner ORDERS through the brands' own channels
--                            (CLICK / ArmourHouse, ~3-week lead) — inventory
--                            data source is not the purchasing channel, so
--                            each gets its own PO vendor;
--   * momentec             → Momentec.
insert into public.teamshop_auto_po_settings (vendor, inventory_sources) values
  ('SanMar',          '{sanmar,nike}'),
  ('S&S Activewear',  '{ss_activewear}'),
  ('adidas CLICK',    '{click}'),
  ('UA ArmourHouse',  '{ua}'),
  ('Momentec',        '{momentec}')
on conflict (vendor) do nothing;

-- ── Needs / audit queue ─────────────────────────────────────────────────────
-- One row per (so_item, size) the generator evaluated — INCLUDING zero-need
-- and unmapped-vendor rows, so the presence of any row for a so_id is the
-- evaluated marker and the staff tab can show what still needs manual
-- ordering. qty_needed = max(qty_ordered - qty_on_hand, 0); on-hand is NSA's
-- own warehouse stock (product_inventory). vendor_stock_qty/vendor_synced_at
-- snapshot the supplier's stock (inventory_unified) at evaluation time —
-- informational, never subtracted (supplier stock isn't ours).
create table if not exists public.teamshop_auto_po_needs (
  id               bigserial primary key,
  so_id            text not null,
  so_item_id       int not null,
  product_id       text,
  sku              text,
  size             text not null,
  qty_ordered      int not null,
  qty_on_hand      int not null default 0,
  qty_needed       int not null,
  vendor           text,
  unit_cost_cents  bigint,                          -- integer cents (00193 convention)
  vendor_stock_qty int,
  vendor_synced_at timestamptz,
  po_id            uuid references public.purchase_orders(id),
  skip_reason      text,                            -- 'no_vendor_mapping' | 'in_stock' | null
  created_at       timestamptz default now(),
  unique (so_id, so_item_id, size)
);
create index if not exists teamshop_auto_po_needs_so_id_idx on public.teamshop_auto_po_needs (so_id);
create index if not exists teamshop_auto_po_needs_po_id_idx on public.teamshop_auto_po_needs (po_id);

-- Staff SELECT; writes come only from the service-role generator (no write
-- policy on purpose — same posture as purchase_orders in 00193).
alter table public.teamshop_auto_po_needs enable row level security;
drop policy if exists teamshop_auto_po_needs_staff_read on public.teamshop_auto_po_needs;
create policy teamshop_auto_po_needs_staff_read on public.teamshop_auto_po_needs
  for select to authenticated using (public.is_team_member());
revoke select, insert, update, delete on public.teamshop_auto_po_needs from anon;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop table if exists public.teamshop_auto_po_needs;
--   drop table if exists public.teamshop_auto_po_settings;
--   alter table public.purchase_orders drop column if exists submitted_by;
