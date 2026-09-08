-- Shipping cost capture — the three gaps the Sep 1 audit could not close.
--
-- 1. no_carrier_cost   — tell "we delivered it ourselves" apart from "nobody recorded it"
-- 2. ship_cartons      — standard box sizes, so dimensions get captured by picking not typing
-- 3. ship_carrier_invoices — somewhere for carrier rebills to land
--
-- Additive and idempotent; safe on a live database.

-- ═══ 1. GENUINE ZERO vs UNKNOWN ═════════════════════════════════════════════
-- _shipping_cost is 0 on 1,103 of 1,226 rows and NULL on 2, so a zero means
-- either "our own truck, no carrier cost" or "never recorded" — and the audit
-- cannot tell which. 46 warehouse_delivery and 29 rep_delivery orders carrying
-- $6,763 of shipping charge are genuinely the former. This is the same
-- unknown-versus-zero trap the handoff flags for _inbound_freight; the fix is a
-- flag that says the zero was asserted by a person.
alter table public.sales_orders add column if not exists no_carrier_cost boolean not null default false;
alter table public.sales_orders add column if not exists no_carrier_cost_reason text;
alter table public.sales_orders add column if not exists no_carrier_cost_by text;
alter table public.sales_orders add column if not exists no_carrier_cost_at timestamptz;

comment on column public.sales_orders.no_carrier_cost is
  'A person asserted this order had no carrier cost (local/rep delivery, customer pickup). '
  'Distinguishes a real zero from an unrecorded one: without it, _shipping_cost = 0 is ambiguous.';

-- ═══ 2. CARTON CATALOG ══════════════════════════════════════════════════════
-- Carriers bill on the greater of actual and dimensional weight (L*W*H / 139).
-- Only 6 of 301 recorded shipments carry dimensions, so in practice they are
-- already being dropped — and on the 6 that have them, dim weight beats actual
-- on 4, by 2.0x to 3.8x. SO-2047 (15 lb) and SO-2246 (8 lb) share a 20x15x14 box
-- and both cost exactly $39.14, which only happens if the carrier billed the
-- 30.2 lb dim weight rather than the scale.
--
-- Typing three numbers per box is why they go unrecorded. Picking a box does not.
-- Seeded from the sizes actually observed in _shipments — no invented cartons.
create table if not exists public.ship_cartons (
  id            text primary key,
  name          text not null,
  length_in     numeric not null,
  width_in      numeric not null,
  height_in     numeric not null,
  -- Dimensional weight at the standard divisor. Stored generated so a rate quote
  -- and the audit read the same number rather than each recomputing it.
  dim_weight_lb numeric generated always as (round(length_in * width_in * height_in / 139.0, 1)) stored,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

insert into public.ship_cartons (id, name, length_in, width_in, height_in, sort_order) values
  ('SM-10X6X4',  'Small — 10 x 6 x 4',   10, 6,  4,  10),
  ('SM-10X6X5',  'Small — 10 x 6 x 5',   10, 6,  5,  20),
  ('LG-21X16X10','Large — 21 x 16 x 10', 21, 16, 10, 30),
  ('LG-20X15X14','Large — 20 x 15 x 14', 20, 15, 14, 40),
  ('XL-24X15X14','X-Large — 24 x 15 x 14', 24, 15, 14, 50)
on conflict (id) do nothing;

-- ═══ 3. CARRIER INVOICES ════════════════════════════════════════════════════
-- A shipment's recorded shipping_cost is the LABEL-TIME QUOTE. Ship a carton
-- without declaring dimensions and the carrier measures it at the hub and
-- rebills the difference weeks later as an invoice adjustment. No table here
-- held carrier invoices, so those rebills landed nowhere — which means recorded
-- cost is systematically optimistic and the audit's margin is an upper bound,
-- not a measurement.
--
-- One row per carrier invoice line. tracking_number is the join back to
-- sales_orders._shipments[].tracking_number.
create table if not exists public.ship_carrier_invoices (
  id                bigserial primary key,
  carrier           text,
  invoice_number    text,
  invoice_date      date,
  tracking_number   text,
  so_id             text references public.sales_orders(id) on delete set null,
  quoted_amount     numeric,   -- what we were quoted at label time, if known
  billed_amount     numeric,   -- what the carrier actually charged
  -- billed - quoted. Positive is a rebill against us; this is the number that was
  -- invisible before this table existed.
  adjustment        numeric generated always as (coalesce(billed_amount,0) - coalesce(quoted_amount,0)) stored,
  adjustment_reason text,      -- 'dim_weight' | 'address_correction' | 'residential' | ...
  billed_weight_lb  numeric,   -- billable weight the carrier used (dim or actual)
  source            text,      -- how it got here: 'csv_import' | 'manual' | ...
  created_by        text,
  created_at        timestamptz not null default now(),
  unique (carrier, invoice_number, tracking_number)
);

create index if not exists ship_carrier_invoices_tracking_idx on public.ship_carrier_invoices (tracking_number);
create index if not exists ship_carrier_invoices_so_idx       on public.ship_carrier_invoices (so_id);
create index if not exists ship_carrier_invoices_date_idx     on public.ship_carrier_invoices (invoice_date desc);

-- ═══ RLS ════════════════════════════════════════════════════════════════════
-- Cost data is sensitive: active staff only from the browser (mirrors
-- finance_snapshots / ship_audit_snapshots). Service-role jobs bypass RLS.
-- The carton catalog is not sensitive but is staff-written.
alter table public.ship_cartons           enable row level security;
alter table public.ship_carrier_invoices  enable row level security;

drop policy if exists ship_cartons_staff_all on public.ship_cartons;
create policy ship_cartons_staff_all on public.ship_cartons for all to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));

drop policy if exists ship_carrier_invoices_staff_all on public.ship_carrier_invoices;
create policy ship_carrier_invoices_staff_all on public.ship_carrier_invoices for all to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
