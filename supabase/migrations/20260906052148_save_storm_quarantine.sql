-- An operator kill switch for a client stuck re-sending a save that can never succeed.
--
-- A looping tab is a CLOSED loop: it holds N requests in flight, so making rejections cheaper only
-- makes it send more. During the 2026-09-05/06 SO-1916 incident, cutting the rejection cost 3x left
-- PostgREST's pool just as full - the client simply spun faster (36 busy backends before and after).
-- Nothing the database can do to a 40001 rejection reduces the number of connections such a client
-- occupies.
--
-- The client does have a terminal path: _handleAuthSaveFailure parks a document after
-- _PERM_DENIAL_CAP consecutive permission denials, because a rights failure can never be fixed by a
-- token refresh, and parked ids are skipped by every retry driver. So a stale write for a
-- quarantined document is reported as 42501 instead of 40001 and the stuck client stops on its own.
-- Applied during the incident: request rate went from ~1,200/s to 0 within seconds.
--
-- This is deliberately narrow. It only changes the ERROR CODE of a save that was already being
-- rejected, only for documents explicitly listed here, and it can never let a write through or
-- affect another order. Remove the row to undo it - no DDL needed.
begin;
create table if not exists public.save_storm_quarantine(
  document_id text primary key,
  reason text not null default '',
  created_at timestamptz not null default now()
);
comment on table public.save_storm_quarantine is
  'Documents whose stale-save rejections are reported as 42501 so a stuck client parks them. Emergency use; delete the row once the client has been reloaded.';
alter table public.save_storm_quarantine enable row level security;
revoke all on table public.save_storm_quarantine from public, anon, authenticated;

