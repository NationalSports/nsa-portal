-- Item-aware webstore refunds.
--
-- Three accounting identities are intentionally separate:
--   original_total = immutable amount originally billed/charged
--   total          = current value of the active item lines
--   refunded_amt   = money actually returned/credited
-- This prevents a saved item cancellation from lowering the ceiling used by a
-- later refund, while keeping the product/player reports on the current lines.

alter table public.webstore_orders
  add column if not exists original_total numeric;

-- team_members.id is text in this database (most values are human-readable
-- staff ids, not UUIDs). The original refund ledger declared its actor column
-- as uuid, which meant the staff-only endpoint could not record refunds for
-- non-UUID team members. Correct that legacy type before adding new actor FKs.
alter table public.webstore_order_refunds
  alter column actor_team_member_id type text
  using actor_team_member_id::text;

do $$ begin
  alter table public.webstore_order_refunds
    add constraint webstore_order_refunds_actor_team_member_id_fkey
    foreign key (actor_team_member_id) references public.team_members(id) on delete set null;
exception when duplicate_object then null; end $$;

-- There are five historical refunded orders at the time of this migration:
-- four full refunds whose stored total was never edited, and one partial refund
-- issued after an item edit lowered total. Preserve both shapes. From this point
-- forward the checkout trigger below captures the amount at insertion time.
update public.webstore_orders
   set original_total = case
     when coalesce(refunded_amt, 0) <= 0 then greatest(coalesce(total, 0), 0)
     when lower(coalesce(status, '')) = 'refunded'
       then greatest(coalesce(total, 0), coalesce(refunded_amt, 0), 0)
     else greatest(coalesce(total, 0) + coalesce(refunded_amt, 0), 0)
   end
 where original_total is null;

