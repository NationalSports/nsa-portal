-- Drop duplicate indexes (keeping the {table}_{col}_id variant in each pair)
DROP INDEX IF EXISTS public.idx_customer_contacts_cust;
DROP INDEX IF EXISTS public.idx_est_item_decos_item;
DROP INDEX IF EXISTS public.idx_estimate_items_est;
DROP INDEX IF EXISTS public.idx_omg_products_store;
DROP INDEX IF EXISTS public.idx_so_item_decos_item;
DROP INDEX IF EXISTS public.idx_so_picks_item;
DROP INDEX IF EXISTS public.idx_so_pos_item;
DROP INDEX IF EXISTS public.idx_so_items_so;
DROP INDEX IF EXISTS public.idx_so_jobs_so;

-- Pin search_path on public functions (defense-in-depth against search_path attacks)
ALTER FUNCTION public.create_default_notif_prefs() SET search_path = public, pg_catalog;
ALTER FUNCTION public.current_profile_id() SET search_path = public, pg_catalog;
ALTER FUNCTION public.current_user_role() SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_my_profile() SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_sales_report(p_start_date date, p_end_date date) SET search_path = public, pg_catalog;
ALTER FUNCTION public.increment_version() SET search_path = public, pg_catalog;
ALTER FUNCTION public.is_admin() SET search_path = public, pg_catalog;
ALTER FUNCTION public.is_admin_or_gm() SET search_path = public, pg_catalog;
ALTER FUNCTION public.link_team_auth(p_team_id text, p_auth_id uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.next_display_id(p_entity text, p_prefix text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.search_customers(p_query text, p_rep_id text, p_active_only boolean, p_limit integer, p_offset integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.search_products(p_query text, p_category text, p_vendor_id text, p_color_category text, p_in_stock boolean, p_limit integer, p_offset integer) SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.should_notify(p_user_id uuid, p_event_type text, p_is_urgent boolean) SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_catalog;
