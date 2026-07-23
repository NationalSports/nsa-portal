-- Marketing Command Center storage (portal /marketing page).
--
-- One snapshot row per source ('seo' | 'google' | 'yelp' | 'brevo') plus an
-- append-only history table. Rows are written ONLY by the service role (the
-- marketing-sync Netlify function; RLS is bypassed there) — there is no
-- client write policy on purpose. Staff read via is_team_member(), the same
-- predicate the RLS lockdown uses everywhere (00173).
--
-- The 'seo' snapshot is a verbatim copy of nsa-website's public
-- https://nationalsportsapparel.com/seo/data.json — that file (written by the
-- weekly SEO autopilot in the nsa-website repo) stays the source of truth;
-- this table is a read model for the portal UI, not a fork of the pipeline.

create table if not exists public.marketing_data (
  source      text primary key,
  data        jsonb not null,
  fetched_at  timestamptz not null default now()
);

create table if not exists public.marketing_history (
  id          bigint generated always as identity primary key,
  source      text not null,
  data        jsonb not null,
  fetched_at  timestamptz not null default now()
);

create index if not exists marketing_history_source_fetched_idx
  on public.marketing_history (source, fetched_at desc);

alter table public.marketing_data    enable row level security;
alter table public.marketing_history enable row level security;

-- Staff read; no client writes (service role only).
drop policy if exists marketing_data_staff_read on public.marketing_data;
create policy marketing_data_staff_read on public.marketing_data
  for select to authenticated using (public.is_team_member());

drop policy if exists marketing_history_staff_read on public.marketing_history;
create policy marketing_history_staff_read on public.marketing_history
  for select to authenticated using (public.is_team_member());

-- Post-condition: fail loudly if RLS didn't take (a migration that reports
-- success while changing nothing is worse than one that fails).
do $$
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'marketing_data' and rowsecurity
  ) then
    raise exception 'marketing_data exists but RLS is not enabled';
  end if;
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'marketing_history' and rowsecurity
  ) then
    raise exception 'marketing_history exists but RLS is not enabled';
  end if;
end $$;
