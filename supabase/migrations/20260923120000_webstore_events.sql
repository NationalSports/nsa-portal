-- Webstore shopper funnel tracking.
--
-- Until now a webstore only knew about a shopper once they reached the payment
-- step (that's when a webstore_orders row is born). Everything before that —
-- how many parents opened the store, looked at an item, added to cart, clicked
-- checkout — was invisible, so we couldn't tell where shoppers drop off.
--
-- One row per shopper action. Anonymous: session_id is a random id the storefront
-- keeps in the browser's localStorage (no name, email, IP, or user agent is stored).
-- Rows are written only by netlify/functions/webstore-track.js with the service
-- role, which validates every field; the browser never writes here directly.
--
-- "Purchased" is not an event: the funnel joins order_placed rows to
-- webstore_orders and counts the order only once it's actually live (paid, or a
-- team-tab/PO order), so an abandoned card payment never counts as a sale.

create table if not exists public.webstore_events (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.webstores(id) on delete cascade,
  session_id text not null,
  event text not null check (event in ('store_view', 'product_view', 'add_to_cart', 'cart_view', 'checkout_start', 'order_placed')),
  webstore_product_id uuid,
  order_id uuid,
  device text check (device in ('mobile', 'tablet', 'desktop')),
  value numeric,
  created_at timestamptz not null default now()
);

create index if not exists webstore_events_store_created_idx on public.webstore_events (store_id, created_at);
create index if not exists webstore_events_created_idx on public.webstore_events (created_at);
create index if not exists webstore_events_order_idx on public.webstore_events (order_id) where order_id is not null;

alter table public.webstore_events enable row level security;

-- Staff read only. No insert/update/delete policy: writes go through the
-- service role in webstore-track.js.
drop policy if exists webstore_events_staff_read on public.webstore_events;
create policy webstore_events_staff_read on public.webstore_events
  for select using ((select public.is_team_member()));

comment on table public.webstore_events is
  'Anonymous storefront shopper actions for the webstore funnel reports. Written by webstore-track.js only.';

-- A shopper counts as "purchased" when an order they placed is live: anything
-- but an unpaid card checkout or a cancellation. Refunded orders still count —
-- the shopper did convert.
create or replace function public.webstore_order_is_live(p_status text)
returns boolean language sql immutable as $$
  select coalesce(p_status, '') not in ('pending_payment', 'cancelled', '')
$$;

-- Funnel per store: distinct shoppers (sessions) that reached each step in the
-- window. SECURITY INVOKER so the staff-only RLS above still applies.
create or replace function public.webstore_funnel(p_from timestamptz default null, p_to timestamptz default null, p_store_id uuid default null)
returns table (
  store_id uuid,
  visitors bigint,
  product_viewers bigint,
  cart_adders bigint,
  checkout_starters bigint,
  order_placers bigint,
  purchasers bigint,
  mobile_visitors bigint,
  desktop_visitors bigint,
  tablet_visitors bigint,
  mobile_purchasers bigint,
  desktop_purchasers bigint,
  tablet_purchasers bigint
)
language sql stable security invoker set search_path = public as $$
  with ev as (
    select e.store_id, e.session_id, e.event, e.device, e.order_id, e.created_at
    from webstore_events e
    where (p_from is null or e.created_at >= p_from)
      and (p_to is null or e.created_at < p_to)
      and (p_store_id is null or e.store_id = p_store_id)
  ),
  -- A shopper's device = the one they were on when they first showed up.
  dev as (
    select distinct on (store_id, session_id) store_id, session_id, device
    from ev where device is not null
    order by store_id, session_id, created_at
  ),
  bought as (
    select distinct ev.store_id, ev.session_id
    from ev join webstore_orders o on o.id = ev.order_id
    where ev.event = 'order_placed' and webstore_order_is_live(o.status)
  )
  select
    s.store_id,
    count(distinct s.session_id),
    count(distinct s.session_id) filter (where s.event = 'product_view'),
    count(distinct s.session_id) filter (where s.event = 'add_to_cart'),
    count(distinct s.session_id) filter (where s.event = 'checkout_start'),
    count(distinct s.session_id) filter (where s.event = 'order_placed'),
    count(distinct b.session_id),
    count(distinct s.session_id) filter (where d.device = 'mobile'),
    count(distinct s.session_id) filter (where d.device = 'desktop'),
    count(distinct s.session_id) filter (where d.device = 'tablet'),
    count(distinct b.session_id) filter (where d.device = 'mobile'),
    count(distinct b.session_id) filter (where d.device = 'desktop'),
    count(distinct b.session_id) filter (where d.device = 'tablet')
  from ev s
  left join dev d on d.store_id = s.store_id and d.session_id = s.session_id
  left join bought b on b.store_id = s.store_id and b.session_id = s.session_id
  group by s.store_id
$$;

-- Per-item interest: how many shoppers looked at each item vs. added it to the
-- cart. A high-view / low-add item points at price, sizing, or photos.
create or replace function public.webstore_product_funnel(p_from timestamptz default null, p_to timestamptz default null, p_store_id uuid default null)
returns table (store_id uuid, webstore_product_id uuid, viewers bigint, adders bigint)
language sql stable security invoker set search_path = public as $$
  select e.store_id, e.webstore_product_id,
    count(distinct e.session_id) filter (where e.event = 'product_view'),
    count(distinct e.session_id) filter (where e.event = 'add_to_cart')
  from webstore_events e
  where e.webstore_product_id is not null
    and e.event in ('product_view', 'add_to_cart')
    and (p_from is null or e.created_at >= p_from)
    and (p_to is null or e.created_at < p_to)
    and (p_store_id is null or e.store_id = p_store_id)
  group by e.store_id, e.webstore_product_id
$$;

revoke all on function public.webstore_funnel(timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.webstore_product_funnel(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.webstore_funnel(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.webstore_product_funnel(timestamptz, timestamptz, uuid) to authenticated;
