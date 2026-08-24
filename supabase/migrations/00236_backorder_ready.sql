-- Backorder visibility + ready alerts (owner ask, 2026-08-14).
--
-- The auto-PO needs ledger (teamshop_auto_po_needs, 00202 — club-enabled in the
-- same change as this migration) already records every backordered (so_item,
-- size) with qty_needed > 0 and its linked draft/submitted PO. What was missing:
--   1. "product is expected on <date>" visibility for staff, and
--   2. an alert to the decoration team when stock lands — EVEN PARTIALLY — so
--      backordered orders get decorated and out the door fast.
--
-- Deliberately NOT new "batches": a backordered club order already has its own
-- SO/jobs; what staff need is a dashboard over the existing ledger plus a
-- push signal. The scheduled sweep (netlify/functions/backorder-ready-sweep.js)
-- computes, per open need row, how many units the house warehouse can now
-- cover (FIFO by need age within a product+size, so two orders never count the
-- same units), stamps it here, refreshes the expected date from the vendor
-- feed, and emails the decoration team the delta. These columns are
-- sweep-owned state, additive and nullable/defaulted — untouched rows behave
-- exactly as before.
--
--   ready_qty           — units of this need the warehouse can cover right now
--                         (sweep-computed; a SIGNAL, not a reservation).
--   ready_at            — first time any coverage appeared.
--   notified_ready_qty  — ready_qty as of the last decoration-team alert; the
--                         sweep alerts only on increases, so a partial arrival
--                         alerts once and the remainder alerts when it lands.
--   ready_notified_at   — when that last alert went out.
--   expected_date       — latest vendor ETA snapshot for the still-short
--                         remainder (inventory_unified future_delivery_date),
--                         refreshed by the sweep; the dashboard's "expected in"
--                         column.
alter table public.teamshop_auto_po_needs add column if not exists ready_qty          int not null default 0;
alter table public.teamshop_auto_po_needs add column if not exists ready_at           timestamptz;
alter table public.teamshop_auto_po_needs add column if not exists notified_ready_qty int not null default 0;
alter table public.teamshop_auto_po_needs add column if not exists ready_notified_at  timestamptz;
alter table public.teamshop_auto_po_needs add column if not exists expected_date      date;

-- Open-backorder scan path for the sweep + dashboard.
create index if not exists teamshop_auto_po_needs_open_idx
  on public.teamshop_auto_po_needs (product_id, size)
  where qty_needed > 0;

-- Where the decoration-team digest goes. Empty/null = dashboard-only (no
-- email) — same staff-editable singleton the auto-release switch lives on, so
-- a manager can set it without an engineering ticket.
alter table public.teamshop_settings add column if not exists backorder_alert_email text;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   alter table public.teamshop_auto_po_needs drop column if exists ready_qty;
--   alter table public.teamshop_auto_po_needs drop column if exists ready_at;
--   alter table public.teamshop_auto_po_needs drop column if exists notified_ready_qty;
--   alter table public.teamshop_auto_po_needs drop column if exists ready_notified_at;
--   alter table public.teamshop_auto_po_needs drop column if exists expected_date;
--   drop index if exists teamshop_auto_po_needs_open_idx;
--   alter table public.teamshop_settings drop column if exists backorder_alert_email;
