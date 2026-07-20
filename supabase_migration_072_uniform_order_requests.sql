-- Uniform Builder — order requests from the guided Pro Configurator.
--
-- The Finalize step offers three ways to complete an order: pay by card now
-- (Stripe), submit a school purchase order, or add to the order queue for a
-- rep to process manually. Every path lands here as one row so staff have a
-- single queue to work from (Settings -> Uniform Orders in the portal).
--
-- Public route, no coach login, so inserts are open — same pattern as
-- uniform_designs. Reads/updates are staff-only so contact info and order
-- details aren't exposed over the public anon key.

create table if not exists public.uniform_order_requests (
  id            uuid primary key default gen_random_uuid(),
  team_name     text not null default 'Team',
  sport         text,
  contact_name  text,
  contact_email text,
  config        jsonb not null,          -- full wizard config (re-editable)
  spec          jsonb not null,          -- top garment design spec
  bottom_spec   jsonb,                   -- paired shorts design spec, if included
  roster        jsonb not null default '[]'::jsonb,   -- [{size,label,qty,nums}]
  total_qty     integer not null default 0,
  unit_price    numeric not null default 0,
  total         numeric not null default 0,
  fulfillment   text not null check (fulfillment in ('card','po','manual')),
  status        text not null default 'queued'
                check (status in ('pending_payment','paid','po_submitted','queued','processing','completed','cancelled')),
  po_number     text,
  po_contact    text,
  stripe_intent_id text,
  thumb         text,                    -- data-URL PNG preview (front)
  created_at    timestamptz not null default now()
);

create index if not exists uniform_order_requests_status_idx on public.uniform_order_requests (status, created_at desc);
create index if not exists uniform_order_requests_created_at_idx on public.uniform_order_requests (created_at desc);

alter table public.uniform_order_requests enable row level security;

-- Public demo route: anyone (coach, no login) may create an order request.
drop policy if exists uniform_order_requests_public_insert on public.uniform_order_requests;
create policy uniform_order_requests_public_insert
  on public.uniform_order_requests
  for insert
  to anon, authenticated
  with check (true);

-- Staff-only: read/manage the queue.
drop policy if exists uniform_order_requests_staff_select on public.uniform_order_requests;
create policy uniform_order_requests_staff_select
  on public.uniform_order_requests
  for select
  to authenticated
  using (true);

drop policy if exists uniform_order_requests_staff_update on public.uniform_order_requests;
create policy uniform_order_requests_staff_update
  on public.uniform_order_requests
  for update
  to authenticated
  using (true);

drop policy if exists uniform_order_requests_staff_delete on public.uniform_order_requests;
create policy uniform_order_requests_staff_delete
  on public.uniform_order_requests
  for delete
  to authenticated
  using (true);
