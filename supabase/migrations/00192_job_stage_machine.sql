-- Production job state machine — one guarded transition RPC + an append-only
-- event log, so shop-floor SCANS can move a job through production safely
-- alongside the existing UI writers (applyJobMove / moveJobStatus in App.js).
--
-- Design (mirrors 00171 place_webstore_order and 00172 apply_coach_art_decision):
--   * SELECT ... FOR UPDATE the job row (serializes concurrent scans of one job);
--   * a transition table re-derived from how the warehouse UI already moves jobs
--     (App.js applyJobMove / moveJobStatus + OrderEditor recall) — NOT invented;
--   * illegal moves raise NSA_STALE_STATE:<current-prod_status>;
--   * an optimistic p_expected guard lets a scan assert the state it saw, so scan
--     moves and UI moves coexist without clobbering each other;
--   * every call appends a job_stage_events row in the SAME transaction.
--
-- Coexistence: the UI writers are deliberately LEFT ALONE. They keep patching
-- prod_status through savSO; this RPC is an additional, guarded path for scans.
--
-- prod_status contract (emb-machine-manifest.js): 'hold' | 'staging' |
-- 'in_process' | 'completed'; legacy 'ready' folds to 'hold'. 'draft' (not yet a
-- real job) and 'shipped' (post-fulfillment) are terminal-ish and out of scope
-- for scan transitions here.
--
-- Legal prod_status transitions (derived from src/App.js):
--   release   : hold                  -> staging      (moveJobStatus(j,'staging'), the "→ In Line" button)
--   start_run : staging               -> in_process   (moveJobStatus(j,'in_process'), "→ In Process")
--   decorated : in_process            -> completed    (moveJobStatus(j,'completed'), "✓ Done"; stamps completed_at)
--   packed    : completed             -> completed    (no move; stamps packed_at — post-decoration warehouse step)
--   hold      : staging | in_process  -> hold         (recall / pull back to Ready-for-Prod)
-- Annotation events (NO prod_status move — the event log is the record; they may
-- fire in any state and stamp their own columns only):
--   art_resolved, digitizing_sent (stamps digitizing_*), digitizing_received,
--   goods_received, po_evaluated.

-- ── Additive columns on so_jobs (all nullable) ──────────────────────────────
alter table public.so_jobs add column if not exists decorated_at      timestamptz;
alter table public.so_jobs add column if not exists decorated_by      text;
alter table public.so_jobs add column if not exists packed_at         timestamptz;
alter table public.so_jobs add column if not exists digitizing_vendor text;
alter table public.so_jobs add column if not exists digitizing_sent_at timestamptz;
alter table public.so_jobs add column if not exists digitizing_due_at timestamptz;

-- ── Append-only event log ───────────────────────────────────────────────────
create table if not exists public.job_stage_events (
  id         bigserial primary key,
  so_id      text,
  job_id     text,
  event      text,
  from_state jsonb,
  to_state   jsonb,
  actor      text,
  source     text,
  payload    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists job_stage_events_job_idx on public.job_stage_events (so_id, job_id, created_at);

-- Staff SELECT only; writes go exclusively through the SECURITY DEFINER RPC below
-- (which runs as the function owner and bypasses RLS). No INSERT policy on purpose.
alter table public.job_stage_events enable row level security;
drop policy if exists job_stage_events_staff_read on public.job_stage_events;
create policy job_stage_events_staff_read on public.job_stage_events
  for select to authenticated using (public.is_team_member());
revoke select, insert, update, delete on public.job_stage_events from anon;

-- ── Transition RPC ──────────────────────────────────────────────────────────
create or replace function public.advance_job_stage(
  p_so_id    text,
  p_job_id   text,
  p_event    text,
  p_actor    text,
  p_expected text  default null,
  p_payload  jsonb default '{}'::jsonb
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
          coalesce(nullif(p_payload->>'source', ''), 'rpc'),
          p_payload);

  return jsonb_build_object(
    'ok', true, 'event', p_event, 'from', v_from_snap, 'to', v_to_snap, 'job', to_jsonb(v_job));
end $$;

-- Staff phones scan directly (authenticated + guarded above); unattended
-- stations and the job-scan function use the service role. Never anon/public.
revoke all on function public.advance_job_stage(text, text, text, text, text, jsonb) from public;
revoke all on function public.advance_job_stage(text, text, text, text, text, jsonb) from anon;
grant execute on function public.advance_job_stage(text, text, text, text, text, jsonb) to authenticated, service_role;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop function if exists public.advance_job_stage(text, text, text, text, text, jsonb);
--   drop table if exists public.job_stage_events;
--   alter table public.so_jobs
--     drop column if exists decorated_at, drop column if exists decorated_by,
--     drop column if exists packed_at, drop column if exists digitizing_vendor,
--     drop column if exists digitizing_sent_at, drop column if exists digitizing_due_at;
