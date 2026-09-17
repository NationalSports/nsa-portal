-- TUO Store Remittance Reports — the settlement TUO wires us, split by store.
--
-- Sibling of omg_deposits (migration 20260915120000) but NOT the same shape,
-- because the document is not the same shape:
--
--   * OMG prints a 5-character sale code per row, so rows self-match to a store
--     and can wait for one that does not exist yet. TUO prints a store NAME and
--     a type, nothing else. Names are ambiguous in practice — "Vista HS Field
--     Hockey 2026" could be either of two real customers — so a person decides
--     the mapping once per store name and tuo_store_map remembers it. No
--     automatic name guessing ever moves money.
--   * OMG gives a net deposit per store. TUO charges fees on the STATEMENT, so
--     the only per-store number on the report is the gross assessed amount.
--     That gross is what is stored. A per-store net can only be estimated
--     pro-rata (lib/tuoRemittance.js allocateFees) and is never persisted as
--     fact — it would not even reconcile, since the remitted amount also
--     carries shipping and sales tax that belong to no store row.
--
-- SAFETY: purely additive. Three new tables, three new functions, one trigger.
-- No existing column, row, policy or trigger is touched.

create table public.tuo_remittances (
  id uuid primary key default gen_random_uuid(),
  -- TUO's own Remittance/Invoice #, or DATE-<iso> if a report ever lacks one.
  -- Unique, so re-uploading the same report replaces its rows instead of
  -- doubling the money.
  remittance_key text not null unique,
  remittance_no text,
  date_created date not null,
  total_orders integer not null default 0 check (total_orders >= 0),
  item_qty_total integer not null default 0 check (item_qty_total >= 0),
  items_ordered numeric(14,2) not null default 0,
  fundraiser_tax numeric(14,2) not null default 0,
  fundraisers numeric(14,2) not null default 0,
  shipping numeric(14,2) not null default 0,
  bulk_fee numeric(14,2) not null default 0,
  handling numeric(14,2) not null default 0,
  sales_tax numeric(14,2) not null default 0,
  store_discounts numeric(14,2) not null default 0,
  total_billed numeric(14,2) not null default 0,
  total_collected numeric(14,2) not null default 0,
  cc_fees numeric(14,2) not null default 0,
  tuo_fees numeric(14,2) not null default 0,
  total_fees numeric(14,2) not null default 0,
  total_re_closed numeric(14,2) not null default 0,
  remittance_amount numeric(14,2) not null default 0,
  -- TUO's own component rounding: items + shipping + tax vs what they say they
  -- collected. Six cents on the 09/15/26 report. Kept so it is auditable rather
  -- than quietly absorbed.
  collected_drift numeric(14,2) not null default 0,
  source_file text,
  imported_by text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tuo_remittances_date_idx on public.tuo_remittances (date_created desc);

comment on table public.tuo_remittances is
  'One TUO Store Remittance Report = one settlement. remittance_amount is what TUO wires; fees are charged here, not per store.';
comment on column public.tuo_remittances.collected_drift is
  'items + shipping + tax + other components minus total_collected. TUO''s own rounding; recorded, never corrected.';

-- ── The confirm-once decision: which customer is this TUO store? ───────────
create table public.tuo_store_map (
  -- Uppercased full store name exactly as TUO prints it. The FULL name on
  -- purpose: two teams of one club are two stores and may belong on different
  -- customers.
  store_key text primary key,
  store_name text not null,
  customer_id text not null references public.customers(id) on delete cascade,
  -- How the mapping was decided, for later review: 'confirmed' (a person chose
  -- it, possibly accepting a suggestion) is the only value written today.
  decided_by_rule text not null default 'confirmed',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tuo_store_map_customer_idx on public.tuo_store_map (customer_id);

comment on table public.tuo_store_map is
  'TUO store name -> NSA customer, decided once by a person and reused by every later remittance. Nothing auto-matches on name.';

create table public.tuo_remittance_lines (
  id uuid primary key default gen_random_uuid(),
  remittance_id uuid not null references public.tuo_remittances(id) on delete cascade,
  line_no integer not null,
  store_type text,
  store_name text not null,
  -- Uppercased store_name; the join key into tuo_store_map.
  store_key text not null,
  -- Null until this store name has been mapped to a customer.
  customer_id text references public.customers(id) on delete set null,
  matched_at timestamptz,
  billed numeric(14,2) not null default 0,
  free numeric(14,2) not null default 0,
  -- The ONLY per-store money on the report: gross assessed for this store.
  assessed numeric(14,2) not null default 0,
  constraint tuo_remittance_lines_line_key unique (remittance_id, line_no)
);

create index tuo_remittance_lines_customer_idx on public.tuo_remittance_lines (customer_id)
  where customer_id is not null;
create index tuo_remittance_lines_unmapped_idx on public.tuo_remittance_lines (store_key)
  where customer_id is null;
create index tuo_remittance_lines_remittance_idx on public.tuo_remittance_lines (remittance_id);

comment on table public.tuo_remittance_lines is
  'Per-store rows of a TUO remittance. assessed is gross; there is no per-store net on the document. customer_id is null until the store name is mapped.';

-- ── Linking ────────────────────────────────────────────────────────────────
-- A new line adopts an existing mapping. Unmapped lines park with customer_id
-- null and are adopted by tuo_map_store() when someone confirms the store.
create or replace function public.tuo_link_remittance_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.store_key := upper(btrim(coalesce(new.store_key, new.store_name, '')));
  if new.customer_id is null and new.store_key <> '' then
    select m.customer_id into new.customer_id
      from public.tuo_store_map m where m.store_key = new.store_key;
  end if;
  new.matched_at := case when new.customer_id is not null then coalesce(new.matched_at, now()) else null end;
  return new;
end;
$$;

create trigger tuo_remittance_lines_link
  before insert on public.tuo_remittance_lines
  for each row execute function public.tuo_link_remittance_line();

-- Confirm a store -> customer mapping and adopt every row already waiting on
-- it, across every remittance imported so far. One call per store name, ever.
create or replace function public.tuo_map_store(p_store_key text, p_store_name text, p_customer_id text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key text := upper(btrim(coalesce(p_store_key, p_store_name, '')));
  v_rows integer;
begin
  if v_key = '' then
    raise exception 'tuo_map_store: store key is required';
  end if;
  insert into public.tuo_store_map as m (store_key, store_name, customer_id, created_by, updated_at)
  values (v_key, coalesce(nullif(btrim(p_store_name), ''), v_key), p_customer_id, current_setting('request.jwt.claim.sub', true), now())
  on conflict (store_key) do update set
    store_name = excluded.store_name,
    customer_id = excluded.customer_id,
    updated_at = now();

  update public.tuo_remittance_lines l
     set customer_id = p_customer_id, matched_at = now()
   where l.store_key = v_key
     and (l.customer_id is null or l.customer_id <> p_customer_id);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.tuo_map_store(text, text, text) is
  'Record the store -> customer decision and apply it to every remittance line already waiting on that store name. Returns rows updated.';

-- ── Import, atomically ─────────────────────────────────────────────────────
-- One function call is one transaction, so a re-import either keeps the old
-- rows or gets the whole new set — never a header with no rows behind it.
create or replace function public.tuo_import_remittance(p_remittance jsonb, p_lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.tuo_remittances as r (
    remittance_key, remittance_no, date_created, total_orders, item_qty_total,
    items_ordered, fundraiser_tax, fundraisers, shipping, bulk_fee, handling,
    sales_tax, store_discounts, total_billed, total_collected, cc_fees, tuo_fees,
    total_fees, total_re_closed, remittance_amount, collected_drift,
    source_file, imported_by, updated_at
  )
  values (
    p_remittance ->> 'remittance_key',
    nullif(p_remittance ->> 'remittance_no', ''),
    (p_remittance ->> 'date_created')::date,
    coalesce((p_remittance ->> 'total_orders')::int, 0),
    coalesce((p_remittance ->> 'item_qty_total')::int, 0),
    coalesce((p_remittance ->> 'items_ordered')::numeric, 0),
    coalesce((p_remittance ->> 'fundraiser_tax')::numeric, 0),
    coalesce((p_remittance ->> 'fundraisers')::numeric, 0),
    coalesce((p_remittance ->> 'shipping')::numeric, 0),
    coalesce((p_remittance ->> 'bulk_fee')::numeric, 0),
    coalesce((p_remittance ->> 'handling')::numeric, 0),
    coalesce((p_remittance ->> 'sales_tax')::numeric, 0),
    coalesce((p_remittance ->> 'store_discounts')::numeric, 0),
    coalesce((p_remittance ->> 'total_billed')::numeric, 0),
    coalesce((p_remittance ->> 'total_collected')::numeric, 0),
    coalesce((p_remittance ->> 'cc_fees')::numeric, 0),
    coalesce((p_remittance ->> 'tuo_fees')::numeric, 0),
    coalesce((p_remittance ->> 'total_fees')::numeric, 0),
    coalesce((p_remittance ->> 'total_re_closed')::numeric, 0),
    coalesce((p_remittance ->> 'remittance_amount')::numeric, 0),
    coalesce((p_remittance ->> 'collected_drift')::numeric, 0),
    nullif(p_remittance ->> 'source_file', ''),
    nullif(p_remittance ->> 'imported_by', ''),
    now()
  )
  on conflict (remittance_key) do update set
    remittance_no     = excluded.remittance_no,
    date_created      = excluded.date_created,
    total_orders      = excluded.total_orders,
    item_qty_total    = excluded.item_qty_total,
    items_ordered     = excluded.items_ordered,
    fundraiser_tax    = excluded.fundraiser_tax,
    fundraisers       = excluded.fundraisers,
    shipping          = excluded.shipping,
    bulk_fee          = excluded.bulk_fee,
    handling          = excluded.handling,
    sales_tax         = excluded.sales_tax,
    store_discounts   = excluded.store_discounts,
    total_billed      = excluded.total_billed,
    total_collected   = excluded.total_collected,
    cc_fees           = excluded.cc_fees,
    tuo_fees          = excluded.tuo_fees,
    total_fees        = excluded.total_fees,
    total_re_closed   = excluded.total_re_closed,
    remittance_amount = excluded.remittance_amount,
    collected_drift   = excluded.collected_drift,
    source_file       = excluded.source_file,
    imported_by       = excluded.imported_by,
    updated_at        = now()
  returning r.id into v_id;

  delete from public.tuo_remittance_lines where remittance_id = v_id;

  insert into public.tuo_remittance_lines (
    remittance_id, line_no, store_type, store_name, store_key, billed, free, assessed
  )
  select
    v_id,
    (line ->> 'line_no')::int,
    nullif(line ->> 'store_type', ''),
    line ->> 'store_name',
    upper(btrim(line ->> 'store_name')),
    coalesce((line ->> 'billed')::numeric, 0),
    coalesce((line ->> 'free')::numeric, 0),
    coalesce((line ->> 'assessed')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as line;

  return v_id;
end;
$$;

comment on function public.tuo_import_remittance(jsonb, jsonb) is
  'Idempotent whole-report import: upsert by remittance_key and replace its lines, in one transaction. Lines adopt any existing tuo_store_map entry.';

-- ── Access: staff only, same posture as omg_deposits ───────────────────────
alter table public.tuo_remittances enable row level security;
alter table public.tuo_remittance_lines enable row level security;
alter table public.tuo_store_map enable row level security;

create policy tuo_remittances_staff_all on public.tuo_remittances
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy tuo_remittance_lines_staff_all on public.tuo_remittance_lines
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy tuo_store_map_staff_all on public.tuo_store_map
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());

grant select, insert, update, delete on public.tuo_remittances to authenticated;
grant select, insert, update, delete on public.tuo_remittance_lines to authenticated;
grant select, insert, update, delete on public.tuo_store_map to authenticated;
revoke all on public.tuo_remittances from anon;
revoke all on public.tuo_remittance_lines from anon;
revoke all on public.tuo_store_map from anon;

grant execute on function public.tuo_import_remittance(jsonb, jsonb) to authenticated;
grant execute on function public.tuo_map_store(text, text, text) to authenticated;
revoke execute on function public.tuo_import_remittance(jsonb, jsonb) from anon;
revoke execute on function public.tuo_map_store(text, text, text) from anon;

-- The linking trigger function is SECURITY DEFINER, and every function in the
-- public schema is reachable over PostgREST as /rest/v1/rpc/<name>. Nothing
-- outside a trigger should call it, so drop the default PUBLIC grant.
-- PostgreSQL checks EXECUTE when a trigger is created, not each time it fires.
revoke execute on function public.tuo_link_remittance_line() from public, anon, authenticated;
