-- ============================================================
-- Quote Requests — customer-facing quote input forms
-- Migration: 00029_quote_requests
-- ============================================================
-- NOTE: Uses text IDs to match existing app schema (customers,
-- team_members, estimates all use text IDs in production)

-- ────────────────────────────────────────────────────────────
-- QUOTE_REQUESTS (one per customer request)
-- ────────────────────────────────────────────────────────────
create table if not exists public.quote_requests (
  id            text primary key,
  token         text not null unique,               -- unique public token for URL
  customer_id   text not null,                      -- references customers(id)
  contact_id    text,                               -- references customer_contacts
  created_by    text,                               -- rep who created it (team_members id)
  status        text not null default 'pending' check (status in (
                  'pending','submitted','reviewed','converted'
                )),
  contact_name  text,                               -- who filled it out
  contact_email text,
  notes         text,                               -- customer notes
  estimate_id   text,                               -- linked estimate after conversion
  submitted_at  timestamptz,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_quote_requests_updated
  before update on public.quote_requests
  for each row execute function public.set_updated_at();

create index idx_quote_requests_customer on public.quote_requests(customer_id);
create index idx_quote_requests_token    on public.quote_requests(token);
create index idx_quote_requests_status   on public.quote_requests(status);

-- ────────────────────────────────────────────────────────────
-- QUOTE_REQUEST_ITEMS (line items from the customer)
-- ────────────────────────────────────────────────────────────
create table if not exists public.quote_request_items (
  id               text primary key default gen_random_uuid()::text,
  quote_request_id text not null references public.quote_requests(id) on delete cascade,
  sort_order       integer not null default 0,
  item_type        text not null default 'description' check (item_type in ('sku','description')),
  sku              text,                            -- if customer knows the SKU
  description      text,                            -- freeform: "fleece hood", "dri-fit polo"
  color            text,
  sizes            jsonb not null default '{}',     -- {"S":5,"M":10,"L":8} or {}
  total_qty        integer,                         -- if they just want a total instead of by-size
  decoration_notes text,                            -- rough decoration description
  notes            text,                            -- any other notes per item
  created_at       timestamptz not null default now()
);

create index idx_qr_items_request on public.quote_request_items(quote_request_id);
