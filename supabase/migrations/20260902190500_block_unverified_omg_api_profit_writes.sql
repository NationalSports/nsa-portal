-- OMG V1 silently ignores sale filters on orders/order_products in this account.
-- Fail closed at the database boundary so stale function deployments or queued
-- invocations cannot write cross-store accounting data. Manual monthly Margin
-- Report snapshots remain permitted.

create or replace function public.block_unverified_omg_api_profit_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'omg_store_profit_snapshots'
     and to_jsonb(new)->>'source_mode' = 'omg_api' then
    raise exception 'OMG API profit writes are disabled; import a verified monthly Margin Report snapshot';
  end if;

  if tg_table_name = 'omg_store_profit_daily_snapshots' then
    raise exception 'OMG API daily profit writes are disabled because sale-filtered costs are not verified';
  end if;

  return new;
end;
$$;

create trigger block_unverified_omg_api_monthly_write
before insert or update on public.omg_store_profit_snapshots
for each row execute function public.block_unverified_omg_api_profit_write();

create trigger block_unverified_omg_api_daily_write
before insert or update on public.omg_store_profit_daily_snapshots
for each row execute function public.block_unverified_omg_api_profit_write();

comment on function public.block_unverified_omg_api_profit_write() is
  'Fail-closed guard against unverified OMG V1 accounting writes; manual snapshots remain allowed.';
