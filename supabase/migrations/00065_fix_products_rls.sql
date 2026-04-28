-- ============================================================
-- Fix RLS on public.products: estimates/SOs auto-save the
-- product row when a line item is added (to keep the catalog
-- in sync with on-the-fly product edits). The original
-- "products_admin_all" policy from 00002 requires
-- is_admin_or_gm(), which checks user_profiles.role — but the
-- portal's role system lives in team_members.access, so users
-- who appear as "admin" in the sidebar may not have a matching
-- user_profiles row at all. Result: every product write fails
-- with 401 / "new row violates row-level security policy for
-- table products", which then marks the parent estimate/SO as
-- a failed save.
--
-- Migration 00053 already loosened the same kind of policy on
-- estimate_item_decorations / so_item_decorations / art_files
-- / firm_dates / omg_store_products, but missed products.
-- This brings products in line with that pattern: any
-- authenticated user can write; reads stay public.
--
-- Migration 00061 already gates anon writes site-wide by
-- restricting qual=true,with_check=true policies to the
-- authenticated role, so creating a permissive write policy
-- here does NOT re-open writes to anonymous users.
-- ============================================================

drop policy if exists "products_admin_all" on public.products;

create policy "products_write" on public.products
  for all to authenticated
  using (true) with check (true);
