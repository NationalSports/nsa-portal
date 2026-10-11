-- A Club transfer pull is a physical readiness signal only when its stock was
-- actually available and decremented. Older pull RPCs stamped transfers_pulled
-- even when they clamped shortages (and could not report missing stock rows).
-- Keep those legacy stamps unverified for manual reconciliation; never repeat
-- their decrement automatically.

alter table public.webstore_orders
  add column if not exists transfers_pull_verified_at timestamptz,
  add column if not exists transfers_pull_verified_codes text[] not null default '{}';

-- Re-derive jersey digit-transfer demand from active source order lines and
-- server catalog recipes, mirroring transferDemand.shared's resolution order:
-- frozen recipe, exact offering ID, then unambiguous product-ID fallback.
-- Conflicting legacy config is held for reconciliation rather than silently
-- using an arbitrary offering.
create or replace function public.club_number_transfer_demand(p_store_id uuid, p_so_id text)
returns table(transfer_code text, required_qty integer)
language plpgsql security definer set search_path = public as $$
declare
  v_line record;
  v_cfg jsonb;
  v_config_count integer;
  v_config jsonb;
  v_sets jsonb;
  v_set text;
  v_player text;
  v_digit text;
  v_code text;
  v_units integer;
  v_offering_id text;
  v_demand jsonb := '{}'::jsonb;
