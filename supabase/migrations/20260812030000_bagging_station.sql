-- Bagging Station (BAGGING_STATION_PLAN.md): human-driven per-order bagging on
-- top of the webstore rails. Adds bag/claim/short state, the bagging_events
-- audit log, and the race-safe RPCs the /bagging-station tablet drives through
-- netlify/functions/bagging-api.js (service role only — EXECUTE is revoked from
-- anon/authenticated below). Deliberately never writes line_status: that column
-- stays owned by the job-rollup triggers (00037/00213) and pushOmgStatusSync.

-- ── Columns ─────────────────────────────────────────────────────────────────

alter table webstore_orders
  add column if not exists bagging_claimed_by text,
  add column if not exists bagging_claimed_at timestamptz,
  add column if not exists bagged_at timestamptz,
  add column if not exists bagged_by text,
  add column if not exists bag_seq int,
  add column if not exists backorder_of uuid references webstore_orders(id);

create index if not exists idx_webstore_orders_backorder_of
  on webstore_orders(backorder_of) where backorder_of is not null;

alter table webstore_order_items
  add column if not exists bagged_qty int not null default 0,
  add column if not exists short_qty int not null default 0,
  add column if not exists short_note text,
  add column if not exists short_status text,
  add column if not exists short_resolved_by text,
  add column if not exists short_resolved_at timestamptz,
  add column if not exists backorder_of_item uuid references webstore_order_items(id);

do $$ begin
  alter table webstore_order_items
    add constraint chk_bagging_short_status
    check (short_status is null or short_status in ('open','found','pulled','backordered','refunded'));
exception when duplicate_object then null; end $$;

create index if not exists idx_webstore_order_items_backorder_of_item
  on webstore_order_items(backorder_of_item) where backorder_of_item is not null;

-- ── Audit log ───────────────────────────────────────────────────────────────

