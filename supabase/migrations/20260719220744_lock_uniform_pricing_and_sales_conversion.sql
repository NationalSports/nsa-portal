-- Lock custom-uniform money to a server-owned policy and provide one atomic,
-- idempotent handoff from an approved builder order into the existing sales
-- order system.

alter table public.customers
  add column if not exists uniform_discount_percent numeric(5,2) not null default 0;

alter table public.customers
  drop constraint if exists customers_uniform_discount_percent_check;
alter table public.customers
  add constraint customers_uniform_discount_percent_check
  check (uniform_discount_percent between 0 and 100);

insert into public.uniform_settings(key, value, updated_at)
values (
  'pricing_policy',
  '{"publicBase":80,"fabricAdjustments":{"sublimated":0,"matte":0,"mesh":0,"heather":0,"gloss":0},"decorationAdjustments":{"sublimated":0,"heat_transfer":0}}'::jsonb,
  now()
)
on conflict (key) do nothing;

alter table public.uniform_order_requests
  add column if not exists customer_id text references public.customers(id) on delete set null,
  add column if not exists sales_order_id text,
  add column if not exists converted_at timestamptz,
  add column if not exists converted_by text;

alter table public.sales_orders
  add column if not exists uniform_order_id uuid references public.uniform_order_requests(id) on delete set null;

create unique index if not exists uniform_order_requests_sales_order_uidx
  on public.uniform_order_requests(sales_order_id)
  where sales_order_id is not null;
create unique index if not exists sales_orders_uniform_order_uidx
  on public.sales_orders(uniform_order_id)
  where uniform_order_id is not null;

comment on column public.customers.uniform_discount_percent is
  'Server-applied discount from the public custom-uniform price for this account.';
comment on column public.uniform_order_requests.sales_order_id is
  'Existing portal sales order created from the locked, approved builder order.';

create or replace function public.convert_uniform_order_to_sales_order(
  p_order_id uuid,
  p_customer_id text,
  p_actor text
)
returns text
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_order public.uniform_order_requests%rowtype;
  v_customer public.customers%rowtype;
  v_counter bigint;
  v_so_id text;
  v_now text := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sizes jsonb := '{}'::jsonb;
  v_available jsonb := '[]'::jsonb;
  v_roster jsonb;
  v_size text;
  v_qty integer;
  v_design text;
begin
  select * into v_order
  from public.uniform_order_requests
  where id = p_order_id
  for update;

  if not found then raise exception 'Uniform order not found'; end if;
  if v_order.sales_order_id is not null then return v_order.sales_order_id; end if;
  if v_order.locked_at is null
     or v_order.approved_at is null
     or v_order.approved_proof_version is null
     or v_order.approved_proof_version <> v_order.proof_version then
    raise exception 'The latest proof must be approved and locked before conversion';
  end if;

  select * into v_customer from public.customers where id = p_customer_id;
  if not found then raise exception 'Choose a valid customer before conversion'; end if;

  -- Atomic counter allocation. The first call seeds safely above all existing
  -- SO-#### values; later calls increment the same row under row lock.
  insert into public.app_counters(key, value)
  select 'sales_order', coalesce(max((regexp_match(id, '^SO-([0-9]+)$'))[1]::bigint), 1000) + 1
  from public.sales_orders
  on conflict (key) do update
    set value = greatest(public.app_counters.value + 1, excluded.value)
  returning value into v_counter;
  v_so_id := 'SO-' || v_counter::text;

  for v_roster in select value from jsonb_array_elements(coalesce(v_order.roster, '[]'::jsonb)) loop
    v_size := coalesce(nullif(v_roster->>'size', ''), nullif(v_roster->>'label', ''), 'UNASSIGNED');
    v_qty := greatest(coalesce((v_roster->>'qty')::integer, 0), 0);
    if v_qty > 0 then
      v_sizes := jsonb_set(
        v_sizes,
        array[v_size],
        to_jsonb(coalesce((v_sizes->>v_size)::integer, 0) + v_qty),
        true
      );
      if not v_available ? v_size then v_available := v_available || to_jsonb(v_size); end if;
    end if;
  end loop;

  v_design := coalesce(nullif(v_order.config->>'designId', ''), 'AGI-1012');

  insert into public.sales_orders(
    id, customer_id, memo, status, created_by, created_at, updated_at,
    production_notes, shipping_type, shipping_value, ship_to_id,
    default_markup, po_number, tax_rate, tax_exempt, source, uniform_order_id
  ) values (
    v_so_id, v_customer.id,
    v_order.team_name || ' - ' || v_order.order_number || ' - ' || v_design,
    'need_order', nullif(p_actor, ''), v_now, v_now,
    'Uniform Builder ' || v_order.order_number || E'\nApproved proof v' || v_order.proof_version ||
      E'\nCustomer status link remains on the uniform order record.',
    'pct', 0, 'default', coalesce(v_customer.catalog_markup, 1.65),
    v_order.po_number, coalesce(v_customer.tax_rate, 0), coalesce(v_customer.tax_exempt, false),
    'uniform_builder', v_order.id
  );

  insert into public.so_items(
    so_id, item_index, sku, name, brand, color, retail_price, unit_sell,
    sizes, available_sizes, no_deco, is_custom, custom_desc, custom_sell,
    est_qty, qty_only, notes
  ) values (
    v_so_id, 0, v_design, 'Custom ' || v_design || ' Soccer Jersey',
    'National Sports Apparel', coalesce(v_order.config->'teamPalette', '[]'::jsonb)::text,
    v_order.public_unit_price, v_order.unit_price, v_sizes, v_available,
    false, true, v_order.team_name || ' custom uniform', v_order.unit_price,
    v_order.total_qty, false,
    'Created from Uniform Builder order ' || v_order.order_number || '; approved proof v' || v_order.proof_version
  );

  update public.uniform_order_requests
  set customer_id = v_customer.id,
      sales_order_id = v_so_id,
      converted_at = now(),
      converted_by = nullif(p_actor, ''),
      updated_at = now()
  where id = v_order.id;

  insert into public.uniform_order_events(order_id, event_type, actor_type, actor_name, message, metadata)
  values (v_order.id, 'sales_order_created', 'staff', nullif(p_actor, ''),
    'Converted to sales order ' || v_so_id,
    jsonb_build_object('sales_order_id', v_so_id, 'customer_id', v_customer.id));

  return v_so_id;
end;
$$;

revoke all on function public.convert_uniform_order_to_sales_order(uuid, text, text) from public;
revoke all on function public.convert_uniform_order_to_sales_order(uuid, text, text) from anon;
revoke all on function public.convert_uniform_order_to_sales_order(uuid, text, text) from authenticated;
grant execute on function public.convert_uniform_order_to_sales_order(uuid, text, text) to service_role;
