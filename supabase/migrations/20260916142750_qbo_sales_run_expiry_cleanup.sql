-- Enforce the run-table terminal-state invariant even when a worker dies before
-- it can call finish_qbo_sales_run. This also repairs the first read-only
-- worker that was terminated by the Edge resource limit during rollout.
create function public.qbo_clear_terminal_run_lease()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'running' then
    new.lease_token := null;
    new.lease_expires_at := null;
  end if;
  return new;
end;
$$;

create trigger qbo_sales_clear_terminal_lease
before insert or update of status on public.qbo_sales_runs
for each row execute function public.qbo_clear_terminal_run_lease();

revoke all on function public.qbo_clear_terminal_run_lease() from public, anon, authenticated;
grant execute on function public.qbo_clear_terminal_run_lease() to service_role;
