-- Audit fix (build audit, MEDIUM): a teamshop/club job's release must go through
-- advance_job_stage (the 00205 gate + audit), never the legacy App.js board.
-- Supersedes the 00216 advance_job_stage body (same 8-arg signature; the only
-- change is the set_config marker) and adds a BEFORE-UPDATE stage guard on so_jobs.
-- See the inline notes on both.
--
-- Rollback:
--   drop trigger if exists trg_guard_teamshop_stage on public.so_jobs;
--   drop function if exists public.guard_teamshop_stage();
--   -- then re-apply the advance_job_stage block from 00216.

create or replace function public.advance_job_stage(
  p_so_id    text,
  p_job_id   text,
  p_event    text,
  p_actor    text,
  p_expected text    default null,
  p_payload  jsonb   default '{}'::jsonb,
  p_override boolean default false,
  p_reason   text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job       so_jobs;
  v_now       timestamptz := now();
  v_role      text;
  v_cur       text;          -- normalized current prod_status
  v_to        text := null;  -- target prod_status; null = no prod_status move
  v_allowed   text[] := null;
  v_from_snap jsonb;
  v_to_snap   jsonb;
  v_vendor    text;
  v_due       timestamptz;
  v_payload   jsonb;         -- p_payload, plus the override annotation when applicable (00205)
begin
  -- Guard: an active team member (staff phone) OR a service-role caller (the
  -- unattended scan station / the job-scan function). Coaches carry the
  -- `authenticated` role but have no team_members row, so is_team_member()
  -- rejects them. Granting to authenticated without this check would let any
  -- signed-in coach drive production.
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    current_setting('request.jwt.claim.role', true),
    '');
  if v_role <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:staff or service role required';
  end if;

  -- Mark this transaction as an AUTHORIZED stage move so the teamshop stage guard
  -- (trg_guard_teamshop_stage, below) permits the release/advance. A direct legacy
  -- App.js write to so_jobs.prod_status never sets this, so the guard preserves the
  -- stage for teamshop/club jobs written outside this RPC.
  perform set_config('nsa.job_stage_rpc', 'on', true);

  if p_event is null or p_event not in (
      'release','start_run','decorated','packed','art_resolved',
      'digitizing_sent','digitizing_received','goods_received','po_evaluated','hold') then
    raise exception 'NSA_BAD_INPUT:unknown event %', coalesce(p_event, '(null)');
  end if;

  -- Lock the job for the transaction (serializes concurrent scans of one job).
  select * into v_job from so_jobs where so_id = p_so_id and id = p_job_id for update;
  if not found then
    raise exception 'NSA_NOT_FOUND:job';
  end if;

  -- Legacy 'ready' folds to 'hold' (mirror App.js _normSt); empty -> 'hold'.
  v_cur := case
             when coalesce(v_job.prod_status, '') = 'ready' then 'hold'
             else coalesce(nullif(v_job.prod_status, ''), 'hold')
           end;

  -- Optimistic concurrency: if the caller asserted a state, it must still hold
  -- (normalized). A UI move between scan render and scan submit fails cleanly.
  if p_expected is not null
     and (case when p_expected = 'ready' then 'hold' else p_expected end) <> v_cur then
    raise exception 'NSA_STALE_STATE:%', v_cur;
  end if;

  -- prod_status transition table (re-derived from App.js — see header).
  case p_event
    when 'release'   then v_allowed := array['hold'];                       v_to := 'staging';
    when 'start_run' then v_allowed := array['staging'];                    v_to := 'in_process';
    when 'decorated' then v_allowed := array['in_process'];                 v_to := 'completed';
    when 'packed'    then v_allowed := array['completed'];                  v_to := 'completed';
    when 'hold'      then v_allowed := array['staging','in_process','hold']; v_to := 'hold';
    else v_allowed := null; v_to := null;  -- annotation events: no move
  end case;

  if v_allowed is not null and not (v_cur = any(v_allowed)) then
    raise exception 'NSA_STALE_STATE:%', v_cur;
  end if;

  -- ── Release gate (00205) ────────────────────────────────────────────────
  -- Only reached once the transition above is otherwise legal (hold -> staging).
  -- item_status is client-computed advisory — see the migration header for why
  -- the full recompute lives in a future sweep, not here.
  if p_event = 'release' and not p_override then
    if coalesce(v_job.art_status, 'needs_art') <> 'art_complete'
       or coalesce(v_job.item_status, 'need_to_order') = 'need_to_order' then
      raise exception 'NSA_NOT_READY:art=%,item=%',
        coalesce(v_job.art_status, '(null)'), coalesce(v_job.item_status, '(null)');
    end if;
  end if;

  -- Override annotation: recorded on the event row only, never touches so_jobs
  -- columns. Every other call's payload is p_payload, byte-identical to 00192.
  v_payload := p_payload;
  if p_event = 'release' and p_override then
    v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('override', true, 'reason', p_reason);
  end if;

  v_from_snap := jsonb_build_object(
    'prod_status',        v_job.prod_status,
    'decorated_at',       v_job.decorated_at,
    'packed_at',          v_job.packed_at,
    'digitizing_sent_at', v_job.digitizing_sent_at);

  -- Complete column write set per event.
  if p_event = 'decorated' then
    update so_jobs set
      prod_status  = 'completed',
      decorated_at = coalesce(decorated_at, v_now),
      decorated_by = coalesce(nullif(p_actor, ''), decorated_by),
      completed_at = coalesce(completed_at, v_now)   -- mirror applyJobMove's completion stamp
    where so_id = p_so_id and id = p_job_id;
  elsif p_event = 'packed' then
    update so_jobs set packed_at = coalesce(packed_at, v_now)
    where so_id = p_so_id and id = p_job_id;
  elsif p_event = 'digitizing_sent' then
    v_vendor := nullif(p_payload->>'vendor', '');
    v_due := case when nullif(p_payload->>'due_at', '') is not null
                  then (p_payload->>'due_at')::timestamptz else null end;
    update so_jobs set
      digitizing_vendor  = coalesce(v_vendor, digitizing_vendor),
      digitizing_sent_at = coalesce(digitizing_sent_at, v_now),
      digitizing_due_at  = coalesce(v_due, digitizing_due_at)
    where so_id = p_so_id and id = p_job_id;
  elsif v_to is not null then
    -- release / start_run / hold: prod_status move only.
    update so_jobs set prod_status = v_to
    where so_id = p_so_id and id = p_job_id;
  end if;
  -- art_resolved / digitizing_received / goods_received / po_evaluated:
  -- annotation-only — the event row below is the record.

  select * into v_job from so_jobs where so_id = p_so_id and id = p_job_id;
  v_to_snap := jsonb_build_object(
    'prod_status',        v_job.prod_status,
    'decorated_at',       v_job.decorated_at,
    'packed_at',          v_job.packed_at,
    'digitizing_sent_at', v_job.digitizing_sent_at);

  insert into job_stage_events (so_id, job_id, event, from_state, to_state, actor, source, payload)
  values (p_so_id, p_job_id, p_event, v_from_snap, v_to_snap,
          nullif(p_actor, ''),
          coalesce(nullif(v_payload->>'source', ''), 'rpc'),
          v_payload);

  -- Wake the client (build audit, HIGH). advance_job_stage writes only so_jobs +
  -- job_stage_events; nothing else bumps the parent SO. The portal's realtime
  -- subscription watches sales_orders, NOT so_jobs, so a floor/queue stage move
  -- was invisible to a staffer with that SO open — and their next App.js save
  -- (receiving, order edit) upserted a STALE prod_status straight back over the
  -- move, silently reverting it. Bumping updated_at fires that subscription so the
  -- client reloads the SO's jobs and saves the current prod_status, not a stale one.
  -- Column-scoped triggers on sales_orders (trg_webstore_sync_status watches
  -- status/_shipped only) do NOT fire on this updated_at write.
  update sales_orders set updated_at = now() where id = p_so_id;

  return jsonb_build_object(
    'ok', true, 'event', p_event, 'from', v_from_snap, 'to', v_to_snap, 'job', to_jsonb(v_job));
