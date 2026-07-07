-- supplier_bill_holds — durable, cross-machine record of supplier bills set aside in
-- the "Look at Later" queue (and how they were resolved).
--
-- Why this exists: parking a bill used to be a pure localStorage flag (nsa_saved_bills).
-- That made "Look at Later" a per-browser snooze, not a real hold — a fresh Sports Inc /
-- S&S pull re-surfaced parked bills (the pull dedup only skips bills already PUSHED, via
-- _docAlreadyApplied), and a teammate on another machine never saw them at all. This table
-- moves the parked/resolved subset server-side so:
--   • both pull doors (pullFromSportsInc / pullFromSS) skip a held doc on every machine, and
--   • the Look at Later tab shows the same queue wherever you log in.
--
-- Scope is deliberately the worklist only — NOT all bill history (that stays local). One row
-- per bill id; status tracks its lifecycle. The client writes through on park / resolve /
-- push and deletes on "move back to review". Dedup at pull time reads these (loaded into
-- savedBills), so no unique constraint is needed on doc_number (and two bills can legitimately
-- share a doc# — a credit vs its invoice — which a unique constraint would wrongly reject).

create table if not exists public.supplier_bill_holds (
  id            text primary key,               -- the client bill id (e.g. 'BILL-1783...-0')
  file          text,                           -- display label ("S&S Activewear · Inv … · PO …")
  doc_number    text,                           -- supplier doc / invoice #
  si_doc_number text,                           -- SportsLink / S&S order # (second dedup key)
  source        text,                           -- 'sportsinc' | 'ss_orders' | 'pdf' | …
  vendor        text,
  po_number     text,
  doc_total     numeric,
  freight       numeric,
  parsed        jsonb,                          -- bill snapshot (items + match state; rawText stripped)
  status        text        not null default 'parked',  -- 'parked' | 'resolved' | 'pushed'
  portal_status text,                           -- mirrors the bill's portalStatus
  resolution    jsonb,                          -- {disposition, note, by, at}
  held_by       text,
  held_at       timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists supplier_bill_holds_doc_idx    on public.supplier_bill_holds (lower(doc_number)) where doc_number is not null;
create index if not exists supplier_bill_holds_sidoc_idx  on public.supplier_bill_holds (si_doc_number)     where si_doc_number is not null;
create index if not exists supplier_bill_holds_status_idx on public.supplier_bill_holds (status);

alter table public.supplier_bill_holds enable row level security;

-- Sensitive supplier-bill data: only active staff may read/write from the browser.
-- Mirrors the si_documents staff gate (team_members.auth_id = auth.uid()).
drop policy if exists supplier_bill_holds_staff_all on public.supplier_bill_holds;
create policy supplier_bill_holds_staff_all
  on public.supplier_bill_holds
  for all
  to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