create or replace function public.webstore_capture_original_total()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.original_total := old.original_total;
  elsif new.original_total is null then
    new.original_total := greatest(coalesce(new.total, 0), 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_webstore_capture_original_total on public.webstore_orders;
create trigger trg_webstore_capture_original_total
before insert or update of original_total on public.webstore_orders
for each row execute function public.webstore_capture_original_total();

revoke all on function public.webstore_capture_original_total() from public, anon, authenticated;

alter table public.webstore_orders
  alter column original_total set not null;

do $$ begin
  alter table public.webstore_orders
    add constraint webstore_orders_original_total_nonnegative
    check (original_total >= 0);
exception when duplicate_object then null; end $$;

-- qty is the quantity still active on the order. cancelled_qty preserves units
-- removed from the active reports; refunded_qty records how many of those units
-- have a money movement linked to them.
alter table public.webstore_order_items
  add column if not exists cancelled_qty integer not null default 0,
  add column if not exists refunded_qty integer not null default 0,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text references public.team_members(id) on delete set null,
  add column if not exists cancelled_from_status text;

create index if not exists webstore_order_items_cancelled_by_idx
  on public.webstore_order_items(cancelled_by)
  where cancelled_by is not null;

do $$ begin
  alter table public.webstore_order_items
    add constraint webstore_order_items_refund_quantities_valid
    check (cancelled_qty >= 0 and refunded_qty >= 0 and refunded_qty <= cancelled_qty);
exception when duplicate_object then null; end $$;

-- Immutable audit of every item edit made from the Manage Order panel.
create table if not exists public.webstore_order_item_changes (
  id                    bigint generated always as identity primary key,
  order_id              uuid not null references public.webstore_orders(id) on delete cascade,
  order_item_id         uuid references public.webstore_order_items(id) on delete set null,
  actor_team_member_id  text references public.team_members(id) on delete set null,
  change_kind           text not null,
  before_data           jsonb not null default '{}'::jsonb,
  after_data            jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);
create index if not exists webstore_order_item_changes_order_idx
  on public.webstore_order_item_changes(order_id, created_at);
create index if not exists webstore_order_item_changes_item_idx
  on public.webstore_order_item_changes(order_item_id, created_at)
  where order_item_id is not null;
create index if not exists webstore_order_item_changes_actor_idx
  on public.webstore_order_item_changes(actor_team_member_id)
  where actor_team_member_id is not null;

alter table public.webstore_order_item_changes enable row level security;
drop policy if exists webstore_order_item_changes_staff_read on public.webstore_order_item_changes;
create policy webstore_order_item_changes_staff_read
  on public.webstore_order_item_changes for select to authenticated
  using ((select public.is_team_member()));
grant select on public.webstore_order_item_changes to authenticated;
revoke insert, update, delete, truncate on public.webstore_order_item_changes from anon, authenticated;
revoke all on public.webstore_order_item_changes from anon;

-- One row per item allocation on an actual refund. Snapshot columns make the
-- audit durable even if a legacy/admin cleanup later removes the source item.
create table if not exists public.webstore_order_refund_items (
  id                    uuid primary key default gen_random_uuid(),
  refund_id             uuid not null references public.webstore_order_refunds(id) on delete cascade,
  order_id              uuid not null references public.webstore_orders(id) on delete cascade,
  order_item_id         uuid references public.webstore_order_items(id) on delete set null,
  qty                   integer not null check (qty > 0),
  amount                numeric not null default 0 check (amount >= 0),
  sku_snapshot          text,
  name_snapshot         text,
  color_snapshot        text,
  size_snapshot         text,
  player_name_snapshot  text,
  player_number_snapshot text,
  created_at            timestamptz not null default now(),
  unique (refund_id, order_item_id)
);
create index if not exists webstore_order_refund_items_order_idx
  on public.webstore_order_refund_items(order_id, created_at);
create index if not exists webstore_order_refund_items_item_idx
  on public.webstore_order_refund_items(order_item_id, created_at)
  where order_item_id is not null;

alter table public.webstore_order_refund_items enable row level security;
drop policy if exists webstore_order_refund_items_staff_read on public.webstore_order_refund_items;
create policy webstore_order_refund_items_staff_read
  on public.webstore_order_refund_items for select to authenticated
  using ((select public.is_team_member()));
grant select on public.webstore_order_refund_items to authenticated;
revoke insert, update, delete, truncate on public.webstore_order_refund_items from anon, authenticated;
revoke all on public.webstore_order_refund_items from anon;

-- Refund history itself used to be readable by every authenticated account,
-- including non-staff portal identities. Match the item/change ledgers: staff only.
drop policy if exists webstore_order_refunds_auth_read on public.webstore_order_refunds;
drop policy if exists webstore_order_refunds_staff_read on public.webstore_order_refunds;
create policy webstore_order_refunds_staff_read
  on public.webstore_order_refunds for select to authenticated
  using ((select public.is_team_member()));

-- Transactional item editor. Rows are never deleted: full removal becomes qty=0
-- + line_status=cancelled, which immediately removes it from active product/player
-- reports while retaining the exact item a later refund belongs to.
create or replace function public.apply_webstore_order_item_edits(
  p_order_id uuid,
  p_edits jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_order public.webstore_orders;
  v_item public.webstore_order_items;
  v_edit jsonb;
  v_item_id uuid;
  v_new_qty integer;
  v_new_size text;
  v_new_status text;
  v_new_cancelled integer;
  v_kind text;
  v_before jsonb;
  v_after jsonb;
  v_subtotal numeric;
  v_fundraise numeric;
  v_processing numeric;
  v_tax numeric;
  v_discount numeric;
  v_pre_tax numeric;
  v_total numeric;
  v_old_pot numeric;
  v_pending jsonb;
begin
  -- This browser-facing RPC is authenticated-staff only. Do not use auth.role():
  -- authenticated portal identities share that Postgres role, while this predicate
  -- requires an active team_members row.
  if not public.is_team_member() then
    raise exception 'NSA_NOT_STAFF' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_edits, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_edits');
  end if;

  if auth.uid() is not null then
    select tm.id into v_actor
      from public.team_members tm
     where tm.auth_id = auth.uid() and coalesce(tm.is_active, true)
     limit 1;
  end if;

  select * into v_order
    from public.webstore_orders
   where id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  for v_edit in select value from jsonb_array_elements(coalesce(p_edits, '[]'::jsonb)) loop
    begin
      v_item_id := nullif(v_edit->>'id', '')::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid_item_id');
    end;

    select * into v_item
      from public.webstore_order_items
     where id = v_item_id and order_id = p_order_id
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'item_not_on_order', 'item_id', v_item_id);
    end if;

    v_before := jsonb_build_object(
      'sku', v_item.sku, 'name', v_item.name, 'color', v_item.color,
      'size', v_item.size, 'qty', v_item.qty, 'line_status', v_item.line_status,
      'cancelled_qty', v_item.cancelled_qty, 'refunded_qty', v_item.refunded_qty
    );
    v_new_size := case when v_edit ? 'size' then nullif(v_edit->>'size', '') else v_item.size end;
    v_new_qty := case
      when coalesce((v_edit->>'removed')::boolean, false) then 0
      else greatest(1, coalesce(nullif(v_edit->>'qty', '')::integer, v_item.qty, 1))
    end;
    v_new_cancelled := greatest(
      coalesce(v_item.refunded_qty, 0),
      coalesce(v_item.cancelled_qty, 0) + coalesce(v_item.qty, 0) - v_new_qty
    );
    v_new_status := case
      when v_new_qty = 0 then 'cancelled'
      when lower(coalesce(v_item.line_status, '')) in ('cancelled', 'canceled')
        then coalesce(nullif(v_item.cancelled_from_status, ''), 'pending')
      else coalesce(v_item.line_status, 'pending')
    end;

    update public.webstore_order_items
       set size = v_new_size,
           qty = v_new_qty,
           cancelled_qty = v_new_cancelled,
           line_status = v_new_status,
           cancelled_at = case
             when v_new_cancelled > 0 then coalesce(cancelled_at, now())
             else null
           end,
           cancelled_by = case
             when v_new_cancelled > 0 then coalesce(v_actor, cancelled_by)
             else null
           end,
           cancelled_from_status = case
             when v_new_qty = 0 then coalesce(
               nullif(case when lower(coalesce(v_item.line_status, '')) not in ('cancelled', 'canceled') then v_item.line_status end, ''),
               v_item.cancelled_from_status,
               'pending'
             )
             when v_new_cancelled = 0 then null
             else v_item.cancelled_from_status
           end
     where id = v_item_id
     returning * into v_item;

    v_after := jsonb_build_object(
      'sku', v_item.sku, 'name', v_item.name, 'color', v_item.color,
      'size', v_item.size, 'qty', v_item.qty, 'line_status', v_item.line_status,
      'cancelled_qty', v_item.cancelled_qty, 'refunded_qty', v_item.refunded_qty
    );
    if v_before is distinct from v_after then
      v_kind := case
        when (v_after->>'qty')::integer = 0 then 'removed'
        when (v_after->>'qty')::integer < (v_before->>'qty')::integer then 'quantity_reduced'
        when (v_after->>'qty')::integer > (v_before->>'qty')::integer then 'quantity_increased'
        when coalesce(v_after->>'size', '') <> coalesce(v_before->>'size', '') then 'size_changed'
        else 'edited'
      end;
      insert into public.webstore_order_item_changes
        (order_id, order_item_id, actor_team_member_id, change_kind, before_data, after_data)
      values
        (p_order_id, v_item_id, v_actor, v_kind, v_before, v_after);
    end if;
  end loop;

  select
    coalesce(sum(coalesce(i.unit_price, 0) * greatest(coalesce(i.qty, 0), 0)), 0),
    coalesce(sum(coalesce(i.unit_fundraise, 0) * greatest(coalesce(i.qty, 0), 0)), 0)
  into v_subtotal, v_fundraise
  from public.webstore_order_items i
  where i.order_id = p_order_id
    and lower(coalesce(i.line_status, '')) not in ('cancelled', 'canceled');

  v_subtotal := round(v_subtotal, 2);
  v_fundraise := round(v_fundraise, 2);
  v_processing := round(case when coalesce(v_order.subtotal, 0) > 0
    then coalesce(v_order.processing_fee, 0) / v_order.subtotal * v_subtotal
    else coalesce(v_order.processing_fee, 0) end, 2);
  v_tax := round(case when coalesce(v_order.subtotal, 0) > 0
    then coalesce(v_order.tax, 0) / v_order.subtotal * v_subtotal
    else coalesce(v_order.tax, 0) end, 2);
  v_old_pot := coalesce(v_order.subtotal, 0) + coalesce(v_order.fundraise_amt, 0);
  v_discount := round(case when v_old_pot > 0
    then coalesce(v_order.discount_amt, 0) / v_old_pot * (v_subtotal + v_fundraise)
    else coalesce(v_order.discount_amt, 0) end, 2);
  v_pre_tax := round(greatest(0,
    v_subtotal + v_fundraise + coalesce(v_order.shipping_fee, 0) + v_processing - v_discount
  ), 2);
  v_total := round(v_pre_tax + v_tax, 2);

  update public.webstore_orders
     set subtotal = v_subtotal,
         fundraise_amt = v_fundraise,
         processing_fee = v_processing,
         tax = v_tax,
         discount_amt = v_discount,
         total = v_total
   where id = p_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', i.id,
    'qty', i.cancelled_qty - i.refunded_qty,
    'sku', i.sku,
    'name', i.name,
    'color', i.color,
    'size', i.size,
    'player_name', i.player_name,
    'player_number', i.player_number,
    'unit_price', i.unit_price,
    'unit_fundraise', i.unit_fundraise
  ) order by i.id), '[]'::jsonb)
  into v_pending
  from public.webstore_order_items i
  where i.order_id = p_order_id
    and i.cancelled_qty > i.refunded_qty;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'owed', greatest(0, round(coalesce(v_order.total, 0) - v_total, 2)),
    'original_total', v_order.original_total,
    'pending_items', v_pending
  );
