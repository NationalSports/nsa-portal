\set ON_ERROR_STOP 1
\set QUIET 1
-- Verifies migration 00173. Helpers: become a role + set the simulated logged-in uid.
-- STAFF  = authenticated with test.auth_uid = the linked staff member's auth_id.
-- COACH  = authenticated but with an auth_uid that matches NO team_members row (magic-link coach).
-- ANON   = the anon role, no uid.

-- ═══ 1. READS are preserved for everyone ═══
do $$
declare n int;
begin
  -- anon can still read team_members (coach portal rep block) and app_state (branding)
  set local role anon;
  perform set_config('test.auth_uid', '', true);
  select count(*) into n from public.team_members; if n < 2 then raise exception 'R1: anon lost team_members read'; end if;
  select count(*) into n from public.app_state;    if n < 1 then raise exception 'R1: anon lost app_state read'; end if;
  reset role;
  raise notice 'R1 anon reads preserved: OK';
end $$;

-- anon must NOT read scheduled_emails (was world-readable; now staff-only)
do $$
declare n int;
begin
  set local role anon; perform set_config('test.auth_uid','',true);
  select count(*) into n from public.scheduled_emails;
  reset role;
  if n <> 0 then raise exception 'R2: anon can still read scheduled_emails (%)', n; end if;
  raise notice 'R2 scheduled_emails hidden from anon: OK';
end $$;

-- ═══ 2. WRITES: anon blocked on all three ═══
do $$
declare ok boolean;
begin
  set local role anon; perform set_config('test.auth_uid','',true);
  ok := false;
  begin insert into public.app_state(id,value) values('x','1'); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'W1: anon could INSERT app_state'; end if;
  raise notice 'W1 anon app_state write blocked: OK';
end $$;

do $$
declare ok boolean;
begin
  set local role anon; perform set_config('test.auth_uid','',true);
  ok := false;
  begin insert into public.scheduled_emails(send_at,payload) values(now(),'{}'); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'W2: anon could INSERT scheduled_emails'; end if;
  raise notice 'W2 anon scheduled_emails write blocked: OK';
end $$;

-- ═══ 3. WRITES: a magic-link COACH (authenticated, not a team member) is blocked ═══
do $$
declare ok boolean;
begin
  set local role authenticated;
  perform set_config('test.auth_uid','99999999-9999-9999-9999-999999999999', true); -- not in team_members
  ok := false;
  begin insert into public.app_state(id,value) values('coach','1'); exception when insufficient_privilege then ok := true; end;
  reset role;
  if not ok then raise exception 'C1: authenticated coach could INSERT app_state'; end if;
  -- and an UPDATE the coach shouldn't be allowed must affect zero rows (RLS filters it out)
  set local role authenticated;
  perform set_config('test.auth_uid','99999999-9999-9999-9999-999999999999', true);
  update public.team_members set name='hacked' where id='tm-staff';
  reset role;
  if exists(select 1 from public.team_members where id='tm-staff' and name='hacked') then
    raise exception 'C1b: coach UPDATE of team_members took effect';
  end if;
  raise notice 'C1 coach (authenticated non-staff) write blocked: OK';
end $$;

-- ═══ 4. WRITES: a linked STAFF member can do everything ═══
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('test.auth_uid','11111111-1111-1111-1111-111111111111', true); -- tm-staff.auth_id
  insert into public.app_state(id,value) values('staff_key','ok');
  update public.app_state set value='ok2' where id='staff_key';
  insert into public.scheduled_emails(send_at,payload) values(now(),'{"to":"x"}');
  update public.team_members set name='Rep Staff Renamed' where id='tm-floor';
  select count(*) into n from public.app_state where id='staff_key' and value='ok2';
  reset role;
  if n <> 1 then raise exception 'S1: staff write did not persist'; end if;
  raise notice 'S1 staff full write access: OK';
end $$;

-- ═══ 5. service_role bypasses RLS (background functions keep working) ═══
do $$
declare n int;
begin
  set local role service_role; perform set_config('test.auth_uid','',true);
  insert into public.scheduled_emails(send_at,payload) values(now(),'{"cron":true}');
  select count(*) into n from public.scheduled_emails; -- can read all
  reset role;
  if n < 1 then raise exception 'SR1: service_role blocked'; end if;
  raise notice 'SR1 service_role bypasses RLS: OK';
end $$;

\echo ALL_RLS_STEP1_SCENARIOS_PASSED
