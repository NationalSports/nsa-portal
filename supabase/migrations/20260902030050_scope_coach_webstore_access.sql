-- Close global coach/store tracking reads. The coach portal now uses the
-- token-scoped /.netlify/functions/coach-webstore-access endpoint, which
-- resolves alpha_tag to a customer family and queries with the service role.

-- Bring production's roster schema up to the fields already used by the app.
alter table public.webstore_roster
  add column if not exists token text,
  add column if not exists ordered_at timestamptz,
  add column if not exists order_id uuid references public.webstore_orders(id) on delete set null,
  add column if not exists first_opened_at timestamptz,
  add column if not exists last_opened_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists invite_sent_at timestamptz,
  add column if not exists invite_count integer not null default 0,
  add column if not exists reminder_sent_at timestamptz;

update public.webstore_roster
set token = replace(gen_random_uuid()::text, '-', '')
where token is null;

create unique index if not exists idx_webstore_roster_token
  on public.webstore_roster(token);
create index if not exists idx_webstore_roster_store_token
  on public.webstore_roster(store_id, token);
create index if not exists idx_webstore_roster_order_id
  on public.webstore_roster(order_id);
create index if not exists idx_webstore_roster_reminder_due
  on public.webstore_roster(invite_sent_at)
  where reminder_sent_at is null and last_opened_at is null and ordered = false;

-- Views owned by postgres bypass table RLS unless security_invoker is enabled.
-- They are retained temporarily for compatibility, but no client role may use
-- them; the scoped server endpoint reads curated base-table columns instead.
revoke all on public.coach_webstores from anon, authenticated;
revoke all on public.coach_webstore_orders from anon, authenticated;
revoke all on public.coach_webstore_order_items from anon, authenticated;

-- The coach gateway owns public-portal roster access. Authenticated staff keep
-- direct access only when is_team_member() confirms a staff profile.
drop policy if exists webstore_roster_anon_read on public.webstore_roster;
drop policy if exists webstore_roster_authenticated_all on public.webstore_roster;
drop policy if exists webstore_roster_staff_all on public.webstore_roster;
create policy webstore_roster_staff_all
  on public.webstore_roster
  for all
  to authenticated
  using ((select public.is_team_member()))
  with check ((select public.is_team_member()));
revoke all on public.webstore_roster from anon;

-- Profiles are no longer world-readable. Signed-in users may read their own
-- profile; staff may read profiles needed by internal workflows.
drop policy if exists profiles_select on public.user_profiles;
drop policy if exists profiles_select_own_or_staff on public.user_profiles;
create policy profiles_select_own_or_staff
  on public.user_profiles
  for select
  to authenticated
  using (
    auth_id = (select auth.uid())
    or (select public.is_team_member())
  );
revoke all on public.user_profiles from anon;
