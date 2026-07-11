-- Team Shop — School-PO checkout (owner-approved flow, follow-up to 00200).
--
-- Eligible programs (customers.teamshop_po_allowed = true, 00200) may check
-- out with a School PO number + a PDF of the PO instead of paying by card.
-- The PO is verified MANUALLY by staff after the order is placed
-- (netlify/functions/teamshop-po-review.js). This migration adds the two
-- pieces of persistence that flow needs:
--
--   1. A PRIVATE storage bucket 'po-docs' for the uploaded PO PDFs.
--      Writes are service-role only (teamshop-checkout.js's place_order_po
--      uploads with the service key, which bypasses RLS) — no INSERT/UPDATE/
--      DELETE policy is created on purpose. Staff may read directly
--      (is_team_member(), same gate as 00191's artwork lockdown); coaches and
--      anon get NO direct read — coach/staff-facing links are short-lived
--      signed URLs minted by functions using the service role.
--
--   2. Additive PO columns on webstore_orders. NO new status column and NO
--      new status values beyond what the stack already understands:
--
--        place_order_po  -> status 'unpaid'      (existing storefront value for
--                                                 a no-card order; NOT convertible
--                                                 — 00199's guard only accepts
--                                                 'paid'/'po_verified'; the coach
--                                                 label map src/lib/
--                                                 teamshopOrderStatus.js already
--                                                 renders 'unpaid' as 'PO review')
--        staff approve   -> status 'po_verified' (the exact value 00199's
--                                                 create_teamshop_sales_order
--                                                 accepts defensively and invoices
--                                                 OPEN — the RPC then sets
--                                                 'batched' as usual)
--        staff reject    -> status 'cancelled'   (terminal; not convertible;
--                                                 reason recorded below)
--
-- RLS on webstore_orders: no policy change. The new columns ride the table's
-- existing policies (July lockdown); coach reads go through service-role
-- functions that hand-pick fields, and teamshop-orders.js deliberately never
-- returns po_doc_path.
--
-- Additive only — nothing here changes card checkout or any existing order.

-- ── 1. Private bucket for PO PDFs (10 MB cap, PDF only) ─────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('po-docs', 'po-docs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Staff read (signed-in team members only). is_team_member() (00173) is
-- SECURITY DEFINER and already granted to authenticated, so a storage policy
-- may call it. No write policies: the service role (which bypasses RLS) is
-- the only writer, and anon/coach roles get no policy at all — the bucket is
-- unreadable to them except through function-minted signed URLs.
drop policy if exists "staff_read_po_docs" on storage.objects;
create policy "staff_read_po_docs" on storage.objects
  for select to authenticated
  using (bucket_id = 'po-docs' and public.is_team_member());

-- ── 2. PO columns on webstore_orders ────────────────────────────────────────
alter table public.webstore_orders
  add column if not exists po_number text,
  add column if not exists po_doc_path text,
  add column if not exists po_rejected_reason text,
  add column if not exists po_reviewed_by text,
  add column if not exists po_reviewed_at timestamptz;

comment on column public.webstore_orders.po_number is
  'School PO number supplied at Team Shop PO checkout (place_order_po). Present only on order_source=teamshop orders placed via the School-PO path.';
comment on column public.webstore_orders.po_doc_path is
  'Storage path of the uploaded PO PDF inside the private po-docs bucket (<order id>/po.pdf). Never exposed to coaches directly — staff view via short-lived signed URLs.';
comment on column public.webstore_orders.po_rejected_reason is
  'Staff-entered reason when a PO order is rejected (status -> cancelled). Recorded even when the rejection email to the coach fails.';
comment on column public.webstore_orders.po_reviewed_by is
  'team_members.id of the staff member who approved/rejected the PO.';
comment on column public.webstore_orders.po_reviewed_at is
  'When the PO was approved/rejected.';

-- Staff PO-review queue reads pending POs by (order_source, status); partial
-- index keeps that cheap without touching the storefront's order indexes.
create index if not exists idx_webstore_orders_po_pending
  on public.webstore_orders (created_at)
  where order_source = 'teamshop' and status = 'unpaid' and po_number is not null;

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- drop index if exists public.idx_webstore_orders_po_pending;
-- alter table public.webstore_orders
--   drop column if exists po_number,
--   drop column if exists po_doc_path,
--   drop column if exists po_rejected_reason,
--   drop column if exists po_reviewed_by,
--   drop column if exists po_reviewed_at;
-- drop policy if exists "staff_read_po_docs" on storage.objects;
-- -- Bucket removal only if empty (objects must be deleted first):
-- -- delete from storage.buckets where id = 'po-docs';
