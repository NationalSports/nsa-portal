\set ON_ERROR_STOP 1
\set QUIET 1

-- ═══ S1: unknown job → NSA_NOT_FOUND ═══
do $$ begin
  begin
    perform apply_coach_art_decision('SO-1', 'nope', 'approve', null, '[]'::jsonb, 'production_files_needed');
    raise exception 'S1: expected NSA_NOT_FOUND';
  exception when others then
    if sqlerrm not like 'NSA_NOT_FOUND%' then raise exception 'S1: wrong error: %', sqlerrm; end if;
  end;
  raise notice 'S1 not-found: OK';
end $$;

-- ═══ S2: bad decision verb → NSA_BAD_INPUT ═══
do $$ begin
  begin
    perform apply_coach_art_decision('SO-1', 'JOB-1-01', 'maybe');
    raise exception 'S2: expected NSA_BAD_INPUT';
  exception when others then
    if sqlerrm not like 'NSA_BAD_INPUT%' then raise exception 'S2: wrong error: %', sqlerrm; end if;
  end;
  raise notice 'S2 bad decision: OK';
end $$;

-- ═══ S3: approve pinned to vanished mock → NSA_MOCKS_CHANGED, nothing persisted ═══
do $$
declare v_status text; v_af text;
begin
  begin
    perform apply_coach_art_decision('SO-1', 'JOB-1-01', 'approve', null,
      '["art1","art2"]'::jsonb, 'production_files_needed',
      '["https://cdn/x/mock-v1.png","https://cdn/x/REPLACED-old-mock.png"]'::jsonb);
    raise exception 'S3: expected NSA_MOCKS_CHANGED';
  exception when others then
    if sqlerrm not like 'NSA_MOCKS_CHANGED:%REPLACED-old-mock%' then raise exception 'S3: wrong error: %', sqlerrm; end if;
  end;
  select art_status into v_status from so_jobs where so_id='SO-1' and id='JOB-1-01';
  if v_status <> 'waiting_approval' then raise exception 'S3: job state leaked: %', v_status; end if;
  select status into v_af from so_art_files where so_id='SO-1' and id='art1';
  if v_af <> 'needs_approval' then raise exception 'S3: art state leaked: %', v_af; end if;
  raise notice 'S3 mocks-changed conflict: OK';
end $$;

-- ═══ S4: reject without comment → NSA_BAD_INPUT ═══
do $$ begin
  begin
    perform apply_coach_art_decision('SO-1', 'JOB-1-01', 'reject', '   ', '["art1"]'::jsonb);
    raise exception 'S4: expected NSA_BAD_INPUT';
  exception when others then
    if sqlerrm not like 'NSA_BAD_INPUT%' then raise exception 'S4: wrong error: %', sqlerrm; end if;
  end;
  raise notice 'S4 comment required: OK';
end $$;

-- ═══ S5: reject — complete write set ═══
do $$
declare j so_jobs; a1 so_art_files; a2 so_art_files; so_ts text; rej jsonb;
begin
  perform apply_coach_art_decision('SO-1', 'JOB-1-01', 'reject', 'Wrong shade of orange',
    '["art1","art2"]'::jsonb, null, null, '7/3/2026, 1:23:45 PM');
  select * into j from so_jobs where so_id='SO-1' and id='JOB-1-01';
  if j.art_status <> 'art_requested' then raise exception 'S5: art_status %', j.art_status; end if;
  if j.coach_rejected is not true then raise exception 'S5: coach_rejected not set'; end if;
  if j.sent_to_coach_at is not null then raise exception 'S5: sent_to_coach_at not cleared (M4)'; end if;
  rej := j.rejections->-1;
  if rej->>'reason' <> 'Wrong shade of orange' or rej->>'by' <> 'Coach' then raise exception 'S5: rejection entry wrong: %', rej; end if;
  if rej->>'at' is null or rej->>'rejected_at' is null then raise exception 'S5: rejection missing at/rejected_at (L1)'; end if;
  select * into a1 from so_art_files where so_id='SO-1' and id='art1';
  select * into a2 from so_art_files where so_id='SO-1' and id='art2';
  if a1.status <> 'waiting_for_art' or a2.status <> 'waiting_for_art' then raise exception 'S5: art status not reset'; end if;
  if a1.prod_files_attached is not false or a2.prod_files_attached is not false then raise exception 'S5: prod_files_attached survived (M2)'; end if;
  if a1.notes <> e'orig note\nCoach feedback: Wrong shade of orange' then raise exception 'S5: notes append wrong: %', a1.notes; end if;
  if a2.notes <> 'Coach feedback: Wrong shade of orange' then raise exception 'S5: null-notes append wrong: %', a2.notes; end if;
  select updated_at into so_ts from sales_orders where id='SO-1';
  if so_ts <> '7/3/2026, 1:23:45 PM' then raise exception 'S5: SO not touched'; end if;
  raise notice 'S5 reject write set: OK';
