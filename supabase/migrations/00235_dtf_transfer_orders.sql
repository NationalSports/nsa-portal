-- Migration 00235: DTF transfer order automation (submission → weekly batch → supplier ship).
--
-- Owner ask: sales/artists submit a DTF artwork file (.ai / hi-res PNG) with the
-- print size, quantity, and options (e.g. white outline); the portal batches the
-- queue into a weekly order laid out on a gang sheet, emails it to the DTF
-- supplier, and the supplier marks the batch shipped with tracking from a
-- token-gated vendor page (same trust model as vendor-digitizing.js).
--
-- RELATIONSHIP TO THE TEAMSHOP DTF LANE (00211 teamshop_dtf_print_needs): that lane
-- auto-counts prints for converted Team Shop jobs and batches them into a PO by
-- COUNT — it carries no artwork file, no print dimensions, and no ship-back step.
-- This is the complementary, submission-first lane for everything else (sales/art
-- requests with real artwork + sizes). Kept as sibling tables for the same reason
-- 00211 kept a sibling needs table: the columns genuinely don't fit, and touching
-- the teamshop lane's idempotency queries is the real hazard.
--
-- Write posture (same as teamshop_dtf_print_needs / purchase_orders): staff can
-- SELECT; ALL writes go through the dtf-orders Netlify function using the service
-- role (staff JWT verified there; supplier actions verified by VENDOR_DTF_TOKEN).
-- No anon access of any kind.

-- ── Weekly batches sent to the DTF supplier ─────────────────────────────────
create table if not exists public.dtf_batches (
  id              uuid primary key default gen_random_uuid(),
  batch_number    text not null unique,               -- e.g. DTF-260729 (date-keyed)
  status          text not null default 'draft',      -- 'draft' | 'sent' | 'shipped' | 'received' | 'canceled'
  built_by        text,                                -- team member id, or 'schedule'
  built_at        timestamptz not null default now(),
  sent_at         timestamptz,
  sent_to         text,                                -- supplier email the manifest went to
  sheet_width_in  numeric(6,2),                        -- roll width the layout was packed for
  layout          jsonb,                               -- { placements:[{request_id,copy,x,y,w,h,rotated}], sheet_length_in, ... }
  total_prints    int,
  total_area_sqin numeric(10,2),
  sheet_length_in numeric(8,2),
  carrier         text,
  tracking_number text,
  tracking_url    text,
  shipped_at      timestamptz,
  shipped_note    text,                                -- free text from the supplier (e.g. "2 boxes")
  received_at     timestamptz,
  received_by     text,
  canceled_at     timestamptz,
  canceled_by     text
);
create index if not exists dtf_batches_status_idx on public.dtf_batches (status);

-- ── One row per submitted transfer design ───────────────────────────────────
create table if not exists public.dtf_requests (
  id           uuid primary key default gen_random_uuid(),
  design_name  text not null,
  file_url     text not null,                          -- Cloudinary secure_url (.ai/.png/.pdf/.eps)
  file_name    text,
  preview_url  text,                                   -- raster thumb for gang-sheet preview (nullable for vector-only)
  width_in     numeric(6,2) not null check (width_in  > 0 and width_in  <= 200),
  height_in    numeric(6,2) not null check (height_in > 0 and height_in <= 200),
  qty          int not null check (qty > 0 and qty <= 10000),
  outline      boolean not null default false,         -- add white outline / halo
  notes        text,
  customer_id  text,                                   -- optional links back to order context
  so_id        text,
  job_id       text,
  status       text not null default 'queued',         -- 'queued' | 'batched' | 'shipped' | 'received' | 'canceled'
  batch_id     uuid references public.dtf_batches(id),
  submitted_by text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  canceled_at  timestamptz,
  canceled_by  text
);
create index if not exists dtf_requests_status_idx   on public.dtf_requests (status);
create index if not exists dtf_requests_batch_id_idx on public.dtf_requests (batch_id);
create index if not exists dtf_requests_so_id_idx    on public.dtf_requests (so_id);

-- ── Single-row settings (supplier + sheet geometry + automation gates) ──────
-- Default-inert like the 00211 DTF vendor seed: no supplier_email and
-- auto_send=false means the weekly sweep builds a DRAFT batch for staff review
-- but never emails anyone until staff configure the supplier in the DTF page.
create table if not exists public.dtf_settings (
  id             int primary key default 1 check (id = 1),
  supplier_name  text not null default 'DTF Supplier',
  supplier_email text,
  cc_email       text,
  notify_email   text,                                 -- gets the "batch shipped" heads-up
  sheet_width_in numeric(6,2) not null default 22,
  margin_in      numeric(4,2) not null default 0.25,
  spacing_in     numeric(4,2) not null default 0.5,
  auto_send      boolean not null default false,       -- weekly sweep emails the supplier itself
  updated_at     timestamptz not null default now(),
  updated_by     text
);
insert into public.dtf_settings (id) values (1) on conflict (id) do nothing;

-- ── RLS: staff read; service-role-only writes; nothing for anon ─────────────
alter table public.dtf_requests enable row level security;
alter table public.dtf_batches  enable row level security;
alter table public.dtf_settings enable row level security;

drop policy if exists dtf_requests_staff_read on public.dtf_requests;
create policy dtf_requests_staff_read on public.dtf_requests
  for select to authenticated using (public.is_team_member());
drop policy if exists dtf_batches_staff_read on public.dtf_batches;
create policy dtf_batches_staff_read on public.dtf_batches
  for select to authenticated using (public.is_team_member());
drop policy if exists dtf_settings_staff_read on public.dtf_settings;
create policy dtf_settings_staff_read on public.dtf_settings
  for select to authenticated using (public.is_team_member());

revoke select, insert, update, delete on public.dtf_requests from anon;
revoke select, insert, update, delete on public.dtf_batches  from anon;
revoke select, insert, update, delete on public.dtf_settings from anon;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop table if exists public.dtf_requests;
--   drop table if exists public.dtf_batches;
--   drop table if exists public.dtf_settings;
