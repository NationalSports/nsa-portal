-- Workload projection: remaining units to bag in a group's READY orders —
-- the input for "this store should take ~N minutes" (learned rate × units).
-- Applied 2026-08-12 (bagging_ready_items).
create or replace function bagging_ready_items(p_kind text, p_group_id text)
returns int language sql stable as $$
  select coalesce(sum(greatest(0, coalesce(i.qty,0) - coalesce(i.bagged_qty,0)
           - case when i.short_status in ('open','backordered','refunded') then coalesce(i.short_qty,0) else 0 end)), 0)::int
    from webstore_order_items i
    join webstore_orders o on o.id = i.order_id
   where o.bagged_at is null
     and o.status not in ('pending_payment','cancelled','refunded')
     and (p_kind = 'backorders' or bagging_order_ready(o.id))
     and coalesce(i.line_status,'pending') <> 'cancelled'
     and not coalesce(i.is_bundle_parent, false)
     and case p_kind
           when 'so'         then o.so_id = p_group_id and o.backorder_of is null
           when 'store'      then o.store_id = p_group_id::uuid and o.backorder_of is null
           when 'backorders' then o.store_id = p_group_id::uuid and o.backorder_of is not null
           else false
         end
$$;
revoke execute on function bagging_ready_items(text,text) from public, anon, authenticated;
