-- A memo command never prepares or rewrites order children. Existing RLS and
-- staff authorization remain in force; this function does not elevate privileges.
-- Only relationship changes should run the relationship repair trigger. Running
-- it on a memo UPDATE can otherwise clear a legacy estimate link as a side effect.
drop trigger if exists trg_sales_orders_estimate_customer on public.sales_orders;
create trigger trg_sales_orders_estimate_customer
  before insert or update of estimate_id,customer_id on public.sales_orders
  for each row execute function public.enforce_so_estimate_customer();

create or replace function public.save_sales_order_memo(
  p_so_id text,p_expected_memo text,p_memo text,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_before public.sales_orders%rowtype;
  v_after public.sales_orders%rowtype;
  v_request jsonb:=jsonb_build_object('expected_memo',p_expected_memo,'memo',p_memo);
  v_key text:='memo:'||p_request_id::text;
  v_receipt jsonb;
  v_result jsonb;
begin
  if current_user not in ('postgres','service_role') and not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  if coalesce(p_so_id,'')='' or p_request_id is null or nullif(btrim(p_memo),'') is null or length(p_memo)>10000 then
    raise exception 'INVALID_MEMO_COMMAND' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sales-order-save:'||p_so_id,0));
  select * into v_before from public.sales_orders where id=p_so_id for update;
  if not found then raise exception 'ORDER_NOT_AVAILABLE' using errcode='P0002'; end if;
  select result into v_receipt from public.document_save_receipts where document_id=p_so_id and request_hash=v_key;
  if found then
    if v_receipt->'request' is distinct from v_request then raise exception 'MEMO_REQUEST_REUSED' using errcode='22023'; end if;
    -- A lost-response retry acknowledges the old commit without replaying it over
    -- a later edit. Return the current memo separately so the UI stays truthful.
    return v_receipt || jsonb_build_object('replayed',true,'current_memo',v_before.memo,'current_version',v_before._version);
  end if;
  if v_before.memo is distinct from p_expected_memo then
    return jsonb_build_object('saved',false,'conflict',true,'current_memo',v_before.memo,'current_version',v_before._version);
  end if;
  if v_before.memo is not distinct from p_memo then v_after:=v_before;
  else
    update public.sales_orders set memo=p_memo where id=p_so_id returning * into v_after;
    if not found then raise exception 'MEMO_UPDATE_DENIED' using errcode='42501'; end if;
    -- Fail closed if a future trigger changes unrelated order data.
    if (to_jsonb(v_before)-'memo'-'_version'-'updated_at') is distinct from
       (to_jsonb(v_after)-'memo'-'_version'-'updated_at') then
      raise exception 'MEMO_CHANGED_UNRELATED_FIELDS';
    end if;
  end if;
  v_result:=jsonb_build_object('saved',true,'request',v_request,'version',v_after._version,
    'memo',v_after.memo,'current_memo',v_after.memo,'current_version',v_after._version);
  insert into public.document_save_receipts(document_id,request_hash,result) values(p_so_id,v_key,v_result);
  return v_result;
end;
$$;
revoke all on function public.save_sales_order_memo(text,text,text,uuid) from public,anon;
grant execute on function public.save_sales_order_memo(text,text,text,uuid) to authenticated,service_role;

-- Additive rollout: older frontends keep working. New UI exposes the separate
-- memo editor only after the migration is present, with no write used as a probe.
create or replace function public.sales_order_memo_capabilities()
returns integer language sql stable security invoker set search_path = '' as $$
  select case when current_user in ('postgres','service_role') or coalesce(public.is_team_member(),false) then 1 else 0 end;
$$;
revoke all on function public.sales_order_memo_capabilities() from public,anon;
grant execute on function public.sales_order_memo_capabilities() to authenticated,service_role;