end $$;

revoke all on function public.advance_job_stage(text, text, text, text, text, jsonb, boolean, text) from public;
revoke all on function public.advance_job_stage(text, text, text, text, text, jsonb, boolean, text) from anon;
grant execute on function public.advance_job_stage(text, text, text, text, text, jsonb, boolean, text) to authenticated, service_role;

-- ── Teamshop/club stage guard ───────────────────────────────────────────────
-- Closes the audit gap where a teamshop/club job could be RELEASED to the floor
-- through the legacy App.js production board (moveJobStatus -> applyJobMove ->
-- savSO writes so_jobs.prod_status DIRECTLY), bypassing the 00205 readiness gate,
-- the override-reason requirement, and the job_stage_events audit trail.
--
-- A teamshop/club job's release must go through advance_job_stage (Production HQ /
-- Floor Station). This BEFORE trigger permits that path (it sets nsa.job_stage_rpc
-- above) and, for any OTHER writer, preserves the stage on a FORWARD release
-- (hold/ready -> staging/in_process/completed) of a teamshop/club job.
--
-- Deliberately NARROW:
--   * Only a forward release is guarded — moves BACK to hold (Recall Art,
--     hold-art-siblings) and all non-teamshop jobs are untouched, so the huge
--     majority of legacy-board activity is unaffected.
--   * Non-teamshop jobs never match the order_source EXISTS (index-backed on
--     webstore_orders.so_id), so regular Connect production is a pure no-op.
--   * Silent preserve (not RAISE): a staff SO save that happens to include a
--     stray stage change still commits its other edits; only the ungated stage
--     move is ignored (the board card reverts on the next realtime refresh).
-- Composes with 00213: by resetting NEW.prod_status to OLD, that AFTER trigger's
-- WHEN (NEW.prod_status IS DISTINCT FROM OLD.prod_status) is false, so it no-ops.
create or replace function public.guard_teamshop_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(OLD.prod_status, 'hold') in ('hold', 'ready')
     and NEW.prod_status in ('staging', 'in_process', 'completed')
     and coalesce(current_setting('nsa.job_stage_rpc', true), 'off') <> 'on'
     and exists (
       select 1 from webstore_orders w
        where w.so_id = NEW.so_id and w.order_source in ('teamshop', 'club'))
  then
    NEW.prod_status := OLD.prod_status;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_guard_teamshop_stage on public.so_jobs;
create trigger trg_guard_teamshop_stage
  before update of prod_status on public.so_jobs
  for each row
  execute function public.guard_teamshop_stage();