begin
  for v_line in
    select i.*
      from webstore_order_items i
      join webstore_orders w on w.id = i.order_id and w.so_id = p_so_id and w.store_id = p_store_id
      join webstores ws on ws.id = w.store_id and ws.org_type = 'club'
     where coalesce(i.is_bundle_parent, false) is false
       and coalesce(i.line_status, '') not in ('cancelled', 'canceled', 'refunded')
  loop
    v_units := greatest(0,
      coalesce(v_line.qty, 0)
      - coalesce(nullif(to_jsonb(v_line)->>'cancelled_qty','')::integer, 0)
      - coalesce(nullif(to_jsonb(v_line)->>'refunded_qty','')::integer, 0));
    if v_units = 0 or nullif(trim(coalesce(v_line.player_number, '')), '') is null then
      continue;
    end if;

    v_offering_id := coalesce(
      nullif(to_jsonb(v_line)->>'webstore_product_id',''),
      nullif(to_jsonb(v_line)->>'bundle_webstore_product_id',''));
    v_cfg := null;
    if coalesce(to_jsonb(v_line)->'production_recipe'->>'version', '') <> '' then
      v_cfg := to_jsonb(v_line)->'production_recipe';
    elsif v_offering_id is not null then
      select to_jsonb(wp) into v_cfg
        from webstore_products wp
       where wp.id::text = v_offering_id and wp.store_id = p_store_id
       limit 1;
      if v_cfg is null then
        raise exception 'NSA_NUMBER_TRANSFER_CONFIG_UNVERIFIED:exact offering % is missing for source line %',
          v_offering_id, v_line.id;
      end if;
    else
      -- The UI's product-ID fallback is safe only when all catalog and
      -- unlinked bundle configs agree on transfer codes, number support and sets.
      with candidates as (
        select jsonb_build_object(
          'codes', coalesce(to_jsonb(wp)->'transfer_codes', '[]'::jsonb),
          'takes_number', coalesce((to_jsonb(wp)->>'takes_number')::boolean, false),
          'num_transfer_sets', case
            when jsonb_typeof(to_jsonb(wp)->'num_transfer_sets') = 'array'
                 and jsonb_array_length(to_jsonb(wp)->'num_transfer_sets') > 0
              then to_jsonb(wp)->'num_transfer_sets'
            when nullif(to_jsonb(wp)->>'num_transfer_size', '') is not null
              then jsonb_build_array((to_jsonb(wp)->>'num_transfer_size') || '|' || coalesce(to_jsonb(wp)->>'num_transfer_color',''))
            else '[]'::jsonb end
        ) as cfg
        from webstore_products wp
        where wp.store_id = p_store_id and wp.product_id = v_line.product_id
        union all
        select jsonb_build_object(
          'codes', case when nullif(to_jsonb(bi)->>'transfer_code','') is null then '[]'::jsonb
                        else jsonb_build_array(to_jsonb(bi)->>'transfer_code') end,
          'takes_number', coalesce((to_jsonb(bi)->>'takes_number')::boolean, false),
          'num_transfer_sets', case
            when jsonb_typeof(to_jsonb(bi)->'num_transfer_sets') = 'array'
                 and jsonb_array_length(to_jsonb(bi)->'num_transfer_sets') > 0
              then to_jsonb(bi)->'num_transfer_sets'
            when nullif(to_jsonb(bi)->>'num_transfer_size', '') is not null
              then jsonb_build_array((to_jsonb(bi)->>'num_transfer_size') || '|' || coalesce(to_jsonb(bi)->>'num_transfer_color',''))
            else '[]'::jsonb end
        ) as cfg
        from webstore_bundle_items bi
        join webstore_products parent on parent.id = bi.bundle_id and parent.store_id = p_store_id
        where bi.product_id = v_line.product_id
          and (nullif(to_jsonb(bi)->>'webstore_product_id','') is null
            or not exists (select 1 from webstore_products linked
                            where linked.id::text = to_jsonb(bi)->>'webstore_product_id'
                              and linked.store_id = p_store_id))
      )
      select count(distinct cfg), (array_agg(cfg order by cfg::text))[1]
        into v_config_count, v_config from candidates;
      if coalesce(v_config_count, 0) <> 1 then
        raise exception 'NSA_NUMBER_TRANSFER_CONFIG_UNVERIFIED:ambiguous or missing product config for source line %', v_line.id;
      end if;
      v_cfg := v_config;
    end if;

    if coalesce((v_cfg->>'takes_number')::boolean, false) is not true then
      continue;
    end if;
    v_sets := v_cfg->'num_transfer_sets';
    if jsonb_typeof(v_sets) is distinct from 'array' then v_sets := '[]'::jsonb; end if;
    if jsonb_array_length(v_sets) = 0 and nullif(v_cfg->>'num_transfer_size','') is not null then
      v_sets := jsonb_build_array((v_cfg->>'num_transfer_size') || '|' || coalesce(v_cfg->>'num_transfer_color',''));
    end if;
    -- No number transfer set means a non-transfer personalization method. This
    -- mirrors the UI: it consumes no digit-transfer inventory.
    if jsonb_array_length(v_sets) = 0 then continue; end if;

    v_player := regexp_replace(coalesce(v_line.player_number, ''), '[^0-9]', '', 'g');
    if v_player = '' then continue; end if;
    if length(v_player) > 4 then
      raise exception 'NSA_NUMBER_TRANSFER_ROSTER_UNVERIFIED:source line % has an invalid number', v_line.id;
    end if;
    for v_set in select jsonb_array_elements_text(v_sets)
    loop
      if v_set !~ '^[^|]*\|[^|]*$' then
        raise exception 'NSA_NUMBER_TRANSFER_CONFIG_UNVERIFIED:invalid number transfer set on source line %', v_line.id;
      end if;
      for v_digit in select substring(v_player from n for 1) from generate_series(1, length(v_player)) n
      loop
        v_code := v_digit || '|' || split_part(v_set, '|', 1) || '|' || split_part(v_set, '|', 2);
        v_demand := jsonb_set(v_demand, array[v_code], to_jsonb(coalesce((v_demand->>v_code)::integer, 0) + v_units), true);
      end loop;
    end loop;
  end loop;

  return query select d.key, d.value::integer from jsonb_each_text(v_demand) d order by d.key;
end $$;
revoke all on function public.club_number_transfer_demand(uuid, text) from public, anon, authenticated;

