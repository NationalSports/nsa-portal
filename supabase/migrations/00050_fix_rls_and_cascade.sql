-- ============================================================
-- Fix permissive RLS write policies (remove "or true")
-- Migration: 00050_fix_rls_and_cascade
-- ============================================================

-- 1. est_deco_write on estimate_item_decorations
drop policy if exists "est_deco_write" on public.estimate_item_decorations;
create policy "est_deco_write" on public.estimate_item_decorations
  for all using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.estimate_items ei
        join public.estimates e on e.id = ei.estimate_id
      where ei.id = estimate_item_id
        and e.created_by = public.current_profile_id()::text
    )
  );

-- 2. est_art_write on estimate_art_files
drop policy if exists "est_art_write" on public.estimate_art_files;
create policy "est_art_write" on public.estimate_art_files
  for all using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.estimates e
      where e.id = estimate_id
        and e.created_by = public.current_profile_id()::text
    )
  );

-- 3. so_deco_write on so_item_decorations
drop policy if exists "so_deco_write" on public.so_item_decorations;
create policy "so_deco_write" on public.so_item_decorations
  for all using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.so_items si
        join public.sales_orders s on s.id = si.so_id
      where si.id = so_item_id
        and s.created_by = public.current_profile_id()::text
    )
  );

-- 4. so_art_write on so_art_files
drop policy if exists "so_art_write" on public.so_art_files;
create policy "so_art_write" on public.so_art_files
  for all using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.sales_orders s
      where s.id = so_id
        and s.created_by = public.current_profile_id()::text
    )
  );

-- 5. firm_dates_write on so_firm_dates
drop policy if exists "firm_dates_write" on public.so_firm_dates;
create policy "firm_dates_write" on public.so_firm_dates
  for all using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.sales_orders s
      where s.id = so_id
        and s.created_by = public.current_profile_id()::text
    )
  );

-- 6. omg_products_write on omg_store_products
drop policy if exists "omg_products_write" on public.omg_store_products;
create policy "omg_products_write" on public.omg_store_products
  for all using (
    public.is_admin_or_gm()
    or exists (
      select 1 from public.omg_stores os
      where os.id = store_id
        and os.rep_id = public.current_profile_id()::text
    )
  );

-- Cascade delete safety: already RESTRICT on estimates, sales_orders, invoices.
