-- Limit the public app_state bootstrap to the two non-sensitive configuration
-- rows used by the coach portal. app_state contains operational history,
-- inventory state, QuickBooks configuration, payroll/job-time data, and other
-- internal blobs that must not be enumerable with the shipped anon key.
--
-- The existing app_state_staff_write FOR ALL policy remains in place. Because
-- RLS policies are permissive, it continues to grant active staff their normal
-- reads/writes while preserving 00197's admin-only comm_rep_comp rule.

alter table public.app_state enable row level security;

drop policy if exists app_state_anon_read on public.app_state;
drop policy if exists app_state_read on public.app_state;
create policy app_state_public_config_read on public.app_state
  for select to anon, authenticated
  using (id in ('company_info', 'portal_settings'));

-- Abort if a known historical always-true public policy survived under its old
-- name. This deliberately does not drop app_state_staff_write.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_state'
      and policyname in ('Allow all', 'app_state_anon_read', 'app_state_read')
  ) then
    raise exception 'app_state public-read lockdown left a broad historical policy';
  end if;
end $$;
