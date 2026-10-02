-- SO-2757 was sent as NSA 4691 and NSA 4695 from separate staff sessions.
-- This ledger is independent of browser-owned SO child rows and app_state blobs.
create schema if not exists private;
grant usage on schema private to service_role;
create table private.vendor_api_submissions (
  id uuid primary key default gen_random_uuid(),
  vendor text not null check (vendor in ('sanmar','sss','momentec')),
  po_number text not null,
  status text not null check (status in ('pending','accepted','uncertain','released')),
  sources jsonb not null check (jsonb_typeof(sources)='array'),
  actor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  result jsonb not null default '{}'
);
alter table private.vendor_api_submissions enable row level security;
revoke all on private.vendor_api_submissions from public, anon, authenticated;
grant select,insert,update on private.vendor_api_submissions to service_role;
create unique index vendor_api_submissions_po_active on private.vendor_api_submissions(vendor,po_number) where status<>'released';
create index vendor_api_submissions_sources on private.vendor_api_submissions using gin(sources);
comment on table private.vendor_api_submissions is 'Supplier reservations/receipts. Pending and uncertain never expire. Release ONLY after supplier confirms no order exists (or cancellation); preserve result and audit evidence.';

-- Preserve current historical commitments before another client can overwrite the blob.
-- Includes manual batches: they also consume the SO demand and must not be API reordered.
insert into private.vendor_api_submissions(vendor,po_number,status,sources,actor,result)
select b->>'vendor_key',b->>'po_number','accepted',
  (select jsonb_agg(jsonb_build_object('so_id',p->>'so_id','sku',i->>'sku','color',coalesce(i->>'color',''),
     'size',sz.key,'qty',sz.value::integer,'source_po',coalesce(p->>'po_id',''),'queue_id',''))
   from jsonb_array_elements(coalesce(b->'source_pos','[]')) p
   cross join lateral jsonb_array_elements(coalesce(p->'items','[]')) i
   cross join lateral jsonb_each_text(coalesce(i->'sizes','{}')) sz
   where sz.value ~ '^[0-9]+$' and sz.value::numeric>0),
  b->>'submitted_by',jsonb_build_object('historical_batch',b)
from public.app_state a cross join lateral jsonb_array_elements(a.value::jsonb) b
where a.id='submitted_batches' and b->>'vendor_key' in ('sanmar','sss','momentec')
  and coalesce(b->>'po_number','')<>''
  and exists (select 1 from jsonb_array_elements(coalesce(b->'source_pos','[]')) p
    cross join lateral jsonb_array_elements(coalesce(p->'items','[]')) i
    cross join lateral jsonb_each_text(coalesce(i->'sizes','{}')) sz
    where sz.value ~ '^[0-9]+$' and sz.value::numeric>0)
on conflict do nothing;

