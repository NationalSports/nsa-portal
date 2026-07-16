-- Migration 00211: DTF print auto-order lane for the Team Shop auto-PO engine.
--
-- Owner ask: DTF transfer prints should auto-batch-order once enough are pending,
-- gated the same way garment POs are (SanMar / S&S), instead of a person keying
-- each one. DTF is keyed by DECO TYPE ('dtf'), not by products.inventory_source
-- (a DTF print isn't a stocked garment with a supplier feed) — so it's a NEW LANE
-- in the existing engine, not a new inventory_source mapping.
--
-- WHY A SIBLING NEEDS TABLE (not a discriminator column on teamshop_auto_po_needs):
--   teamshop_auto_po_needs is keyed unique(so_id, so_item_id, size) and its
--   columns (so_item_id, size, qty_ordered, qty_on_hand, vendor_stock_qty) are all
--   garment-per-size facts. A DTF print need is per JOB (a decoration applied to
--   the job's units), has no so_item/size/warehouse-stock dimension, and its
--   natural key is (so_id, job_id). Shoehorning it in would need synthetic
--   so_item_id/size values AND — the real hazard — it would poison the garment
--   engine's idempotency: teamshop-auto-po.js's generateForSo treats ANY
--   teamshop_auto_po_needs row for an SO as "already evaluated → replay, order no
--   garments" (and sweep's done-set does the same). A DTF row in that table would
--   silently stop garment ordering for that SO. A sibling table touches none of
--   those money-path queries. The columns genuinely don't fit → sibling table.
--
-- teamshop_auto_po_settings gains a DTF LANE row: deco_type='dtf' (null on the
-- existing garment vendors = inventory_source lane, unchanged), plus threshold_qty
-- and max_age_days gates. The seeded DTF vendor is INERT — no contact_email,
-- auto_submit OFF, and threshold_qty/max_age_days NULL — so the lane cannot batch
-- or submit anything until staff set a threshold and (for auto-submit) an email.

-- ── DTF lane knobs on the shared settings table ─────────────────────────────
-- deco_type: null = garment/inventory_source vendor (today's behavior); 'dtf' =
--   the DTF print vendor (routed by deco_type, ignores inventory_sources).
-- threshold_qty: DTF batches when SUM(pending prints) >= this (total print COUNT;
--   gang-sheet area is a future refinement). NULL = gate off.
-- max_age_days: backstop — batch if the oldest pending need is older than this,
--   even below threshold. NULL = no backstop. Both NULL = lane inert.
alter table public.teamshop_auto_po_settings add column if not exists deco_type    text;
alter table public.teamshop_auto_po_settings add column if not exists threshold_qty int;
alter table public.teamshop_auto_po_settings add column if not exists max_age_days  int;

-- Seed ONE DTF vendor row, fully inert (no email, auto-submit off, no gates) so it
-- cannot fire until staff configure it in Production HQ → Auto-PO vendors.
insert into public.teamshop_auto_po_settings (vendor, deco_type, auto_submit_enabled)
values ('DTF Transfers', 'dtf', false)
on conflict (vendor) do nothing;

-- ── DTF print needs / batch queue ───────────────────────────────────────────
-- One row per DTF job: qty = prints needed (the job's units at record time). The
-- lifecycle status (pending → ordered → received) is the batch state; po_id links
-- the batch PO once ordered. Natural key (so_id, job_id) makes recording an
-- idempotent upsert. dismissed_* lets staff clear a need they handled by hand
-- (mirrors teamshop_auto_po_needs 00209), without deleting the audit row.
create table if not exists public.teamshop_dtf_print_needs (
  id           bigserial primary key,
  so_id        text not null,
  job_id       text not null,
  qty          int  not null,                        -- prints needed (job units at record time)
  status       text not null default 'pending',      -- 'pending' | 'ordered' | 'received'
  vendor       text,                                  -- DTF vendor name, stamped when batched
  po_id        uuid references public.purchase_orders(id),
  created_at   timestamptz not null default now(),
  ordered_at   timestamptz,
  received_at  timestamptz,
  dismissed_at timestamptz,
  dismissed_by text,
  unique (so_id, job_id)
);
create index if not exists teamshop_dtf_print_needs_status_idx on public.teamshop_dtf_print_needs (status);
create index if not exists teamshop_dtf_print_needs_po_id_idx  on public.teamshop_dtf_print_needs (po_id);

-- Staff SELECT; writes come only from the service-role sweep (no write policy —
-- same posture as teamshop_auto_po_needs / purchase_orders).
alter table public.teamshop_dtf_print_needs enable row level security;
drop policy if exists teamshop_dtf_print_needs_staff_read on public.teamshop_dtf_print_needs;
create policy teamshop_dtf_print_needs_staff_read on public.teamshop_dtf_print_needs
  for select to authenticated using (public.is_team_member());
revoke select, insert, update, delete on public.teamshop_dtf_print_needs from anon;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop table if exists public.teamshop_dtf_print_needs;
--   delete from public.teamshop_auto_po_settings where deco_type = 'dtf';
--   alter table public.teamshop_auto_po_settings drop column if exists deco_type;
--   alter table public.teamshop_auto_po_settings drop column if exists threshold_qty;
--   alter table public.teamshop_auto_po_settings drop column if exists max_age_days;
