-- 00176 — roster portal write lockdown (audit #11, Phase 1)
--
-- ⚠️  DO NOT APPLY until the coach roster portal frontend has been rerouted to write
--     through netlify/functions/roster-write.js AND that build is deployed. This migration
--     REVOKES direct anon/coach writes on roster_*; applying it before the reroute ships
--     will break the live coach portal (its writes will start getting RLS-denied).
--     Deploy order: (1) ship roster-write.js + the rerouted frontend, (2) verify the coach
--     portal can still edit rosters on the preview, (3) THEN apply this migration.
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
  end loop;
end $$;

commit;
