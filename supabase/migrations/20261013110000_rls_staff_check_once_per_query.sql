-- Staff access checks run once per query instead of once per row.
--
-- Row-level-security policies call is_team_member() / is_admin_member() / is_quickbooks_member()
-- / is_admin_or_gm() / current_user_role() bare. Postgres evaluates a bare call in a policy for
-- EVERY row it reads (the helpers are SECURITY DEFINER, so they can't be inlined), and each call
-- is its own lookup on team_members / user_profiles. Measured on production as a signed-in admin
-- (2026-10-13): reading message_reads' 11k ids took 147 ms against 1.6 ms for the same scan
-- without the check; app_state's 25.7k rows took 462 ms. The app pages through these tables 1000
-- rows at a time with ORDER BY, so every page pays for the whole table again — this is most of the
-- staff app's database time at startup.
--
-- Wrapped as `(SELECT is_team_member())` the call becomes an InitPlan: evaluated once per query,
-- the same answer for every row. The helpers are STABLE and take no arguments, so the answer can't
-- differ between rows of one statement — who can read or write what is unchanged. (Postgres's own
-- advice for RLS; Supabase's advisor flags the bare form.)
--
-- Must be applied BEFORE 20261013120000_staff_only_business_reads: today most of these tables also
-- carry a `using (true)` read policy, which Postgres folds into "everyone passes" so the bare staff
-- check costs nothing there. Dropping that policy without this change would make every staff read
-- of the order book pay the per-row cost (scratch test: 50k rows, 4.6 ms -> 398 ms). The lockdown
-- migration refuses to run while any bare call remains on its tables.
--
-- Generic on purpose: it rewrites whichever public-schema policies contain a bare helper call
-- (119 on 2026-10-13) rather than restating each one, so it can't drift from production. It then
-- proves the rewrite changed nothing but the wrapping, and that no bare call is left.

begin;

-- Re-parse the deparsed policy text with the same name resolution it was deparsed under.
set local search_path = public, pg_catalog;

create temporary table _rls_wrap_before on commit drop as
  select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public';

do $$
declare
  r record;
  -- A helper call not already directly inside `SELECT `. Production's policies call them unqualified.
  bare constant text := '(?<!SELECT )\m(is_team_member|is_admin_member|is_quickbooks_member|is_admin_or_gm|current_user_role)\(\)';
  n int := 0;
begin
  for r in select tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public'
              and (coalesce(qual, '') ~ bare or coalesce(with_check, '') ~ bare) loop
    execute format('alter policy %I on public.%I', r.policyname, r.tablename)
      || case when r.qual is not null then format(' using (%s)', regexp_replace(r.qual, bare, '(SELECT \1())', 'g')) else '' end
      || case when r.with_check is not null then format(' with check (%s)', regexp_replace(r.with_check, bare, '(SELECT \1())', 'g')) else '' end;
    n := n + 1;
  end loop;
  raise notice 'rls_staff_check_once_per_query: wrapped helper calls in % policies', n;
end $$;

-- Prove it: (1) no bare call is left; (2) every policy, with the wrapping undone, reads exactly as it
-- did before — same tables, same names, same conditions, nothing added or dropped.
do $$
declare
  bare constant text := '(?<!SELECT )\m(is_team_member|is_admin_member|is_quickbooks_member|is_admin_or_gm|current_user_role)\(\)';
  wrapped constant text := '\( SELECT (is_team_member|is_admin_member|is_quickbooks_member|is_admin_or_gm|current_user_role)\(\) AS \1\)';
  bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into bad from pg_policies
   where schemaname = 'public' and (coalesce(qual, '') ~ bare or coalesce(with_check, '') ~ bare);
  if bad is not null then
    raise exception 'rls_staff_check_once_per_query: bare helper calls remain in %', bad;
  end if;

  select string_agg(coalesce(b.tablename, a.tablename) || '.' || coalesce(b.policyname, a.policyname), ', ') into bad
    from _rls_wrap_before b
    full join (select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public') a
      on a.tablename = b.tablename and a.policyname = b.policyname
   where a.policyname is null or b.policyname is null
      or regexp_replace(coalesce(a.qual, ''), wrapped, '\1()', 'g') is distinct from regexp_replace(coalesce(b.qual, ''), wrapped, '\1()', 'g')
      or regexp_replace(coalesce(a.with_check, ''), wrapped, '\1()', 'g') is distinct from regexp_replace(coalesce(b.with_check, ''), wrapped, '\1()', 'g');
  if bad is not null then
    raise exception 'rls_staff_check_once_per_query: rewrite changed more than the wrapping in %', bad;
  end if;
end $$;

commit;
