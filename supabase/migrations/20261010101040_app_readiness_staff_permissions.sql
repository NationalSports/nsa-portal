-- Staff cannot grant themselves roles, access, or another user's login identity.
-- Service-role team-invite/deactivate endpoints remain unaffected.
begin;
drop policy if exists team_members_staff_write on public.team_members;
create policy team_members_admin_write on public.team_members
  for all to authenticated
  using (public.is_admin_member()) with check (public.is_admin_member());
create or replace function public.get_my_profile()
returns setof public.team_members language sql stable security definer
set search_path to public, pg_catalog
as $$ select * from public.team_members where auth_id = auth.uid() and is_active is not false limit 1; $$;
revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- In-app initiation of deletion; completion is a separately audited operator workflow.
-- A recovery rollback retains this queue with client access revoked. Reapplying
-- the release must preserve pending requests rather than require dropping it.
create table if not exists public.account_deletion_requests (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null unique,
 team_member_id text not null,
 requested_at timestamptz not null default now(),
 status text not null default 'pending' check (status in ('pending','processing','completed')),
 completed_at timestamptz,
 completion_note text,
 check ((status = 'completed') = (completed_at is not null))
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.account_deletion_requests to authenticated;
create policy account_deletion_requests_own_read on public.account_deletion_requests
 for select to authenticated using (auth_user_id = (select auth.uid()) or public.is_admin_member());
-- Only server-side verified callers can insert; no client can mark deletion completed.
grant all on public.account_deletion_requests to service_role;
commit;
