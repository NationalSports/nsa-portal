-- ============================================================
-- Fix RLS policies: revert to permissive for anon-key access
-- The portal uses anon key without Supabase auth sessions,
-- so current_profile_id() always returns null. Policies that
-- check created_by = current_profile_id() will always reject.
-- Revert to permissive policies until auth is implemented.
-- Migration: 00053_fix_rls_permissive
-- ============================================================

-- estimate_item_decorations
drop policy if exists "est_deco_write" on public.estimate_item_decorations;
create policy "est_deco_write" on public.estimate_item_decorations
  for all using (true) with check (true);

-- estimate_art_files
drop policy if exists "est_art_write" on public.estimate_art_files;
create policy "est_art_write" on public.estimate_art_files
  for all using (true) with check (true);

-- so_item_decorations
drop policy if exists "so_deco_write" on public.so_item_decorations;
create policy "so_deco_write" on public.so_item_decorations
  for all using (true) with check (true);

-- so_art_files
drop policy if exists "so_art_write" on public.so_art_files;
create policy "so_art_write" on public.so_art_files
  for all using (true) with check (true);

-- so_firm_dates
drop policy if exists "firm_dates_write" on public.so_firm_dates;
create policy "firm_dates_write" on public.so_firm_dates
  for all using (true) with check (true);

-- omg_store_products
drop policy if exists "omg_products_write" on public.omg_store_products;
create policy "omg_products_write" on public.omg_store_products
  for all using (true) with check (true);
