-- Automatically assign stocked garments to native Club / All School warehouse
-- pick tasks. Assignment is only a reservation: it does not decrement stock or
-- claim that a person physically pulled the garments.

create or replace function public.at_once_pick_size_qty(p_sizes jsonb, p_size text)
returns integer language sql immutable parallel safe set search_path=public as $$
  select coalesce(sum(case
    when jsonb_typeof(e.value) = 'number' and coalesce(e.value #>> '{}', '') ~ '^-?[0-9]+$'
      then greatest((e.value #>> '{}')::integer, 0)
    else 0 end), 0)::integer
    from jsonb_each(coalesce(p_sizes, '{}'::jsonb)) e
   where upper(trim(e.key)) = upper(trim(p_size));
$$;
revoke all on function public.at_once_pick_size_qty(jsonb, text) from public, anon;

create or replace function public.assign_at_once_inventory_picks(p_so_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_so record;
  v_item record;
  v_size record;
  v_item_pick_sizes jsonb;
  v_item_assigned integer;
  v_qty integer;
  v_open integer;
  v_have integer;
  v_pending integer;
  v_other_demand integer;
  v_reserved integer;
  v_own_reserved integer;
  v_available integer;
  v_pick_id text;
  v_lines integer := 0;
  v_units integer := 0;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    current_setting('request.jwt.claim.role', true),
    '');
  if v_role <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:staff or service role required';
  end if;
  if coalesce(trim(p_so_id), '') = '' then
    raise exception 'NSA_BAD_INPUT:p_so_id required';
  end if;

  -- The SO lock serializes replays for this order. The resource advisory lock
  -- below serializes different eligible orders competing for the same stock.
  perform pg_advisory_xact_lock(hashtextextended('at_once_pick_so:' || p_so_id, 0));
  select so.id, so.status, ws.id as store_id, ws.org_type as store_type into v_so
    from sales_orders so
    join webstores ws on ws.id = so.webstore_id
    join webstore_orders wo on wo.so_id = so.id and wo.store_id = ws.id
   where so.id = p_so_id
     and lower(coalesce(so.status, '')) not in ('cancelled','void','archived','complete','completed','done')
     and so.deleted_at is null
     and so.source is distinct from 'omg'
     and coalesce(ws.source, 'webstore') <> 'omg'
     and ws.org_type in ('club','all_school')
     and wo.status in ('paid','batched')
   for update;
  if not found then
    return jsonb_build_object('ok', true, 'created_lines', 0, 'assigned_units', 0, 'reason', 'not_eligible');
  end if;

  v_pick_id := 'IF-AUTO-' || replace(gen_random_uuid()::text, '-', '');

  for v_item in
    select i.id, i.product_id, i.sizes, i.source_webstore_item_ids
      from so_items i
     where i.so_id = p_so_id
       and i.product_id is not null
     order by i.id
     for update
  loop
    v_item_pick_sizes := '{}'::jsonb;
    v_item_assigned := 0;
    if v_so.store_type = 'all_school' and not public.all_school_garment_source_valid(v_item.id) then
      raise exception 'NSA_SOURCE_LINE_CHANGED:%', v_item.id;
    end if;
    if coalesce(cardinality(v_item.source_webstore_item_ids), 0) > 0 and exists (
      select 1
        from unnest(v_item.source_webstore_item_ids) src(id)
        left join webstore_order_items li on li.id = src.id
        left join webstore_orders wo on wo.id = li.order_id
        left join webstores ws on ws.id = wo.store_id
       where li.id is null or coalesce(li.qty, 0) <= 0
          or lower(coalesce(li.line_status, '')) in ('cancelled','canceled','refunded')
          or wo.so_id is distinct from p_so_id
          or wo.store_id is distinct from v_so.store_id
          or ws.org_type is distinct from v_so.store_type
          or li.product_id is distinct from v_item.product_id
    ) then
      raise exception 'NSA_SOURCE_LINE_CHANGED:%', v_item.id;
    end if;
    if coalesce(cardinality(v_item.source_webstore_item_ids), 0) = 0
       and v_so.store_type = 'club'
       and (select count(*) from so_items same_product
             where same_product.so_id = p_so_id
               and same_product.product_id = v_item.product_id) > 1 then
      raise exception 'NSA_SOURCE_LINE_AMBIGUOUS:%', v_item.product_id;
    end if;
    if (coalesce(cardinality(v_item.source_webstore_item_ids), 0) > 0
        or (coalesce(cardinality(v_item.source_webstore_item_ids), 0) = 0 and v_so.store_type = 'club'))
       and exists (
      with source_qty as (
        select upper(trim(coalesce(nullif(li.size, ''), 'OS'))) as size,
               sum(greatest(coalesce(li.qty, 0) - coalesce(li.cancelled_qty, 0) - coalesce(li.refunded_qty, 0), 0))::integer as qty
          from webstore_order_items li
          join webstore_orders wo on wo.id = li.order_id
         where ((coalesce(cardinality(v_item.source_webstore_item_ids), 0) > 0
                 and li.id = any(v_item.source_webstore_item_ids))
             or (coalesce(cardinality(v_item.source_webstore_item_ids), 0) = 0
                 and v_so.store_type = 'club'
                 and wo.so_id = p_so_id
                 and wo.store_id = v_so.store_id
                 and li.product_id = v_item.product_id))
           and coalesce(li.qty, 0) > 0
           and lower(coalesce(li.line_status, '')) not in ('cancelled','canceled','refunded')
           and coalesce((to_jsonb(li)->>'is_bundle_parent')::boolean, false) is false
         group by 1
      ), snapshot_qty as (
        select upper(trim(e.key)) as size,
               sum(case when jsonb_typeof(e.value)='number' and coalesce(e.value #>> '{}','') ~ '^-?[0-9]+$'
                        then greatest((e.value #>> '{}')::integer,0) else 0 end)::integer as qty
          from jsonb_each(coalesce(v_item.sizes,'{}'::jsonb)) e
         group by 1
      )
      select 1 from source_qty s full join snapshot_qty i using(size)
       where coalesce(s.qty,0) <> coalesce(i.qty,0)
    ) then
      raise exception 'NSA_SOURCE_QTY_CHANGED:%', v_item.id;
    end if;
    for v_size in
      select min(s.key) as size, sum(greatest(coalesce(s.value #>> '{}', '0')::integer, 0))::integer as ordered_qty
        from jsonb_each(coalesce(v_item.sizes, '{}'::jsonb)) s
       where jsonb_typeof(s.value) = 'number'
         and coalesce(s.value #>> '{}', '0') ~ '^-?[0-9]+$'
         and coalesce((s.value #>> '{}')::integer, 0) > 0
       group by upper(trim(s.key))
       order by upper(trim(s.key))
    loop
      -- Same resource lock as the All School purchasing planner. It leaves
      -- house reservations gross and durable, while this RPC nets the matching
      -- pick rows out of their residual before assigning another task.
      perform pg_advisory_xact_lock(hashtextextended(
        'all_school_house:' || v_item.product_id || '|' || upper(trim(v_size.size)), 0));

      -- Lock before reading the stock snapshot so a committed physical pull is
      -- visible to the quantity calculation below.
      perform 1 from product_inventory pi
       where pi.product_id = v_item.product_id
         and upper(trim(pi.size)) = upper(trim(v_size.size))
       order by pi.id for update;
      select coalesce(sum(greatest(coalesce(pi.quantity, 0), 0)), 0)::integer
        into v_have
        from product_inventory pi
       where pi.product_id = v_item.product_id
         and upper(trim(pi.size)) = upper(trim(v_size.size));

      select coalesce(sum(public.at_once_pick_size_qty(pk.sizes, v_size.size)), 0)::integer
        into v_pending
        from so_item_pick_lines pk
        join so_items pi on pi.id = pk.so_item_id
        join sales_orders ps on ps.id = pi.so_id
       where pi.product_id = v_item.product_id
         and pk.status = 'pick'
         and lower(coalesce(ps.status, '')) not in ('cancelled','void','archived','complete','completed','done')
         and (not exists (
           select 1 from webstore_orders pwo join webstores pws on pws.id=pwo.store_id
            where pwo.so_id=ps.id and pwo.status in ('paid','unpaid','batched')
              and pws.org_type not in ('club','all_school'))
           or exists (select 1 from webstore_orders nwo join webstores nws on nws.id=nwo.store_id
                       where nwo.so_id=ps.id and nws.org_type in ('club','all_school')
                         and nwo.status in ('paid','batched')));

      -- Protect stock reserved for any All School need, except the remaining
      -- share of this item which its own pick assignment may consume. Existing
      -- picks (including physically pulled rows) reduce the reservation's
      -- residual. Pulled quantities are already absent from product_inventory.
      select coalesce(sum(greatest(r.qty - coalesce((
        select sum(public.at_once_pick_size_qty(pk.sizes, r.size))
          from so_item_pick_lines pk
          join so_items ri on ri.id = pk.so_item_id
         where ri.id = nd.so_item_id
           and ri.product_id = r.product_id
           and pk.status in ('pick','pulled')
      ), 0), 0)), 0)::integer
        into v_reserved
        from all_school_house_reservations r
        join teamshop_auto_po_needs nd on nd.id = r.need_id
        join sales_orders rs on rs.id = r.so_id
       where r.product_id = v_item.product_id
         and upper(trim(r.size)) = upper(trim(v_size.size))
         and lower(coalesce(rs.status, '')) not in ('cancelled','void','archived','complete','completed','done')
         and exists (select 1 from webstore_orders rwo join webstores rws on rws.id=rwo.store_id
                      where rwo.so_id = r.so_id and rws.org_type = 'all_school' and rwo.status in ('paid','batched'));

      select coalesce(sum(greatest(r.qty - coalesce((
        select sum(public.at_once_pick_size_qty(pk.sizes, r.size))
          from so_item_pick_lines pk
         where pk.so_item_id = v_item.id and pk.status in ('pick','pulled')
      ), 0), 0)), 0)::integer
        into v_own_reserved
        from all_school_house_reservations r
        join teamshop_auto_po_needs nd on nd.id = r.need_id
       where r.so_id = p_so_id and nd.so_item_id = v_item.id
         and r.product_id = v_item.product_id
         and upper(trim(r.size)) = upper(trim(v_size.size));

      -- Match the existing purchasing planner: active non-All-School webstore
      -- demand keeps first call on house stock. Also protect paid unconverted
      -- Club checkouts, whose source order may not have an SO yet. Converted
      -- native orders are allocated by this sweep; they must not each reserve
      -- the other's entire unassigned demand.
      select coalesce(sum(greatest(oi.qty - coalesce((
        select sum(public.at_once_pick_size_qty(pk.sizes, coalesce(nullif(oi.size,''),'OS')))
          from so_item_pick_lines pk
          join so_items si on si.id = pk.so_item_id
         where si.so_id = wo.so_id and si.product_id = oi.product_id and pk.status = 'pulled'
      ), 0), 0)), 0)::integer
        into v_other_demand
        from webstore_order_items oi
        join webstore_orders wo on wo.id = oi.order_id
        join webstores ows on ows.id = wo.store_id
       where ows.org_type <> 'all_school'
         and (ows.org_type <> 'club' or wo.so_id is null)
         and wo.so_id is distinct from p_so_id
         and wo.status in ('paid','unpaid','batched')
         and lower(coalesce(oi.line_status, '')) not in ('cancelled','canceled','refunded','shipped','complete')
         and oi.product_id = v_item.product_id
         and upper(trim(coalesce(nullif(oi.size,''),'OS'))) = upper(trim(v_size.size));

      select greatest(
        v_size.ordered_qty
        - coalesce((select sum(public.at_once_pick_size_qty(pk.sizes, v_size.size))
                      from so_item_pick_lines pk where pk.so_item_id = v_item.id),0)
        - coalesce((select sum(greatest(public.at_once_pick_size_qty(pl.sizes, v_size.size)
                                           - public.at_once_pick_size_qty(pl.cancelled, v_size.size),0))
                      from so_item_po_lines pl where pl.so_item_id = v_item.id
                        and coalesce(pl.status,'') not in ('cancelled','void')),0),
        0)::integer into v_open;

      v_available := greatest(v_have - v_pending - v_reserved - v_other_demand + v_own_reserved, 0);
      v_qty := least(v_open, v_available);
      if v_qty > 0 then
        v_item_pick_sizes := v_item_pick_sizes || jsonb_build_object(v_size.size, v_qty);
        v_item_assigned := v_item_assigned + v_qty;
        v_units := v_units + v_qty;
      end if;
    end loop;
    if v_item_assigned > 0 then
      insert into so_item_pick_lines(so_item_id, pick_id, sizes, status, created_at, memo, ship_dest)
      values (v_item.id, v_pick_id, v_item_pick_sizes, 'pick', to_char(current_date, 'YYYY-MM-DD'),
              'Automatically assigned from available warehouse stock', 'in_house');
      v_lines := v_lines + 1;
    end if;
  end loop;

  update sales_orders set updated_at = to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS')
   where id = p_so_id;

  return jsonb_build_object('ok', true, 'so_id', p_so_id,
    'created_lines', v_lines, 'assigned_units', v_units);
end;
$$;

revoke all on function public.assign_at_once_inventory_picks(text) from public;
revoke all on function public.assign_at_once_inventory_picks(text) from anon;
grant execute on function public.assign_at_once_inventory_picks(text) to authenticated, service_role;
