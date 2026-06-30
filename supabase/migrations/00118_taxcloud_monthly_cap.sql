-- Hard monthly cap on TaxCloud API calls (default 100/month).
--
-- Every TaxCloud call the app makes is metered against a per-(UTC month)
-- counter. Discretionary calls — rate lookups (taxcloud-lookup) and bulk
-- refresh (taxcloud-refresh) — are DENIED once the month's budget is spent.
--
-- Invoice filing (taxcloud-capture) passes p_enforce => false: it is still
-- counted for visibility but is NEVER blocked, because dropping a legally
-- required tax filing is worse than briefly exceeding the call budget.
--
-- Cap value comes from the caller (edge fn env TAXCLOUD_MONTHLY_CAP, default
-- 100) so it can be raised without a schema change.

create table if not exists public.taxcloud_usage (
  month      date primary key,            -- first day of the UTC month
  calls      integer not null default 0,  -- TaxCloud calls consumed this month
  updated_at timestamptz not null default now()
);

comment on table public.taxcloud_usage is
  'Per-month counter of TaxCloud API calls, used to enforce the monthly plan cap.';

alter table public.taxcloud_usage enable row level security;

drop policy if exists taxcloud_usage_read on public.taxcloud_usage;
create policy taxcloud_usage_read on public.taxcloud_usage
  for select to authenticated using (true);

-- Atomically reserve p_count calls for the current month. When p_enforce is
-- true (default), the reservation is granted only if it keeps the running
-- total at or below p_cap. When p_enforce is false, the calls are always
-- recorded and granted (used by compliance-critical invoice filing).
create or replace function public.taxcloud_try_consume(
  p_count integer,
  p_cap integer,
  p_enforce boolean default true
)
returns table(granted boolean, used integer, cap integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', timezone('utc', now()))::date;
  v_used  integer;
  v_cap   integer := coalesce(p_cap, 100);
  v_n     integer := greatest(coalesce(p_count, 1), 1);
begin
  insert into public.taxcloud_usage(month, calls)
    values (v_month, 0)
    on conflict (month) do nothing;

  select calls into v_used from public.taxcloud_usage where month = v_month for update;

  if (not coalesce(p_enforce, true)) or (v_used + v_n <= v_cap) then
    update public.taxcloud_usage
      set calls = calls + v_n, updated_at = now()
      where month = v_month;
    return query select true, v_used + v_n, v_cap;
  else
    return query select false, v_used, v_cap;
  end if;
end;
$$;

revoke all on function public.taxcloud_try_consume(integer, integer, boolean) from public;
grant execute on function public.taxcloud_try_consume(integer, integer, boolean) to service_role;
