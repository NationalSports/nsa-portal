-- Deco gate for the Bagging Station: an order is baggable only when none of
-- its live lines are still in production (pending/received/in_production —
-- the stages before the job-rollup triggers advance a line to 'bagging').
-- 'on_order' does NOT block (OMG per-size receiving holds are grayed on the
-- order screen instead), and backorder child orders are exempt (their lines
-- sit at 'pending' by design; goods come from receiving, not production).
-- bagging_list_groups gains a `ready` count per card ("12 of 42 ready") and
-- hides batches with zero ready orders; bagging_next_order serves ready
-- orders only. Applied 2026-08-12 (bagging_deco_readiness).

drop function if exists bagging_list_groups();

create or replace function bagging_order_ready(p_order_id uuid)
returns boolean language sql stable as $$
  select not exists (
    select 1 from webstore_order_items i
     where i.order_id = p_order_id
       and not coalesce(i.is_bundle_parent, false)
       and coalesce(i.line_status, 'pending') in ('pending','received','in_production')
  )
$$;

create or replace function bagging_next_order(p_kind text, p_group_id text, p_actor text)
returns setof webstore_orders language plpgsql as $$
declare v_id uuid;
begin
  select o.id into v_id
    from webstore_orders o
   where o.bagged_at is null
     and o.status not in ('pending_payment','cancelled','refunded')
     and bagging_claim_is_free(o, p_actor)
     and (p_kind = 'backorders' or bagging_order_ready(o.id))
     and case p_kind
           when 'so'         then o.so_id = p_group_id and o.backorder_of is null
           when 'store'      then o.store_id = p_group_id::uuid and o.backorder_of is null
           when 'backorders' then o.store_id = p_group_id::uuid and o.backorder_of is not null
           else false
         end
   order by o.created_at
   for update of o skip locked
   limit 1;
  if v_id is null then return; end if;
  return query select * from bagging_claim_order(v_id, p_actor);
end $$;
revoke execute on function bagging_next_order(text,text,text) from public, anon, authenticated;

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
  having count(*) filter (where o.bagged_at is null and bagging_order_ready(o.id)) > 0

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
revoke execute on function bagging_order_ready(uuid) from public, anon, authenticated;

-- ── Exception aging (applied as bagging_short_at) ──────────────────────────
-- Pro pack-station convention: exceptions carry an age so problem-shelf bags
-- don't rot. bagging_short_item stamps short_at when a short is declared
-- (kept on re-declare, cleared when the short is zeroed).
alter table webstore_order_items add column if not exists short_at timestamptz;

create or replace function bagging_short_item(p_item_id uuid, p_short_qty int, p_note text, p_actor text)
returns setof webstore_order_items language plpgsql as $$
declare r webstore_order_items; v_order uuid;
begin
  select i.order_id into v_order from webstore_order_items i where i.id = p_item_id;
  if v_order is null then raise exception 'NSA_BAG_NO_ITEM'; end if;
  if not exists (select 1 from webstore_orders o where o.id = v_order and o.bagging_claimed_by = p_actor) then
    raise exception 'NSA_BAG_NOT_CLAIMED';
  end if;
  update webstore_order_items i
     set short_qty = greatest(0, least(coalesce(i.qty,0), coalesce(p_short_qty,0))),
         short_note = coalesce(p_note, i.short_note),
         short_status = case when coalesce(p_short_qty,0) > 0 then 'open' else null end,
         short_at = case when coalesce(p_short_qty,0) > 0 then coalesce(i.short_at, now()) else null end,
         short_resolved_by = null, short_resolved_at = null
   where i.id = p_item_id
  returning i.* into r;
  insert into bagging_events(order_id, item_id, actor, event, qty, note)
    values (v_order, p_item_id, p_actor, 'short', r.short_qty, p_note);
  return next r;
end $$;
revoke execute on function bagging_short_item(uuid,int,text,text) from public, anon, authenticated;
