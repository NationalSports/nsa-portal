-- Webstore shopper tracking, round 2: where shoppers came from, and sold-out sizes.
--
-- source — set on a shopper's store_view: 'email', 'qr', 'flyer', 'text', 'social',
--          'search', 'roster_link', 'direct', … (src/lib/webstoreTracking.js
--          trafficSource; tagged ?src= links come from Webstores.js).
-- detail — set on the new 'soldout_view' event: the sizes the shopper couldn't
--          pick on an item because they were out of stock, e.g. 'S,2XL'.

alter table public.webstore_events add column if not exists source text;
alter table public.webstore_events add column if not exists detail text;

alter table public.webstore_events drop constraint if exists webstore_events_event_check;
alter table public.webstore_events add constraint webstore_events_event_check
  check (event in ('store_view', 'product_view', 'add_to_cart', 'cart_view', 'checkout_start', 'order_placed', 'soldout_view'));

-- Funnel split by where the shopper came from. A shopper's source is the one on
-- their first store visit in the window (first touch).
create or replace function public.webstore_source_funnel(p_from timestamptz default null, p_to timestamptz default null, p_store_id uuid default null)
returns table (store_id uuid, source text, visitors bigint, cart_adders bigint, purchasers bigint)
language sql stable security invoker set search_path = public as $$
  with ev as (
    select e.store_id, e.session_id, e.event, e.source, e.order_id, e.created_at
    from webstore_events e
    where (p_from is null or e.created_at >= p_from)
      and (p_to is null or e.created_at < p_to)
      and (p_store_id is null or e.store_id = p_store_id)
  ),
  src as (
    select distinct on (store_id, session_id) store_id, session_id, coalesce(source, 'direct') as source
    from ev where event = 'store_view'
    order by store_id, session_id, created_at
  ),
  added as (select distinct store_id, session_id from ev where event = 'add_to_cart'),
  bought as (
    select distinct ev.store_id, ev.session_id
    from ev join webstore_orders o on o.id = ev.order_id
    where ev.event = 'order_placed' and webstore_order_is_live(o.status)
  )
  select s.store_id, s.source, count(*), count(a.session_id), count(b.session_id)
  from src s
  left join added a on a.store_id = s.store_id and a.session_id = s.session_id
  left join bought b on b.store_id = s.store_id and b.session_id = s.session_id
  group by s.store_id, s.source
$$;

-- Sold-out sizes shoppers ran into: per item and size, how many shoppers saw it
-- unavailable, and how many of them still added that item to their cart.
create or replace function public.webstore_soldout(p_from timestamptz default null, p_to timestamptz default null, p_store_id uuid default null)
returns table (store_id uuid, webstore_product_id uuid, size text, viewers bigint, adders bigint)
language sql stable security invoker set search_path = public as $$
  with ev as (
    select e.store_id, e.session_id, e.event, e.webstore_product_id, e.detail
    from webstore_events e
    where e.event in ('soldout_view', 'add_to_cart')
      and e.webstore_product_id is not null
      and (p_from is null or e.created_at >= p_from)
      and (p_to is null or e.created_at < p_to)
      and (p_store_id is null or e.store_id = p_store_id)
  ),
  seen as (
    select distinct ev.store_id, ev.webstore_product_id, ev.session_id, trim(sz) as size
    from ev, unnest(string_to_array(coalesce(ev.detail, ''), ',')) as sz
    where ev.event = 'soldout_view' and trim(sz) <> ''
  ),
  added as (select distinct store_id, webstore_product_id, session_id from ev where event = 'add_to_cart')
  select s.store_id, s.webstore_product_id, s.size, count(*), count(a.session_id)
  from seen s
  left join added a on a.store_id = s.store_id and a.webstore_product_id = s.webstore_product_id and a.session_id = s.session_id
  group by s.store_id, s.webstore_product_id, s.size
$$;

-- For the rep daily digest's "closing soon" alert: per store, shoppers who added
-- to cart vs. shoppers whose order went through, over the store's whole life.
create or replace function public.webstore_cart_gap(p_store_ids uuid[])
returns table (store_id uuid, visitors bigint, cart_adders bigint, purchasers bigint)
language sql stable security invoker set search_path = public as $$
  with ev as (
    select e.store_id, e.session_id, e.event, e.order_id
    from webstore_events e where e.store_id = any(p_store_ids)
  ),
  bought as (
    select distinct ev.store_id, ev.session_id
    from ev join webstore_orders o on o.id = ev.order_id
    where ev.event = 'order_placed' and webstore_order_is_live(o.status)
  )
  select ev.store_id, count(distinct ev.session_id),
    count(distinct ev.session_id) filter (where ev.event = 'add_to_cart'),
    count(distinct b.session_id)
  from ev left join bought b on b.store_id = ev.store_id and b.session_id = ev.session_id
  group by ev.store_id
$$;

revoke all on function public.webstore_cart_gap(uuid[]) from public, anon, authenticated;
grant execute on function public.webstore_cart_gap(uuid[]) to service_role;

revoke all on function public.webstore_source_funnel(timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.webstore_soldout(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.webstore_source_funnel(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.webstore_soldout(timestamptz, timestamptz, uuid) to authenticated;
