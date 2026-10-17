-- Restore a customer's carried shipping balance only after the sales-order
-- removal is durable. The usage rows and balance update commit together, and
-- selecting usage by id makes retries idempotent.
create or replace function public.release_pending_shipping_for_so(p_so_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_restored integer := 0;
  v_deleted integer := 0;
begin
  if nullif(trim(p_so_id), '') is null then
    raise exception 'sales order id is required';
  end if;

  -- The client journals recovery before saving the SO. Refuse to restore any
  -- customer balance until the authoritative SO row confirms the charge is off.
  perform 1
  from public.sales_orders
  where id = p_so_id
    and pending_ship_applied is false
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'not_ready', true);
  end if;

  with target_usage as materialized (
    select id, pending_id, amount
    from public.customer_pending_shipping_usage
    where so_id = p_so_id
  ),
  amounts as (
    select pending_id, sum(amount) as amount
    from target_usage
    group by pending_id
  ),
  restored as (
    update public.customer_pending_shipping pending
    set used = greatest(0, pending.used - amounts.amount)
    from amounts
    where pending.id = amounts.pending_id
    returning pending.id
  ),
  deleted as (
    delete from public.customer_pending_shipping_usage usage
    using target_usage
    where usage.id = target_usage.id
    returning usage.id
  )
  select
    (select count(*) from restored),
    (select count(*) from deleted)
  into v_restored, v_deleted;

  return jsonb_build_object(
    'ok', true,
    'restored_rows', v_restored,
    'deleted_usage_rows', v_deleted
  );
end;
$$;

revoke all on function public.release_pending_shipping_for_so(text) from public;
grant execute on function public.release_pending_shipping_for_so(text) to authenticated;
