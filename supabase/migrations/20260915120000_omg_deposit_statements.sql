-- OMG Deposit Statements — the weekly bank deposit, split back onto its stores.
--
-- OMG publishes one statement per deposit (Tuesday; the money lands Wednesday).
-- It is company-level: one header for the bank deposit and one row per store
-- that contributed to it. Until now the portal had nowhere to put it —
-- parseOmgAccounting() in src/App.js explicitly refuses a Deposit Statement
-- because assigning a 22-store deposit to the one selected store would be
-- silently, badly wrong.
--
-- TWO TABLES, ONE RULE: a statement is stored whole and immutable-ish, and its
-- store rows attach to omg_stores by OMG sale code. Most rows arrive for stores
-- the portal has not ingested yet (4 of 22 matched on the 09/15/26 statement),
-- so an unmatched row is NOT an error: it parks with store_id null and links
-- itself the moment that store's sale code appears. That is what makes the PDF
-- safe to upload before *or* after a store is processed.
--
-- SIGNS ARE AS PRINTED on the statement: fees are negative when withheld and
-- positive when refunded back, so net_deposit = collected + omg_fee +
-- processing_fee holds on every row, refund weeks included, and a row can be
-- diffed against the paper column for column.
--
-- SAFETY: purely additive. Two new tables, two new functions, two new triggers.
-- No existing column, row, or policy is altered.

