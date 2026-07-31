-- Telemetry blind spot (diagnosed 2026-07-31): forced_reauth fires at the exact moment the
-- session is dead, so the insert goes out under the anon key and the authenticated-only
-- INSERT policy rejects it — the dashboard's RLS errors on client_events were the telemetry
-- itself dying. Zero forced_reauth rows existed despite the code logging them.
-- Fix: allow anon to insert ONLY the two auth-failure events, size-capped. Whitelist is
-- hand-synced with the events dbEngine.js may emit while the session is dead
-- (src/lib/dbEngine.js _logClientEvent / _handleAuthSaveFailure) — keep in step.
create policy client_events_anon_auth_failure_insert
on public.client_events
for insert to anon
with check (
  event in ('forced_reauth','auth_save_failed')
  and coalesce(length(user_email), 0) <= 320
  and coalesce(pg_column_size(details), 0) <= 2048
);

-- Assert the change took (a migration that reports success while changing nothing is
-- worse than one that fails — FABLE_WORKING_PROCESS.md §5).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_events'
      and policyname = 'client_events_anon_auth_failure_insert'
  ) then
    raise exception 'client_events_anon_auth_failure_insert policy was not created';
  end if;
end $$;
