-- Hard monthly cap on TaxCloud API calls.
--
-- The TaxCloud plan allows a limited number of calls per month (default 100).
-- Every TaxCloud call the app makes — rate lookups (taxcloud-lookup),
-- bulk refresh (taxcloud-refresh), and invoice filing (taxcloud-capture,
-- which makes 2 calls per invoice) — must be counted against this cap so
-- we never exceed the plan limit.
--
-- This adds a per-(UTC calendar)-month counter and an atomic
-- "try to consume N calls" function. Edge functions call the function
-- before hitting TaxCloud; if the month's budget is exhausted, the call
-- is skipped and the user is warned.
--
-- Cap value is passed in by the caller (edge fn env TAXCLOUD_MONTHLY_CAP,
-- default 100) so it can be raised later without a schema change.

create table if not exists public.taxcloud_usage (
  month      date primary key,            -- first day of the UTC month
  calls      integer not null default 0,  -- TaxCloud calls consumed this month
  updated_at timestamptz not null default now()
);

comment on table public.taxcloud_usage is
  'Per-month counter of TaxCloud API calls, used to enforce the monthly plan cap.';

alter table public.taxcloud_usage enable row level security;

-- Reads are harmless (just a count) and useful for showing usage in the UI.
-- Writes happen only through the SECURITY DEFINER function below, called by
-- the service role from edge functions.
drop policy if exists taxcloud_usage_read on public.taxcloud_usage;
create policy taxcloud_usage_read on public.taxcloud_usage
  for select to authenticated using (true);

-- Atomically reserve p_count calls for the current month if doing so keeps
-- the running total at or below p_cap. Returns whether it was granted plus
-- the post-call usage and the cap in effect.
create or replace function public.taxcloud_try_consume(p_count integer, p_cap integer)
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

  -- Row lock serializes concurrent consumers so the cap can't be overrun.
  select calls into v_used from public.taxcloud_usage where month = v_month for update;

  if v_used + v_n <= v_cap then
    update public.taxcloud_usage
      set calls = calls + v_n, updated_at = now()
      where month = v_month;
    return query select true, v_used + v_n, v_cap;
  else
    return query select false, v_used, v_cap;
  end if;
end;
$$;

revoke all on function public.taxcloud_try_consume(integer, integer) from public;
grant execute on function public.taxcloud_try_consume(integer, integer) to service_role;
