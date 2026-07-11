-- ss_documents — the S&S Activewear orders bill queue.
--
-- S&S comes through Sports Inc only as a scanned/header-only doc (no usable lines),
-- so instead of waiting on that OCR we pull the bill straight from S&S's own /Orders
-- feed (GET /Orders?All=True&lines=true). The killer field is `yourSku` — S&S echoes
-- OUR OWN SKU back on every line, so the bill matches our Sales Orders exactly with no
-- normalization. See src/ssOrders.js (the browser adapter) and
-- netlify/functions/ss-orders-sync-background.js (the daily sync).
--
-- One row per S&S order (dedup key = order_number, stable from creation; the invoice #
-- only appears after S&S invoices, so it is NOT the key). The sync job (service role)
-- upserts header fields + the raw order and NEVER clobbers a human decision (status /
-- resolved_*), so an upsert on an existing row leaves a review/apply mark untouched while
-- new rows arrive as 'new'. The browser reads the count for the Import & Review badge and
-- re-maps `raw` via mapSsOrderToBill when staff pull the bills in for review.

create table if not exists public.ss_documents (
  order_number       text primary key,                       -- S&S OrderNumber (stable, unique)
  invoice_number     text,                                    -- S&S invoice # (appears after invoicing)
  po_number          text,                                    -- our dealer PO as sent (join key to SOs)
  supplier           text        not null default 'S&S Activewear',
  order_date         date,
  ship_date          date,
  invoice_date       date,
  merchandise_total  numeric,                                 -- sum of shipped line extensions
  freight            numeric,                                 -- header shipping charge
  doc_total          numeric,                                 -- order total
  total_pieces       integer,
  is_credit          boolean     not null default false,      -- negative total (return/credit)
  has_usable_lines   boolean     not null default false,      -- at least one shipped line with a SKU
  raw                jsonb,                                   -- full S&S order (re-mapped in the browser / audit)
  -- Lifecycle: 'new' (just synced) → 'reviewed' (surfaced in Import & Review) →
  --   'applied' (pushed to Billed tracking) | 'ignored'. The Import & Review badge counts 'new'.
  -- Nothing is applied automatically — clean vendor-key matches still wait for a human push.
  status             text        not null default 'new',
  resolved_by        text,                                    -- staff who reviewed / applied
  resolved_at        timestamptz,
  applied_doc_number text,                                    -- the invoice/order # that satisfied it
  notes              text,
  first_seen_at      timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists ss_documents_status_idx   on public.ss_documents (status);
create index if not exists ss_documents_po_idx        on public.ss_documents (po_number) where po_number is not null;
create index if not exists ss_documents_invoice_idx   on public.ss_documents (invoice_number) where invoice_number is not null;
create index if not exists ss_documents_date_idx      on public.ss_documents (order_date desc);

alter table public.ss_documents enable row level security;

-- Sensitive supplier-bill data: only active staff (team_members) may read/write from the
-- browser. The sync job uses the service role, which is RLS-exempt. Mirrors the staff check
-- in netlify/functions/_shared.js verifyUser() and the si_documents policy.
drop policy if exists ss_documents_staff_all on public.ss_documents;
create policy ss_documents_staff_all
  on public.ss_documents
  for all
  to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
