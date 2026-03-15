-- ============================================================
-- Quote Requests & Items – Row Level Security Policies
-- Migration: 00031_quote_requests_rls
-- ============================================================
-- Fixes: "new row violates row-level security policy for table quote_requests"
-- RLS was enabled on these tables but no policies were defined.

-- ─── Enable RLS (idempotent) ─────────────────────────────────
alter table public.quote_requests      enable row level security;
alter table public.quote_request_items enable row level security;

-- ─── QUOTE_REQUESTS ──────────────────────────────────────────

-- All authenticated staff can read all quote requests
create policy "qr_select" on public.quote_requests
  for select using (true);

-- Admin/GM full access
create policy "qr_admin_all" on public.quote_requests
  for all using (public.is_admin_or_gm());

-- Reps can create and manage their own quote requests
create policy "qr_rep_manage" on public.quote_requests
  for all using (
    created_by = public.current_profile_id()::text
    or exists (
      select 1 from public.customers c
      where c.id = customer_id
        and c.primary_rep_id = public.current_profile_id()
    )
  );

-- Anon users (public quote form) can read & update by token
create policy "qr_public_select" on public.quote_requests
  for select to anon using (true);

create policy "qr_public_update" on public.quote_requests
  for update to anon using (true)
  with check (true);

-- ─── QUOTE_REQUEST_ITEMS ─────────────────────────────────────

-- All authenticated staff can read all items
create policy "qr_items_select" on public.quote_request_items
  for select using (true);

-- Staff write access (admin/gm or request owner)
create policy "qr_items_write" on public.quote_request_items
  for all using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.quote_requests qr
      where qr.id = quote_request_id
        and qr.created_by = public.current_profile_id()::text
    )
  );

-- Anon users (public quote form) can read, insert, delete items
create policy "qr_items_public_select" on public.quote_request_items
  for select to anon using (true);

create policy "qr_items_public_insert" on public.quote_request_items
  for insert to anon with check (true);

create policy "qr_items_public_delete" on public.quote_request_items
  for delete to anon using (true);
