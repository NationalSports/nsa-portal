-- applied_bills — the hard, server-side ledger of supplier bills applied to the portal.
--
-- Why: duplicate detection was a client-side scan (submitted batches, PO-line _bill_details,
-- local bill history). That works within one browser but is soft — no constraint enforces it,
-- and a second machine that hasn't loaded the same SOs can re-apply a doc. This table makes
-- "same doc applied twice" a database refusal: one row per applied bill, unique on the
-- normalized doc number (per credit-flag, so a credit note can coexist with its invoice).
--
-- The client (App.js _recordAppliedBills) inserts on every successful apply — both the
-- Push-to-Portal path and the QuickBooks push (which also applies) — and loads the ledger
-- into its dedup set on the import page, so a doc applied on ANY machine dedups everywhere.
-- Rows are never deleted by the app; this is an audit ledger.

create table if not exists public.applied_bills (
  id            bigint generated always as identity primary key,
  doc_norm      text,                                   -- lower(trim(doc_number)); null when the bill has no doc #
  si_doc_number text,                                   -- SI / S&S order # (second dedup key)
  is_credit     boolean     not null default false,
  vendor        text,
  po_number     text,
  doc_total     numeric,
  source        text,                                   -- 'sportsinc' | 'ss_orders' | 'pdf' | …
  applied_by    text,
  applied_at    timestamptz not null default now()
);

-- The constraint that turns scan-and-hope into a refusal. Deliberately NOT a partial index:
-- PostgREST's `onConflict` can only emit a bare column list, and Postgres refuses to infer a
-- partial unique index from that (42P10) — the client upsert would silently fail forever.
-- A full unique index still admits doc_norm-NULL rows freely (NULLs are distinct), which is
-- what we want: bills without a doc # can't be keyed and stay guarded by the client-side
-- _bill_details scan.
create unique index if not exists applied_bills_doc_uniq
  on public.applied_bills (doc_norm, is_credit);
create index if not exists applied_bills_sidoc_idx
  on public.applied_bills (si_doc_number) where si_doc_number is not null;

alter table public.applied_bills enable row level security;

-- Staff-only, same gate as si_documents / supplier_bill_holds.
drop policy if exists applied_bills_staff_all on public.applied_bills;
create policy applied_bills_staff_all
  on public.applied_bills
  for all
  to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