create or replace function public.pull_webstore_transfers(
  p_store_id uuid,
  p_so_ids text[],
  p_needs jsonb -- [{code, qty}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_expected int;
  v_found int;
  v_expected_rows int;
  v_found_rows int;
  v_verified int;
  v_legacy int;
  v_stamped int := 0;
  v_decremented int := 0;
  v_need record;
  v_expected_need record;
  v_requested numeric;
  v_stock record;
  v_stock_rows int;
  v_available numeric;
  v_remaining numeric;
  v_take numeric;
  v_verified_codes text[] := '{}';
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    current_setting('request.jwt.claim.role', true),
    '');
  if v_role <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:staff or service role required';
  end if;
  if p_store_id is null then raise exception 'NSA_BAD_INPUT:p_store_id required'; end if;
  if p_so_ids is null or array_length(p_so_ids, 1) is null then
    raise exception 'NSA_BAD_INPUT:p_so_ids required';
  end if;
  if p_needs is not null and jsonb_typeof(p_needs) <> 'array' then
    raise exception 'NSA_BAD_INPUT:p_needs must be an array';
  end if;

  select count(distinct x) into v_expected from unnest(p_so_ids) as x where x is not null;
  if v_expected = 0 then raise exception 'NSA_BAD_INPUT:p_so_ids required'; end if;
  select count(distinct so_id) into v_found from webstore_orders
   where store_id = p_store_id and so_id = any(p_so_ids);
  if v_found <> v_expected then
    raise exception 'NSA_TRANSFER_PULL_ORDER_MISMATCH:one or more orders are not in this store';
  end if;
  select count(*) into v_found_rows from webstore_orders
   where store_id = p_store_id and so_id = any(p_so_ids);

  -- Lock first. Historical true flags have no evidence that the required stock
  -- existed, so stop for reconciliation without risking a second decrement.
  perform 1 from webstore_orders
   where store_id = p_store_id and so_id = any(p_so_ids) for update;
  select count(*) into v_legacy from webstore_orders
   where store_id = p_store_id and so_id = any(p_so_ids)
     and transfers_pulled is true and transfers_pull_verified_at is null;
  if v_legacy > 0 then
    raise exception 'NSA_TRANSFER_PULL_RECONCILIATION_REQUIRED:legacy pull has no verified stock record';
  end if;

  select count(*) into v_verified from webstore_orders
   where store_id = p_store_id and so_id = any(p_so_ids)
     and transfers_pulled is true and transfers_pull_verified_at is not null;
  if v_verified = v_found_rows then
    return jsonb_build_object('ok', true, 'decremented', 0, 'stamped', 0,
      'already_pulled', true, 'shortfalls', '[]'::jsonb,
      'verified', true);
  end if;
  if v_verified > 0 then
    raise exception 'NSA_TRANSFER_PULL_MIXED_BATCH:split already-pulled orders from this batch';
  end if;

  -- Never trust the browser's demand for catalogued Club heat-transfer
  -- designs. Recompute their minimum units from persisted SO sizes and the
  -- converter's one transfer_code decoration per garment. This also rejects
  -- an empty/partial payload; personalized number codes remain additive in the
  -- caller payload because they are derived from per-player digits.
  for v_expected_need in
    select d.transfer_code as code,
           sum((select coalesce(sum(e.value::numeric), 0)
                  from jsonb_each_text(coalesce(si.sizes, '{}'::jsonb)) e)) as qty
      from webstore_orders w
      join webstores ws on ws.id = w.store_id and ws.org_type = 'club'
      join so_items si on si.so_id = w.so_id
      join so_item_decorations d on d.so_item_id = si.id
     where w.store_id = p_store_id and w.so_id = any(p_so_ids)
       and coalesce(d.transfer_code, '') <> ''
     group by d.transfer_code
  loop
    select coalesce(sum(x.qty), 0) into v_requested
      from jsonb_to_recordset(coalesce(p_needs, '[]'::jsonb)) as x(code text, qty numeric)
     where x.code = v_expected_need.code;
    if v_requested < v_expected_need.qty then
      raise exception 'NSA_TRANSFER_DEMAND_MISMATCH:% need %, requested %',
        v_expected_need.code, v_expected_need.qty, v_requested;
    end if;
  end loop;

  -- Number-transfer demand is recomputed from the immutable SO roster and
  -- unique store catalog set mapping. Do not let a partial client code list
  -- certify a numbered garment whose digit transfers were omitted.
  for v_expected_need in
    select demand.transfer_code as code, sum(demand.required_qty)::numeric as qty
      from (select distinct unnest(p_so_ids) as so_id) ids
      cross join lateral public.club_number_transfer_demand(p_store_id, ids.so_id) demand
     group by demand.transfer_code
  loop
    select coalesce(sum(x.qty), 0) into v_requested
      from jsonb_to_recordset(coalesce(p_needs, '[]'::jsonb)) as x(code text, qty numeric)
     where x.code = v_expected_need.code;
    if v_requested < v_expected_need.qty then
      raise exception 'NSA_TRANSFER_DEMAND_MISMATCH:% need %, requested %',
        v_expected_need.code, v_expected_need.qty, v_requested;
    end if;
  end loop;

  -- Claim all orders inside this transaction. Any following exception rolls
  -- back both this stamp and every stock change.
  update webstore_orders
     set transfers_pulled = true,
         transfers_pulled_at = now(),
         transfers_pull_verified_at = null,
         transfers_pull_verified_codes = '{}'
   where store_id = p_store_id and so_id = any(p_so_ids)
     and transfers_pulled is not true;
  get diagnostics v_stamped = row_count;
  select count(*) into v_expected_rows from webstore_orders
   where store_id = p_store_id and so_id = any(p_so_ids);
  if v_stamped <> v_expected_rows then
    raise exception 'NSA_TRANSFER_PULL_RACE:orders changed during pull; retry';
  end if;

  -- Validate and decrement every requested code under row locks. Unlike the
  -- legacy clamp, a shortage or missing code aborts the whole transaction and
  -- leaves both inventory and order flags untouched.
  for v_need in
    select code, sum(qty)::numeric as qty
      from jsonb_to_recordset(coalesce(p_needs, '[]'::jsonb)) as x(code text, qty numeric)
     group by code order by code
  loop
    if v_need.code is null or btrim(v_need.code) = '' or coalesce(v_need.qty, 0) <= 0 then
      raise exception 'NSA_BAD_INPUT:each transfer need requires a code and positive qty';
    end if;
    perform 1 from webstore_transfers
     where store_id = p_store_id and code = v_need.code for update;
    get diagnostics v_stock_rows = row_count;
    if v_stock_rows = 0 then
      raise exception 'NSA_TRANSFER_STOCK_MISSING:%', v_need.code;
    end if;
    select coalesce(sum(greatest(on_hand, 0)), 0) into v_available
      from webstore_transfers where store_id = p_store_id and code = v_need.code;
    if v_available < v_need.qty then
      raise exception 'NSA_TRANSFER_SHORTAGE:% need %, available %', v_need.code, v_need.qty, v_available;
    end if;

    v_remaining := v_need.qty;
    for v_stock in
      select id, greatest(coalesce(on_hand, 0), 0) as available
        from webstore_transfers
       where store_id = p_store_id and code = v_need.code
       order by id for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_stock.available, v_remaining);
      if v_take > 0 then
        update webstore_transfers set on_hand = on_hand - v_take where id = v_stock.id;
        v_remaining := v_remaining - v_take;
        v_decremented := v_decremented + 1;
      end if;
    end loop;
    if v_remaining > 0 then
      raise exception 'NSA_TRANSFER_SHORTAGE:% remaining %', v_need.code, v_remaining;
    end if;
    v_verified_codes := array_append(v_verified_codes, v_need.code);
  end loop;

  update webstore_orders
     set transfers_pull_verified_at = now(),
         transfers_pull_verified_codes = v_verified_codes
   where store_id = p_store_id and so_id = any(p_so_ids);

  return jsonb_build_object('ok', true, 'decremented', v_decremented,
    'stamped', v_stamped, 'already_pulled', false, 'shortfalls', '[]'::jsonb,
    'verified', true, 'verified_codes', to_jsonb(v_verified_codes));
