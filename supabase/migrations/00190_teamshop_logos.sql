-- Team Shop logo library (Stage 3): logos a coach uploads through the Team Shop
-- storefront, one row per uploaded file. The file itself lands in the `artwork`
-- storage bucket under teamshop/<customer_id>/<uuid>.<ext>, written ONLY by the
-- service-role function netlify/functions/teamshop-art.js — 00187 made artwork
-- bucket writes staff-only, so coach browsers can never write storage directly.
--
-- Deliberately separate from customers.art_files (the staff-maintained art
-- library JSONB): the staff client save engine whole-value rewrites that column,
-- so any server-side append there would be silently clobbered. Coach uploads get
-- their own table; the Team Shop "list" action UNIONS both sources read-only.
--
-- Writes: NONE via RLS on purpose (no insert/update/delete policies) — the
-- service-role key bypasses RLS, mirroring 00189 purchase_orders.

create table if not exists public.teamshop_logos (
  id           uuid primary key default gen_random_uuid(),
  customer_id  text not null,                 -- team (customers.id) this logo belongs to
  coach_id     uuid not null,                 -- coach_accounts.id of the uploader
  name         text not null,
  url          text not null,                 -- public artwork-bucket URL
  storage_path text,                          -- server-constructed path in the artwork bucket
  file_type    text,                          -- mime type as validated at upload
  width        int,                           -- probed from PNG/JPEG headers; null when unknown
  height       int,
  deco_hint    text,                          -- optional decoration hint (e.g. 'embroidery')
  created_at   timestamptz default now()
);
create index if not exists idx_teamshop_logos_customer
  on public.teamshop_logos (customer_id, created_at desc);

alter table public.teamshop_logos enable row level security;

-- Staff SELECT — same predicate as the lockdown migrations (00173 is_team_member,
-- reused verbatim by 00189 purchase_orders_staff_read).
drop policy if exists teamshop_logos_staff_read on public.teamshop_logos;
create policy teamshop_logos_staff_read on public.teamshop_logos
  for select to authenticated using (public.is_team_member());

-- Coach SELECT — same claim rule as the coach policies in 00129/00130 (an ACTIVE
-- coach_accounts row matched by claimed auth_user_id OR the verified sign-in
-- email), extended with the 00163 coach_customer_access many-to-many so a
-- multi-club coach sees every team they've been granted (the same union
-- _coachAuth.coachHasCustomerAccess enforces server-side). coach_accounts
-- self-read RLS (00112) means the subquery only ever sees the coach's own row.
drop policy if exists teamshop_logos_coach_read on public.teamshop_logos;
create policy teamshop_logos_coach_read on public.teamshop_logos
  for select to authenticated
  using (exists (
    select 1 from public.coach_accounts ca
    where ca.status = 'active'
      and (ca.auth_user_id = auth.uid()
           or lower(ca.email) = lower(coalesce(auth.jwt()->>'email', '')))
      and (ca.customer_id = teamshop_logos.customer_id
           or exists (
             select 1 from public.coach_customer_access cca
             where cca.coach_id = ca.id
               and cca.customer_id = teamshop_logos.customer_id))
  ));

-- No INSERT/UPDATE/DELETE policies on purpose: writes go through the
-- service-role teamshop-art function only (service_role bypasses RLS) — 00189 pattern.
revoke select, insert, update, delete on public.teamshop_logos from anon;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop table if exists public.teamshop_logos;
