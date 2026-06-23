-- si_documents — the shared Sports Inc (SportsLink API) bill queue.
--
-- One row per Sports Inc document (dedup key = siDocNumber). This is the single
-- source of truth for "every supplier bill Sports Inc has for us," so accounting
-- can see and reconcile that nothing slips through. Two capture paths:
--
--   • EDI documents (real line items)  → matched + AI-reconciled in the portal,
--       accounting APPROVES, the bill writes to the SO Billed tracking.
--   • Scanned/OCR documents (e.g. S&S) → the API gives only header totals and no
--       PDF, so these are shown as a "grab from Sports Inc" worklist; the team
--       pulls the PDF, runs it through the existing parser, and the row is marked
--       done when that doc# lands (manual completeness tracking).
--
-- The sync job (service role) upserts header fields and never clobbers a human
-- decision (status / resolved_*). The browser (staff) reads the queue and writes
-- back approvals via RLS gated to active team members.

create table if not exists public.si_documents (
  si_doc_number       bigint primary key,        -- SportsLink siDocNumber (stable, unique)
  supplier_doc_number text,                       -- the supplier's invoice number
  po_number           text,                       -- dealer PO as entered (join key to SOs)
  supplier            text,                        -- real vendor (adidas, SanMar, …)
  si_doc_date         date,
  supplier_doc_date   date,
  ship_date           date,
  due_date            date,
  tracking_number     text,
  merchandise_total   numeric,
  freight_amount      numeric,
  si_upcharge         numeric,
  doc_total           numeric,
  is_credit           boolean     not null default false,
  supplier_method     text,                                   -- 'EDI' | 'OCR' expected (National Sports supplier list)
  source_type         text        not null default 'edi',   -- actual route: 'edi' (usable lines) | 'scanned' (manual)
  raw                 jsonb,                                  -- full API document (re-map / audit)
  -- Lifecycle:
  --   edi:     pending  → approved | ignored
  --   scanned: manual_pending → manual_done | ignored
  -- "Captured" (counts toward we-got-everything) = approved | manual_done | ignored.
  status              text        not null default 'new',
  resolved_by         text,                                   -- staff who approved / marked done
  resolved_at         timestamptz,
  applied_doc_number  text,                                   -- the bill doc# that satisfied it
  notes               text,
  si_historical       boolean     not null default false,     -- mirrors SI Active/Historical
  first_seen_at       timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists si_documents_status_idx   on public.si_documents (status);
create index if not exists si_documents_source_idx    on public.si_documents (source_type);
create index if not exists si_documents_po_idx         on public.si_documents (po_number) where po_number is not null;
create index if not exists si_documents_supplier_idx   on public.si_documents (supplier);
create index if not exists si_documents_date_idx       on public.si_documents (si_doc_date desc);

alter table public.si_documents enable row level security;

-- Sensitive supplier-bill data: only active staff (team_members) may read/write from
-- the browser. The sync job uses the service role, which is RLS-exempt. Mirrors the
-- staff check in netlify/functions/_shared.js verifyUser().
drop policy if exists si_documents_staff_all on public.si_documents;
create policy si_documents_staff_all
  on public.si_documents
  for all
  to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