end $$;

revoke all on function public.pull_webstore_transfers(uuid, text[], jsonb) from public;
revoke all on function public.pull_webstore_transfers(uuid, text[], jsonb) from anon;
grant execute on function public.pull_webstore_transfers(uuid, text[], jsonb) to authenticated, service_role;


-- Replace the latest 00220 stage RPC body while preserving its guard, audit,
-- transaction-local trigger authorization, and parent SO wake-up.
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

  -- Club transfer-code designs are not covered by the garment item_status gate.
  -- Require the new physical-pull proof on every linked Club order that carries
  -- a transfer code used by this job. This remains required for explicit overrides.
  if p_event = 'release' and exists (
    select 1 from webstore_orders w
      join webstores ws on ws.id = w.store_id
     where w.so_id = p_so_id and ws.org_type = 'club'
  ) and exists (
    select 1
      from jsonb_array_elements(coalesce(v_job.items, '[]'::jsonb)) ji
      join so_items si on si.so_id = v_job.so_id
                       and si.item_index = case when coalesce(ji->>'item_idx','') ~ '^\d+$' then (ji->>'item_idx')::int end
      join so_item_decorations d on d.so_item_id = si.id
     where coalesce(d.transfer_code, '') <> ''
       and (
         (jsonb_typeof(ji->'deco_idxs') = 'array' and exists (
           select 1 from jsonb_array_elements_text(ji->'deco_idxs') x(value)
            where x.value ~ '^\d+$' and x.value::int = d.deco_index
         ))
         or (coalesce(ji->>'deco_idx','') ~ '^\d+$' and (ji->>'deco_idx')::int = d.deco_index)
         or (not (ji ? 'deco_idxs') and not (ji ? 'deco_idx')
             and d.type = v_job.deco_type)
       )
       and exists (
         select 1 from webstore_orders w
          join webstores ws on ws.id = w.store_id
          where w.so_id = p_so_id and ws.org_type = 'club'
            and (w.transfers_pulled is not true
              or w.transfers_pull_verified_at is null
              or not (d.transfer_code = any(coalesce(w.transfers_pull_verified_codes, '{}'::text[]))))
       )
  ) then
    raise exception 'NSA_TRANSFER_PULL_UNVERIFIED:club transfer stock is not verified for this job';
  end if;

  -- Club number jobs are not individual art jobs in the legacy converter,
  -- but the roster still requires one physical number transfer per digit and
  -- configured set. Require every recomputed digit code to be covered by each
  -- linked Club order's verified pull, including explicit release overrides.
  if p_event = 'release' and exists (
    select 1
      from webstore_orders w join webstores ws on ws.id = w.store_id
     where w.so_id = p_so_id and ws.org_type = 'club'
  ) and exists (
    select 1
      from webstore_orders w
      join webstores ws on ws.id = w.store_id
      cross join lateral public.club_number_transfer_demand(w.store_id, p_so_id) need
     where w.so_id = p_so_id and ws.org_type = 'club'
       and (w.transfers_pulled is not true or w.transfers_pull_verified_at is null
         or not (need.transfer_code = any(coalesce(w.transfers_pull_verified_codes, '{}'::text[]))))
  ) then
    raise exception 'NSA_TRANSFER_PULL_UNVERIFIED:club number transfers are not verified for this job';
  end if;

  -- All School readiness is backed by its per-order decoration allocation
  -- ledger, source quantities, and physical consumption state. Keep this gate
  -- inside the trusted stage RPC too; a direct SQL caller or an explicit
  -- override cannot substitute a browser-computed ready flag for consumption.
  if p_event = 'release' and exists (
    select 1 from webstore_orders w
      join webstores ws on ws.id = w.store_id
     where w.so_id = p_so_id and ws.org_type = 'all_school'
  ) then
    if (public.all_school_materials_ready(p_so_id, p_job_id)->>'ready')::boolean is distinct from true then
      raise exception 'NSA_ALL_SCHOOL_MATERIALS_NOT_READY:physical decoration requirements are not satisfied';
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
