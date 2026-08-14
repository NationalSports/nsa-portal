-- Bagging Station hardening — fixes from the end-to-end review of the feature
-- (PR #1960). Each numbered fix maps to a reviewed failure mode:
--  1. bagging_claim_order refuses already-bagged orders (claim ≠ reopen):
--     "Next order" on a stale board could re-claim a finished bag and complete
--     it again, re-sending the buyer email and buying a second ship label.
--  2. check/short refresh the claim clock, so staleness measures INACTIVITY:
--     a packer 16 minutes into a big order no longer gets the bag stolen by
--     the other tablet's 15-minute stale-claim takeover.
--  3. bagged_qty and counted short_qty are jointly clamped to qty — a tap on
--     an already-shorted line can no longer make bagged+short exceed qty
--     (which over-reported units in the buyer email and batch totals).
--  4. Short edits on a refunded line are refused (money already moved), and
--     editing a backordered short first undoes the child split (child line
--     zeroed, parent missing_qty reduced) so a corrected short can't leave
--     units that ship nowhere, or ship twice.
--  5. bagging_backorder_short reopens an already-bagged child order before
--     adding a new line to it (a late second short no longer lands on a
--     "done" child that never resurfaces), and copies product_id so child
--     labels/emails keep real weights and images.
--  6. bag_seq is assigned under a per-group advisory lock — two tablets
--     completing simultaneously can't print duplicate "Bag 7 of 30" labels.
--  7. Orders with zero live lines (everything cancelled) are invisible to
--     bagging everywhere — they could previously wedge a batch at 29/30.
--  8. Blanks-only native batches (an SO with no production jobs) auto-ready:
--     nothing ever advances their line_status past 'pending', so the deco
--     gate stranded them forever.
--  9. list_groups' open-short counts ignore dead (cancelled/refunded) orders.

-- ── 7. Live-order helper ────────────────────────────────────────────────────
create or replace function bagging_order_live(p_order_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from webstore_order_items i
     where i.order_id = p_order_id
       and not coalesce(i.is_bundle_parent, false)
       and coalesce(i.line_status, 'pending') <> 'cancelled'
  )
$$;
revoke execute on function bagging_order_live(uuid) from public, anon, authenticated;

-- ── 8. Deco gate: SO with no production jobs is ready ───────────────────────
create or replace function bagging_order_ready(p_order_id uuid)
returns boolean language sql stable as $$
  select exists (
      select 1 from webstore_orders o
       where o.id = p_order_id and o.so_id is not null
         and not exists (select 1 from so_jobs j where j.so_id = o.so_id)
    )
    or not exists (
      select 1 from webstore_order_items i
       where i.order_id = p_order_id
         and not coalesce(i.is_bundle_parent, false)
         and coalesce(i.line_status, 'pending') in ('pending','received','in_production')
    )
$$;
revoke execute on function bagging_order_ready(uuid) from public, anon, authenticated;

-- ── 1. Claim: never claim a completed bag ───────────────────────────────────
create or replace function bagging_claim_order(p_order_id uuid, p_actor text)
returns setof webstore_orders language plpgsql as $$
declare r webstore_orders;
begin
  update webstore_orders o
     set bagging_claimed_by = p_actor, bagging_claimed_at = now()
   where o.id = p_order_id
     and o.bagged_at is null
     and bagging_claim_is_free(o, p_actor)
  returning o.* into r;
  if r.id is null then
    if exists (select 1 from webstore_orders where id = p_order_id and bagged_at is not null) then
      raise exception 'NSA_BAG_ALREADY_BAGGED' using detail = 'bag already completed — reopen it instead';
    end if;
    raise exception 'NSA_BAG_CLAIMED' using detail = 'order is claimed by another packer';
  end if;
  insert into bagging_events(order_id, actor, event) values (p_order_id, p_actor, 'claim');
  return next r;
end $$;
revoke execute on function bagging_claim_order(uuid,text) from public, anon, authenticated;

-- ── 2 + 3. The tap: refresh the claim clock, joint clamp ────────────────────
create or replace function bagging_check_item(p_item_id uuid, p_qty int, p_actor text)
returns setof webstore_order_items language plpgsql as $$
declare r webstore_order_items; v_order uuid;
begin
  select i.order_id into v_order from webstore_order_items i where i.id = p_item_id;
  if v_order is null then raise exception 'NSA_BAG_NO_ITEM'; end if;
  if not exists (select 1 from webstore_orders o where o.id = v_order and o.bagging_claimed_by = p_actor) then
    raise exception 'NSA_BAG_NOT_CLAIMED' using detail = 'claim the order before checking items';
  end if;
  -- activity keeps the claim alive (staleness = inactivity, not claim age)
  update webstore_orders set bagging_claimed_at = now() where id = v_order;
  update webstore_order_items i
     set bagged_qty = greatest(0, least(
           coalesce(i.qty,0)
             - (case when i.short_status in ('open','backordered','refunded') then coalesce(i.short_qty,0) else 0 end),
           coalesce(p_qty,0)))
   where i.id = p_item_id
  returning i.* into r;
  insert into bagging_events(order_id, item_id, actor, event, qty)
    values (v_order, p_item_id, p_actor, 'check', r.bagged_qty);
  return next r;
end $$;
revoke execute on function bagging_check_item(uuid,int,text) from public, anon, authenticated;

-- ── 2 + 3 + 4. Shorts: clamp, refund lock, backorder-edit undo ──────────────
create or replace function bagging_short_item(p_item_id uuid, p_short_qty int, p_note text, p_actor text)
returns setof webstore_order_items language plpgsql as $$
declare r webstore_order_items; v_old webstore_order_items;
begin
  select i.* into v_old from webstore_order_items i where i.id = p_item_id;
  if v_old.id is null then raise exception 'NSA_BAG_NO_ITEM'; end if;
  if not exists (select 1 from webstore_orders o where o.id = v_old.order_id and o.bagging_claimed_by = p_actor) then
    raise exception 'NSA_BAG_NOT_CLAIMED';
  end if;
  update webstore_orders set bagging_claimed_at = now() where id = v_old.order_id;
  if v_old.short_status = 'refunded' then
    raise exception 'NSA_BAG_REFUND_LOCKED' using detail = 'short already refunded — money moved; adjust from the desk refund flow';
  end if;
  if v_old.short_status = 'backordered' then
    -- the follow-up already shipped this piece: the short can't be re-declared
    if exists (select 1 from webstore_order_items c join webstore_orders co on co.id = c.order_id
                where c.backorder_of_item = p_item_id and co.bagged_at is not null and coalesce(c.qty,0) > 0) then
      raise exception 'NSA_BAG_BACKORDER_DONE' using detail = 'backordered piece already shipped on the follow-up order';
    end if;
    -- undo the split: zero the child line, give the parent its qty back
    update webstore_order_items c set qty = 0 where c.backorder_of_item = p_item_id;
    update webstore_order_items i
       set missing_qty = greatest(0, coalesce(i.missing_qty,0) - coalesce(v_old.short_qty,0))
     where i.id = p_item_id;
  end if;
  update webstore_order_items i
     set short_qty = greatest(0, least(coalesce(i.qty,0) - coalesce(i.bagged_qty,0), coalesce(p_short_qty,0))),
         short_note = coalesce(p_note, i.short_note),
         short_status = case when coalesce(p_short_qty,0) > 0 then 'open' else null end,
         short_at = case when coalesce(p_short_qty,0) > 0 then coalesce(i.short_at, now()) else null end,
         short_resolved_by = null, short_resolved_at = null
   where i.id = p_item_id
  returning i.* into r;
  insert into bagging_events(order_id, item_id, actor, event, qty, note)
    values (v_old.order_id, p_item_id, p_actor, 'short', r.short_qty, p_note);
  return next r;
end $$;
revoke execute on function bagging_short_item(uuid,int,text,text) from public, anon, authenticated;

-- ── 6. Complete: bag_seq under a per-group advisory lock ────────────────────
create or replace function bagging_complete_order(p_order_id uuid, p_actor text)
returns setof webstore_orders language plpgsql as $$
declare r webstore_orders; me webstore_orders; v_open int; v_seq int; v_key text;
begin
  select o.* into me from webstore_orders o where o.id = p_order_id;
  if me.id is null or me.bagging_claimed_by is distinct from p_actor then
    raise exception 'NSA_BAG_NOT_CLAIMED';
  end if;
  select count(*) into v_open
    from webstore_order_items i
   where i.order_id = p_order_id and not bagging_line_satisfied(i);
  if v_open > 0 then
    raise exception 'NSA_BAG_INCOMPLETE' using detail = v_open || ' line(s) not yet bagged or shorted';
  end if;
  v_key := case when me.so_id is not null and me.backorder_of is null then 'bagseq:so:' || me.so_id
                else 'bagseq:store:' || me.store_id || ':' || (me.backorder_of is not null)::text end;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select coalesce(max(x.bag_seq), 0) + 1 into v_seq
    from webstore_orders x
   where x.bagged_at is not null
     and ((me.so_id is not null and me.backorder_of is null and x.so_id = me.so_id)
          or ((me.so_id is null or me.backorder_of is not null)
              and x.store_id = me.store_id
              and (x.backorder_of is not null) = (me.backorder_of is not null)));
  update webstore_orders o
     set bagged_at = now(), bagged_by = p_actor,
         bag_seq = coalesce(o.bag_seq, v_seq),
         bagging_claimed_by = null, bagging_claimed_at = null
   where o.id = p_order_id
  returning o.* into r;
  insert into bagging_events(order_id, actor, event, qty) values (p_order_id, p_actor, 'complete', r.bag_seq);
  return next r;
end $$;
revoke execute on function bagging_complete_order(uuid,text) from public, anon, authenticated;

-- ── 5. Backorder split: reopen a bagged child, carry product_id ─────────────
create or replace function bagging_backorder_short(p_item_id uuid, p_eta date, p_note text, p_actor text)
returns uuid language plpgsql as $$
declare v_item webstore_order_items; v_parent webstore_orders; v_child_id uuid;
begin
  select i.* into v_item from webstore_order_items i where i.id = p_item_id;
  if v_item.id is null then raise exception 'NSA_BAG_NO_ITEM'; end if;
  if coalesce(v_item.short_qty,0) <= 0 or v_item.short_status not in ('open','backordered') then
    raise exception 'NSA_BAG_NO_OPEN_SHORT';
  end if;
  select o.* into v_parent from webstore_orders o where o.id = v_item.order_id;
  if v_parent.backorder_of is not null then
    raise exception 'NSA_BAG_NESTED_BACKORDER' using detail = 'shorts on a backorder order must be resolved or refunded, not re-backordered';
  end if;

  select c.id into v_child_id from webstore_orders c where c.backorder_of = v_parent.id limit 1;
  if v_child_id is null then
    insert into webstore_orders
      (store_id, backorder_of, status, order_kind, payment_mode, buyer_name, buyer_email, buyer_phone,
       ship_address, ship_method, customer_id, coach_id, order_source, omg_order_number)
    values
      (v_parent.store_id, v_parent.id, 'paid', 'individual', v_parent.payment_mode, v_parent.buyer_name,
       v_parent.buyer_email, v_parent.buyer_phone, v_parent.ship_address, v_parent.ship_method,
       v_parent.customer_id, v_parent.coach_id, v_parent.order_source,
       case when v_parent.omg_order_number is not null then v_parent.omg_order_number || '-BO' end)
    returning id into v_child_id;
  else
    -- a late short must put a completed child back in the backorders queue
    update webstore_orders set bagged_at = null, bagged_by = null
     where id = v_child_id and bagged_at is not null;
  end if;

  update webstore_order_items c
     set qty = v_item.short_qty
   where c.order_id = v_child_id and c.backorder_of_item = p_item_id;
  if not found then
    insert into webstore_order_items
      (order_id, backorder_of_item, sku, size, qty, unit_price, name, color, image_url,
       product_id, player_name, player_number, variant_label, line_status)
    values
      (v_child_id, p_item_id, v_item.sku, v_item.size, v_item.short_qty, 0, v_item.name,
       v_item.color, v_item.image_url, v_item.product_id, v_item.player_name, v_item.player_number,
       v_item.variant_label, 'pending');
  end if;

  update webstore_order_items i
     set short_status = 'backordered', backorder_eta = coalesce(p_eta, i.backorder_eta),
         short_note = coalesce(p_note, i.short_note),
         short_resolved_by = p_actor, short_resolved_at = now(),
         missing_qty = greatest(coalesce(i.missing_qty,0), coalesce(i.short_qty,0))
   where i.id = p_item_id;

  insert into bagging_events(order_id, item_id, actor, event, qty, note)
    values (v_parent.id, p_item_id, p_actor, 'backorder', v_item.short_qty,
            'child=' || v_child_id || coalesce(' eta=' || p_eta, '') || coalesce(' ' || p_note, ''));
  return v_child_id;
end $$;
revoke execute on function bagging_backorder_short(uuid,date,text,text) from public, anon, authenticated;

-- ── 7 + 9. Groups/progress ignore empty orders and dead-order shorts ────────
create or replace function bagging_next_order(p_kind text, p_group_id text, p_actor text)
returns setof webstore_orders language plpgsql as $$
declare v_id uuid;
begin
  select o.id into v_id
    from webstore_orders o
   where o.bagged_at is null
     and o.status not in ('pending_payment','cancelled','refunded')
     and bagging_claim_is_free(o, p_actor)
     and bagging_order_live(o.id)
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
           where i.order_id in (select o2.id from webstore_orders o2 where o2.so_id = o.so_id and o2.backorder_of is null
                                   and o2.status not in ('pending_payment','cancelled','refunded'))
             and i.short_status = 'open'),
         null::date
    from webstore_orders o
    join webstores w on w.id = o.store_id
   where o.backorder_of is null and o.so_id is not null
     and o.status not in ('pending_payment','cancelled','refunded')
     and bagging_order_live(o.id)
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
           where i.order_id in (select o2.id from webstore_orders o2 where o2.store_id = w.id and o2.backorder_of is null
                                   and o2.status not in ('pending_payment','cancelled','refunded'))
             and i.short_status = 'open'),
         null::date
    from webstore_orders o
    join webstores w on w.id = o.store_id
    join omg_stores os on os.id = 'OMG-sale_' || w.omg_sale_code
   where o.backorder_of is null
     and o.status not in ('pending_payment','cancelled','refunded')
     and bagging_order_live(o.id)
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
     and bagging_order_live(o.id)
   group by w.id, w.name
  having count(*) filter (where o.bagged_at is null) > 0
$$;
revoke execute on function bagging_list_groups() from public, anon, authenticated;

create or replace function bagging_batch_progress(p_kind text, p_group_id text)
returns table(total int, bagged int, claimed int, open_shorts int) language sql stable as $$
  with grp as (
    select o.* from webstore_orders o
     where o.status not in ('pending_payment','cancelled','refunded')
       and bagging_order_live(o.id)
       and case p_kind
             when 'so'         then o.so_id = p_group_id and o.backorder_of is null
             when 'store'      then o.store_id = p_group_id::uuid and o.backorder_of is null
             when 'backorders' then o.store_id = p_group_id::uuid and o.backorder_of is not null
             else false
           end
  )
  select count(*)::int,
         count(*) filter (where g.bagged_at is not null)::int,
         count(*) filter (where g.bagged_at is null and g.bagging_claimed_by is not null
                            and g.bagging_claimed_at > now() - interval '15 minutes')::int,
         (select count(*) from webstore_order_items i join grp g2 on g2.id = i.order_id
           where i.short_status = 'open')::int
    from grp g
$$;
revoke execute on function bagging_batch_progress(text,text) from public, anon, authenticated;
