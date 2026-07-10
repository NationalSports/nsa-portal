-- A coach decision requires the art to have been SENT to the coach.
--
-- Audit 2026-07-10, finding A1: every artist mockup submission parks its job at
-- waiting_approval for INTERNAL rep review; the rep then forwards it with "Send to
-- Coach" (stamping sent_to_coach_at). The 00172 RPC only checked art_status, so a
-- coach who opened their persistent portal link during the rep-review window could
-- approve a draft the rep never sent — bypassing the rep-review gate. The portal UI
-- no longer shows un-forwarded art as "Awaiting Your Approval", and this closes the
-- server side: a decision on an un-sent job raises NSA_NOT_SENT (portal-action maps
-- it to a 409 "not ready for review yet").
--
-- Identical to 00172's function otherwise (locked read, waiting_approval guard,
-- seen-mocks pinning, complete atomic write sets).

create or replace function apply_coach_art_decision(
  p_so_id            text,
  p_job_id           text,
  p_decision         text,                     -- 'approve' | 'reject'
  p_comment          text default null,        -- required for reject
  p_art_ids          jsonb default '[]'::jsonb,-- so_art_files ids the job decorates with
  p_approved_status  text default null,        -- prod-files stage the job lands on (approve)
  p_seen_mocks       jsonb default null,       -- mock URLs the portal rendered (approve)
  p_touch_updated_at text default null         -- locale-format SO timestamp from the caller
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     so_jobs;
  v_now     timestamptz := now();
  v_missing text;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'NSA_BAD_INPUT:decision must be approve or reject';
  end if;

  select * into v_job from so_jobs where so_id = p_so_id and id = p_job_id for update;
  if not found then
    raise exception 'NSA_NOT_FOUND:job';
  end if;

  -- H1: only a job still waiting on the coach may be decided. A tab opened
  -- before a rep recall/update gets a conflict instead of resurrecting the job.
  if v_job.art_status <> 'waiting_approval' then
    raise exception 'NSA_STALE_STATE:%', v_job.art_status;
  end if;

  -- A1: only art the rep actually FORWARDED may be decided. Un-sent
  -- waiting_approval jobs are still under internal rep review.
  if v_job.sent_to_coach_at is null then
    raise exception 'NSA_NOT_SENT:%', v_job.id;
  end if;

  if p_decision = 'approve' then
    if p_approved_status is null
       or p_approved_status not in ('production_files_needed', 'order_dtf_transfers', 'upload_emb_files', 'art_complete') then
      raise exception 'NSA_BAD_INPUT:approved_status';
    end if;

    -- H2: every mock the coach was looking at must still exist on the job's art
    -- files. An artist re-upload/replace between page load and the Approve click
    -- removes the old URL from the pools, so the approval would describe an
    -- image that is no longer the artwork — conflict instead of record it.
    if p_seen_mocks is not null and jsonb_array_length(p_seen_mocks) > 0 then
      with pools as (
        select jsonb_array_elements(coalesce(a.mockup_files, '[]'::jsonb)) as f
          from so_art_files a
         where a.so_id = p_so_id and p_art_ids @> to_jsonb(a.id)
        union all
        select jsonb_array_elements(coalesce(a.files, '[]'::jsonb))
          from so_art_files a
         where a.so_id = p_so_id and p_art_ids @> to_jsonb(a.id)
        union all
        select jsonb_array_elements(v.val)
          from so_art_files a,
               lateral jsonb_each(coalesce(a.item_mockups, '{}'::jsonb)) as v(key, val)
         where a.so_id = p_so_id and p_art_ids @> to_jsonb(a.id)
           and jsonb_typeof(v.val) = 'array'
        union all
        select to_jsonb(a.preview_url)
          from so_art_files a
         where a.so_id = p_so_id and p_art_ids @> to_jsonb(a.id) and a.preview_url is not null
      ), urls as (
        select case when jsonb_typeof(f) = 'string' then f #>> '{}'
                    else coalesce(f->>'url', f->>'name') end as u
          from pools
      )
      select string_agg(t.u, ', ') into v_missing
        from jsonb_array_elements_text(p_seen_mocks) as t(u)
       where t.u not in (select u from urls where u is not null);
      if v_missing is not null then
        raise exception 'NSA_MOCKS_CHANGED:%', v_missing;
      end if;
    end if;

    -- M4-complete approve write set: forward state, provenance, and the
    -- rejection flag cleared in the SAME write — never a contradictory pair.
    update so_jobs set
      art_status             = p_approved_status,
      coach_approved_at      = v_now,
      coach_approval_comment = nullif(trim(coalesce(p_comment, '')), ''),
      coach_rejected         = false,
      coach_approved_mocks   = case when p_seen_mocks is not null
                                    then jsonb_build_object('at', v_now, 'mocks', p_seen_mocks)
                                    else coach_approved_mocks end
    where so_id = p_so_id and id = p_job_id;

    update so_art_files set status = 'approved'
    where so_id = p_so_id and p_art_ids @> to_jsonb(id);

  else
    if coalesce(trim(p_comment), '') = '' then
      raise exception 'NSA_BAD_INPUT:comment required to request changes';
    end if;

    -- M4/M2/L1-complete reject write set: back to the artist, send timestamp
    -- cleared, seps confirmation cleared, rejection recorded under BOTH key
    -- spellings (the portal displays `at`; the dashboard todo reads `rejected_at`).
    update so_jobs set
      art_status       = 'art_requested',
      coach_rejected   = true,
      sent_to_coach_at = null,
      coach_approved_at = null,
      rejections       = coalesce(rejections, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                           'reason', p_comment, 'by', 'Coach', 'at', v_now, 'rejected_at', v_now))
    where so_id = p_so_id and id = p_job_id;

    update so_art_files set
      status              = 'waiting_for_art',
      notes               = coalesce(notes, '') ||
                            case when coalesce(notes, '') = '' then '' else e'\n' end ||
                            'Coach feedback: ' || p_comment,
      prod_files_attached = false
    where so_id = p_so_id and p_art_ids @> to_jsonb(id);
  end if;

  -- Nudge the SO so the app's selective sync picks the change up. The caller
  -- supplies the locale-formatted string the app writes everywhere else.
  if p_touch_updated_at is not null then
    update sales_orders set updated_at = p_touch_updated_at where id = p_so_id;
  end if;

  select * into v_job from so_jobs where so_id = p_so_id and id = p_job_id;
  return jsonb_build_object('ok', true, 'job', to_jsonb(v_job));
end $$;

-- portal-action runs with the service key; nothing else may call this.
revoke all on function apply_coach_art_decision(text, text, text, text, jsonb, text, jsonb, text) from public;
revoke all on function apply_coach_art_decision(text, text, text, text, jsonb, text, jsonb, text) from anon;
revoke all on function apply_coach_art_decision(text, text, text, text, jsonb, text, jsonb, text) from authenticated;
grant execute on function apply_coach_art_decision(text, text, text, text, jsonb, text, jsonb, text) to service_role;
