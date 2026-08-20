-- Repair the RLS on the gl_* tables so the people it names can actually write.
--
-- Migration 077 guarded gl_accounts, gl_entries, gl_account_balances and
-- gl_import_batches with is_admin_or_gm(), which resolves the caller through
--
--   public.user_profiles where auth_id = auth.uid()
--
-- user_profiles.auth_id is NULL on all 28 rows, including all 3 admins, so
-- that predicate is false for every caller and the tables have never been
-- writable by anyone through the browser. The first real import surfaced it as
--
--   gl_detail_2025.csv failed: new row violates row-level security policy
--   for table "gl_entries"
--
-- for a signed-in admin.
--
-- Identity in this database lives in team_members.auth_id — that is what
-- is_team_member() reads, and what every other staff-writable table
-- (customer_invoices, sales_orders, netsuite_pos, …) is guarded by. 5 admins
-- and 2 accounting users have it populated and active.
--
-- This introduces a separate is_gl_admin() rather than redefining
-- is_admin_or_gm(). That function also backs the profiles_admin_all policy on
-- user_profiles, which is dead for the same reason; repairing it here would
-- silently grant admin write on user_profiles as a side effect of fixing a
-- ledger import. Scope stays on the four gl_* tables.
--
-- The membership itself is unchanged: admin and gm only, exactly what 077
-- intended. Note there is currently no team member with the 'gm' role, so in
-- practice this is the 5 admins. Whether the 2 accounting users should also be
-- able to import is a separate decision and is deliberately NOT made here.

create or replace function public.is_gl_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.team_members tm
    where tm.auth_id = (select auth.uid())
      and coalesce(tm.is_active, true)
      and tm.role in ('admin', 'gm')
  );
$function$;

alter policy gl_accounts_admin  on public.gl_accounts
  using (public.is_gl_admin()) with check (public.is_gl_admin());

alter policy gl_entries_admin   on public.gl_entries
  using (public.is_gl_admin()) with check (public.is_gl_admin());

alter policy gl_balances_admin  on public.gl_account_balances
  using (public.is_gl_admin()) with check (public.is_gl_admin());

alter policy gl_batches_admin   on public.gl_import_batches
  using (public.is_gl_admin()) with check (public.is_gl_admin());
