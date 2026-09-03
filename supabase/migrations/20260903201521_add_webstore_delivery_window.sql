-- Per-store parent-facing production/delivery estimate. Values are deliberately
-- constrained because they are rendered directly in the public storefront.
alter table public.webstores
  add column if not exists delivery_window_weeks text not null default '4-5';

alter table public.webstores
  drop constraint if exists webstores_delivery_window_weeks_check;

alter table public.webstores
  add constraint webstores_delivery_window_weeks_check
  check (delivery_window_weeks in ('2-3', '3-4', '4-5', '5-6'));

comment on column public.webstores.delivery_window_weeks is
  'Parent-facing estimated delivery window, in weeks after the store closes.';

-- Every sales-order creation path (staff batch, automatic paid club order, and
-- retry conversion) writes webstore_id. Fill an empty expected_date centrally so
-- no application path can forget to carry the store promise into production.
create or replace function public.set_webstore_sales_order_expected_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_close_at timestamptz;
  v_window text;
begin
  if new.webstore_id is null or nullif(btrim(coalesce(new.expected_date, '')), '') is not null then
    return new;
  end if;

  select w.close_at, w.delivery_window_weeks
    into v_close_at, v_window
    from public.webstores w
   where w.id = new.webstore_id;

  if v_close_at is not null then
    new.expected_date := to_char(
      (v_close_at at time zone 'America/Los_Angeles')::date
        + (split_part(coalesce(v_window, '4-5'), '-', 2)::integer * 7),
      'YYYY-MM-DD'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_webstore_sales_order_expected_date on public.sales_orders;
create trigger trg_webstore_sales_order_expected_date
before insert or update of webstore_id on public.sales_orders
for each row execute function public.set_webstore_sales_order_expected_date();

revoke all on function public.set_webstore_sales_order_expected_date() from public;
revoke all on function public.set_webstore_sales_order_expected_date() from anon;
revoke all on function public.set_webstore_sales_order_expected_date() from authenticated;
