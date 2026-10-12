-- Server-owned observations. Staff APIs return aggregates, never employee rankings.
create table public.fulfillment_job_events (
 id bigserial primary key, so_id text not null, job_id text not null,
 from_status text, to_status text not null, method text not null default '',
 units integer not null default 0, machine text,
 occurred_at timestamptz not null default now(), audit_id bigint unique
);
create index fulfillment_job_events_time on public.fulfillment_job_events(occurred_at);
create index fulfillment_job_events_job on public.fulfillment_job_events(so_id,job_id,occurred_at);
alter table public.fulfillment_job_events enable row level security;
revoke all on public.fulfillment_job_events from public,anon,authenticated;
grant select,insert on public.fulfillment_job_events to service_role;
grant usage,select on sequence public.fulfillment_job_events_id_seq to service_role;

create function public.capture_fulfillment_job_event() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.prod_status is distinct from old.prod_status and new.prod_status is not null and new.so_id is not null
  and coalesce(to_jsonb(new)->>'key','') not like 'outside_art:%' then
  insert into fulfillment_job_events(so_id,job_id,from_status,to_status,method,units,machine)
  values(new.so_id,new.id,old.prod_status,new.prod_status,coalesce(new.deco_type,''),coalesce(new.total_units,0),new.assigned_machine);
 end if;
 return new;
end $$;
revoke all on function public.capture_fulfillment_job_event() from public,anon,authenticated;
create trigger capture_fulfillment_job_event after update of prod_status on public.so_jobs
 for each row execute function public.capture_fulfillment_job_event();

-- Only real UPDATE transitions: imports/inserts of old completed jobs are not production.
insert into fulfillment_job_events(so_id,job_id,from_status,to_status,method,units,machine,occurred_at,audit_id)
select new_data->>'so_id',new_data->>'id',old_data->>'prod_status',new_data->>'prod_status',
 coalesce(new_data->>'deco_type',''),coalesce((new_data->>'total_units')::integer,0),new_data->>'assigned_machine',changed_at,id
from public.audit_log where table_name='so_jobs' and op='UPDATE' and changed_at>=now()-interval '90 days'
 and coalesce(new_data->>'key','') not like 'outside_art:%'
 and old_data->>'prod_status' is distinct from new_data->>'prod_status'
 and new_data->>'so_id' is not null and new_data->>'id' is not null and new_data->>'prod_status' is not null
on conflict(audit_id) do nothing;

create table public.fulfillment_arrivals (
 id bigserial primary key, request_id uuid not null, so_id text not null, so_item_id integer not null,
 po_id text not null, size text not null, quantity integer not null check(quantity>0),
 received_before integer not null check(received_before>=0), received_target integer not null,
 arrived_at timestamptz not null default now(), checked_in_at timestamptz, invalidated_at timestamptz,
 unique(request_id,so_item_id,po_id,size), check(received_target=received_before+quantity)
);
create index fulfillment_arrivals_item on public.fulfillment_arrivals(so_item_id,po_id,size);
create index fulfillment_arrivals_time on public.fulfillment_arrivals(arrived_at);
alter table public.fulfillment_arrivals enable row level security;
revoke all on public.fulfillment_arrivals from public,anon,authenticated;
grant select,insert,update on public.fulfillment_arrivals to service_role;
grant usage,select on sequence public.fulfillment_arrivals_id_seq to service_role;

-- Authorized staff endpoint is the only caller. Row locks and cumulative ranges
-- prevent two partial deliveries claiming the same received units. Request IDs
-- make network retries idempotent. No backdating or client-chosen completion time.
create function public.record_fulfillment_arrivals(p_request_id uuid,p_lines jsonb) returns integer
language plpgsql security invoker set search_path=public as $$
declare l jsonb; p so_item_po_lines; item_id integer; item_sizes jsonb; q integer; before_qty integer; received_qty integer; ordered_qty integer; result integer:=0; sz text;
begin
 if p_request_id is null or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 250 then raise exception 'Choose 1–250 arriving size lines'; end if;
 -- Serialize retries of one request, including a simultaneous retry before commit.
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select count(*) into result from fulfillment_arrivals where request_id=p_request_id;
 if result>0 then return result; end if;
 for l in select value from jsonb_array_elements(p_lines) order by value->>'so_id',value->>'item_index',value->>'po_id',value->>'size' loop
  q:=(l->>'qty')::integer; sz:=l->>'size';
  if q is null or q<=0 or q>100000 or coalesce(sz,'')='' then raise exception 'Enter positive arriving quantities'; end if;
  select id,sizes into strict item_id,item_sizes from so_items where so_id=l->>'so_id' and item_index=(l->>'item_index')::integer;
  if not (item_sizes ? sz) or jsonb_typeof(item_sizes->sz)<>'number' then raise exception 'Choose an ordered garment size'; end if;
  select * into strict p from so_item_po_lines where so_item_id=item_id and po_id=l->>'po_id' for update;
  if p.status='cancelled' or coalesce((p.sizes->>'drop_ship')::boolean,false) then raise exception 'Only warehouse arrivals can be recorded'; end if;
  received_qty:=coalesce((p.received->>sz)::integer,0);
  ordered_qty:=coalesce((p.sizes->>sz)::integer,0)-coalesce((p.cancelled->>sz)::integer,0);
  select greatest(received_qty,coalesce(max(received_target),0)) into before_qty from fulfillment_arrivals
   where so_item_id=item_id and po_id=p.po_id and size=sz and invalidated_at is null;
  if before_qty+q>ordered_qty then raise exception 'These units are already recorded as arrived, received, or exceed the open order'; end if;
  insert into fulfillment_arrivals(request_id,so_id,so_item_id,po_id,size,quantity,received_before,received_target)
   values(p_request_id,l->>'so_id',item_id,p.po_id,sz,q,before_qty,before_qty+q);
  result:=result+1;
 end loop;
 return result;
end $$;
revoke all on function public.record_fulfillment_arrivals(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_fulfillment_arrivals(uuid,jsonb) to service_role;

create function public.capture_fulfillment_checkin() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 -- Updates and reinserts both occur in existing SO save paths. Stable item+PO
 -- references preserve observations even when a PO child row is recreated.
 update fulfillment_arrivals a set
  invalidated_at=case when new.status='cancelled' or coalesce((new.sizes->>a.size)::integer,0)-coalesce((new.cancelled->>a.size)::integer,0)<a.received_target
   or (a.checked_in_at is not null and coalesce((new.received->>a.size)::integer,0)<a.received_target) then now() else a.invalidated_at end,
  checked_in_at=case when a.checked_in_at is null and coalesce((new.received->>a.size)::integer,0)>=a.received_target then now() else a.checked_in_at end
 where a.so_item_id=new.so_item_id and a.po_id=new.po_id and a.invalidated_at is null;
 return new;
end $$;
revoke all on function public.capture_fulfillment_checkin() from public,anon,authenticated;
create trigger capture_fulfillment_checkin after insert or update of received,cancelled,status,sizes on public.so_item_po_lines
 for each row execute function public.capture_fulfillment_checkin();
