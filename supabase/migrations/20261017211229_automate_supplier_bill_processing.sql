begin;

-- These columns exist in production and in the original schema bootstrap, but
-- an early split migration omitted them. Keep a fresh migration replay aligned
-- before the functions below reference them.
alter table public.so_item_po_lines
  add column if not exists billed jsonb default '{}'::jsonb,
  add column if not exists tracking_numbers jsonb default '[]'::jsonb;
alter table public.applied_bills
  add column if not exists qb_review_required boolean not null default false;

-- One durable lease coordinates browser pushes, scheduled retries, and QBO sends.
-- The source queues remain the document archive; this row records processing/review
-- progress without relying on one browser's localStorage.
create table public.supplier_bill_processing (
  bill_key text primary key,
  doc_norm text,
  vendor_norm text,
  is_credit boolean not null default false,
  source text,
  source_id text,
  status text not null default 'pending'
    check (status in ('pending','processing','review','applied','failed')),
  review_code text,
  review_reason text,
  payload jsonb,
  match_plan jsonb,
  owner text,
  lease_token uuid,
  lease_until timestamptz,
  qbo_status text not null default 'pending'
    check (qbo_status in ('pending','processing','review','applied','failed')),
  qbo_owner text,
  qbo_lease_token uuid,
  qbo_lease_until timestamptz,
  attempts integer not null default 0,
  qbo_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplier_bill_processing_status_idx
  on public.supplier_bill_processing(status, lease_until);
create index supplier_bill_processing_qbo_idx
  on public.supplier_bill_processing(qbo_status, qbo_lease_until);

alter table public.supplier_bill_processing enable row level security;
create policy supplier_bill_processing_staff_read
  on public.supplier_bill_processing for select to authenticated
  using ((select public.is_team_member()));
grant select on public.supplier_bill_processing to authenticated, service_role;
grant insert, update on public.supplier_bill_processing to service_role;

create or replace function public.claim_supplier_bill(
  p_bill_key text,
  p_doc_norm text,
  p_vendor text,
  p_is_credit boolean,
  p_source text,
  p_source_id text,
  p_owner text,
  p_allow_review boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.supplier_bill_processing;
  v_token uuid;
  v_existing_vendor text;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  if nullif(trim(p_bill_key),'') is null or nullif(trim(p_owner),'') is null then
    raise exception 'INVALID_BILL_CLAIM';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('supplier-bill:'||p_bill_key,0));
  if nullif(trim(p_doc_norm),'') is not null then
    select vendor into v_existing_vendor from public.applied_bills
      where doc_norm=lower(trim(p_doc_norm)) and is_credit=coalesce(p_is_credit,false);
    if found then
      if lower(regexp_replace(coalesce(v_existing_vendor,''),'[^a-zA-Z0-9]','','g'))
         = lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g'))
         and nullif(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g'),'') is not null then
        return jsonb_build_object('state','applied');
      end if;
      insert into public.supplier_bill_processing(
        bill_key,doc_norm,vendor_norm,is_credit,source,source_id,status,review_code,review_reason,owner,updated_at
      ) values (
        p_bill_key,lower(trim(p_doc_norm)),lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g')),coalesce(p_is_credit,false),
        p_source,p_source_id,'review','document_vendor_collision',
        'This document number is already applied under a different supplier.',p_owner,now()
      ) on conflict (bill_key) do update set
        status='review',review_code=excluded.review_code,review_reason=excluded.review_reason,updated_at=now();
      return jsonb_build_object('state','collision','reason','Document number already belongs to a different supplier');
    end if;
  end if;

  insert into public.supplier_bill_processing(
    bill_key,doc_norm,vendor_norm,is_credit,source,source_id,status,owner,updated_at
  ) values (
    p_bill_key,nullif(lower(trim(p_doc_norm)),''),nullif(lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g')),''),coalesce(p_is_credit,false),
    p_source,p_source_id,'pending',p_owner,now()
  ) on conflict (bill_key) do nothing;

  select * into v_row from public.supplier_bill_processing
    where bill_key=p_bill_key for update;
  if v_row.vendor_norm is distinct from nullif(lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g')),'') then
    if v_row.status='processing' and v_row.lease_until>now() then
      return jsonb_build_object('state','busy','lease_until',v_row.lease_until);
    end if;
    update public.supplier_bill_processing
      set status='review',review_code='document_vendor_collision',
          review_reason='This document number is claimed under a different supplier.',
          lease_token=null,lease_until=null,updated_at=now()
      where bill_key=p_bill_key;
    return jsonb_build_object('state','collision','reason','Document number is claimed under a different supplier');
  end if;
  -- A status bit without its immutable ledger row is not proof that money moved.
  -- Repair the state and let the normal claim/apply path re-derive it.
  if v_row.status='applied' then
    update public.supplier_bill_processing set status='pending',updated_at=now() where bill_key=p_bill_key;
    v_row.status:='pending';
  end if;
  if v_row.status='review' and not p_allow_review then
    return jsonb_build_object('state','review','code',v_row.review_code,'reason',v_row.review_reason);
  end if;
  if v_row.status='processing' and v_row.lease_until>now() and v_row.owner is distinct from p_owner then
    return jsonb_build_object('state','busy','lease_until',v_row.lease_until);
  end if;

  v_token:=case when v_row.status='processing' and v_row.lease_until>now()
    and v_row.owner=p_owner and v_row.lease_token is not null
    then v_row.lease_token else gen_random_uuid() end;
  update public.supplier_bill_processing
    set doc_norm=coalesce(nullif(lower(trim(p_doc_norm)),''),doc_norm),
        vendor_norm=coalesce(nullif(lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g')),''),vendor_norm),
        is_credit=coalesce(p_is_credit,false),source=coalesce(p_source,source),
        source_id=coalesce(p_source_id,source_id),status='processing',
        review_code=null,review_reason=null,owner=p_owner,lease_token=v_token,
        lease_until=now()+interval '10 minutes',attempts=attempts+1,updated_at=now()
    where bill_key=p_bill_key;
  return jsonb_build_object('state','claimed','token',v_token,'lease_until',now()+interval '10 minutes');
end;
$$;

create or replace function public.finish_supplier_bill_claim(
  p_claim_token uuid,
  p_status text,
  p_code text default null,
  p_reason text default null,
  p_payload jsonb default null,
  p_match_plan jsonb default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.supplier_bill_processing;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  if p_status not in ('pending','review','applied','failed') then raise exception 'INVALID_BILL_STATUS'; end if;
  select * into v_row from public.supplier_bill_processing
    where lease_token=p_claim_token for update;
  if not found then return false; end if;
  if p_status='applied' and not exists (
    select 1 from public.applied_bills
    where doc_norm=v_row.doc_norm and is_credit=v_row.is_credit
  ) then raise exception 'APPLIED_LEDGER_REQUIRED'; end if;
  update public.supplier_bill_processing
    set status=p_status,review_code=p_code,review_reason=p_reason,
        payload=coalesce(p_payload,payload),match_plan=coalesce(p_match_plan,match_plan),
        lease_token=null,lease_until=null,updated_at=now()
    where bill_key=v_row.bill_key;
  return true;
end;
$$;

create or replace function public.claim_supplier_bill_qbo(
  p_bill_key text,
  p_doc_norm text,
  p_vendor text,
  p_is_credit boolean,
  p_owner text,
  p_allow_review boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.supplier_bill_processing;
  v_token uuid;
  v_portal_applied boolean:=false;
  v_existing_vendor text;
  v_existing_qbo boolean:=false;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  if nullif(trim(p_bill_key),'') is null or nullif(trim(p_owner),'') is null then raise exception 'INVALID_QBO_CLAIM'; end if;
  perform pg_advisory_xact_lock(hashtextextended('supplier-bill-qbo:'||p_bill_key,0));
  select vendor,portal_status='success',(qb_status='success' and qb_bill_id is not null)
    into v_existing_vendor,v_portal_applied,v_existing_qbo
    from public.applied_bills where doc_norm=lower(trim(p_doc_norm))
      and is_credit=coalesce(p_is_credit,false);
  if found and (
    lower(regexp_replace(coalesce(v_existing_vendor,''),'[^a-zA-Z0-9]','','g'))
      is distinct from lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g'))
    or nullif(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g'),'') is null
  ) then
    return jsonb_build_object('state','collision','reason','Document number already belongs to a different supplier');
  end if;
  v_portal_applied:=coalesce(v_portal_applied,false);
  v_existing_qbo:=coalesce(v_existing_qbo,false);
  if v_existing_qbo then
    update public.applied_bills set qb_review_required=false,updated_at=now()
      where doc_norm=lower(trim(p_doc_norm)) and is_credit=coalesce(p_is_credit,false);
    update public.supplier_bill_processing
      set qbo_status='applied',qbo_lease_token=null,qbo_lease_until=null,updated_at=now()
      where bill_key=p_bill_key;
    return jsonb_build_object('state','applied');
  end if;
  if not v_portal_applied and not p_allow_review then
    return jsonb_build_object('state','not_portal_applied');
  end if;
  insert into public.supplier_bill_processing(bill_key,doc_norm,vendor_norm,is_credit,status,owner,updated_at)
    values(p_bill_key,lower(trim(p_doc_norm)),
      nullif(lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g')),''),
      coalesce(p_is_credit,false),
      case when v_portal_applied then 'applied' else 'pending' end,p_owner,now())
    on conflict (bill_key) do nothing;
  select * into v_row from public.supplier_bill_processing where bill_key=p_bill_key for update;
  if v_row.vendor_norm is distinct from nullif(lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g')),'') then
    if v_row.status='processing' and v_row.lease_until>now() then
      return jsonb_build_object('state','busy','lease_until',v_row.lease_until);
    end if;
    update public.supplier_bill_processing
      set qbo_status='review',review_reason='This document number is claimed under a different supplier.',
          qbo_lease_token=null,qbo_lease_until=null,updated_at=now()
      where bill_key=p_bill_key;
    update public.applied_bills set qb_review_required=true,
      qb_message='Needs review: document number is claimed under a different supplier.',updated_at=now()
      where doc_norm=lower(trim(p_doc_norm)) and is_credit=coalesce(p_is_credit,false);
    return jsonb_build_object('state','collision','reason','Document number is claimed under a different supplier');
  end if;
  if v_row.qbo_status='applied' then
    update public.supplier_bill_processing set qbo_status='pending',updated_at=now() where bill_key=p_bill_key;
    v_row.qbo_status:='pending';
  end if;
  if v_row.qbo_status='review' and not p_allow_review then
    return jsonb_build_object('state','review','reason',v_row.review_reason);
  end if;
  if v_row.qbo_status='processing' and v_row.qbo_lease_until>now()
     and v_row.qbo_owner is distinct from p_owner then
    return jsonb_build_object('state','busy','lease_until',v_row.qbo_lease_until);
  end if;
  v_token:=case when v_row.qbo_status='processing' and v_row.qbo_lease_until>now()
    and v_row.qbo_owner=p_owner and v_row.qbo_lease_token is not null
    then v_row.qbo_lease_token else gen_random_uuid() end;
  update public.supplier_bill_processing
    set qbo_status='processing',qbo_owner=p_owner,qbo_lease_token=v_token,
        qbo_lease_until=now()+interval '10 minutes',qbo_attempts=qbo_attempts+1,updated_at=now()
    where bill_key=p_bill_key;
  return jsonb_build_object('state','claimed','token',v_token);
end;
$$;

create or replace function public.finish_supplier_bill_qbo_claim(
  p_claim_token uuid,
  p_status text,
  p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.supplier_bill_processing;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and not coalesce(public.is_team_member(),false) then
    raise exception 'STAFF_REQUIRED' using errcode='42501';
  end if;
  if p_status not in ('pending','review','applied','failed') then raise exception 'INVALID_QBO_STATUS'; end if;
  select * into v_row from public.supplier_bill_processing where qbo_lease_token=p_claim_token for update;
  if not found then return false; end if;
  if p_status='applied' and not exists (
    select 1 from public.applied_bills where doc_norm=v_row.doc_norm
      and is_credit=v_row.is_credit and qb_status='success' and qb_bill_id is not null
  ) then raise exception 'QBO_RECEIPT_REQUIRED'; end if;
  update public.supplier_bill_processing
    set qbo_status=p_status,review_reason=case when p_status='review' then p_reason else review_reason end,
        qbo_lease_token=null,qbo_lease_until=null,updated_at=now()
    where bill_key=v_row.bill_key;
  update public.applied_bills
    set qb_review_required=(p_status='review'),updated_at=now()
    where doc_norm=v_row.doc_norm and is_credit=v_row.is_credit;
  return true;
end;
$$;

-- Candidate read is normalized but exact: punctuation and a leading PO/DPO may
-- differ, while the complete number+tag must still agree.
create or replace function public.supplier_bill_po_candidates(p_po_number text)
returns table(
  id integer, so_id text, po_id text, vendor text, sku text, name text,
  color text, sizes jsonb, billed jsonb, tracking_numbers jsonb
)
language sql
security definer
set search_path = ''
as $$
  select p.id,i.so_id,p.po_id,coalesce(v.name,p.vendor),i.sku,i.name,i.color,p.sizes,p.billed,p.tracking_numbers
  from public.so_item_po_lines p
  join public.so_items i on i.id=p.so_item_id
  join public.sales_orders s on s.id=i.so_id
  left join public.vendors v on v.id=p.vendor
  where s.deleted_at is null
    and regexp_replace(upper(coalesce(p.po_id,'')),'^(D?PO)|[^A-Z0-9]','','g')
      = regexp_replace(upper(coalesce(p_po_number,'')),'^(D?PO)|[^A-Z0-9]','','g')
  order by i.so_id,p.id
$$;

-- Apply the conservative server plan and the applied-bills ledger in ONE
-- transaction. The expected values make a stale plan fail before any money moves.
create or replace function public.apply_claimed_supplier_bill(
  p_claim_token uuid,
  p_bill jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.supplier_bill_processing;
  v_map jsonb;
  v_po record;
  v_doc text:=lower(trim(p_bill->>'doc_number'));
  v_credit boolean:=coalesce((p_bill->>'is_credit')::boolean,false);
  v_maps jsonb:=coalesce(p_bill->'_lineMappings','[]'::jsonb);
  v_map_count integer:=jsonb_array_length(v_maps);
  v_duplicate_count integer:=0;
  v_ordered numeric;
  v_billed numeric;
  v_unit numeric;
  v_qty numeric;
  v_size text;
  v_cost numeric;
  v_details jsonb;
  v_tracking text:=coalesce(p_bill->>'tracking','');
  v_so_id text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if v_doc='' or v_credit or v_map_count=0 then raise exception 'INVALID_AUTOMATED_BILL'; end if;
  select * into v_claim from public.supplier_bill_processing
    where lease_token=p_claim_token and status='processing' and lease_until>now() for update;
  if not found then raise exception 'BILL_CLAIM_REQUIRED'; end if;
  if exists(select 1 from public.applied_bills where doc_norm=v_doc and is_credit=v_credit) then
    update public.supplier_bill_processing set status='applied',lease_token=null,lease_until=null,updated_at=now()
      where bill_key=v_claim.bill_key;
    return jsonb_build_object('state','already_applied');
  end if;

  for v_map in select value from jsonb_array_elements(v_maps) loop
    select p.*,i.so_id,i.sku into v_po
      from public.so_item_po_lines p join public.so_items i on i.id=p.so_item_id
      where p.id=(v_map->>'po_line_id')::integer for update of p;
    if not found or v_po.so_id is distinct from v_map->>'so_id'
       or v_po.po_id is distinct from v_map->>'po_id' or v_po.sku is distinct from v_map->>'sku' then
      raise exception 'SUPPLIER_BILL_STALE_TARGET';
    end if;
    if v_so_id is null then v_so_id:=v_po.so_id;
    elsif v_so_id<>v_po.so_id then raise exception 'MULTI_ORDER_AUTOMATION_BLOCKED'; end if;
    v_size:=v_map->>'size';
    v_ordered:=coalesce((v_po.sizes->>v_size)::numeric,0);
    v_billed:=coalesce((v_po.billed->>v_size)::numeric,0);
    v_unit:=coalesce((v_po.sizes->>'unit_cost')::numeric,0);
    if v_ordered is distinct from (v_map->>'expected_ordered')::numeric
       or v_billed is distinct from (v_map->>'expected_billed')::numeric
       or abs(v_unit-(v_map->>'expected_unit_cost')::numeric)>.005 then
      raise exception 'SUPPLIER_BILL_STALE_VALUES';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_po.sizes->'_bill_details','[]'::jsonb)) detail
      where lower(trim(detail->>'doc'))=v_doc
    ) then
      v_duplicate_count:=v_duplicate_count+1;
    end if;
  end loop;
  if v_duplicate_count>0 and v_duplicate_count<v_map_count then raise exception 'PARTIAL_SUPPLIER_BILL_REQUIRES_REVIEW'; end if;

  if v_duplicate_count=0 then
    for v_map in select value from jsonb_array_elements(v_maps) loop
      select p.*,i.so_id,i.sku into v_po
        from public.so_item_po_lines p join public.so_items i on i.id=p.so_item_id
        where p.id=(v_map->>'po_line_id')::integer for update of p;
      v_size:=v_map->>'size'; v_qty:=(v_map->>'qty')::numeric; v_cost:=(v_map->>'bill_cost')::numeric;
      v_billed:=coalesce((v_po.billed->>v_size)::numeric,0);
      if v_billed+v_qty>coalesce((v_po.sizes->>v_size)::numeric,0) then raise exception 'SUPPLIER_BILL_OVERAGE'; end if;
      v_details:=coalesce(v_po.sizes->'_bill_details','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
        'doc',p_bill->>'doc_number','date',p_bill->>'doc_date','sizes',jsonb_build_object(v_size,v_qty),
        'tracking',v_tracking,'cost',v_cost,'server_automated',true
      ));
      update public.so_item_po_lines
        set billed=jsonb_set(coalesce(billed,'{}'::jsonb),array[v_size],to_jsonb(v_billed+v_qty),true),
            tracking_numbers=case when v_tracking='' or coalesce(tracking_numbers,'[]'::jsonb) ? v_tracking
              then coalesce(tracking_numbers,'[]'::jsonb)
              else coalesce(tracking_numbers,'[]'::jsonb)||to_jsonb(v_tracking) end,
            sizes=jsonb_set(
              jsonb_set(coalesce(sizes,'{}'::jsonb),'{_bill_cost}',
                to_jsonb(coalesce((sizes->>'_bill_cost')::numeric,0)+v_cost),true),
              '{_bill_details}',v_details,true)
        where id=v_po.id;
    end loop;
    update public.sales_orders
      set _inbound_freight=round((coalesce(_inbound_freight,0)
            +coalesce((p_bill->>'freight')::numeric,0)+coalesce((p_bill->>'si_upcharge')::numeric,0))::numeric,2),
          updated_at=now()
      where id=v_so_id;
  end if;

  insert into public.applied_bills(
    doc_norm,doc_number,si_doc_number,is_credit,vendor,po_number,doc_total,source,
    applied_by,status,portal_status,applied_so_ids,resolution,raw_meta,updated_at
  ) values (
    v_doc,p_bill->>'doc_number',nullif(lower(trim(p_bill->>'si_doc_number')),''),
    false,coalesce(nullif(p_bill->>'vendor',''),p_bill->>'supplier'),p_bill->>'po_number',
    (p_bill->>'doc_total')::numeric,p_bill->>'source',p_actor,'pushed','success',array[v_so_id],
    jsonb_build_object('auto_pushed',true,'server_automated',true,'lines',v_map_count),
    p_bill-'rawText'-'_wizard'-'_applyKey',now()
  ) on conflict (doc_norm,is_credit) do nothing;

  if v_claim.source='ss_orders' then
    update public.ss_documents set status='applied',applied_doc_number=p_bill->>'doc_number',
      resolved_by=p_actor,resolved_at=now(),updated_at=now() where order_number=v_claim.source_id;
  elsif v_claim.source='sportsinc' then
    update public.si_documents set status='approved',applied_doc_number=p_bill->>'doc_number',
      resolved_by=p_actor,resolved_at=now(),updated_at=now() where si_doc_number::text=v_claim.source_id;
  end if;
  update public.supplier_bill_processing
    set status='applied',payload=p_bill,match_plan=v_maps,lease_token=null,lease_until=null,updated_at=now()
    where bill_key=v_claim.bill_key;
  return jsonb_build_object('state',case when v_duplicate_count=v_map_count then 'ledger_repaired' else 'applied' end,'so_id',v_so_id);
end;
$$;

revoke all on function public.claim_supplier_bill(text,text,text,boolean,text,text,text,boolean) from public,anon;
revoke all on function public.finish_supplier_bill_claim(uuid,text,text,text,jsonb,jsonb) from public,anon;
revoke all on function public.claim_supplier_bill_qbo(text,text,text,boolean,text,boolean) from public,anon;
revoke all on function public.finish_supplier_bill_qbo_claim(uuid,text,text) from public,anon;
revoke all on function public.supplier_bill_po_candidates(text) from public,anon;
revoke all on function public.apply_claimed_supplier_bill(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_supplier_bill(text,text,text,boolean,text,text,text,boolean) to authenticated,service_role;
grant execute on function public.finish_supplier_bill_claim(uuid,text,text,text,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.claim_supplier_bill_qbo(text,text,text,boolean,text,boolean) to authenticated,service_role;
grant execute on function public.finish_supplier_bill_qbo_claim(uuid,text,text) to authenticated,service_role;
grant execute on function public.supplier_bill_po_candidates(text) to service_role;
grant execute on function public.apply_claimed_supplier_bill(uuid,jsonb,text) to service_role;

commit;
