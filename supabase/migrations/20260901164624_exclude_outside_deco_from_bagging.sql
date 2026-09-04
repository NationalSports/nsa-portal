-- Orders routed to an outside decorator are shipped by that decorator and
-- should never enter the in-house bagging workflow.
create or replace function public.bagging_order_live(p_order_id uuid)
returns boolean
language sql
stable
as $function$
  select exists (
    select 1
    from public.webstore_order_items i
    where i.order_id = p_order_id
      and not coalesce(i.is_bundle_parent, false)
      and coalesce(i.line_status, 'pending') <> 'cancelled'
  )
  and not exists (
    select 1
    from public.webstore_orders o
    join public.sales_orders so on so.id = o.so_id
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(so.deco_pos) = 'array' then so.deco_pos
        else '[]'::jsonb
      end
    ) as deco_po
    where o.id = p_order_id
      and lower(coalesce(deco_po ->> 'drop_ship', 'false')) in ('true', '1', 'yes')
  );
$function$;

create or replace function public.bagging_ready_items(p_kind text, p_group_id text)
returns integer
language sql
stable
as $function$
  select coalesce(sum(greatest(
    0,
    coalesce(i.qty, 0) - coalesce(i.bagged_qty, 0)
      - case
          when i.short_status in ('open', 'backordered', 'refunded') then coalesce(i.short_qty, 0)
          else 0
        end
  )), 0)::int
  from public.webstore_order_items i
  join public.webstore_orders o on o.id = i.order_id
  where o.bagged_at is null
    and o.status not in ('pending_payment', 'cancelled', 'refunded')
    and public.bagging_order_live(o.id)
    and (p_kind = 'backorders' or public.bagging_order_ready(o.id))
    and not coalesce(i.is_bundle_parent, false)
    and coalesce(i.line_status, 'pending') <> 'cancelled'
    and case p_kind
          when 'so'         then o.so_id = p_group_id and o.backorder_of is null
          when 'store'      then o.store_id = p_group_id::uuid and o.backorder_of is null
          when 'backorders' then o.store_id = p_group_id::uuid and o.backorder_of is not null
          else false
        end;
$function$;

revoke execute on function public.bagging_order_live(uuid) from public, anon, authenticated;
revoke execute on function public.bagging_ready_items(text, text) from public, anon, authenticated;
