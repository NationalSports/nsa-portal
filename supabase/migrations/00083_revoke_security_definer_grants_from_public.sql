-- Corrected version of 00070. The previous migration revoked EXECUTE from
-- `anon` and `authenticated` directly, but those roles inherit EXECUTE from
-- the PUBLIC pseudo-role (Postgres' default for functions), so the revoke
-- was a no-op. This migration revokes from PUBLIC, which is what actually
-- removes anon's reach.
--
-- Functions with explicit `authenticated=X/postgres` grants on top of PUBLIC
-- (`get_my_profile`, `link_team_auth`) keep their explicit authenticated
-- grant — only PUBLIC (and therefore anon) loses access.
--
-- service_role and postgres have their own explicit grants on every
-- function — both unaffected. Cron jobs (running as postgres) and Netlify
-- functions (using service_role) continue to work.
--
-- Rollback (run via SQL editor if needed):
--   GRANT EXECUTE ON FUNCTION public.create_past_due_invoice_todos()    TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.current_profile_id()               TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.current_user_role()                TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_health_report()                TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_sales_report(date, date)       TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.is_admin()                         TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.is_admin_or_gm()                   TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.rls_auto_enable()                  TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.should_notify(uuid, text, boolean) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_my_profile()                   TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.link_team_auth(text, uuid)         TO PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_past_due_invoice_todos()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_profile_id()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_role()                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_health_report()                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_report(date, date)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin()                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_gm()                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.should_notify(uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile()                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_team_auth(text, uuid)         FROM PUBLIC;