end $$;

-- ═══ S6: H1 — decision on a job no longer waiting → NSA_STALE_STATE ═══
do $$ begin
  begin
    perform apply_coach_art_decision('SO-1', 'JOB-1-01', 'approve', null,
      '["art1","art2"]'::jsonb, 'production_files_needed');
    raise exception 'S6: expected NSA_STALE_STATE';
  exception when others then
    if sqlerrm not like 'NSA_STALE_STATE:art_requested%' then raise exception 'S6: wrong error: %', sqlerrm; end if;
  end;
  raise notice 'S6 stale-link guard (H1): OK';
end $$;

-- ═══ S7: approve — complete write set, heals the contradictory pair ═══
do $$
declare j so_jobs; a1 so_art_files; r jsonb;
begin
  -- simulate the artist re-send (job back to waiting, coach_rejected still true —
  -- the SO-1199 contradictory shape the RPC must heal on approve)
  update so_jobs set art_status='waiting_approval', sent_to_coach_at=now() where so_id='SO-1' and id='JOB-1-01';
  update so_art_files set status='needs_approval' where so_id='SO-1';

  r := apply_coach_art_decision('SO-1', 'JOB-1-01', 'approve', 'Looks great!',
    '["art1","art2"]'::jsonb, 'production_files_needed',
    '["https://cdn/x/mock-v1.png","https://cdn/x/item-mock-1.png","https://cdn/x/back-mock.png"]'::jsonb,
    '7/3/2026, 1:30:00 PM');
  if (r->>'ok') <> 'true' then raise exception 'S7: rpc not ok'; end if;

  select * into j from so_jobs where so_id='SO-1' and id='JOB-1-01';
  if j.art_status <> 'production_files_needed' then raise exception 'S7: art_status %', j.art_status; end if;
  if j.coach_rejected is not false then raise exception 'S7: coach_rejected not cleared (M4/SO-1199)'; end if;
  if j.coach_approved_at is null then raise exception 'S7: coach_approved_at missing'; end if;
  if j.coach_approval_comment <> 'Looks great!' then raise exception 'S7: comment %', j.coach_approval_comment; end if;
  if jsonb_array_length(j.coach_approved_mocks->'mocks') <> 3 then raise exception 'S7: approved mocks not recorded (H2)'; end if;
  select * into a1 from so_art_files where so_id='SO-1' and id='art1';
  if a1.status <> 'approved' then raise exception 'S7: art1 status %', a1.status; end if;
  raise notice 'S7 approve write set + heal: OK';
end $$;

-- ═══ S8: invalid approved_status → NSA_BAD_INPUT ═══
do $$ begin
  update so_jobs set art_status='waiting_approval' where so_id='SO-1' and id='JOB-1-01';
  begin
    perform apply_coach_art_decision('SO-1', 'JOB-1-01', 'approve', null, '[]'::jsonb, 'shipped');
    raise exception 'S8: expected NSA_BAD_INPUT';
  exception when others then
    if sqlerrm not like 'NSA_BAD_INPUT:approved_status%' then raise exception 'S8: wrong error: %', sqlerrm; end if;
  end;
  raise notice 'S8 approved_status validation: OK';
end $$;

-- ═══ S9: approve without seen_mocks (legacy portal) still works ═══
do $$
declare r jsonb;
begin
  r := apply_coach_art_decision('SO-1', 'JOB-1-01', 'approve', null, '["art1"]'::jsonb, 'upload_emb_files');
  if (r->'job'->>'art_status') <> 'upload_emb_files' then raise exception 'S9: %', r; end if;
  raise notice 'S9 approve without pin: OK';
end $$;

\echo ALL_ART_SCENARIOS_PASSED
