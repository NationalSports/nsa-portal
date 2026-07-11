-- Pending shipping charges.
--
-- Lets the warehouse record a billable shipping charge against a customer who
-- has NO open sales order (Manual Ship → "Ship without an order"). The charge
-- is stored per-customer and auto-attaches to the customer's next rep-created
-- sales order (New SO / estimate→SO) — the mirror image of customer_credits
-- (adds to the order instead of subtracting).
--
-- Additive / idempotent. The app degrades gracefully if this hasn't been
-- applied yet: the SO columns are in _soExtraCols (stripped on insert retry)
-- and the loader treats the child tables as optional (404 is tolerated).

create table if not exists customer_pending_shipping (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  amount numeric not null default 0,   -- billable shipping charge to carry to the next order
  used numeric not null default 0,     -- amount applied to orders so far
  cost numeric default 0,              -- internal label cost paid (carried onto the SO for margin)
  source text,                         -- description / reason
  tracking_number text,
  carrier text,
  label_url text,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists idx_pending_ship_customer on customer_pending_shipping(customer_id);

create table if not exists customer_pending_shipping_usage (
  id serial primary key,
  pending_id text not null references customer_pending_shipping(id) on delete cascade,
  so_id text references sales_orders(id) on delete set null,
  amount numeric not null default 0,
  cost numeric default 0,
  description text,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists idx_pending_ship_usage_pending on customer_pending_shipping_usage(pending_id);
create index if not exists idx_pending_ship_usage_so on customer_pending_shipping_usage(so_id);

alter table sales_orders add column if not exists pending_ship_applied boolean default false;
alter table sales_orders add column if not exists pending_ship_amount numeric default 0;

alter table customer_pending_shipping enable row level security;
alter table customer_pending_shipping_usage enable row level security;

do $$ begin
  create policy "Allow all" on customer_pending_shipping for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all" on customer_pending_shipping_usage for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
