-- RLS lockdown, step 1 — staff-only WRITES on team_members / app_state / scheduled_emails.
--
-- Closes the always-true WRITE grant that let anyone with the shipped anon key (including
-- magic-link coach accounts, which share the `authenticated` role) mutate these tables, while
-- PRESERVING the reads the public surfaces genuinely depend on:
--   * The anonymous coach portal (?portal=<alpha_tag>) mounts the full app and reads team_members
--     directly as anon to render the sales-rep contact block and address approval emails, and reads
--     app_state for company branding. Those SELECTs stay open.
-- Netlify/edge functions use the service-role key and BYPASS RLS entirely, so background sync,
-- portal-action, digests, the email cron, etc. are unaffected.
--
-- scheduled_emails is an outbound queue no anonymous surface reads (verified) and was world-
-- accessible via `FOR ALL TO public` — it becomes fully staff-only.
--
-- Scope note: this deliberately does NOT touch coach_store_config or omg_rebuild_tokens (the
-- storefront reads them as anon), nor the core order tables (see the roll-out plan — those are
-- gated on giving floor/warehouse staff real logins first).

-- ── Staff predicate ─────────────────────────────────────────────────
-- A logged-in, active team member. SECURITY DEFINER so a policy ON team_members can call it without
-- re-triggering team_members' own RLS (which would recurse). STABLE + (select auth.uid()) so the
-- planner hoists it once per query (RLS initplan optimization) instead of per row.
create or replace function public.is_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.auth_id = (select auth.uid()) and coalesce(tm.is_active, true)
  );
$$;
revoke all on function public.is_team_member() from public;
grant execute on function public.is_team_member() to anon, authenticated;

-- ── team_members: reads stay open (coach portal needs rep contact); writes → staff only ──
alter table public.team_members enable row level security;
drop policy if exists "Allow all" on public.team_members;
drop policy if exists team_members_anon_read on public.team_members;
create policy team_members_read on public.team_members
  for select to anon, authenticated using (true);
create policy team_members_staff_write on public.team_members
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());

-- ── app_state: reads stay open (coach portal reads company_info); writes → staff only ──
alter table public.app_state enable row level security;
drop policy if exists "Allow all" on public.app_state;
drop policy if exists app_state_anon_read on public.app_state;
create policy app_state_read on public.app_state
  for select to anon, authenticated using (true);
create policy app_state_staff_write on public.app_state
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());

-- ── scheduled_emails: outbound queue, no anon reader — fully staff-only ──
alter table public.scheduled_emails enable row level security;
drop policy if exists "Allow all" on public.scheduled_emails;
create policy scheduled_emails_staff_all on public.scheduled_emails
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