create table if not exists bagging_events (
  id bigint generated always as identity primary key,
  order_id uuid references webstore_orders(id) on delete cascade,
  item_id uuid references webstore_order_items(id) on delete set null,
  event text not null, -- claim|release|check|short|complete|reopen|resolve|backorder|label_print
  qty int,
  actor text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_bagging_events_order on bagging_events(order_id);
alter table bagging_events enable row level security; -- no policies: service role only

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- A claim older than 15 minutes is stale and reclaimable (tablet died / walked
-- away). Computed at read time — no cron.
create or replace function bagging_claim_is_free(o webstore_orders, p_actor text)
returns boolean language sql stable as $$
  select o.bagging_claimed_by is null
      or o.bagging_claimed_by = p_actor
      or o.bagging_claimed_at < now() - interval '15 minutes'
$$;

-- A line is "satisfied" for completion when tapped-off plus terminally-shorted
-- covers qty. found/pulled shorts do NOT count — the physical item must still
-- be tapped into the bag after resolution.
create or replace function bagging_line_satisfied(i webstore_order_items)
returns boolean language sql stable as $$
  select coalesce(i.bagged_qty,0)
       + (case when i.short_status in ('open','backordered','refunded') then coalesce(i.short_qty,0) else 0 end)
       >= coalesce(i.qty,0)
      or i.line_status = 'cancelled'
$$;

-- ── RPCs (service-role only) ────────────────────────────────────────────────

-- Atomic claim: exactly one packer holds an order. Re-claim by the same actor
-- refreshes the clock; a stale claim is silently taken over.
create or replace function bagging_claim_order(p_order_id uuid, p_actor text)
returns setof webstore_orders language plpgsql as $$
declare r webstore_orders;
begin
  update webstore_orders o
     set bagging_claimed_by = p_actor, bagging_claimed_at = now()
   where o.id = p_order_id
     and bagging_claim_is_free(o, p_actor)
  returning o.* into r;
  if r.id is null then
    raise exception 'NSA_BAG_CLAIMED' using detail = 'order is claimed by another packer';
  end if;
  insert into bagging_events(order_id, actor, event) values (p_order_id, p_actor, 'claim');
  return next r;
end $$;

create or replace function bagging_release_order(p_order_id uuid, p_actor text)
returns void language plpgsql as $$
begin
  update webstore_orders
     set bagging_claimed_by = null, bagging_claimed_at = null
   where id = p_order_id and bagging_claimed_by = p_actor;
  insert into bagging_events(order_id, actor, event) values (p_order_id, p_actor, 'release');
end $$;

-- Pick + claim the next unbagged, unclaimed order of a bag group in one call.
-- kind: 'so' (native batch, group = so_id) | 'store' (OMG sale / whole store,
-- group = store_id) | 'backorders' (child orders of a store).
-- FOR UPDATE SKIP LOCKED makes two tablets tapping "Next" at once take
-- different orders instead of racing.
create or replace function bagging_next_order(p_kind text, p_group_id text, p_actor text)
returns setof webstore_orders language plpgsql as $$
declare v_id uuid;
begin
  select o.id into v_id
    from webstore_orders o
   where o.bagged_at is null
     and o.status not in ('pending_payment','cancelled','refunded')
     and bagging_claim_is_free(o, p_actor)
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

-- The tap. Sets the bagged counter (absolute, clamped 0..qty) so optimistic UI
-- retries are idempotent. Requires the caller to hold the claim.
create or replace function bagging_check_item(p_item_id uuid, p_qty int, p_actor text)
returns setof webstore_order_items language plpgsql as $$
declare r webstore_order_items; v_order uuid;
begin
  select i.order_id into v_order from webstore_order_items i where i.id = p_item_id;
  if v_order is null then raise exception 'NSA_BAG_NO_ITEM'; end if;
  if not exists (select 1 from webstore_orders o where o.id = v_order and o.bagging_claimed_by = p_actor) then
    raise exception 'NSA_BAG_NOT_CLAIMED' using detail = 'claim the order before checking items';
  end if;
  update webstore_order_items i
     set bagged_qty = greatest(0, least(coalesce(i.qty,0), coalesce(p_qty,0)))
   where i.id = p_item_id
  returning i.* into r;
  insert into bagging_events(order_id, item_id, actor, event, qty)
    values (v_order, p_item_id, p_actor, 'check', r.bagged_qty);
  return next r;
end $$;

-- "Can't find it": declare p_short_qty missing (0 clears an open short).
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
         short_resolved_by = null, short_resolved_at = null
   where i.id = p_item_id
  returning i.* into r;
  insert into bagging_events(order_id, item_id, actor, event, qty, note)
    values (v_order, p_item_id, p_actor, 'short', r.short_qty, p_note);
  return next r;
end $$;

-- Complete the bag: every line satisfied → stamp bagged_at/by, assign bag_seq
-- within the bag group (so_id when set, else store_id; backorder children
-- number among themselves), release the claim.
create or replace function bagging_complete_order(p_order_id uuid, p_actor text)
returns setof webstore_orders language plpgsql as $$
declare r webstore_orders; v_open int; v_seq int;
begin
  if not exists (select 1 from webstore_orders o where o.id = p_order_id and o.bagging_claimed_by = p_actor) then
    raise exception 'NSA_BAG_NOT_CLAIMED';
  end if;
  select count(*) into v_open
    from webstore_order_items i
   where i.order_id = p_order_id and not bagging_line_satisfied(i);
  if v_open > 0 then
    raise exception 'NSA_BAG_INCOMPLETE' using detail = v_open || ' line(s) not yet bagged or shorted';
  end if;
  select coalesce(max(x.bag_seq), 0) + 1 into v_seq
    from webstore_orders x
    join webstore_orders me on me.id = p_order_id
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

-- Reopen a completed bag (label QR / found short): clears bagged_at (bag_seq is
-- kept so the label stays valid) and claims it for the actor.
create or replace function bagging_reopen_order(p_order_id uuid, p_actor text)
returns setof webstore_orders language plpgsql as $$
declare r webstore_orders;
begin
  update webstore_orders o
     set bagged_at = null, bagged_by = null,
         bagging_claimed_by = p_actor, bagging_claimed_at = now()
   where o.id = p_order_id
     and bagging_claim_is_free(o, p_actor)
  returning o.* into r;
  if r.id is null then raise exception 'NSA_BAG_CLAIMED'; end if;
  insert into bagging_events(order_id, actor, event) values (p_order_id, p_actor, 'reopen');
  return next r;
end $$;

-- Resolve an open short WITHOUT moving money: 'found' | 'pulled' reopen the
-- physical work (packer still has to bag the item — bagging_line_satisfied
-- stops counting the short); 'refunded' is recorded by the desktop flow ONLY
-- after the existing refund path (stripe-payment refund_webstore_order →
-- apply_webstore_refund) has succeeded, or with a note for OMG orders whose
-- money lives outside Stripe. This RPC records state; it never refunds.
create or replace function bagging_resolve_short(p_item_id uuid, p_resolution text, p_note text, p_actor text)
returns setof webstore_order_items language plpgsql as $$
declare r webstore_order_items;
begin
  if p_resolution not in ('found','pulled','refunded') then
    raise exception 'NSA_BAG_BAD_RESOLUTION';
  end if;
  update webstore_order_items i
     set short_status = p_resolution,
         short_note = coalesce(p_note, i.short_note),
         short_resolved_by = p_actor, short_resolved_at = now(),
         -- refunded qty must not ship from the parent: missing_qty is the column
         -- the existing ship-plan math and packing-list flags already respect
         missing_qty = case when p_resolution = 'refunded'
                            then greatest(coalesce(i.missing_qty,0), coalesce(i.short_qty,0))
                            else i.missing_qty end
   where i.id = p_item_id and i.short_status in ('open','found','pulled')
  returning i.* into r;
  if r.id is null then raise exception 'NSA_BAG_NO_OPEN_SHORT'; end if;
  -- found/pulled: the bag is no longer complete — put the order back in the queue.
  if p_resolution in ('found','pulled') then
    update webstore_orders set bagged_at = null, bagged_by = null where id = r.order_id;
  end if;
  insert into bagging_events(order_id, item_id, actor, event, qty, note)
    values (r.order_id, p_item_id, p_actor, 'resolve', r.short_qty, p_resolution || coalesce(': ' || p_note, ''));
  return next r;
end $$;

-- Backorder an open short: split the missing qty onto the parent order's single
-- child backorder order (created on first use, reused after — idempotent per
-- item via backorder_of_item). Money stays on the parent: child lines are $0.
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
  end if;

  update webstore_order_items c
     set qty = v_item.short_qty
   where c.order_id = v_child_id and c.backorder_of_item = p_item_id;
  if not found then
    insert into webstore_order_items
      (order_id, backorder_of_item, sku, size, qty, unit_price, name, color, image_url,
       player_name, player_number, variant_label, line_status)
    values
      (v_child_id, p_item_id, v_item.sku, v_item.size, v_item.short_qty, 0, v_item.name,
       v_item.color, v_item.image_url, v_item.player_name, v_item.player_number,
       v_item.variant_label, 'pending');
  end if;

  update webstore_order_items i
     set short_status = 'backordered', backorder_eta = coalesce(p_eta, i.backorder_eta),
         short_note = coalesce(p_note, i.short_note),
         short_resolved_by = p_actor, short_resolved_at = now(),
         -- backordered qty ships on the child order, never the parent
         missing_qty = greatest(coalesce(i.missing_qty,0), coalesce(i.short_qty,0))
   where i.id = p_item_id;

  insert into bagging_events(order_id, item_id, actor, event, qty, note)
    values (v_parent.id, p_item_id, p_actor, 'backorder', v_item.short_qty,
            'child=' || v_child_id || coalesce(' eta=' || p_eta, '') || coalesce(' ' || p_note, ''));
  return v_child_id;
end $$;

-- Progress counts for a bag group (picker cards, progress bars, ship gate).
create or replace function bagging_batch_progress(p_kind text, p_group_id text)
returns table(total int, bagged int, claimed int, open_shorts int) language sql stable as $$
  with grp as (
    select o.* from webstore_orders o
     where o.status not in ('pending_payment','cancelled','refunded')
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

-- ── Lockdown: service role only ─────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'bagging_claim_order(uuid,text)', 'bagging_release_order(uuid,text)',
    'bagging_next_order(text,text,text)', 'bagging_check_item(uuid,int,text)',
    'bagging_short_item(uuid,int,text,text)', 'bagging_complete_order(uuid,text)',
    'bagging_reopen_order(uuid,text)', 'bagging_resolve_short(uuid,text,text,text)',
    'bagging_backorder_short(uuid,date,text,text)', 'bagging_batch_progress(text,text)'
  ] loop
    execute 'revoke execute on function ' || fn || ' from public, anon, authenticated';
  end loop;
end $$;

-- ── Picker cards ────────────────────────────────────────────────────────────
-- Native deliver-to-club batches, OMG deliver-to-school sales, and per-store
-- backorder queues, one row per card. Service-role only.
create or replace function bagging_list_groups()
returns table(kind text, group_id text, store_id uuid, store_name text,
              total int, bagged int, open_shorts int, earliest_eta date)
language sql stable as $$
  select 'so'::text, o.so_id, w.id, w.name,
         count(*)::int,
         count(*) filter (where o.bagged_at is not null)::int,
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
  having count(*) filter (where o.bagged_at is null) > 0

  union all
  select 'store'::text, w.id::text, w.id, w.name,
         count(*)::int,
         count(*) filter (where o.bagged_at is not null)::int,
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
  having count(*) filter (where o.bagged_at is null) > 0

  union all
  select 'backorders'::text, w.id::text, w.id, w.name,
         count(*)::int,
         count(*) filter (where o.bagged_at is not null)::int,
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
