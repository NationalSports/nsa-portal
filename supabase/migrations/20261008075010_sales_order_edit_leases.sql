-- Deploy before the editor bundle. Existing callers remain usable when no lease
-- is active. Leased payloads are fenced permanently, including after expiry.
begin;
create schema if not exists private;
grant usage on schema private to authenticated;
create table private.sales_order_edit_leases (
  so_id text primary key references public.sales_orders(id) on delete cascade,
  owner_id uuid not null,
  session_id uuid not null,
  generation bigint not null default 1,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table private.sales_order_edit_leases enable row level security;
revoke all on private.sales_order_edit_leases from public,anon,authenticated;

-- Private definer only for the protected coordination table. It grants no order
-- write privileges; the existing save RPC remains SECURITY INVOKER with its RLS.
create or replace function private.sales_order_edit_lease(
  p_so_id text,p_session uuid,p_action text,p_generation bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_lease private.sales_order_edit_leases%rowtype;
  v_active boolean; v_mine boolean; v_name text; v_admin boolean; v_now timestamptz;
begin
  if v_uid is null or not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  if p_session is null or p_action not in ('status','acquire','renew','release','takeover') then
    raise exception 'INVALID_EDIT_LEASE_COMMAND';
  end if;
  -- Same lock and lock order as save_sales_order_atomic; never held while a user types.
  perform pg_advisory_xact_lock(hashtextextended('sales-order-save:'||p_so_id,0));
  if not exists(select 1 from public.sales_orders where id=p_so_id) then raise exception 'SO_WAS_DELETED'; end if;
  select * into v_lease from private.sales_order_edit_leases where so_id=p_so_id;
  v_now:=clock_timestamp();
  v_active:=coalesce(v_lease.expires_at>v_now,false);
  v_mine:=coalesce(v_lease.owner_id=v_uid and v_lease.session_id=p_session,false);
  if p_action='renew' then
    if not v_active or not v_mine or p_generation is distinct from v_lease.generation then
      return jsonb_build_object('owned',false,'reason','lost');
    end if;
    update private.sales_order_edit_leases set expires_at=v_now+interval '120 seconds',updated_at=v_now where so_id=p_so_id returning * into v_lease;
  elsif p_action='release' then
    if v_mine and p_generation=v_lease.generation then
      update private.sales_order_edit_leases set expires_at=v_now,updated_at=v_now where so_id=p_so_id;
    end if;
    return jsonb_build_object('owned',false,'released',true);
  elsif p_action in ('acquire','takeover') then
    if p_action='takeover' and v_active and not v_mine then
      select exists(select 1 from public.team_members where auth_id=v_uid and is_active is not false and role in ('admin','super_admin','gm')) into v_admin;
      if v_lease.owner_id<>v_uid and not v_admin then raise exception 'EDIT_TAKEOVER_FORBIDDEN' using errcode='42501'; end if;
      if p_generation is distinct from v_lease.generation then return jsonb_build_object('owned',false,'reason','changed'); end if;
    elsif v_active and not v_mine then
      select name into v_name from public.team_members where auth_id=v_lease.owner_id and is_active is not false limit 1;
      select exists(select 1 from public.team_members where auth_id=v_uid and is_active is not false and role in ('admin','super_admin','gm')) into v_admin;
      return jsonb_build_object('owned',false,'holder',coalesce(v_name,'Another staff member'),'generation',v_lease.generation,'can_takeover',v_lease.owner_id=v_uid or v_admin);
    end if;
    -- Every new acquisition changes the fence, including this session after expiry.
    if not v_active or not v_mine then
      insert into private.sales_order_edit_leases(so_id,owner_id,session_id,generation,expires_at,updated_at)
      values(p_so_id,v_uid,p_session,coalesce(v_lease.generation,0)+1,v_now+interval '120 seconds',v_now)
      on conflict(so_id) do update set owner_id=excluded.owner_id,session_id=excluded.session_id,
        generation=excluded.generation,expires_at=excluded.expires_at,updated_at=excluded.updated_at
      returning * into v_lease;
    end if;
  end if;
  v_active:=coalesce(v_lease.expires_at>v_now,false);
  v_mine:=coalesce(v_lease.owner_id=v_uid and v_lease.session_id=p_session,false);
  select name into v_name from public.team_members where auth_id=v_lease.owner_id and is_active is not false limit 1;
  select exists(select 1 from public.team_members where auth_id=v_uid and is_active is not false and role in ('admin','super_admin','gm')) into v_admin;
  return jsonb_build_object('owned',v_active and v_mine,'active',v_active,
    'holder',case when v_active then coalesce(v_name,'Another staff member') else null end,
    'generation',v_lease.generation,'ttl_ms',greatest(0,extract(epoch from (v_lease.expires_at-v_now))*1000),
    'can_takeover',v_active and (v_lease.owner_id=v_uid or v_admin));
end;
$$;
revoke all on function private.sales_order_edit_lease(text,uuid,text,bigint) from public,anon;
grant execute on function private.sales_order_edit_lease(text,uuid,text,bigint) to authenticated;
create or replace function public.sales_order_edit_lease(p_so_id text,p_session uuid,p_action text,p_generation bigint default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.sales_order_edit_lease(p_so_id,p_session,p_action,p_generation);
$$;
revoke all on function public.sales_order_edit_lease(text,uuid,text,bigint) from public,anon;
grant execute on function public.sales_order_edit_lease(text,uuid,text,bigint) to authenticated;

create or replace function private.assert_sales_order_edit_lease(p_so_id text,p_lease jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_row private.sales_order_edit_leases%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_team_member(),false) then raise exception 'STAFF_REQUIRED' using errcode='42501'; end if;
  select * into v_row from private.sales_order_edit_leases where so_id=p_so_id;
  if p_lease is not null and p_lease<>'null'::jsonb then
    if not found or v_row.expires_at<=clock_timestamp() or v_row.owner_id is distinct from auth.uid()
      or v_row.session_id::text is distinct from p_lease->>'session'
      or v_row.generation::text is distinct from p_lease->>'generation' then
      raise exception 'SO_EDIT_LEASE_LOST: keep your draft and reopen the order' using errcode='P0001';
    end if;
  elsif found and v_row.expires_at>clock_timestamp() then
    raise exception 'SO_EDIT_LEASE_REQUIRED: order is being edited in another session' using errcode='P0001';
  end if;
end;
$$;
revoke all on function private.assert_sales_order_edit_lease(text,jsonb) from public,anon;
grant execute on function private.assert_sales_order_edit_lease(text,jsonb) to authenticated;

-- Add the guard to the installed function instead of replacing newer save fixes
-- with a copied historical body. Require the expected signature/security mode.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.save_sales_order_atomic(text,text,jsonb)'::regprocedure) into v_def;
  if v_def ilike '%SECURITY DEFINER%' then raise exception 'Review unexpected save RPC security mode'; end if;
  if position('private.assert_sales_order_edit_lease' in v_def)=0 then
    if position(E'\nbegin\n' in v_def)=0 then raise exception 'Review unexpected save RPC body'; end if;
    v_def:=replace(v_def,E'\nbegin\n',E'\nbegin\n  -- Ownership is checked before retry receipts, so a revoked editor cannot replay.\n  if current_user not in (''postgres'',''service_role'') and (coalesce((p_plan->>''write_header'')::boolean,true) or p_plan ? ''items'' or p_plan ? ''firm_dates'') then\n    perform private.assert_sales_order_edit_lease(p_so_id,p_plan->''edit_lease'');\n  end if;\n');
    -- Recheck after acquiring the transaction lock, closing the race between a
    -- legacy no-lease save and a new editor claiming the order. The first check
    -- stays cheap so rejected old tabs cannot rebuild the historical save storm.
    if position('perform pg_advisory_xact_lock(hashtextextended(''sales-order-save:''||p_so_id,0));' in v_def)=0 then raise exception 'Review unexpected save RPC lock'; end if;
    v_def:=replace(v_def,'perform pg_advisory_xact_lock(hashtextextended(''sales-order-save:''||p_so_id,0));',E'perform pg_advisory_xact_lock(hashtextextended(''sales-order-save:''||p_so_id,0));\n  if current_user not in (''postgres'',''service_role'') and (coalesce((p_plan->>''write_header'')::boolean,true) or p_plan ? ''items'' or p_plan ? ''firm_dates'') then\n    perform private.assert_sales_order_edit_lease(p_so_id,p_plan->''edit_lease'');\n  end if;');
    execute v_def;
  end if;
end;
$$;
notify pgrst,'reload schema';
commit;
