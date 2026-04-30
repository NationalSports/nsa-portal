-- Revokes EXECUTE on 8 SECURITY DEFINER functions from PUBLIC. The 3
-- helpers used inside RLS policies (is_admin, is_admin_or_gm,
-- current_profile_id) are NOT touched — anon needs EXECUTE on them so
-- that policy evaluation against tables like slack_notifications,
-- product_variants, and user_profiles succeeds.
--
-- Audit trail: 00070/00071/00072 in this repo are the failed first
-- attempt at locking down all 11 functions and its rollback. v1 broke
-- because RLS-helper functions need PUBLIC reach. This v2 only touches
-- functions whose internal callers all use postgres or service_role.
--
-- Verified internal callers:
--   create_past_due_invoice_todos: cron.job 'past-due-invoice-todos-weekly' (postgres)
--   should_notify:                 supabase/functions/slack-notify (service_role)
--   get_health_report:             netlify/functions/so-health-alert.js (service_role)
--   get_my_profile:                src/App.js:348 (authenticated — explicit grant exists)
--   link_team_auth:                src/App.js:344 (authenticated — explicit grant exists)
--   current_user_role, get_sales_report, rls_auto_enable: no callers found
--
-- Rollback (run via SQL editor if needed):
--   GRANT EXECUTE ON FUNCTION public.current_user_role()                TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.should_notify(uuid, text, boolean) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.rls_auto_enable()                  TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_health_report()                TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_sales_report(date, date)       TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.create_past_due_invoice_todos()    TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_my_profile()                   TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.link_team_auth(text, uuid)         TO PUBLIC;

-- Internal-only — postgres + service_role retain explicit grants
REVOKE EXECUTE ON FUNCTION public.current_user_role()                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.should_notify(uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_health_report()                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_report(date, date)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_past_due_invoice_todos()    FROM PUBLIC;

-- Client-called — authenticated keeps its explicit grant, anon loses inherited access
REVOKE EXECUTE ON FUNCTION public.get_my_profile()             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_team_auth(text, uuid)   FROM PUBLIC;
