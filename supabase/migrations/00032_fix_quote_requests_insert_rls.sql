-- ============================================================
-- Fix: Quote Requests INSERT RLS policy
-- Migration: 00032_fix_quote_requests_insert_rls
-- ============================================================
-- The existing "qr_rep_manage" FOR ALL policy's USING clause
-- becomes the WITH CHECK for INSERTs, but current_profile_id()
-- returns UUID while created_by is TEXT, causing mismatches.
-- This adds an explicit INSERT policy for any authenticated user.

create policy "qr_auth_insert" on public.quote_requests
  for insert to authenticated
  with check (true);