create table public.omg_deposits (
  id uuid primary key default gen_random_uuid(),
  -- OMG's statement number ('VQFGYBTFP') when printed, else 'DATE-<iso date>'.
  -- Unique, so re-uploading the same statement updates it instead of doubling
  -- the money.
  statement_key text not null unique,
  statement_no text,
  statement_date date not null,
  deposit_status text,
  bank_account text,
  stores_included integer not null default 0 check (stores_included >= 0),
  total_collected numeric(14,2) not null default 0,
  omg_fee numeric(14,2) not null default 0,
  processing_fee numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  source_file text,
  imported_by text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index omg_deposits_date_idx on public.omg_deposits (statement_date desc);

comment on table public.omg_deposits is
  'One OMG Deposit Statement = one bank deposit. Header totals are OMG''s own; omg_deposit_lines must sum to them.';
comment on column public.omg_deposits.statement_key is
  'Idempotency key for re-import: OMG''s statement number, or DATE-<statement_date> when the statement carries no number.';
comment on column public.omg_deposits.omg_fee is
  'Signed exactly as printed: negative when withheld from the deposit, positive when refunded back.';

create table public.omg_deposit_lines (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.omg_deposits(id) on delete cascade,
  -- Ordinal within the statement. Keyed on this rather than store_code so a
  -- statement that ever lists one store twice still imports.
  line_no integer not null,
  -- OMG sale code, matching omg_stores._omg_sale_code. Always uppercase.
  store_code text not null,
  -- The work-order number OMG sometimes prints ahead of the sale code
  -- ('KB5259 VUG6Y'). Informational; the sale code does the matching.
  work_order text,
  -- The store name as printed, kept so an unmatched row is still identifiable.
  store_name text,
  -- Null until an omg_stores row with this sale code exists. Set automatically
  -- by the triggers below, in either order of arrival.
  store_id text references public.omg_stores(id) on delete set null,
  matched_at timestamptz,
  collected numeric(14,2) not null default 0,
  omg_fee numeric(14,2) not null default 0,
  processing_fee numeric(14,2) not null default 0,
  net_deposit numeric(14,2) not null default 0,
  constraint omg_deposit_lines_deposit_line_key unique (deposit_id, line_no)
);

-- Lookup for the "which deposits has this store been paid in?" card.
create index omg_deposit_lines_store_idx on public.omg_deposit_lines (store_id)
  where store_id is not null;
-- Lookup for the parked rows the store-side trigger has to sweep.
create index omg_deposit_lines_unmatched_idx on public.omg_deposit_lines (store_code)
  where store_id is null;
create index omg_deposit_lines_deposit_idx on public.omg_deposit_lines (deposit_id);

comment on table public.omg_deposit_lines is
  'Per-store rows of an OMG Deposit Statement. store_id is null while the store has not been ingested yet; it links itself when the sale code appears.';
comment on column public.omg_deposit_lines.net_deposit is
  'Cash actually deposited for this store on this statement. Signed as printed: negative on a net-refund week.';

-- ── Linking, in both directions ────────────────────────────────────────────
-- Statement first (the normal case): a new line finds its store, if we have it.
create or replace function public.omg_link_deposit_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.store_code := upper(btrim(coalesce(new.store_code, '')));
  if new.store_id is null and new.store_code <> '' then
    select s.id into new.store_id
      from public.omg_stores s
     where upper(btrim(coalesce(s._omg_sale_code, ''))) = new.store_code
     order by s.id
     limit 1;
  end if;
  new.matched_at := case when new.store_id is not null then coalesce(new.matched_at, now()) else null end;
  return new;
end;
$$;

create trigger omg_deposit_lines_link
  before insert on public.omg_deposit_lines
  for each row execute function public.omg_link_deposit_line();

-- Store first, or store later: ingesting a store adopts every deposit row that
-- has been waiting on its sale code.
--
-- omg_stores is written on every store save, so this fires often and must never
-- be able to fail one. The body is wrapped: a linking problem parks the rows for
-- the next save rather than rejecting the user's store edit.
create or replace function public.omg_link_deposit_lines_for_store()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if coalesce(btrim(new._omg_sale_code), '') = '' then
      return new;
    end if;
    update public.omg_deposit_lines l
       set store_id = new.id,
           matched_at = now()
     where l.store_id is null
       and l.store_code = upper(btrim(new._omg_sale_code));
  exception when others then
    null;  -- never block a store save on deposit bookkeeping
  end;
  return new;
end;
$$;

create trigger omg_stores_link_deposit_lines
  after insert or update of _omg_sale_code on public.omg_stores
  for each row execute function public.omg_link_deposit_lines_for_store();

-- ── Import, atomically ─────────────────────────────────────────────────────
-- Re-importing a statement replaces its rows. Done as two client round trips
-- (delete, then insert) a failure between them would leave the statement with
-- no rows while still showing its header totals — money missing, quietly. One
-- function call is one transaction, so the statement either keeps its old rows
-- or gets the whole new set.
--
-- SECURITY INVOKER on purpose: row-level security still applies, so only a team
-- member can import a deposit.
create or replace function public.omg_import_deposit(p_deposit jsonb, p_lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.omg_deposits as d (
    statement_key, statement_no, statement_date, deposit_status, bank_account,
    stores_included, total_collected, omg_fee, processing_fee, net_amount,
    source_file, imported_by, updated_at
  )
  values (
    p_deposit ->> 'statement_key',
    nullif(p_deposit ->> 'statement_no', ''),
    (p_deposit ->> 'statement_date')::date,
    nullif(p_deposit ->> 'deposit_status', ''),
    nullif(p_deposit ->> 'bank_account', ''),
    coalesce((p_deposit ->> 'stores_included')::int, 0),
    coalesce((p_deposit ->> 'total_collected')::numeric, 0),
    coalesce((p_deposit ->> 'omg_fee')::numeric, 0),
    coalesce((p_deposit ->> 'processing_fee')::numeric, 0),
    coalesce((p_deposit ->> 'net_amount')::numeric, 0),
    nullif(p_deposit ->> 'source_file', ''),
    nullif(p_deposit ->> 'imported_by', ''),
    now()
  )
  on conflict (statement_key) do update set
    statement_no    = excluded.statement_no,
    statement_date  = excluded.statement_date,
    deposit_status  = excluded.deposit_status,
    bank_account    = excluded.bank_account,
    stores_included = excluded.stores_included,
    total_collected = excluded.total_collected,
    omg_fee         = excluded.omg_fee,
    processing_fee  = excluded.processing_fee,
    net_amount      = excluded.net_amount,
    source_file     = excluded.source_file,
    imported_by     = excluded.imported_by,
    updated_at      = now()
  returning d.id into v_id;

  delete from public.omg_deposit_lines where deposit_id = v_id;

  insert into public.omg_deposit_lines (
    deposit_id, line_no, store_code, work_order, store_name,
    collected, omg_fee, processing_fee, net_deposit
  )
  select
    v_id,
    (line ->> 'line_no')::int,
    line ->> 'store_code',
    nullif(line ->> 'work_order', ''),
    nullif(line ->> 'store_name', ''),
    coalesce((line ->> 'collected')::numeric, 0),
    coalesce((line ->> 'omg_fee')::numeric, 0),
    coalesce((line ->> 'processing_fee')::numeric, 0),
    coalesce((line ->> 'net_deposit')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as line;

  return v_id;
end;
$$;

comment on function public.omg_import_deposit(jsonb, jsonb) is
  'Idempotent whole-statement import: upsert the deposit by statement_key and replace its lines, in one transaction.';

-- ── Access: staff only, same posture as omg_store_profit_snapshots ─────────
alter table public.omg_deposits enable row level security;
alter table public.omg_deposit_lines enable row level security;

create policy omg_deposits_staff_all
  on public.omg_deposits
  for all
  to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

create policy omg_deposit_lines_staff_all
  on public.omg_deposit_lines
  for all
  to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

-- New public-schema tables are not automatically exposed to the Data API on
-- newer Supabase projects, so grant the intended staff role explicitly.
grant select, insert, update, delete on public.omg_deposits to authenticated;
grant select, insert, update, delete on public.omg_deposit_lines to authenticated;
revoke all on public.omg_deposits from anon;
revoke all on public.omg_deposit_lines from anon;

grant execute on function public.omg_import_deposit(jsonb, jsonb) to authenticated;
revoke execute on function public.omg_import_deposit(jsonb, jsonb) from anon;

-- The two linking functions are SECURITY DEFINER, and every function in the
-- public schema is reachable over PostgREST as /rest/v1/rpc/<name>. Nothing
-- outside a trigger should be able to call them, so drop the default PUBLIC
-- grant. Triggers are unaffected: PostgreSQL checks EXECUTE when the trigger is
-- created, not each time it fires.
revoke execute on function public.omg_link_deposit_line() from public, anon, authenticated;
revoke execute on function public.omg_link_deposit_lines_for_store() from public, anon, authenticated;
