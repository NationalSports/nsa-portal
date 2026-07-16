-- Production HQ Pipeline tab — dismiss/resolve for "Needs manual ordering" lines.
--
-- The Auto-PO engine (00202) records every line it evaluated in
-- teamshop_auto_po_needs, including ones it could NOT route to a supplier
-- (skip_reason='no_vendor_mapping' — custom items, or an inventory_source with
-- no teamshop_auto_po_settings mapping). The Team Shop queue's Auto POs tab
-- has shown these as a flat "Needs manual ordering" list since 00202, with no
-- way to clear a line once staff ordered it by hand — it just accumulates
-- forever.
--
-- Least-schema fix: teamshop_auto_po_needs IS the natural table for this (it's
-- exactly where the unmapped rows already live — po_id is null for them by
-- construction, since a no-vendor-mapping line was never attached to a PO, so
-- there's no purchase_orders row to hang metadata off of). Adding ONE nullable
-- column here is smaller and more direct than either alternative floated when
-- this was scoped (purchase_orders metadata — doesn't apply, these rows have
-- no PO; or a teamshop_settings jsonb allowlist keyed by a composite
-- so_id/sku/size string — indirect, and duplicates the identity this table
-- already has as its primary key).
--
-- No RLS write policy is added — the write is behind the existing
-- teamshop-auto-po.js netlify function (service role, staff JWT verified),
-- the same posture as mark_submitted. This mirrors 00202's own reasoning for
-- leaving teamshop_auto_po_needs with staff SELECT only: it's a
-- server-computed audit table, not a form staff free-edit through RLS.

alter table public.teamshop_auto_po_needs add column if not exists dismissed_at timestamptz;
alter table public.teamshop_auto_po_needs add column if not exists dismissed_by text;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   alter table public.teamshop_auto_po_needs drop column if exists dismissed_at;
--   alter table public.teamshop_auto_po_needs drop column if exists dismissed_by;
