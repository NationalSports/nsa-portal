-- Reverts 00071. Restores PUBLIC's EXECUTE on the 11 SECURITY DEFINER
-- functions that 00071 locked down.
--
-- Why: revoking from PUBLIC broke the live app. Multiple of these
-- functions (notably `is_admin`, `is_admin_or_gm`, `current_profile_id`,
-- `current_user_role`, possibly `should_notify`) are referenced inside
-- RLS policies. Postgres evaluates RLS-policy-invoked functions in the
-- *calling user's* role context, so `authenticated` needs EXECUTE on
-- them. Stripping PUBLIC removed that.
--
-- The GRANT statements below were first run via execute_sql immediately
-- after the breakage was reported. This migration captures that change
-- as a properly-recorded entry in supabase_migrations.schema_migrations,
-- so prod's migration history matches the repo.
--
-- Net effect of 00070 + 00071 + 00072 = zero change vs. pre-audit state.
--
-- Lesson: before locking down a SECURITY DEFINER function via REVOKE,
-- audit pg_policy and pg_proc.prosrc for internal callers. To be done
-- as part of a redo of Step D in a future PR.

GRANT EXECUTE ON FUNCTION public.create_past_due_invoice_todos()    TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_profile_id()               TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role()                TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_health_report()                TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_report(date, date)       TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin()                         TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_gm()                   TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable()                  TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.should_notify(uuid, text, boolean) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile()                   TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_team_auth(text, uuid)         TO PUBLIC;
