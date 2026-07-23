-- Lock the comm_rep_comp app_state key (per-rep monthly draws + employee loan
-- balances, written by the Commissions Admin Dashboard) to ADMIN reads/writes only.
--
-- Why: 00173 deliberately left app_state SELECT open to anon+authenticated because
-- the coach portal reads company_info. That means every key in the table is
-- world-readable — acceptable for branding, not for employee comp data. This
-- migration carves comm_rep_comp out of both the open read policy and the
-- staff-wide write policy, and grants it to admins alone.
--
-- All other app_state keys keep exactly their 00173 behavior:
--   read: anon + authenticated, open
--   write: active staff (is_team_member())

create or replace function public.is_admin_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.auth_id = auth.uid()
      and tm.is_active is not false
      and tm.role in ('admin','super_admin')
  );
$$;
revoke all on function public.is_admin_member() from public;
grant execute on function public.is_admin_member() to anon, authenticated;

-- Reads: everything except comm_rep_comp stays open; comm_rep_comp needs admin.
drop policy if exists app_state_read on public.app_state;
create policy app_state_read on public.app_state
  for select to anon, authenticated
  using (id <> 'comm_rep_comp' or public.is_admin_member());

-- Writes: staff for everything except comm_rep_comp; admin for comm_rep_comp.
drop policy if exists app_state_staff_write on public.app_state;
create policy app_state_staff_write on public.app_state
  for all to authenticated
  using (public.is_team_member() and (id <> 'comm_rep_comp' or public.is_admin_member()))
  with check (public.is_team_member() and (id <> 'comm_rep_comp' or public.is_admin_member()));

-- app_state_cas (00181) is SECURITY DEFINER, so it bypasses the policies above —
-- without this it would remain a staff-wide write path into comm_rep_comp.
-- Recreated identical to 00181 plus the admin gate on this one key.
create or replace function public.app_state_cas(p_key text, p_expected int, p_value text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_new int;
begin
  if not public.is_team_member() then
    raise exception 'app_state_cas: staff only';
  end if;
  if p_key = 'comm_rep_comp' and not public.is_admin_member() then
    raise exception 'app_state_cas: admin only for %', p_key;
  end if;
  update app_state
     set value = p_value, version = version + 1, updated_at = now()
   where id = p_key and version = p_expected
   returning version into v_new;
  if v_new is not null then
    return v_new;
  end if;
  if p_expected = 0 then
    -- No row yet (first save of this key): create it at version 1. on conflict do nothing
    -- keeps a concurrent creator's row; FOUND is false then and we fall through to -1.
    insert into app_state(id, value, version, updated_at)
    values (p_key, p_value, 1, now())
    on conflict (id) do nothing;
    if found then return 1; end if;
  end if;
  return -1; -- version mismatch: caller refetches the row and re-applies
end $$;
