-- Release gate for advance_job_stage (00192) — a 'release' (hold -> staging) now
-- requires the job to actually be producible: art done AND garments in hand,
-- unless staff explicitly override it. Team Shop backend hardening #1: staff had
-- no guard against releasing a job with no finished art or no stock into the
-- production queue.
--
-- CREATE OR REPLACE cannot change an existing function's argument list in
-- place — Postgres identifies a function by name + parameter type list, so a
-- different arg count is a NEW overload, not a replacement. Leaving the old
-- 00192 6-arg signature callable alongside a new 8-arg one would let a stale
-- client bypass this gate entirely (exactly the footgun this migration exists
-- to close). So this migration DROPS the 00192 signature first, then creates
-- the 8-arg one. All three existing callers (TeamShopQueue.js:300-306,
-- job-scan.js:240-247, App.js:10436) call with NAMED arguments and never pass
-- p_override/p_reason — they keep working unchanged against the new signature
-- because the two new parameters are optional/defaulted (p_override boolean
-- default false, p_reason text default null), appended at the end. No caller
-- needs to change for this migration to be safe to apply.
--
-- New behavior — ONLY for p_event = 'release':
--   * Guard: so_jobs.art_status = 'art_complete' AND item_status <>
--     'need_to_order'. Fails with NSA_NOT_READY:art=<art_status>,item=<item_status>
--     otherwise (a new error class — existing callers don't pattern-match it,
--     so today it surfaces as a generic failure toast / 500, same as any other
--     unhandled RPC error; wiring a friendlier caller-side message is future
--     work, out of scope for this SQL-only migration).
--   * The FSM legality check (hold -> staging) and the optimistic p_expected
--     stale-state check both still run FIRST and UNCHANGED — a release from a
--     state that was never legal still fails NSA_STALE_STATE exactly as
--     before, regardless of p_override. The readiness gate only evaluates once
--     the transition itself is otherwise legal.
--   * p_override boolean default false: when true, skips the readiness guard
--     (staff/rush judgment call — e.g. item_status hasn't caught up yet but a
--     human confirmed the garments are in hand). The event log payload gains
--     {"override": true, "reason": p_reason} so every override is auditable —
--     merged in ONLY when p_event='release' and p_override=true. Every other
--     call (including a non-overridden release) writes p_payload straight
--     through, byte-identical to 00192.
--   * p_reason text default null: free-text reason recorded alongside the
--     override flag. Not required, not validated — an audit trail, not a
--     second workflow gate.
--
-- item_status is CLIENT-COMPUTED ADVISORY, not a server-verified fact: so_jobs
-- has no trigger/RPC that recomputes it from PO/receiving state (traced —
-- App.js recalculates it in several UI handlers, e.g. the receiving flow
-- around ~11780/~17024, the stock-pull flow around ~16363, and ~19328, all via
-- local setSOs/savSO writes, not a shared server function). A stale
-- item_status can therefore let a release through that shouldn't, or block one
-- that should be allowed. The FULL fulfillment recompute (so this guard reads
-- a trustworthy value) deliberately does NOT live in this SQL migration — it
-- belongs in a future auto-release sweep (a scheduled job that recomputes
-- item_status from po/receiving data before the gate ever runs), matching this
-- repo's existing sweep pattern (teamshop-auto-po.js's `sweep`,
-- followup-sweep.js, teamshop-stuck-sweep.js). Until that sweep ships,
-- p_override is the staff escape hatch for a job whose item_status the UI
-- hasn't caught up on.
--
-- Annotation-event producer audit (honesty pass on 00192's header, which
-- listed all five annotation events as one flat list with no indication which
-- are actually wired up to anything):
--   * digitizing_sent     — HAS a producer: App.js:10436 sendToDigitizingVendor
--     (embroidery job hand-off to the Top Star vendor portal).
--   * digitizing_received — HAS a producer: netlify/functions/vendor-digitizing.js
--     handleComplete (Top Star vendor portal marks a job's DST delivered).
--   * art_resolved, goods_received, po_evaluated — RESERVED. No producer exists
--     anywhere in the codebase as of this migration (traced: zero call sites
--     pass these event names to advance_job_stage or job-scan.js). They remain
--     legal p_event values (so a future feature can wire one up without
--     another migration having to touch the event allowlist) but firing one
--     today only happens by hand (psql / RPC console) — nothing in the product
--     does it. In particular goods_received is NOT wired to purchase-order
--     receiving (00193) or the auto-PO engine (00202): receiving a PO shipment
--     today does not emit this event, despite the name.
--
-- Rollback: drop this migration's 8-arg function and re-apply 00192's function
-- body verbatim (00192 itself is unmodified by this migration, so its own
-- CREATE OR REPLACE block is the correct rollback target):
--   drop function if exists public.advance_job_stage(text, text, text, text, text, jsonb, boolean, text);
--   -- then re-run the `create or replace function public.advance_job_stage(...)`
--   -- block from supabase/migrations/00192_job_stage_machine.sql (lines 65-190)
--   -- and its grants (lines 194-196).
--
-- Verification: lexically reviewed against 00192 line-by-line — every existing
-- lock/transition/stale-guard/event-log statement is present unchanged, and the
-- only new statements are the readiness guard and the override payload merge.
-- ALSO applied to a scratch local Postgres 16 instance this session (00192 then
-- 00205, against a minimal so_jobs/job_stage_events/is_team_member stand-in —
-- not the full schema) and exercised end to end:
--   (1) legal release, art_complete + item_status<>'need_to_order' -> succeeds,
--       prod_status hold->staging, unchanged from 00192's behavior.
--   (2) legal release, needs_art + need_to_order -> raises
--       NSA_NOT_READY:art=needs_art,item=need_to_order (job never moves).
--   (3) legal release, art_complete but item_status='need_to_order', called
--       with p_override:=true, p_reason:='staff confirmed stock by hand' ->
--       succeeds, and the job_stage_events payload is exactly
--       {"override": true, "reason": "staff confirmed stock by hand"}.
--   (4) start_run / decorated / packed / digitizing_sent all ran and produced
--       the same column writes 00192 documents (decorated_at/completed_at/
--       packed_at/digitizing_vendor+sent_at), and a subsequent illegal release
--       attempt (from 'completed') still raised NSA_STALE_STATE:completed,
--       confirming the FSM/stale-state checks run before and are unaffected by
--       the new readiness guard.
--   (5) called with the exact named-argument shapes TeamShopQueue.js:300-306,
--       job-scan.js:240-247, and App.js:10436 use (no p_override/p_reason) —
--       all three succeeded unchanged.
-- This was NOT run against the repo's full Supabase schema (RLS policies,
-- triggers, other tables) — only this function's own dependencies. Re-run on a
-- full scratch Supabase DB before this ships to prod, per standard practice.

drop function if exists public.advance_job_stage(text, text, text, text, text, jsonb);

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

  return jsonb_build_object(
    'ok', true, 'event', p_event, 'from', v_from_snap, 'to', v_to_snap, 'job', to_jsonb(v_job));
end $$;

-- Staff phones scan directly (authenticated + guarded above); unattended
-- stations and the job-scan function use the service role. Never anon/public.
revoke all on function public.advance_job_stage(text, text, text, text, text, jsonb, boolean, text) from public;
revoke all on function public.advance_job_stage(text, text, text, text, text, jsonb, boolean, text) from anon;
grant execute on function public.advance_job_stage(text, text, text, text, text, jsonb, boolean, text) to authenticated, service_role;
