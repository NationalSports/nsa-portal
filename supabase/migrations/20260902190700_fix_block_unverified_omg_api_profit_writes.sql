-- Trigger records have different shapes on the monthly and daily tables. Read
-- the optional source_mode field through jsonb so the shared guard works for
-- both trigger targets.

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