end;
$$;

revoke all on function public.apply_webstore_order_item_edits(uuid, jsonb) from public, anon;
grant execute on function public.apply_webstore_order_item_edits(uuid, jsonb) to authenticated;

-- Replace the six-argument refund function with an optional item-allocation
-- argument. Existing webhook calls keep working because p_items has a default.
drop function if exists public.apply_webstore_refund(uuid, numeric, text, text, uuid, text);
drop function if exists public.apply_webstore_refund(uuid, numeric, text, text, uuid, text, jsonb);
drop function if exists public.apply_webstore_refund(uuid, numeric, text, text, text, text, jsonb);
create function public.apply_webstore_refund(
  p_order_id          uuid,
  p_amount            numeric,
  p_kind              text,
  p_stripe_refund_id  text,
  p_actor             text,
  p_reason            text,
  p_items             jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  o public.webstore_orders;
  v_cap numeric;
  v_new_refunded numeric;
  v_refund_id uuid;
  v_existing_id uuid;
  v_alloc jsonb;
  v_item public.webstore_order_items;
  v_item_id uuid;
  v_qty integer;
  v_alloc_amount numeric;
  v_alloc_total numeric := 0;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_item_allocations');
  end if;

  select * into o from public.webstore_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;
  v_cap := greatest(coalesce(o.original_total, o.total, 0), 0);

  if p_stripe_refund_id is not null then
    select id into v_existing_id
      from public.webstore_order_refunds
     where stripe_refund_id = p_stripe_refund_id;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true,
        'refund_id', v_existing_id, 'refunded_amt', coalesce(o.refunded_amt, 0),
        'total', coalesce(o.total, 0), 'original_total', v_cap);
    end if;
  end if;

  if p_kind = 'dispute' then
    insert into public.webstore_order_refunds
      (order_id, store_id, amount, kind, stripe_refund_id, stripe_pi_id, actor_team_member_id, reason)
    values
      (p_order_id, o.store_id, 0, 'dispute', p_stripe_refund_id, o.stripe_pi_id, p_actor, p_reason)
    returning id into v_refund_id;
    return jsonb_build_object('ok', true, 'dispute', true, 'refund_id', v_refund_id,
      'refunded_amt', coalesce(o.refunded_amt, 0), 'total', coalesce(o.total, 0),
      'original_total', v_cap);
  end if;

  if coalesce(p_amount, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;
  v_new_refunded := coalesce(o.refunded_amt, 0) + p_amount;
  if v_new_refunded > v_cap + 0.01 then
    return jsonb_build_object('ok', false, 'error', 'exceeds_total',
      'refunded_amt', coalesce(o.refunded_amt, 0), 'total', coalesce(o.total, 0),
      'original_total', v_cap);
  end if;

  -- Validate and lock every requested item before writing the refund ledger.
  for v_alloc in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    begin
      v_item_id := nullif(v_alloc->>'item_id', '')::uuid;
      v_qty := greatest(0, coalesce(nullif(v_alloc->>'qty', '')::integer, 0));
      v_alloc_amount := greatest(0, coalesce(nullif(v_alloc->>'amount', '')::numeric, 0));
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid_item_allocation');
    end;
    if v_item_id is null or v_qty <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_item_allocation');
    end if;
    select * into v_item
      from public.webstore_order_items
     where id = v_item_id and order_id = p_order_id
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'item_not_on_order', 'item_id', v_item_id);
    end if;
    if v_qty > coalesce(v_item.cancelled_qty, 0) - coalesce(v_item.refunded_qty, 0) then
      return jsonb_build_object('ok', false, 'error', 'item_qty_not_refundable',
        'item_id', v_item_id,
        'available_qty', greatest(0, coalesce(v_item.cancelled_qty, 0) - coalesce(v_item.refunded_qty, 0)));
    end if;
    v_alloc_total := v_alloc_total + v_alloc_amount;
  end loop;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0
     and abs(v_alloc_total - p_amount) > 0.01 then
    return jsonb_build_object('ok', false, 'error', 'item_amount_mismatch');
  end if;

  insert into public.webstore_order_refunds
    (order_id, store_id, amount, kind, stripe_refund_id, stripe_pi_id, actor_team_member_id, reason)
  values
    (p_order_id, o.store_id, p_amount, coalesce(p_kind, 'card'), p_stripe_refund_id,
     o.stripe_pi_id, p_actor, p_reason)
  returning id into v_refund_id;

  for v_alloc in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item_id := (v_alloc->>'item_id')::uuid;
    v_qty := (v_alloc->>'qty')::integer;
    v_alloc_amount := (v_alloc->>'amount')::numeric;
    select * into v_item from public.webstore_order_items where id = v_item_id;
    insert into public.webstore_order_refund_items
      (refund_id, order_id, order_item_id, qty, amount, sku_snapshot, name_snapshot,
       color_snapshot, size_snapshot, player_name_snapshot, player_number_snapshot)
    values
      (v_refund_id, p_order_id, v_item_id, v_qty, v_alloc_amount, v_item.sku, v_item.name,
       v_item.color, v_item.size, v_item.player_name, v_item.player_number);
    update public.webstore_order_items
       set refunded_qty = refunded_qty + v_qty
     where id = v_item_id;
  end loop;

  update public.webstore_orders
     set refunded_amt = v_new_refunded,
         status = case when v_new_refunded >= v_cap - 0.01 then 'refunded' else status end
   where id = p_order_id;

  -- Preserve migration 00217's full-refund conversion-invoice cleanup, now
  -- comparing against the immutable billed amount instead of the edited total.
  if v_new_refunded >= v_cap - 0.01 and o.so_id is not null then
    update public.invoices
       set status = 'void',
           memo = coalesce(memo, '')
                  || E'\n[Auto-voided ' || to_char(now(), 'MM/DD/YYYY')
                  || ': webstore order fully refunded]',
           updated_at = now()
     where so_id = o.so_id
       and status not in ('void', 'cancelled');
  end if;

  return jsonb_build_object('ok', true, 'refund_id', v_refund_id,
    'refunded_amt', v_new_refunded, 'total', coalesce(o.total, 0),
    'original_total', v_cap,
    'item_allocations', jsonb_array_length(coalesce(p_items, '[]'::jsonb)));
end;
$$;

revoke all on function public.apply_webstore_refund(uuid, numeric, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_webstore_refund(uuid, numeric, text, text, text, text, jsonb)
  to service_role;
