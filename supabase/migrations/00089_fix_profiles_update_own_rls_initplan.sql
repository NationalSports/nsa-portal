-- Addresses the auth_rls_initplan advisor warning on
-- public.user_profiles.profiles_update_own. The policy's USING
-- expression calls auth.uid() once per row evaluated. Wrapping in a
-- subselect makes Postgres cache the value as a constant for the
-- duration of the query, so it's evaluated once instead of N times.
--
-- Behavioral semantics: identical. (auth_id = auth.uid()) and
-- (auth_id = (SELECT auth.uid())) return the same boolean for the
-- same row in the same session.
--
-- Pre-change state (verified via pg_policy):
--   USING (auth_id = auth.uid())
--   WITH CHECK: NULL
--   roles: PUBLIC (anon + authenticated both fall under this; for
--          anon, auth.uid() is NULL so auth_id = NULL is always
--          NULL→false, which means the policy correctly denies anon
--          updates regardless)
--
-- ALTER POLICY (rather than DROP + CREATE) keeps the policy in place
-- atomically — there's no window where the table is unprotected.
--
-- Rollback (run via SQL editor if needed):
--   ALTER POLICY profiles_update_own ON public.user_profiles
--     USING (auth_id = auth.uid());

ALTER POLICY profiles_update_own ON public.user_profiles
  USING (auth_id = (SELECT auth.uid()));
