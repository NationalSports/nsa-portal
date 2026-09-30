-- Atomic SO tracking, DPO reference, portal mention and durable rep-email obligation.
create table public.production_packet_shipment_emails (
 id uuid primary key default gen_random_uuid(),
 shipment_id text not null unique,
 so_id text not null references public.sales_orders(id) on delete cascade,
 message_id text not null references public.messages(id) on delete cascade,
 rep_id text not null references public.team_members(id),
 shipment jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','sent')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 locked_at timestamptz, sent_at timestamptz, provider_message_id text, last_error text,
 created_at timestamptz not null default now()
);
alter table public.production_packet_shipment_emails enable row level security;
revoke all on public.production_packet_shipment_emails from public, anon, authenticated;
grant select, insert, update on public.production_packet_shipment_emails to service_role;
create index on public.production_packet_shipment_emails(status,available_at);
create index on public.production_packet_shipment_emails(so_id);
create index on public.production_packet_shipment_emails(message_id);
create index on public.production_packet_shipment_emails(rep_id);

create function public.record_production_packet_shipment(p_store_id uuid, p_link_id uuid, p_actor_id text, p_shipment jsonb, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 so public.sales_orders%rowtype;
 link public.production_packet_links%rowtype;
 rep text;
 dp jsonb;
 old_shipment jsonb;
 shipments jsonb;
 new_dpos jsonb;
 shipment jsonb;
 msg_id text := 'shipment-' || (p_shipment->>'id');
 msg text;
 author_name text;
 begin
 select * into so from public.sales_orders where id = p_shipment->>'so_id' for update;
 if not found or so.webstore_id is distinct from p_store_id then raise exception 'SO is outside this packet'; end if;
 if p_link_id is not null then
  select * into link from public.production_packet_links where id = p_link_id;
  if not found or link.store_id is distinct from p_store_id or (link.so_id is not null and link.so_id <> so.id) or link.revoked_at is not null or link.expires_at <= now() then raise exception 'Link is invalid or expired'; end if;
  author_name := 'Decorator: ' || link.label;
 elsif p_actor_id is null then raise exception 'Staff or recipient link required';
 else select name into author_name from public.team_members where id=p_actor_id;
 end if;
 if lower(coalesce(so.status,'')) in ('cancelled','canceled','void') then raise exception 'SO is no longer active'; end if;
 shipments := coalesce(so._shipments,'[]'::jsonb);
 select value into old_shipment from jsonb_array_elements(shipments) where value->>'id'=p_shipment->>'id';
 if old_shipment is not null then
  if (old_shipment - 'created_at' - 'created_by') <> p_shipment then raise exception 'This tracking number was already saved with different details. Review SO Tracking before changing it.'; end if;
  return jsonb_build_object('duplicate',true,'shipmentId',old_shipment->>'id','emailStatus','queued');
 end if;
 if so._version is distinct from p_expected_version then raise exception 'SO changed while recording this shipment. Refresh and try again.'; end if;
 if exists(select 1 from jsonb_array_elements(shipments) where upper(regexp_replace(value->>'tracking_number','\s','','g'))=p_shipment->>'tracking_number' and lower(value->>'carrier')=p_shipment->>'carrier') then raise exception 'This tracking number is already on SO Tracking'; end if;
 select value into dp from jsonb_array_elements(coalesce(so.deco_pos,'[]'::jsonb)) where coalesce(value->>'id',value->>'po_id')=p_shipment->>'dpo_id';
 if dp is null or lower(coalesce(dp->>'status','')) in ('cancelled','canceled','void') then raise exception 'DPO is no longer available'; end if;
 if p_shipment->>'destination' not in ('customer','nsa') or (p_shipment->>'quantity')::integer < 1 then raise exception 'Shipment details are invalid'; end if;
 select c.primary_rep_id into rep from public.customers c where c.id=so.customer_id;
 if rep is null or not exists(select 1 from public.team_members where id=rep) then rep:=so.created_by; end if;
 if rep is null or not exists(select 1 from public.team_members where id=rep) then raise exception 'Assign a rep to this customer before reporting a shipment'; end if;
 shipment:=p_shipment || jsonb_build_object('created_at',now(),'created_by',coalesce(p_actor_id,author_name));
 select jsonb_agg(case when coalesce(value->>'id',value->>'po_id')=p_shipment->>'dpo_id' then jsonb_set(value,'{tracking_numbers}',coalesce(value->'tracking_numbers','[]'::jsonb) || jsonb_build_array(p_shipment->>'tracking_number')) else value end order by ord)
 into new_dpos from jsonb_array_elements(coalesce(so.deco_pos,'[]'::jsonb)) with ordinality a(value,ord);
 update public.sales_orders set _shipments=shipments || jsonb_build_array(shipment), deco_pos=new_dpos,
 _tracking_number=case when p_shipment->>'destination'='customer' then coalesce(nullif(_tracking_number,''),p_shipment->>'tracking_number') else _tracking_number end,
 _carrier=case when p_shipment->>'destination'='customer' then coalesce(nullif(_carrier,''),p_shipment->>'carrier') else _carrier end,
 _ship_date=case when p_shipment->>'destination'='customer' then coalesce(nullif(_ship_date,''),p_shipment->>'ship_date') else _ship_date end,
 _tracking_url=case when p_shipment->>'destination'='customer' then coalesce(nullif(_tracking_url,''),p_shipment->>'tracking_url') else _tracking_url end,
 _shipping_status=case when p_shipment->>'destination'='customer' then coalesce(nullif(_shipping_status,''),'partial') else _shipping_status end
 where id=so.id;
 msg := 'Shipment reported · ' || (dp->>'po_id') || E'\n' || (p_shipment->>'quantity') || ' garments · ' || (p_shipment->>'ship_date') || E'\n' || upper(p_shipment->>'carrier') || ': ' || (p_shipment->>'tracking_number') || E'\n' || case when p_shipment->>'destination'='customer' then 'To customer — review shipped quantities and prior invoices for invoicing.' else 'Returning to NSA — confirm receipt and remaining customer fulfillment before invoicing.' end || E'\n' || coalesce(p_shipment->>'notes','');
 insert into public.messages(id,so_id,entity_type,entity_id,author_id,author,text,ts,dept,tagged_members,read_by_staff,attachments)
 values(msg_id,so.id,'so',so.id,p_actor_id,author_name,msg,now()::text,'production',jsonb_build_array(rep),false,'[]'::jsonb);
 insert into public.production_packet_message_shares(message_id,store_id,shared_by,link_id,source,kind,metadata)
 values(msg_id,p_store_id,p_actor_id,p_link_id,case when p_link_id is null then 'staff' else 'decorator' end,'action',jsonb_build_object('type','shipment','shipmentId',p_shipment->>'id','dpoId',p_shipment->>'dpo_id'));
 insert into public.production_packet_shipment_emails(shipment_id,so_id,message_id,rep_id,shipment) values(p_shipment->>'id',so.id,msg_id,rep,p_shipment);
 return jsonb_build_object('shipmentId',p_shipment->>'id','emailStatus','queued');
end $$;
revoke all on function public.record_production_packet_shipment(uuid,uuid,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.record_production_packet_shipment(uuid,uuid,text,jsonb,integer) to service_role;

create function public.claim_production_packet_shipment_emails()
returns setof public.production_packet_shipment_emails language sql security invoker set search_path='' as $$
 with picked as (
 select id from public.production_packet_shipment_emails
 where (status='pending' and available_at<=now()) or (status='processing' and locked_at<now()-interval '10 minutes')
 order by available_at for update skip locked limit 3
 ) update public.production_packet_shipment_emails q set status='processing',attempts=q.attempts+1,locked_at=now()
 from picked where q.id=picked.id returning q.*;
$$;
revoke all on function public.claim_production_packet_shipment_emails() from public,anon,authenticated;
grant execute on function public.claim_production_packet_shipment_emails() to service_role;
