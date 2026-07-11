-- 00176 — roster portal write lockdown (audit #11, Phase 1)
--
-- ⚠️  DO NOT APPLY until the coach roster portal frontend has been rerouted to write
--     through netlify/functions/roster-write.js AND that build is deployed. This migration
--     REVOKES direct anon/coach writes on roster_*; applying it before the reroute ships
--     will break the live coach portal (its writes will start getting denied).
--     Deploy order: (1) ship roster-write.js + the rerouted frontend, (2) verify the coach
--     portal can still edit rosters on the preview, (3) THEN apply this migration —
--     ideally at a low-activity hour: coach tabs opened BEFORE the reroute deploy still run
--     the old bundle and write roster_* directly; the table-privilege REVOKE below makes
--     those writes fail LOUDLY (privilege error) instead of silently affecting 0 rows,
--     which is intended — a coach seeing an error beats an evening of edits silently lost.
--
-- Migration 00160 left every roster_* table as `FOR ALL TO anon/authenticated USING(true)`,
-- so anyone with the shipped anon key can read/write/delete any club's roster directly. This
-- locks WRITES to staff (is_team_member()); coach-portal writes go through roster-write.js
-- (service role, scoped to the portal alpha_tag's customer family, bypasses RLS). READS stay
-- open (anon for the public portal, authenticated for staff) — read-scoping is a later phase.

begin;

do $$
declare
  t text;
  p record;
  roster_tables text[] := array[
    'roster_kit_templates','roster_order_sessions','roster_teams',
    'roster_team_coaches','roster_players','roster_player_sizes'
  ];
begin
  foreach t in array roster_tables loop
    execute format('alter table public.%I enable row level security', t);

    -- Drop the permissive (USING(true)) write policies — both the anon and the authenticated
    -- FOR ALL policies from 00160. SELECT-only policies are left intact.
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd <> 'SELECT'
        and coalesce(qual, 'true') = 'true' and coalesce(with_check, 'true') = 'true'
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    -- Public portal + app read (dropping the FOR ALL policies above also removed read).
    execute format('drop policy if exists %I on public.%I', t || '_portal_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_portal_read', t);

    -- Staff-only direct write. Coach-portal writes go through roster-write.js (service role).
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (is_team_member()) with check (is_team_member())',
      t || '_staff_write', t
    );

    -- Belt & braces: revoke anon's table-level write privileges outright. Two reasons:
    -- (1) RLS-filtered UPDATE/DELETE from a stale pre-reroute bundle otherwise "succeeds"
    --     affecting 0 rows — silent data loss in any coach tab open across the cutover.
    --     A privilege error (42501) is loud, and the old bundle's optimistic UI at least
    --     stops matching reality only until the coach sees requests failing.
    -- (2) The policy drop-loop above matches pg_get_expr renderings ('true'); a permissive
    --     policy recreated via the dashboard as e.g. USING(1=1) would survive it. With no
    --     table privilege, a surviving permissive policy grants anon nothing.
    execute format('revoke insert, update, delete on public.%I from anon', t);

    -- Assert the lockdown took: any non-SELECT policy other than the staff one means a
    -- permissive write policy survived the expression match above — fail the migration
    -- loudly rather than report success while anon/authenticated writes are still open.
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd <> 'SELECT' and policyname <> t || '_staff_write'
    ) then
      raise exception 'roster lockdown: unexpected write policy remains on %', t;
    end if;
  end loop;
end $$;

commit;
