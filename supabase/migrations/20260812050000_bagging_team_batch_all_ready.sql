-- Team-store batches (kind 'so', deliver-to-club) ship to ONE place, so the
-- floor packs them once, whole: the batch appears on the Bagging Station only
-- when EVERY unbagged order is through deco. OMG school sales keep per-order
-- readiness (their goods trickle in from the vendor by design); backorder
-- queues unchanged. Applied 2026-08-12 (bagging_team_batch_all_ready).
drop function if exists bagging_list_groups();
create function bagging_list_groups()
returns table(kind text, group_id text, store_id uuid, store_name text,
              total int, bagged int, ready int, open_shorts int, earliest_eta date)
language sql stable as $$
  select 'so'::text, o.so_id, w.id, w.name,
         count(*)::int,
         count(*) filter (where o.bagged_at is not null)::int,
         count(*) filter (where o.bagged_at is null and bagging_order_ready(o.id))::int,
         (select count(*)::int from webstore_order_items i
           where i.order_id in (select o2.id from webstore_orders o2 where o2.so_id = o.so_id and o2.backorder_of is null)
             and i.short_status = 'open'),
         null::date
    from webstore_orders o
    join webstores w on w.id = o.store_id
   where o.backorder_of is null and o.so_id is not null
     and o.status not in ('pending_payment','cancelled','refunded')
     and coalesce(w.source,'webstore') <> 'omg'
     and coalesce(w.org_type,'team') = 'team'
     and w.delivery_mode = 'deliver_club'
   group by o.so_id, w.id, w.name
  -- whole-batch gate: some orders still to bag, and NONE still in deco
  having count(*) filter (where o.bagged_at is null) > 0
     and count(*) filter (where o.bagged_at is null and not bagging_order_ready(o.id)) = 0

  union all
  select 'store'::text, w.id::text, w.id, w.name,
         count(*)::int,
         count(*) filter (where o.bagged_at is not null)::int,
         count(*) filter (where o.bagged_at is null and bagging_order_ready(o.id))::int,
         (select count(*)::int from webstore_order_items i
           where i.order_id in (select o2.id from webstore_orders o2 where o2.store_id = w.id and o2.backorder_of is null)
             and i.short_status = 'open'),
         null::date
    from webstore_orders o
    join webstores w on w.id = o.store_id
    join omg_stores os on os.id = 'OMG-sale_' || w.omg_sale_code
   where o.backorder_of is null
     and o.status not in ('pending_payment','cancelled','refunded')
     and w.source = 'omg'
     and os.delivery_mode = 'deliver_school'
   group by w.id, w.name
  having count(*) filter (where o.bagged_at is null and bagging_order_ready(o.id)) > 0

  union all
  select 'backorders'::text, w.id::text, w.id, w.name,
         count(*)::int,
         count(*) filter (where o.bagged_at is not null)::int,
         count(*) filter (where o.bagged_at is null)::int,
         0,
         (select min(pi.backorder_eta) from webstore_order_items ci
            join webstore_order_items pi on pi.id = ci.backorder_of_item
           where ci.order_id in (select o2.id from webstore_orders o2 where o2.store_id = w.id and o2.backorder_of is not null))
    from webstore_orders o
    join webstores w on w.id = o.store_id
   where o.backorder_of is not null
     and o.status not in ('pending_payment','cancelled','refunded')
   group by w.id, w.name
  having count(*) filter (where o.bagged_at is null) > 0
$$;
revoke execute on function bagging_list_groups() from public, anon, authenticated;