create function public.reserve_vendor_api_submission(p_vendor text,p_po_number text,p_sources jsonb,p_actor text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  r record; s record; demand bigint; committed bigint; queued bigint;
  reservation uuid; po_n integer;
begin
  if current_user not in ('postgres','service_role') then raise exception 'SERVER_REQUIRED' using errcode='42501'; end if;
  if p_vendor is null or p_vendor not in ('sanmar','sss','momentec')
     or not (coalesce(p_po_number,'') ~ '^NSA [0-9]{3,6}$' or (p_po_number ~ '^PO .+' and length(p_po_number)<=160))
     or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources)=0 then
    raise exception 'INVALID_VENDOR_SUBMISSION: missing PO or source orders';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_sources) as x(so_id text,sku text,color text,size text,qty integer,source_po text,queue_id text)
    where coalesce(so_id,'')='' or coalesce(sku,'')='' or coalesce(size,'')='' or coalesce(qty,0)<=0
       or coalesce(source_po,'')='' or (coalesce(queue_id,'')='' and source_po<>p_po_number)) then
    raise exception 'INVALID_VENDOR_SUBMISSION: incomplete sources';
  end if;
  -- Serializes all live API attempts for this vendor across server instances/users.
  perform pg_advisory_xact_lock(hashtextextended('vendor-api:'||p_vendor,0));
  -- Use the same per-SO lock as save_sales_order_atomic. A demand edit cannot race validation.
  for s in select distinct so_id from jsonb_to_recordset(p_sources) as x(so_id text) order by so_id loop
    perform pg_advisory_xact_lock(hashtextextended('sales-order-save:'||s.so_id,0));
    perform 1 from public.sales_orders where id=s.so_id and deleted_at is null for update;
    if not found then raise exception 'STALE_VENDOR_QUEUE: source order % is missing; reload',s.so_id; end if;
  end loop;
  if exists(select 1 from private.vendor_api_submissions where vendor=p_vendor and po_number=p_po_number and status<>'released') then
    raise exception 'DUPLICATE_VENDOR_ORDER: % is already reserved or submitted. Verify it; do not reorder.',p_po_number;
  end if;
  for r in select so_id,lower(trim(sku)) sku,lower(trim(coalesce(color,''))) color,size,sum(qty) qty
    from jsonb_to_recordset(p_sources) as x(so_id text,sku text,color text,size text,qty integer)
    group by so_id,lower(trim(sku)),lower(trim(coalesce(color,''))),size loop
    select coalesce(sum((i.sizes->>r.size)::bigint),0) into demand
      from public.so_items i where i.so_id=r.so_id and lower(trim(i.sku))=lower(trim(r.sku))
      and lower(trim(coalesce(i.color,'')))=lower(trim(r.color));
    -- Ledger, live batch history, and saved PO lines overlap. Count each order only once.
    -- Different batch numbers DO add: NSA 4691 + NSA 4695 are two supplier orders.
    select coalesce(sum(qty),0) into committed from (
      select order_key,max(qty) qty from (
        select d.po_number order_key,sum((x->>'qty')::bigint) qty
          from private.vendor_api_submissions d cross join lateral jsonb_array_elements(d.sources) x
          where d.status<>'released' and x->>'so_id'=r.so_id
            and lower(trim(x->>'sku'))=lower(trim(r.sku))
            and lower(trim(coalesce(x->>'color','')))=lower(trim(r.color)) and x->>'size'=r.size
          group by d.po_number
        union all
        select b->>'po_number',sum((i->'sizes'->>r.size)::bigint)
          from public.app_state a cross join lateral jsonb_array_elements(a.value::jsonb) b
          cross join lateral jsonb_array_elements(coalesce(b->'source_pos','[]')) p
          cross join lateral jsonb_array_elements(coalesce(p->'items','[]')) i
          where a.id='submitted_batches' and p->>'so_id'=r.so_id
            and lower(trim(i->>'sku'))=lower(trim(r.sku))
            and lower(trim(coalesce(i->>'color','')))=lower(trim(r.color))
          group by b->>'po_number'
        union all
        select coalesce(nullif(pl.sizes->>'batch_po_number',''),pl.po_id),sum((pl.sizes->>r.size)::bigint)
          from public.so_items i join public.so_item_po_lines pl on pl.so_item_id=i.id
          where i.so_id=r.so_id and lower(trim(i.sku))=lower(trim(r.sku))
            and lower(trim(coalesce(i.color,'')))=lower(trim(r.color))
            and pl.status in ('waiting','ordered','partial','received')
            and coalesce(pl.sizes->>'po_type','') not in ('deco','outside_deco')
            -- A standalone PO waiting to be API-sent is the source commitment itself.
            -- Once marked/received, it consumes demand like every other accepted PO.
            and not (pl.po_id=p_po_number and pl.status='waiting'
              and coalesce(pl.sizes->>'api_order_id','')='' and coalesce(pl.sizes->>'batch_po_number','')=''
              and coalesce(pl.received,'{}'::jsonb)='{}'::jsonb)
          group by coalesce(nullif(pl.sizes->>'batch_po_number',''),pl.po_id)
      ) commitments group by order_key
    ) orders;
    if r.qty>greatest(demand-committed,0) then
      raise exception 'DUPLICATE_VENDOR_ORDER: % % % % requests %, but only % remain unordered (already reserved/submitted %). Reload and verify the existing PO.',
        r.so_id,r.sku,r.color,r.size,r.qty,greatest(demand-committed,0),committed;
    end if;
  end loop;
  -- A stale/removed queue cannot order simply by relabelling it as another PO.
  for r in select so_id,lower(trim(sku)) sku,lower(trim(coalesce(color,''))) color,size,source_po,queue_id,sum(qty) qty
    from jsonb_to_recordset(p_sources) as x(so_id text,sku text,color text,size text,source_po text,queue_id text,qty integer)
    group by so_id,lower(trim(sku)),lower(trim(coalesce(color,''))),size,source_po,queue_id loop
    select coalesce(sum((pl.sizes->>r.size)::bigint),0) into queued
      from public.so_items i join public.so_item_po_lines pl on pl.so_item_id=i.id
      where i.so_id=r.so_id and lower(trim(i.sku))=lower(trim(r.sku))
        and lower(trim(coalesce(i.color,'')))=lower(trim(r.color)) and pl.po_id=r.source_po
        and lower(pl.vendor)=case p_vendor when 'sss' then 's&s activewear' when 'sanmar' then 'sanmar' else 'momentec' end
        and coalesce(pl.sizes->>'api_order_id','')=''
        and ((coalesce(r.queue_id,'')<>'' and pl.status='queued' and pl.sizes->>'batch_queue_id'=r.queue_id)
          or (coalesce(r.queue_id,'')='' and r.source_po=p_po_number and pl.status='waiting'
            and coalesce(pl.sizes->>'batch_queue_id','')='' and coalesce(pl.sizes->>'batch_po_number','')=''
            and coalesce(pl.received,'{}'::jsonb)='{}'::jsonb));
    if r.qty>queued then raise exception 'STALE_VENDOR_QUEUE: % % % no longer has these queued quantities. Reload before ordering.',r.so_id,r.sku,r.size; end if;
  end loop;
  -- Reserve the exact reviewed number BEFORE sending. Frontend must not renumber an accepted PO.
  if p_po_number ~ '^NSA [0-9]{3,6}$' then
    po_n:=substring(p_po_number from '[0-9]+')::integer;
    insert into public.batch_po_numbers(n,claimed_by,claimed_at) values(po_n,p_actor,now()) on conflict do nothing;
    if not found and not exists(select 1 from private.vendor_api_submissions where vendor=p_vendor and po_number=p_po_number and status='released') then
      raise exception 'DUPLICATE_VENDOR_ORDER: % is already used. Reload to obtain a new PO number.',p_po_number;
    end if;
  end if;
  insert into private.vendor_api_submissions(vendor,po_number,status,sources,actor)
    values(p_vendor,p_po_number,'pending',p_sources,p_actor) returning id into reservation;
  return jsonb_build_object('id',reservation,'po_number',p_po_number);
end;
$$;

create function public.finish_vendor_api_submission(p_id uuid,p_status text,p_result jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if current_user not in ('postgres','service_role') then raise exception 'SERVER_REQUIRED' using errcode='42501'; end if;
  if p_status not in ('accepted','uncertain') then raise exception 'INVALID_VENDOR_SUBMISSION_STATUS'; end if;
  update private.vendor_api_submissions set status=p_status,result=p_result,updated_at=now()
    where id=p_id and status in ('pending','uncertain');
  if not found then raise exception 'VENDOR_SUBMISSION_RECEIPT_NOT_PENDING'; end if;
end;
$$;
revoke all on function public.reserve_vendor_api_submission(text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.finish_vendor_api_submission(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_vendor_api_submission(text,text,jsonb,text) to service_role;
grant execute on function public.finish_vendor_api_submission(uuid,text,jsonb) to service_role;
