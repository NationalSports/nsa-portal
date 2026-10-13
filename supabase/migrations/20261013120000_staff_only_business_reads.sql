-- Staff-only reads for the order book, customers, staff and settings.
--
-- Until now every one of these tables carried a `<table>_read` / `<table>_anon_read` policy
-- (`using (true)` for anon — and for any logged-in user), so anyone holding the public anon key
-- shipped in the website could read every customer's orders, prices, costs, contacts and
-- invoices, the staff roster (commission rates included) and vendor records (one with a stored
-- B2B password). Migration 00173 locked down WRITES and deliberately kept these READS open
-- because the public coach portal (?portal=) booted the staff app as anon. That portal now
-- reads one team's rows through netlify/functions/coach-portal-data.js (service role), so the
-- reads can close.
--
-- APPLY ONLY AFTER the coach-portal change (CoachPortalApp / coach-portal-data) is deployed:
-- an old portal tab still booting the staff App loses its data at this point.
--
-- Staff are unaffected: every table below already has `<table>_staff_write` FOR ALL TO
-- authenticated USING is_team_member() (the app_state one keeps its admin / QuickBooks
-- carve-outs), and FOR ALL covers SELECT. Only the extra public policy goes. anon also loses
-- the SELECT privilege, so a read fails loudly (42501, which the app treats as "no access")
-- instead of quietly returning no rows.
--
-- APPLY 20261013110000_rls_staff_check_once_per_query FIRST. While the public `using (true)`
-- policy exists Postgres skips the staff check entirely; once it is gone a bare is_team_member()
-- runs for every row and staff reads of the order book get many times slower. This migration
-- refuses to run while a bare call remains on any of its tables.
--
-- Deliberately NOT in this migration (still public, follow-ups): the product catalog
-- (products, product_inventory, variants, groups — the storefronts, Team Shop and Live Look
-- read it), the roster tables (the coach portal's roster screen reads/writes them directly),
-- omg_rebuild_tokens (the public store builder reads one by token), and the vendor inventory
-- tables that still accept anonymous writes.

begin;

-- 0. Staff checks must already run once per query (see the header), or this makes staff reads slow.
do $$
declare bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into bad from pg_policies
   where schemaname = 'public'
     and tablename in ('sales_orders','so_items','so_item_decorations','so_item_po_lines','so_item_pick_lines',
       'so_jobs','so_art_files','so_firm_dates','estimates','estimate_items','estimate_item_decorations',
       'estimate_art_files','invoices','invoice_items','invoice_payments','customers','customer_contacts',
       'customer_credits','customer_credit_usage','customer_promo_programs','customer_promo_periods',
       'customer_promo_usage','team_members','app_state','vendors','deco_vendors','deco_vendor_pricing',
       'assigned_todos','todo_comments','dismissed_todos','dismissed_notifs','issues','rep_csr_assignments',
       'omg_stores','omg_store_products')
     and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
         ~ '(?<!SELECT )\m(is_team_member|is_admin_member|is_quickbooks_member|is_admin_or_gm|current_user_role)\(\)';
  if bad is not null then
    raise exception 'staff-only reads: apply 20261013110000_rls_staff_check_once_per_query first (bare staff checks in %)', bad;
  end if;
end $$;

-- 1. Drop exactly the public read policy on each table (named, so a rename can't no-op this).
do $$
declare
  r record;
begin
  for r in select * from (values
    ('sales_orders','sales_orders_read'), ('so_items','so_items_read'),
    ('so_item_decorations','so_item_decorations_read'), ('so_item_po_lines','so_item_po_lines_read'),
    ('so_item_pick_lines','so_item_pick_lines_read'), ('so_jobs','so_jobs_read'),
    ('so_art_files','so_art_files_read'), ('so_firm_dates','so_firm_dates_read'),
    ('estimates','estimates_read'), ('estimate_items','estimate_items_read'),
    ('estimate_item_decorations','estimate_item_decorations_read'), ('estimate_art_files','estimate_art_files_read'),
    ('invoices','invoices_read'), ('invoice_items','invoice_items_read'), ('invoice_payments','invoice_payments_read'),
    ('customers','customers_read'), ('customer_contacts','customer_contacts_read'),
    ('customer_credits','customer_credits_read'), ('customer_credit_usage','customer_credit_usage_read'),
    ('customer_promo_programs','customer_promo_programs_read'), ('customer_promo_periods','customer_promo_periods_read'),
    ('customer_promo_usage','customer_promo_usage_read'),
    ('team_members','team_members_read'), ('app_state','app_state_read'),
    ('vendors','vendors_anon_read'), ('deco_vendors','deco_vendors_anon_read'),
    ('deco_vendor_pricing','deco_vendor_pricing_anon_read'),
    ('assigned_todos','assigned_todos_anon_read'), ('todo_comments','todo_comments_anon_read'),
    ('dismissed_todos','dismissed_todos_anon_read'), ('dismissed_notifs','dismissed_notifs_anon_read'),
    ('issues','issues_anon_read'), ('rep_csr_assignments','rep_csr_assignments_anon_read'),
    ('omg_stores','omg_stores_anon_read'), ('omg_store_products','omg_store_products_anon_read')
  ) as t(tbl, pol) loop
    execute format('drop policy if exists %I on public.%I', r.pol, r.tbl);
    execute format('revoke select on public.%I from anon', r.tbl);
  end loop;
end $$;

-- 2. A signed-in coach (Team Shop / Live Look, supabaseCoach session) still reads their own team
-- and its parent account: storefront/AdidasInventory.js loads the team's tier, brands and school
-- colors, falling back to the parent's colors. Same coach identity rule as coach_accounts_self_read.
create or replace function public.coach_customer_ids()
returns setof text
language sql stable security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select ca.customer_id from public.coach_accounts ca
     where ca.status = 'active' and ca.customer_id is not null
       and (ca.auth_user_id = (select auth.uid())
            or lower(ca.email) = lower(coalesce((select auth.jwt()) ->> 'email', '')))
  )
  select customer_id from mine
  union
  select c.parent_id from public.customers c join mine on mine.customer_id = c.id where c.parent_id is not null
$$;
revoke all on function public.coach_customer_ids() from public, anon;
grant execute on function public.coach_customer_ids() to authenticated;

drop policy if exists customers_coach_read on public.customers;
create policy customers_coach_read on public.customers for select to authenticated
  using (id in (select public.coach_customer_ids()));

-- 3. The staff login screen lists the roster before anyone is signed in (first-time setup matches
-- the email; src/lib/auth.js sbGetTeam). It gets these columns only — not phones, access flags,
-- auth ids or commission settings.
create or replace function public.login_roster()
returns table (id text, name text, role text, email text, is_active boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select tm.id, tm.name, tm.role, tm.email, tm.is_active
    from public.team_members tm
   where coalesce(tm.is_active, true)
   order by tm.name, tm.id
$$;
revoke all on function public.login_roster() from public;
grant execute on function public.login_roster() to anon, authenticated;

-- 4. Catalog search (Team Shop, Live Look, og-teamshop / sitemap edge functions) runs as the
-- caller and filters out API-vendor products by reading `vendors`, which anon can no longer
-- select. It only returns catalog rows that are public anyway, so it runs as its owner instead.
alter function public.search_products(text, text, text, text, boolean, integer, integer) security definer;

-- 5. Assert the end state — a migration that reports success while leaving a table open is worse
-- than one that fails.
do $$
declare
  t text;
  tables text[] := array['sales_orders','so_items','so_item_decorations','so_item_po_lines','so_item_pick_lines',
    'so_jobs','so_art_files','so_firm_dates','estimates','estimate_items','estimate_item_decorations',
    'estimate_art_files','invoices','invoice_items','invoice_payments','customers','customer_contacts',
    'customer_credits','customer_credit_usage','customer_promo_programs','customer_promo_periods',
    'customer_promo_usage','team_members','app_state','vendors','deco_vendors','deco_vendor_pricing',
    'assigned_todos','todo_comments','dismissed_todos','dismissed_notifs','issues','rep_csr_assignments',
    'omg_stores','omg_store_products'];
begin
  foreach t in array tables loop
    if has_table_privilege('anon', format('public.%I', t), 'SELECT') then
      raise exception 'staff-only reads: anon can still SELECT %', t;
    end if;
    if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t
               and p.cmd in ('SELECT','ALL')
               and ('anon' = any(p.roles) or 'public' = any(p.roles) or coalesce(btrim(p.qual), '') in ('true', '(true)'))) then
      raise exception 'staff-only reads: % still has a public or unconditional read policy', t;
    end if;
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t
                   and p.cmd in ('SELECT','ALL') and 'authenticated' = any(p.roles) and p.qual ilike '%is_team_member%') then
      raise exception 'staff-only reads: % has no staff read policy left', t;
    end if;
  end loop;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'search_products' and p.prosecdef) then
    raise exception 'staff-only reads: search_products is not security definer';
  end if;
end $$;

commit;
