begin;

-- One full SO save is one transaction. Invoker rights preserve existing RLS;
-- authenticated callers must also be active staff, not merely logged-in coaches.
create or replace function public.sales_order_save_token(p_so_id text)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_token text;
begin
  if current_user not in ('postgres','service_role') and not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  select md5(jsonb_build_object(
    'header',(select to_jsonb(s) from public.sales_orders s where s.id=p_so_id),
    'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.so_items i where i.so_id=p_so_id),
    'decorations',(select jsonb_agg(to_jsonb(d) order by d.id) from public.so_item_decorations d join public.so_items i on i.id=d.so_item_id where i.so_id=p_so_id),
    'picks',(select jsonb_agg(to_jsonb(d) order by d.id) from public.so_item_pick_lines d join public.so_items i on i.id=d.so_item_id where i.so_id=p_so_id),
    'pos',(select jsonb_agg(to_jsonb(d) order by d.id) from public.so_item_po_lines d join public.so_items i on i.id=d.so_item_id where i.so_id=p_so_id),
    'art',(select jsonb_agg(to_jsonb(a) order by a.id) from public.so_art_files a where a.so_id=p_so_id),
    'jobs',(select jsonb_agg(to_jsonb(j) order by j.id) from public.so_jobs j where j.so_id=p_so_id),
    'dates',(select jsonb_agg(to_jsonb(d) order by d.id) from public.so_firm_dates d where d.so_id=p_so_id)
  )::text) into v_token;
  return v_token;
end;
$$;

-- Internal typed writer. Omitted columns retain their defaults/existing values;
-- unknown columns abort instead of silently saving a stripped-down document.
create or replace function public._so_save_row(p_table text,p_row jsonb,p_upsert boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_cols text; v_set text; v_conflict text; v_result jsonb; v_unknown text;
begin
  if current_user not in ('postgres','service_role') and not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  if p_table not in ('sales_orders','so_items','so_item_decorations','so_item_pick_lines','so_item_po_lines','so_art_files','so_jobs','so_firm_dates','estimate_art_files') then
    raise exception 'INVALID_SAVE_TABLE';
  end if;
  p_row:=p_row-'_version';
  select string_agg(k,', ') into v_unknown from jsonb_object_keys(p_row) k
  where not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=to_regclass('public.'||p_table) and a.attname=k and a.attnum>0 and not a.attisdropped);
  if v_unknown is not null then raise exception 'SAVE_SCHEMA_MISMATCH: %.%',p_table,v_unknown; end if;
  select string_agg(format('%I',k),',' order by k),string_agg(format('%1$I=excluded.%1$I',k),',' order by k)
    into v_cols,v_set from jsonb_object_keys(p_row) k;
  if v_cols is null then raise exception 'EMPTY_SAVE_ROW'; end if;
  if p_upsert then
    if p_table='sales_orders' then v_conflict:='id';
    elsif p_table='estimate_art_files' then v_conflict:='estimate_id,id';
    elsif p_table in ('so_jobs','so_art_files') then v_conflict:='so_id,id';
    else raise exception 'INVALID_SAVE_UPSERT'; end if;
  end if;
  execute format('insert into public.%1$I as saved (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) %3$s returning to_jsonb(saved)',
    p_table,v_cols,case when p_upsert then format('on conflict (%s) do update set %s',v_conflict,v_set) else '' end)
    into v_result using p_row;
  if v_result is null then raise exception 'SAVE_ROW_NOT_WRITTEN'; end if;
  return v_result;
end;
$$;

-- A lost HTTP response can retry exactly the same prepared transaction without
-- duplicating rows or being mistaken for a competing edit. No client can read
-- another user's data through these receipts: access is staff-only plus RLS.
create table public.document_save_receipts (
  document_id text not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(document_id,request_hash)
);
alter table public.document_save_receipts enable row level security;
create policy staff_save_receipts on public.document_save_receipts for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
grant select,insert on public.document_save_receipts to authenticated,service_role;

create or replace function public.save_sales_order_atomic(p_so_id text,p_expected_token text,p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_hash text:=md5(p_expected_token||p_plan::text);
  v_result jsonb; v_header jsonb; v_item jsonb; v_row jsonb; v_child jsonb;
  v_old_ids integer[]; v_item_id integer; v_version integer; v_current integer;
  v_count integer; v_expected integer; v_table text; v_key text; v_ids text[];
begin
  if current_user not in ('postgres','service_role') and not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  if coalesce(p_so_id,'')='' or p_expected_token is null or jsonb_typeof(p_plan)<>'object' then raise exception 'INVALID_SAVE_PLAN'; end if;
  if coalesce(jsonb_typeof(p_plan->'items'),'null') not in ('null','array') or coalesce(jsonb_typeof(p_plan->'firm_dates'),'null') not in ('null','array') then raise exception 'INVALID_SAVE_COLLECTION'; end if;
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
revoke all on function public.sales_order_save_token(text) from public,anon;
revoke all on function public._so_save_row(text,jsonb,boolean) from public,anon;
revoke all on function public.save_sales_order_atomic(text,text,jsonb) from public,anon;
grant execute on function public.sales_order_save_token(text),public._so_save_row(text,jsonb,boolean),public.save_sales_order_atomic(text,text,jsonb) to authenticated,service_role;
commit;
