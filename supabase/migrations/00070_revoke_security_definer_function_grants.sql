-- Removes EXECUTE on SECURITY DEFINER functions that don't need to be
-- reachable via /rest/v1/rpc by public clients.
--
-- Audit context: Supabase advisor flagged 11 SECURITY DEFINER functions
-- as executable by anon/authenticated. Code grep confirmed only
-- get_my_profile and link_team_auth are called from the React client;
-- the other 9 are DB-internal helpers, cron jobs, or admin-only RPCs.
--
-- Rollback (run via SQL editor if needed):
--   GRANT EXECUTE ON FUNCTION public.create_past_due_invoice_todos() TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.current_profile_id()            TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.current_user_role()             TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.get_health_report()             TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.get_sales_report(date, date)    TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.is_admin()                      TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.is_admin_or_gm()                TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.rls_auto_enable()               TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.should_notify(uuid, text, boolean) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.get_my_profile()                TO anon;
--   GRANT EXECUTE ON FUNCTION public.link_team_auth(text, uuid)      TO anon;

-- No client callers — revoke from both roles
REVOKE EXECUTE ON FUNCTION public.create_past_due_invoice_todos() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_profile_id()            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_role()             FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_health_report()             FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_sales_report(date, date)    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin()                      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_gm()                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.should_notify(uuid, text, boolean) FROM anon, authenticated;

-- Called from client AFTER auth — keep authenticated, revoke anon only
REVOKE EXECUTE ON FUNCTION public.get_my_profile()                FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_team_auth(text, uuid)      FROM anon;
