-- Prepaid Club / All School invoices exist at checkout. Production completion
-- is not dispatch. Close the linked SO automatically only after the existing
-- shipment reconciler has confirmed every source line and production is done.
-- Both event orders work: final shipment after packing, or packing after an
-- already recorded shipment. No invoice button, browser effect, or status drag.
alter table public.sales_orders add column if not exists at_once_fulfillment_completed_at timestamptz;

create or replace function public.complete_at_once_fulfillment()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
declare
  v_so_id text;
  v_so public.sales_orders;
  v_ready boolean := false;
begin
  v_so_id := new.so_id;
  if v_so_id is null then return new; end if;
  select * into v_so from public.sales_orders where id=v_so_id for update;
  if not found or v_so.deleted_at is not null
    or coalesce(v_so.status,'') in ('cancelled','deleted')
    or (v_so.status='complete' and v_so.at_once_fulfillment_completed_at is null) then return new; end if;
  if v_so.webstore_id is null or coalesce(v_so.source,'') <> 'webstore' then return new; end if;
  if not exists(select 1 from public.webstores s where s.id=v_so.webstore_id
    and s.org_type in ('club','all_school') and coalesce(s.source,'webstore') <> 'omg') then return new; end if;
  <<eligibility>>
  begin
  -- Refuse mixed/unknown/unpaid/refunded sources and partial dispatches.
  if not exists(select 1 from public.webstore_orders o where o.so_id=v_so_id) then exit eligibility; end if;
  if exists(select 1 from public.webstore_orders o where o.so_id=v_so_id and
    (o.store_id is distinct from v_so.webstore_id or o.shipped_at is null
      or coalesce(o.status,'') not in ('paid','batched','shipped','complete'))) then exit eligibility; end if;
  if not exists(select 1 from public.webstore_order_items i join public.webstore_orders o on o.id=i.order_id
    where o.so_id=v_so_id and not coalesce(i.is_bundle_parent,false) and i.qty>0
      and coalesce(i.line_status,'') not in ('cancelled','refunded')) then exit eligibility; end if;
  if exists(select 1 from public.webstore_order_items i join public.webstore_orders o on o.id=i.order_id
    where o.so_id=v_so_id and not coalesce(i.is_bundle_parent,false)
      and coalesce(i.line_status,'') not in ('cancelled','refunded')
      and (i.qty is null or i.qty<=0 or coalesce(i.shipped_qty,0)<i.qty)) then exit eligibility; end if;
  if exists(select 1 from public.so_jobs j where j.so_id=v_so_id
    and coalesce(j.prod_status,'') not in ('completed','shipped')) then exit eligibility; end if;
  v_ready := true;
  end eligibility;
  -- For no-decoration orders, the source shipment quantities are the proof.
  if v_ready and v_so.status is distinct from 'complete' then
    update public.sales_orders set status='complete',at_once_fulfillment_completed_at=now(),updated_at=now()::text where id=v_so_id;
  elsif not v_ready and v_so.at_once_fulfillment_completed_at is not null then
    -- Voiding/reconciling a parcel reopens only orders closed by this trigger;
    -- never undo an unrelated/manual historical close.
    update public.sales_orders set status='need_order',at_once_fulfillment_completed_at=null,updated_at=now()::text where id=v_so_id;
  end if;
  return new;
end $$;
revoke all on function public.complete_at_once_fulfillment() from public,anon,authenticated;

create trigger at_once_shipment_completion after update of shipped_at on public.webstore_orders
for each row execute function public.complete_at_once_fulfillment();
create trigger at_once_production_completion after update of prod_status on public.so_jobs
for each row
execute function public.complete_at_once_fulfillment();
