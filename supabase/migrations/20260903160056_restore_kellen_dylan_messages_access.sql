-- Kellen (Warehouse) and Dylan (Production Manager) use the shared Messages
-- workspace. Preserve any explicit access customization while restoring the
-- Messages page that their role defaults now include.
update public.team_members
set access = array_append(access, 'messages')
where id in (
  '00000000-0000-0000-0000-000000000050',
  '00000000-0000-0000-0000-000000000058'
)
  and access is not null
  and not ('messages' = any(access));

-- The AI Inbox exposes complete shared-mailbox content. Match the UI's stable
-- identity allowlist at the database boundary so hiding the navigation is not
-- the only protection.
create or replace function private.can_access_ai_inbox()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.auth_id = (select auth.uid())
      and tm.id = '00000000-0000-0000-0000-000000000001'
      and coalesce(tm.is_active, true)
  );
$$;

revoke all on function private.can_access_ai_inbox() from public;
grant usage on schema private to authenticated;
grant execute on function private.can_access_ai_inbox() to authenticated;

drop policy if exists ai_inbox_staff_select on public.ai_inbox_messages;
drop policy if exists ai_inbox_owner_select on public.ai_inbox_messages;
create policy ai_inbox_owner_select
  on public.ai_inbox_messages
  for select
  to authenticated
  using ((select private.can_access_ai_inbox()));

drop policy if exists ai_inbox_staff_update on public.ai_inbox_messages;
drop policy if exists ai_inbox_owner_update on public.ai_inbox_messages;
create policy ai_inbox_owner_update
  on public.ai_inbox_messages
  for update
  to authenticated
  using ((select private.can_access_ai_inbox()))
  with check ((select private.can_access_ai_inbox()));
