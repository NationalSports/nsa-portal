-- Server-only access. Clients cannot read links, private discussion, or snapshots.
create table public.production_packet_links (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.webstores(id) on delete cascade,
 token_hash text not null unique, label text not null, so_id text references public.sales_orders(id) on delete cascade,
 created_by text not null references public.team_members(id), created_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz
);
create table public.production_packet_notes (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.webstores(id) on delete cascade,
 so_id text references public.sales_orders(id) on delete cascade, scope text not null check (scope in ('store','so','garment','decoration','player')),
 target_id text not null default '', text text not null check (length(text) between 1 and 10000),
 created_by text not null references public.team_members(id), created_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.production_packet_message_shares (
 message_id text primary key references public.messages(id) on delete cascade,
 store_id uuid not null references public.webstores(id) on delete cascade, shared_by text references public.team_members(id),
 link_id uuid references public.production_packet_links(id), source text not null check (source in ('staff','decorator')),
 kind text not null default 'message' check (kind in ('message','question','action')), target_id text not null default '',
 owner_id text references public.team_members(id), resolved_at timestamptz, created_at timestamptz not null default now()
);
create table public.production_packet_revisions (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.webstores(id) on delete cascade,
 so_id text references public.sales_orders(id) on delete cascade, fingerprint text not null, snapshot jsonb not null,
 created_by text not null references public.team_members(id), created_at timestamptz not null default now()
);
create index on public.production_packet_links(store_id);
create index on public.production_packet_notes(store_id);
create index on public.production_packet_message_shares(store_id);
create index on public.production_packet_revisions(store_id,created_at desc);
alter table public.production_packet_links enable row level security;
alter table public.production_packet_notes enable row level security;
alter table public.production_packet_message_shares enable row level security;
alter table public.production_packet_revisions enable row level security;
revoke all on public.production_packet_links, public.production_packet_notes, public.production_packet_message_shares, public.production_packet_revisions from anon, authenticated;
grant select, insert, update, delete on public.production_packet_links, public.production_packet_notes, public.production_packet_message_shares to service_role;
grant select, insert on public.production_packet_revisions to service_role;
