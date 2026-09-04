-- Migration 20260903120000: atomic box merge (boxes, 00185).
--
-- Merging cartons used to be two sequential client updates: move the contents onto the
-- target, then mark the source 'combined'. When the second write failed (dropped tablet
-- connection, RLS blip, closed lid) the units existed in BOTH boxes and BOTH labels kept
-- scanning live — the warehouse double-counts the same 17 mediums, and a short-ship claim
-- or an invoice reconciliation is then argued off wrong numbers.
--
-- box_merge() does the whole thing in one transaction, or none of it.
--
-- Concurrency: two tablets can scan overlapping sets at once. Every row is locked in a
-- single deterministic (id-ordered) statement so the merges serialize instead of
-- deadlocking, and each box carries the updated_at the caller actually read. If anything
-- moved under us the merge aborts with STALE and the caller rescans — writing the stale
-- snapshot would silently drop whatever the other tablet just added.
--
-- The merge MATH stays in src/boxTracking.js (sumBoxContents): the UI has to preview the
-- combined box before the tap, and a second SQL implementation of the same rule would be
-- one more pair of hand-synced copies to drift. This function is the transaction boundary
-- and the guard rail, not a second opinion on the arithmetic.

create or replace function public.box_merge(
  p_target      text,     -- surviving plate
  p_target_ver  text,     -- updated_at the caller read for the target (optimistic lock)
  p_sources     jsonb,    -- [{id, updated_at}] — the plates being absorbed
  p_contents    jsonb,    -- merged contents computed by sumBoxContents
  p_source_refs jsonb,    -- merged source_refs
  p_so_id       text default null,  -- inherited SO when target had none and sources agree
  p_customer_id text default null   -- reserved: boxes has no customer column today
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target   boxes%rowtype;
  v_src      boxes%rowtype;
  v_ids      text[];
  v_elem     jsonb;
  v_out      jsonb;
  v_now      timestamptz := now();
begin
  if not public.is_team_member() then
    raise exception 'box_merge: staff only';
  end if;
  if p_target is null or p_sources is null or jsonb_array_length(p_sources) = 0 then
    raise exception 'box_merge: need a target and at least one source box';
  end if;
  if p_contents is null or jsonb_typeof(p_contents) <> 'array' then
    raise exception 'box_merge: contents must be a json array';
  end if;

  select array_agg(distinct e->>'id') into v_ids from jsonb_array_elements(p_sources) e;
  if p_target = any(v_ids) then
    raise exception 'box_merge: % is both the target and a source', p_target;
  end if;

  -- One id-ordered locking statement over target + sources: concurrent merges queue up
  -- here in the same order, so they serialize instead of deadlocking each other.
  perform 1 from boxes
   where id = any(v_ids || array[p_target])
   order by id
     for update;

  select * into v_target from boxes where id = p_target;
  if not found then
    raise exception 'box_merge: target % not found', p_target;
  end if;
  if v_target.status = 'combined' then
    raise exception 'STALE: % was itself merged into % — rescan and merge into that box',
      p_target, coalesce(v_target.merged_into, '(unknown)');
  end if;
  if p_target_ver is not null and v_target.updated_at <> p_target_ver::timestamptz then
    raise exception 'STALE: % changed while the merge was being built — rescan the boxes', p_target;
  end if;

  -- Validate every source BEFORE writing anything: a partially applied merge is the exact
  -- failure this function exists to prevent.
  for v_elem in select value from jsonb_array_elements(p_sources) loop
    select * into v_src from boxes where id = v_elem->>'id';
    if not found then
      raise exception 'box_merge: source % not found', v_elem->>'id';
    end if;
    if v_src.status = 'combined' then
      raise exception 'STALE: % was already merged into % — its units are counted there',
        v_src.id, coalesce(v_src.merged_into, '(unknown)');
    end if;
    if v_src.status = 'shipped' then
      raise exception 'box_merge: % already shipped — it cannot be merged', v_src.id;
    end if;
    if (v_elem->>'updated_at') is not null and v_src.updated_at <> (v_elem->>'updated_at')::timestamptz then
      raise exception 'STALE: % changed while the merge was being built — rescan the boxes', v_src.id;
    end if;
  end loop;

  update boxes
     set contents    = p_contents,
         source_refs = coalesce(p_source_refs, source_refs),
         so_id       = coalesce(so_id, p_so_id),
         updated_at  = v_now
   where id = p_target;

  -- Sources are never deleted: they stay as historical records pointing at the survivor,
  -- so a dead label still on a carton scans through to the box that now holds the goods.
  update boxes
     set status      = 'combined',
         merged_into = p_target,
         updated_at  = v_now
   where id = any(v_ids);

  select to_jsonb(b.*) into v_out from boxes b where b.id = p_target;
  return v_out;
end $$;

revoke all on function public.box_merge(text, text, jsonb, jsonb, jsonb, text, text) from public;
revoke all on function public.box_merge(text, text, jsonb, jsonb, jsonb, text, text) from anon;
grant execute on function public.box_merge(text, text, jsonb, jsonb, jsonb, text, text) to authenticated;
