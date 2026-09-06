-- ship_audit_snapshots: record the invoice-corrected cost alongside the quoted one.
--
-- The audit's margin figure is computed from shipping cost recorded at label
-- time, which is a QUOTE. The carrier re-measures undeclared cartons at the hub
-- and rebills weeks later, so the quoted number is systematically optimistic —
-- 37.0% is an upper bound, not a measurement.
--
-- ship_carrier_invoices holds what was actually billed. Carrying both figures in
-- the snapshot is what lets the trend show the audit converging on the truth as
-- invoices are loaded: margin_pct is the quote-based number the business has
-- always had, margin_true_pct is the same calculation with the invoice
-- substituted wherever one exists, and the gap between them is what the
-- label-time cost was hiding.
--
-- Additive and idempotent; safe on a live database.
alter table public.ship_audit_snapshots add column if not exists cost_true_total numeric;
alter table public.ship_audit_snapshots add column if not exists margin_true_pct numeric;
alter table public.ship_audit_snapshots add column if not exists invoiced_sos integer not null default 0;

comment on column public.ship_audit_snapshots.cost_true_total is
  'Outbound cost with the carrier invoice substituted wherever one exists, else the label-time quote.';
comment on column public.ship_audit_snapshots.margin_true_pct is
  'Margin computed on cost_true_total. Equals margin_pct until carrier invoices are loaded.';
comment on column public.ship_audit_snapshots.invoiced_sos is
  'Scored orders backed by a carrier invoice. The higher this is, the more margin_true_pct is a measurement rather than a quote.';