create or replace function public.save_sales_order_atomic(p_so_id text,p_expected_token text,p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_hash text;
  v_result jsonb; v_header jsonb; v_item jsonb; v_row jsonb; v_child jsonb;
  v_old_ids integer[]; v_item_id integer; v_version integer; v_current integer;
  v_count integer; v_expected integer; v_table text; v_key text; v_ids text[];
  v_updated timestamptz; v_base integer;
begin
  if current_user not in ('postgres','service_role') and not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  if coalesce(p_so_id,'')='' or p_expected_token is null or jsonb_typeof(p_plan)<>'object' then raise exception 'INVALID_SAVE_PLAN'; end if;
  if coalesce(jsonb_typeof(p_plan->'items'),'null') not in ('null','array') or coalesce(jsonb_typeof(p_plan->'firm_dates'),'null') not in ('null','array') then raise exception 'INVALID_SAVE_COLLECTION'; end if;
  -- FAST PATH (unlocked, and without serializing the payload).
  -- A stale base version needs no lock and is monotonic: _version only ever increases, so a
  -- base_version that does not match now can never match later. The authoritative, locked copies
  -- of both checks below still run further down, unchanged.
  if coalesce((p_plan->>'write_header')::boolean,true) then
    select _version, updated_at into v_current, v_updated from public.sales_orders where id=p_so_id;
    v_base:=(p_plan->>'base_version')::integer;
    if found and (v_base is null or v_base<>v_current) then
      -- Only an in-flight retry of a save that just committed can have a receipt worth the hash:
      -- same version lineage, written moments ago. Anything else is rejected untouched.
      if v_base=v_current-1 and v_updated>now()-interval '2 minutes' then
        v_hash:=md5(p_expected_token||p_plan::text);
        select result into v_result from public.document_save_receipts where document_id=p_so_id and request_hash=v_hash;
        if found then return v_result; end if;
      end if;
      -- Quarantined document: report the same rejection as a rights failure so a stuck client
      -- treats it as terminal and stops re-sending. Never lets a write through.
      if exists(select 1 from public.save_storm_quarantine q where q.document_id=p_so_id) then
        raise exception 'STALE_SO_WRITE: this order is quarantined after a save loop; reload the page' using errcode='42501';
      end if;
      raise exception 'STALE_SO_WRITE: edit is based on a different version' using errcode='40001';
    end if;
  end if;
  v_hash:=coalesce(v_hash,md5(p_expected_token||p_plan::text));
  select result into v_result from public.document_save_receipts where document_id=p_so_id and request_hash=v_hash;
  if found then return v_result; end if;
  -- Serializes creates as well as edits, including a retry arriving before the
  -- first call finishes. Row locks below also cover legacy REST writers.
  perform pg_advisory_xact_lock(hashtextextended('sales-order-save:'||p_so_id,0));
  select result into v_result from public.document_save_receipts where document_id=p_so_id and request_hash=v_hash;
  if found then return v_result; end if;
  perform 1 from public.sales_orders where id=p_so_id for update;
  perform 1 from public.so_items where so_id=p_so_id order by id for update;
  select coalesce(array_agg(id),'{}'::integer[]) into v_old_ids from public.so_items where so_id=p_so_id;
  perform 1 from public.so_item_decorations where so_item_id=any(v_old_ids) order by id for update;
  perform 1 from public.so_item_pick_lines where so_item_id=any(v_old_ids) order by id for update;
  perform 1 from public.so_item_po_lines where so_item_id=any(v_old_ids) order by id for update;
  perform 1 from public.so_art_files where so_id=p_so_id order by id for update;
  perform 1 from public.so_jobs where so_id=p_so_id order by id for update;
  perform 1 from public.so_firm_dates where so_id=p_so_id order by id for update;
  if public.sales_order_save_token(p_so_id) is distinct from p_expected_token then
    raise exception 'STALE_SO_WRITE: order changed during save preparation' using errcode='40001';
  end if;
  v_header:=p_plan->'header';
  if jsonb_typeof(v_header)<>'object' or v_header->>'id' is distinct from p_so_id then raise exception 'SAVE_ID_MISMATCH'; end if;
  -- Check the edit's actual base, not a version silently adopted from a foreign writer.
  select _version into v_current from public.sales_orders where id=p_so_id;
  if coalesce((p_plan->>'write_header')::boolean,true) then
  if found and ((p_plan->>'base_version') is null or (p_plan->>'base_version')::integer<>v_current) then
    raise exception 'STALE_SO_WRITE: edit is based on a different version' using errcode='40001';
  end if;
  if coalesce((p_plan->>'is_new')::boolean,false) and v_current is not null then raise exception 'SO_ID_EXISTS'; end if;
  if v_current is null and not coalesce((p_plan->>'is_new')::boolean,false) then raise exception 'SO_WAS_DELETED'; end if;
  perform public._so_save_row('sales_orders',v_header,not coalesce((p_plan->>'is_new')::boolean,false));
  elsif v_current is null then raise exception 'SO_MUST_BE_SAVED_BEFORE_ARTWORK';
  end if;

  foreach v_table in array array['so_art_files','so_jobs'] loop
    v_key:=case when v_table='so_art_files' then 'art' else 'job' end;
    for v_row in select value from jsonb_array_elements(p_plan->(v_key||'_upserts')) loop
      perform public._so_save_row(v_table,v_row||jsonb_build_object('so_id',p_so_id),true);
    end loop;
    select coalesce(array_agg(value),'{}'::text[]) into v_ids from jsonb_array_elements_text(p_plan->(v_key||'_deletes'));
    if cardinality(v_ids)>0 then
      execute format('delete from public.%I where so_id=$1 and id=any($2)',v_table) using p_so_id,v_ids;
      get diagnostics v_count=row_count;
      if v_count<>cardinality(v_ids) then raise exception 'SAVE_DELETE_NOT_CONFIRMED: %',v_table; end if;
    end if;
  end loop;
  if jsonb_typeof(p_plan->'firm_dates')='array' then
    select count(*) into v_expected from public.so_firm_dates where so_id=p_so_id;
    delete from public.so_firm_dates where so_id=p_so_id;
    get diagnostics v_count=row_count;
    if v_count<>v_expected then raise exception 'SAVE_DELETE_NOT_CONFIRMED: so_firm_dates'; end if;
    for v_row in select value from jsonb_array_elements(p_plan->'firm_dates') loop
      perform public._so_save_row('so_firm_dates',(v_row-'id')||jsonb_build_object('so_id',p_so_id));
    end loop;
  end if;
  if jsonb_typeof(p_plan->'items')='array' then
    if cardinality(v_old_ids)>0 and jsonb_array_length(p_plan->'items')=0 then raise exception 'SO_EMPTY_ITEMS_BLOCKED'; end if;
    -- Duplicate/absent indexes must never attach children to a different garment.
    select count(distinct (value->>'item_index')::integer) into v_count from jsonb_array_elements(p_plan->'items');
    if v_count<>jsonb_array_length(p_plan->'items') then raise exception 'SO_ITEM_INDEX_INVALID'; end if;
    for v_item in select value from jsonb_array_elements(p_plan->'items') loop
      if jsonb_typeof(v_item->'decorations') is distinct from 'array' or jsonb_typeof(v_item->'pick_lines') is distinct from 'array' or jsonb_typeof(v_item->'po_lines') is distinct from 'array' then raise exception 'INVALID_SAVE_ITEM_COLLECTION'; end if;
      v_row:=(v_item-array['id','decorations','pick_lines','po_lines'])||jsonb_build_object('so_id',p_so_id);
      if v_row->>'product_id' is not null and not exists(select 1 from public.products where id=v_row->>'product_id') then
        v_row:=v_row||'{"product_id":null}'::jsonb;
      end if;
      v_row:=public._so_save_row('so_items',v_row);
      v_item_id:=(v_row->>'id')::integer;
      foreach v_table in array array['so_item_decorations','so_item_pick_lines','so_item_po_lines'] loop
        v_key:=case v_table when 'so_item_decorations' then 'decorations' when 'so_item_pick_lines' then 'pick_lines' else 'po_lines' end;
        for v_child in select value from jsonb_array_elements(v_item->v_key) loop
          perform public._so_save_row(v_table,(v_child-'id')||jsonb_build_object('so_item_id',v_item_id));
        end loop;
      end loop;
    end loop;
    -- Remove only the old generations. Every replacement and grandchild already
    -- exists inside this transaction; any error rolls ALL changes back.
    delete from public.so_item_decorations where so_item_id=any(v_old_ids);
    delete from public.so_item_pick_lines where so_item_id=any(v_old_ids);
    delete from public.so_item_po_lines where so_item_id=any(v_old_ids);
    delete from public.so_items where id=any(v_old_ids);
    get diagnostics v_count=row_count;
    if v_count<>cardinality(v_old_ids) then raise exception 'SAVE_DELETE_NOT_CONFIRMED: so_items'; end if;
  end if;
  select _version into v_version from public.sales_orders where id=p_so_id;
  v_result:=jsonb_build_object('saved',true,'version',v_version,'so_id',p_so_id,'line_ids',(select jsonb_agg(jsonb_build_object('item_index',item_index,'line_id',to_jsonb(so_items)->'line_id')) from public.so_items where so_id=p_so_id));
  insert into public.document_save_receipts(document_id,request_hash,result) values(p_so_id,v_hash,v_result);
  return v_result;
end;
$$;
commit;
