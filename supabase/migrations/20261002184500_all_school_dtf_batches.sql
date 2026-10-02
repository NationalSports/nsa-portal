-- Supplier-specific all-school DTF queue. Inert until staff configure a supplier
-- and enable both store auto-send and the worker's global sending switch.
create table if not exists public.all_school_dtf_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.webstores(id),
  supplier_id text not null,
  supplier_snapshot jsonb not null,
  manifest jsonb not null,
  status text not null default 'queued' check(status in ('queued','sending','sent','unknown','blocked','received')),
  message_id text, provider text, error text,
  created_at timestamptz not null default now(), sent_at timestamptz,
  received_at timestamptz, received_by text, bin text
);
create table if not exists public.all_school_dtf_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.webstores(id),
  so_id text not null, job_id text not null,
  supplier_id text, qty integer not null check(qty > 0),
  manifest jsonb not null,
  status text not null default 'queued' check(status in ('queued','blocked','batched','received')),
  error text, batch_id uuid references public.all_school_dtf_batches(id),
  created_at timestamptz not null default now(),
  unique(so_id,job_id)
);
create index if not exists all_school_dtf_requests_queue on public.all_school_dtf_requests(store_id,supplier_id,status);
alter table public.all_school_dtf_requests enable row level security;
alter table public.all_school_dtf_batches enable row level security;
create policy all_school_dtf_requests_read on public.all_school_dtf_requests for select to authenticated using(public.is_team_member());
create policy all_school_dtf_batches_read on public.all_school_dtf_batches for select to authenticated using(public.is_team_member());
revoke all on public.all_school_dtf_requests,public.all_school_dtf_batches from anon;
revoke insert,update,delete on public.all_school_dtf_requests,public.all_school_dtf_batches from authenticated;
grant select on public.all_school_dtf_requests,public.all_school_dtf_batches to authenticated;
grant all on public.all_school_dtf_requests,public.all_school_dtf_batches to service_role;

-- Row locks, batch creation, and request allocation form one transaction. Two
-- sweeps cannot send overlapping prints, nor strand a claim before batch insert.
create or replace function public.claim_all_school_dtf_batch(p_store_id uuid,p_supplier_id text,p_supplier_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_ids uuid[]; v_manifest jsonb; v_batch public.all_school_dtf_batches;
begin
  select array_agg(r.id),jsonb_agg(r.manifest order by r.created_at,r.id)
  into v_ids,v_manifest from (
    select * from all_school_dtf_requests where store_id=p_store_id
      and supplier_id=p_supplier_id and status='queued'
    order by created_at,id limit 100 for update skip locked
  ) r;
  if coalesce(array_length(v_ids,1),0)=0 then return jsonb_build_object('replayed',true); end if;
  insert into all_school_dtf_batches(store_id,supplier_id,supplier_snapshot,manifest)
    values(p_store_id,p_supplier_id,p_supplier_snapshot,v_manifest) returning * into v_batch;
  update all_school_dtf_requests set status='batched',batch_id=v_batch.id where id=any(v_ids);
  return to_jsonb(v_batch);
end $$;
revoke all on function public.claim_all_school_dtf_batch(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_all_school_dtf_batch(uuid,text,jsonb) to service_role;

create or replace function public.receive_all_school_dtf_batch(p_batch_id uuid,p_actor text,p_bin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_batch public.all_school_dtf_batches; m jsonb; a jsonb;
begin
  select * into v_batch from all_school_dtf_batches where id=p_batch_id for update;
  if not found or v_batch.status not in ('sent','received') then raise exception 'Only confirmed sent batches can be received'; end if;
  if v_batch.status='received' then return jsonb_build_object('replayed',true); end if;
  -- Receiving adds physical supplier prints once. Existing reservations remain;
  -- new prints are reserved specifically for their original shortage allocations.
  -- Stocked jobs still require the warehouse's physical consumption step before
  -- their readiness flag can advance. Personalized prints are made-to-order.
  perform pg_advisory_xact_lock(hashtextextended('school-deco:'||v_batch.store_id::text,0));
  for m in select value from jsonb_array_elements(v_batch.manifest) loop
    if coalesce(m->>'transfer_code','')<>'' then
      update webstore_transfers set on_hand=coalesce(on_hand,0)+(m->>'qty')::integer
        where store_id=v_batch.store_id and code=m->>'transfer_code';
      if not found then raise exception 'DTF stock design missing; nothing received'; end if;
      for a in select value from jsonb_array_elements(coalesce(m->'allocation_shortfalls','[]')) loop
        update all_school_decoration_allocations set
          reserved_qty=least(required_qty,reserved_qty+(a->>'qty')::integer)
        where id=(a->>'id')::bigint and store_id=v_batch.store_id
          and transfer_code=m->>'transfer_code' and status='reserved';
      end loop;
    else
      update so_jobs set dtf_prints_status='received' where so_id=m->>'so_id' and id=m->>'job_id';
    end if;
  end loop;
  update all_school_dtf_batches set status='received',received_at=now(),received_by=p_actor,bin=nullif(p_bin,'') where id=p_batch_id;
  update all_school_dtf_requests set status='received' where batch_id=p_batch_id;
  return jsonb_build_object('received',true);
end $$;
revoke all on function public.receive_all_school_dtf_batch(uuid,text,text) from public,anon,authenticated;
grant execute on function public.receive_all_school_dtf_batch(uuid,text,text) to service_role;

-- Bounded scheduled scans cover a fixed snapshot before resetting. Random UUID
-- ordering is deliberate: it supports a cheap stable keyset without excluding
-- old orders as new purchases arrive. A failed order is revisited next cycle.
create table public.all_school_dtf_scan_state (
  id text primary key, last_order_id uuid, upper_order_id uuid,
  updated_at timestamptz not null default now()
);
insert into public.all_school_dtf_scan_state(id) values('orders');
alter table public.all_school_dtf_scan_state enable row level security;
revoke all on public.all_school_dtf_scan_state from public,anon,authenticated;
grant all on public.all_school_dtf_scan_state to service_role;
create or replace function public.all_school_dtf_send_candidates()
returns jsonb language sql security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (
  select b.* from all_school_dtf_batches b join webstores s on s.id=b.store_id
  where b.status='queued' and s.org_type='all_school'
    and s.all_school_settings->'dtf'->>'auto_send'='true'
  order by b.created_at,b.id limit 10
 ) q;
$$;
revoke all on function public.all_school_dtf_send_candidates() from public,anon,authenticated;
grant execute on function public.all_school_dtf_send_candidates() to service_role;
