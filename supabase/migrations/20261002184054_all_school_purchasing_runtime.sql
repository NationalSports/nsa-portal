-- All School purchasing reuses the existing needs ledger and shared PO numbers.
alter table public.purchase_orders add column if not exists all_school_store_id uuid references public.webstores(id);
alter table public.purchase_orders add column if not exists ship_to jsonb;
alter table public.purchase_orders add column if not exists submission_state text not null default 'pending';
alter table public.purchase_orders add column if not exists submission_token uuid;
alter table public.purchase_orders add column if not exists api_order_id text;
alter table public.purchase_orders add column if not exists submission_error text;
alter table public.purchase_orders add column if not exists vendor_lines jsonb;
alter table public.purchase_orders add column if not exists vendor_request_started_at timestamptz;
alter table public.teamshop_auto_po_needs add column if not exists purchasing_run_key text;
alter table public.teamshop_auto_po_needs add column if not exists purchasing_claimed_at timestamptz;

create table public.all_school_house_reservations (
 need_id bigint primary key references public.teamshop_auto_po_needs(id),product_id text not null,size text not null,
 qty integer not null check(qty>0),so_id text not null,created_at timestamptz not null default now()
);
create index all_school_house_resource on public.all_school_house_reservations(product_id,size);
create table public.all_school_batch_allocations (
 id uuid primary key default gen_random_uuid(),po_id uuid not null references public.purchase_orders(id),
 vendor_key text not null,queue_entry jsonb not null,
 state text not null default 'queued' check(state in ('queued','submitting','submitted','unknown','cancelled')),
 submission_token uuid,submitted_po_number text,vendor_request_started_at timestamptz,created_at timestamptz not null default now()
);
create index all_school_batch_allocations_po on public.all_school_batch_allocations(po_id);
alter table public.all_school_house_reservations enable row level security;
alter table public.all_school_batch_allocations enable row level security;
create policy all_school_house_read on public.all_school_house_reservations for select to authenticated using(public.is_team_member());
create policy all_school_batch_read on public.all_school_batch_allocations for select to authenticated using(public.is_team_member());
grant select on public.all_school_house_reservations,public.all_school_batch_allocations to authenticated;
revoke all on public.all_school_house_reservations,public.all_school_batch_allocations from public,anon;
grant all on public.all_school_house_reservations,public.all_school_batch_allocations to service_role;

-- Durable virtual queue entries survive stale LWW app_state writes. No other
-- normal-order batch row is changed. Only a claimed submission removes an entry.
create function public.merge_all_school_batch_queue() returns trigger language plpgsql security definer set search_path=public as $$
declare v jsonb; r record;
begin
 if new.id<>'batch_pos' then return new; end if;
 v:=coalesce(nullif(new.value,''),'[]')::jsonb;
 if jsonb_typeof(v)<>'array' then raise exception 'NSA_BAD_BATCH_QUEUE'; end if;
 select coalesce(jsonb_agg(e),'[]'::jsonb) into v from jsonb_array_elements(v) e where not(e ? 'all_school_allocation_id');
 for r in select id,queue_entry,state from all_school_batch_allocations where state in ('queued','submitting','unknown') order by created_at,id loop
  v:=v||jsonb_build_array(r.queue_entry||jsonb_build_object('all_school_allocation_id',r.id,'all_school_submission_state',r.state));
 end loop;
 new.value:=v::text; return new;
end $$;
create trigger merge_all_school_batch_queue before insert or update on public.app_state for each row execute function public.merge_all_school_batch_queue();

create function public.all_school_garment_source_valid(p_so_item_id integer) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from so_items i where i.id=p_so_item_id
  and coalesce(array_length(i.source_webstore_item_ids,1),0)>0
  and not exists(select 1 from unnest(i.source_webstore_item_ids) src(id)
   left join webstore_order_items li on li.id=src.id left join webstore_orders wo on wo.id=li.order_id
   where li.id is null or coalesce(li.qty,0)<=0 or coalesce(li.line_status,'') in ('cancelled','canceled','refunded')
    or wo.so_id is distinct from i.so_id or wo.order_source is distinct from 'all_school' or coalesce(wo.status,'') not in ('paid','batched')
    or coalesce(li.sku,i.sku) is distinct from i.sku or coalesce(li.color,i.color) is distinct from i.color or li.production_recipe is distinct from i.recipe_snapshot)
  and i.sizes is not distinct from (select jsonb_object_agg(d.size,d.qty) from (
   select coalesce(nullif(li.size,''),'OS') size,sum(li.qty)::integer qty from webstore_order_items li
    where li.id=any(i.source_webstore_item_ids) group by 1) d));
$$;
revoke all on function public.all_school_garment_source_valid(integer) from public,anon,authenticated;
grant execute on function public.all_school_garment_source_valid(integer) to service_role;

create function public.plan_all_school_purchase(p_store_id uuid,p_vendor text,p_run_key text,p_need_ids bigint[],p_due_reason text,p_combine_regular boolean,p_no_batch_policy text,p_max_run_cents bigint,p_actor text,p_ship_to jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s webstores; n record; it so_items; cfg teamshop_auto_po_settings; lines jsonb:='[]'; total bigint:=0;
 q integer; house integer; pulled integer; reserved integer; committed integer; other_demand integer; have integer;
 result jsonb; po purchase_orders; queue jsonb; regular boolean:=false; vk text; bp jsonb; aid uuid; sid text;
begin
 if coalesce(p_run_key,'')='' then raise exception 'NSA_BAD_INPUT:run key'; end if;
 perform pg_advisory_xact_lock(hashtextextended('all_school_purchase:'||p_store_id::text||':'||p_vendor,0));
 select * into s from webstores where id=p_store_id for update;
 if not found or s.org_type<>'all_school' then raise exception 'NSA_BAD_SOURCE'; end if;
 if coalesce((s.all_school_settings->'purchasing'->>'enabled')::boolean,false) is not true then return jsonb_build_object('ok',true,'reason','disabled'); end if;
 if p_vendor not in ('SanMar','S&S Activewear') then return jsonb_build_object('ok',true,'reason','unsupported_vendor'); end if;
 select * into cfg from teamshop_auto_po_settings where vendor=p_vendor;
 if not found then return jsonb_build_object('ok',true,'reason','missing_vendor_settings'); end if;
 if not cfg.auto_submit_enabled then return jsonb_build_object('ok',true,'reason','vendor_disabled'); end if;
 if coalesce(p_ship_to->>'address1','')='' or coalesce(p_ship_to->>'postalCode','')='' then raise exception 'NSA_BAD_DESTINATION'; end if;
 select * into po from purchase_orders where client_ref=p_run_key;
 if found then return jsonb_build_object('ok',true,'replayed',true,'purchase_order',to_jsonb(po)); end if;
 if exists(select 1 from teamshop_auto_po_needs nd where nd.id=any(p_need_ids) and nd.vendor=p_vendor and nd.po_id is null and nd.dismissed_at is null and not all_school_garment_source_valid(nd.so_item_id)) then return jsonb_build_object('ok',true,'reason','source_line_changed'); end if;
 for n in select nd.* from teamshop_auto_po_needs nd join so_items i on i.id=nd.so_item_id and i.so_id=nd.so_id join sales_orders so on so.id=nd.so_id
  where nd.id=any(p_need_ids) and nd.vendor=p_vendor and nd.po_id is null and nd.dismissed_at is null and nd.skip_reason='all_school_pending' and nd.qty_needed>0
   and lower(coalesce(so.status,'')) not in ('cancelled','void','archived','complete','completed','done')
   and exists(select 1 from webstore_orders wo where wo.store_id=p_store_id and wo.so_id=nd.so_id and wo.order_source='all_school' and wo.status in ('paid','batched'))
  order by nd.created_at,nd.id for update of nd
 loop
  select * into it from so_items where id=n.so_item_id for update;
  perform pg_advisory_xact_lock(hashtextextended('all_school_house:'||coalesce(n.product_id,'')||'|'||upper(trim(n.size)),0));
  select coalesce(sum(quantity),0) into have from product_inventory where product_id=n.product_id and upper(trim(size))=upper(trim(n.size));
  select coalesce(sum(greatest(r.qty-coalesce((select sum(greatest(coalesce((pk.sizes->>n.size)::integer,0),0)) from so_item_pick_lines pk join teamshop_auto_po_needs own on own.so_item_id=pk.so_item_id where own.id=r.need_id and pk.status='pulled'),0),0)),0) into reserved from all_school_house_reservations r join sales_orders so on so.id=r.so_id
   where r.product_id=n.product_id and upper(trim(r.size))=upper(trim(n.size)) and r.need_id<>n.id and lower(coalesce(so.status,'')) not in ('cancelled','void','archived','complete','completed','done')
    and exists(select 1 from webstore_orders wo where wo.so_id=r.so_id and wo.order_source='all_school' and wo.status in ('paid','batched'));
  -- Existing non-All-School store orders have first call on physical stock.
  with demand as (
   select wo.so_id,case when wo.so_id is null then wo.id::text else wo.so_id end resource,sum(oi.qty) qty from webstore_order_items oi join webstore_orders wo on wo.id=oi.order_id left join sales_orders so on so.id=wo.so_id
   where oi.product_id=n.product_id and upper(trim(oi.size))=upper(trim(n.size)) and coalesce(wo.order_source,'')<>'all_school' and wo.status in ('paid','unpaid','batched')
    and lower(coalesce(oi.line_status,'')) not in ('cancelled','canceled','shipped','complete') and (wo.so_id is null or lower(coalesce(so.status,'')) not in ('cancelled','void','archived','complete','completed','done')) group by 1,2)
   select coalesce(sum(greatest(d.qty-coalesce((select sum(greatest(coalesce((pk.sizes->>n.size)::integer,0),0)) from so_item_pick_lines pk join so_items si on si.id=pk.so_item_id where si.so_id=d.so_id and si.product_id=n.product_id and pk.status='pulled'),0),0)),0) into other_demand from demand d;
  -- Normal ERP orders also reserve warehouse units through unpulled pick
  -- lines. They have no webstore order to appear in the preceding demand.
  select other_demand+coalesce(sum(greatest(coalesce((pk.sizes->>n.size)::integer,0),0)),0) into other_demand
   from so_item_pick_lines pk join so_items si on si.id=pk.so_item_id join sales_orders so on so.id=si.so_id
   where si.product_id=n.product_id and pk.status='pick' and lower(coalesce(so.status,'')) not in ('cancelled','void','archived','complete','completed','done')
    and not exists(select 1 from webstore_orders wo where wo.so_id=si.so_id and wo.status in ('paid','unpaid','batched'));
  select other_demand+coalesce(sum(nd.qty_on_hand),0) into other_demand from teamshop_auto_po_needs nd join sales_orders so on so.id=nd.so_id
   where nd.product_id=n.product_id and upper(trim(nd.size))=upper(trim(n.size)) and nd.skip_reason is distinct from 'all_school_pending'
    and lower(coalesce(so.status,'')) not in ('cancelled','void','archived','complete','completed','done')
    and not exists(select 1 from webstore_orders wo where wo.so_id=nd.so_id and wo.status in ('paid','unpaid','batched'))
    and not exists(select 1 from so_item_pick_lines pk join so_items si on si.id=pk.so_item_id where si.so_id=nd.so_id and si.product_id=nd.product_id and pk.status='pick' and pk.sizes ? nd.size);
  select coalesce(sum(greatest(coalesce((pl.sizes->>n.size)::integer,0)-coalesce((pl.cancelled->>n.size)::integer,0),0)),0) into committed from so_item_po_lines pl
   where pl.so_item_id=n.so_item_id and coalesce(pl.status,'') not in ('cancelled','void');
  select coalesce(sum(greatest(coalesce((pk.sizes->>n.size)::integer,0),0)),0) into pulled from so_item_pick_lines pk where pk.so_item_id=n.so_item_id and pk.status='pulled';
  pulled:=least(pulled,least(n.qty_needed,coalesce((it.sizes->>n.size)::integer,0)));
  q:=greatest(least(n.qty_needed,coalesce((it.sizes->>n.size)::integer,0))-committed-pulled,0);
  house:=least(q,greatest(have-reserved-other_demand,0));
  if house+pulled>0 and n.product_id is not null then
   -- Reservation quantities remain gross; other orders net physically pulled
   -- units above. A warehouse pull must never recreate already-covered demand.
   insert into all_school_house_reservations(need_id,product_id,size,qty,so_id) values(n.id,n.product_id,n.size,house+pulled,n.so_id) on conflict(need_id) do update set qty=excluded.qty;
   update teamshop_auto_po_needs set qty_on_hand=house+pulled where id=n.id;
  else
   delete from all_school_house_reservations where need_id=n.id;
   update teamshop_auto_po_needs set qty_on_hand=0 where id=n.id;
  end if;
  q:=greatest(q-house,0); if q=0 then continue; end if;
  if coalesce(n.unit_cost_cents,0)<=0 then raise exception 'NSA_UNVERIFIED_COST:%',n.id; end if;
  total:=total+q*n.unit_cost_cents;
  lines:=lines||jsonb_build_array(jsonb_build_object('so_id',n.so_id,'so_item_id',n.so_item_id::text,'product_id',n.product_id,'sku',it.sku,'size',n.size,'qty',q,'unit_cost_cents',n.unit_cost_cents,'meta',jsonb_build_object('need_id',n.id,'color',it.color,'item_idx',it.item_index)));
 end loop;
 if jsonb_array_length(lines)=0 then return jsonb_build_object('ok',true,'reason','covered','lines','[]'::jsonb,'total_cents',0); end if;
 if p_due_reason='evaluate' then return jsonb_build_object('ok',true,'reason','evaluated','lines',lines,'total_cents',total); end if;
 -- Recompute the gate after durable warehouse allocation, including a race
 -- where more physical stock arrived between preview and this transaction.
 if p_due_reason='minimum' and total<coalesce((s.all_school_settings->'purchasing'->'vendors'->p_vendor->>'minimum_cents')::bigint,(s.all_school_settings->'purchasing'->>'minimum_cents')::bigint,20000) then return jsonb_build_object('ok',true,'reason','below_minimum','total_cents',total); end if;
 if total>p_max_run_cents then raise exception 'NSA_PURCHASE_RUN_LIMIT'; end if;
 vk:=case when p_vendor='SanMar' then 'sanmar' else 'sss' end;
 if p_combine_regular then
  perform pg_advisory_xact_lock(hashtextextended('all_school_regular:'||vk,0));
  select value::jsonb into queue from app_state where id='batch_pos' for update;
  regular:=exists(select 1 from jsonb_array_elements(coalesce(queue,'[]')) e where e->>'vendor_key'=vk and not(e ? 'all_school_allocation_id')
   and coalesce(e->>'ship_to_deco_id','')='' and coalesce(e->>'supplier_account',cfg.supplier_account,'')=coalesce(cfg.supplier_account,'')
   and not exists(select 1 from jsonb_array_elements(coalesce(e->'items','[]')) z where coalesce((z->>'drop_ship')::boolean,false) or z ? 'ship_to' or coalesce(z->>'ship_to_deco_id','')<>''))
   and not exists(select 1 from all_school_batch_allocations where vendor_key=vk and state in ('submitting','unknown'));
  if not regular and p_no_batch_policy='hold' and p_due_reason<>'max_wait' then return jsonb_build_object('ok',true,'reason','no_compatible_regular_batch'); end if;
 end if;
 result:=create_purchase_order(p_run_key,jsonb_build_object('vendor',p_vendor,'supplier_account',cfg.supplier_account,'status','draft','origin','auto','created_by',p_actor,'totals_cents',total,'threshold_eval',jsonb_build_object('lane','all_school','store_id',p_store_id,'reason',p_due_reason,'combined_regular',regular)),lines);
 select * into po from purchase_orders where id=(result->'purchase_order'->>'id')::uuid;
 update purchase_orders set all_school_store_id=p_store_id,ship_to=p_ship_to where id=po.id returning * into po;
 update teamshop_auto_po_needs nd set po_id=po.id,purchasing_run_key=p_run_key,purchasing_claimed_at=now() where nd.id in(select (l->'meta'->>'need_id')::bigint from jsonb_array_elements(lines) l) and nd.po_id is null;
 if not regular then
  -- Draft dedicated purchases are commitments too. Existing editor fresh-PO
  -- checks must see them before the external request, closing a manual race.
  insert into so_item_po_lines(so_item_id,po_id,vendor,sizes,status,created_at,memo)
   select (l->>'so_item_id')::integer,po.po_number,p_vendor,jsonb_build_object(l->>'size',(l->>'qty')::integer,'unit_cost',(l->>'unit_cost_cents')::numeric/100,'_all_school_purchase_order_id',po.id),'queued',now()::text,'All School automatic purchase — awaiting supplier submission' from jsonb_array_elements(lines) l;
 end if;
 if regular then
  for sid in select distinct l->>'so_id' from jsonb_array_elements(lines) l loop
   aid:=gen_random_uuid();
   select jsonb_build_object('id','ASBPO '||aid::text,'vendor_key',vk,'vendor_name',p_vendor,'so_id',sid,'po_id',po.po_number,'so_memo',coalesce(so.memo,''),'customer',s.name,'created_at',now(),'total_cost',sum((l->>'qty')::numeric*(l->>'unit_cost_cents')::numeric)/100,
    'items',jsonb_agg(jsonb_build_object('sku',l->>'sku','color',l->'meta'->>'color','sizes',jsonb_build_object(l->>'size',(l->>'qty')::integer),'qty',(l->>'qty')::integer,'unit_cost',(l->>'unit_cost_cents')::numeric/100,'item_idx',(l->'meta'->>'item_idx')::integer))) into bp
    from jsonb_array_elements(lines) l join sales_orders so on so.id=l->>'so_id' where l->>'so_id'=sid group by so.memo;
   insert into all_school_batch_allocations(id,po_id,vendor_key,queue_entry) values(aid,po.id,vk,bp);
   insert into so_item_po_lines(so_item_id,po_id,vendor,sizes,status,created_at,memo) select (l->>'so_item_id')::integer,po.po_number,p_vendor,jsonb_build_object(l->>'size',(l->>'qty')::integer,'unit_cost',(l->>'unit_cost_cents')::numeric/100,'batch_queue_id',bp->>'id'),'queued',now()::text,'All School — regular batch queue' from jsonb_array_elements(lines) l where l->>'so_id'=sid;
  end loop;
  insert into app_state(id,value,updated_at) values('batch_pos',coalesce(queue,'[]')::text,now()) on conflict(id) do update set value=excluded.value,updated_at=excluded.updated_at;
 end if;
 return jsonb_build_object('ok',true,'purchase_order',to_jsonb(po),'lines',lines,'combined_regular',regular,'reason',p_due_reason);
end $$;

create function public.claim_all_school_po_submission(p_po_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p purchase_orders;
begin
 -- Store/vendor toggles and cancellations are checked again immediately before
 -- the request, rather than trusting a PO planned hours earlier.
 update purchase_orders set submission_state='submitting',submission_token=p_token,submission_error=null where id=p_po_id and status='draft' and submission_state='pending' and all_school_store_id is not null and not exists(select 1 from all_school_batch_allocations where po_id=p_po_id and state<>'cancelled') returning * into p;
 if found and (
  not exists(select 1 from webstores s join teamshop_auto_po_settings cfg on cfg.vendor=p.vendor where s.id=p.all_school_store_id and s.org_type='all_school' and cfg.auto_submit_enabled and coalesce((s.all_school_settings->'purchasing'->>'enabled')::boolean,false) and coalesce(s.all_school_settings->'purchasing'->>'mode','minimum_weekly')<>'manual')
  or exists(select 1 from purchase_order_lines l left join so_items i on i.id=l.so_item_id::integer and i.so_id=l.so_id left join sales_orders so on so.id=l.so_id
   where l.po_id=p_po_id and (i.id is null or not all_school_garment_source_valid(i.id) or i.sku is distinct from l.sku or coalesce((i.sizes->>l.size)::integer,0)<l.qty or lower(coalesce(so.status,'')) in ('cancelled','void','archived','complete','completed','done')
    or not exists(select 1 from webstore_orders wo where wo.so_id=l.so_id and wo.store_id=p.all_school_store_id and wo.order_source='all_school' and wo.status in ('paid','batched'))))
 ) then
  update purchase_orders set submission_state='held',submission_error='Source order or purchasing configuration changed before submission' where id=p_po_id;
  return jsonb_build_object('claimed',false,'reason','source_or_configuration_changed');
 end if;
 return jsonb_build_object('claimed',found,'purchase_order',to_jsonb(p));
end $$;
-- A regular batch can remain open indefinitely. At the store's maximum wait,
-- move ONLY still-unsubmitted school allocations into the same dedicated PO.
-- Keep the original commitments and PO number; never release garment demand.
create function public.promote_all_school_regular_purchase(p_po_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p purchase_orders; s webstores; cfg jsonb; oldest timestamptz; vk text; max_days integer;
begin
 select * into p from purchase_orders where id=p_po_id;
 if not found or p.all_school_store_id is null then return jsonb_build_object('promoted',false,'reason','not_all_school'); end if;
 vk:=case when p.vendor='SanMar' then 'sanmar' when p.vendor='S&S Activewear' then 'sss' else null end;
 if vk is null then return jsonb_build_object('promoted',false,'reason','unsupported_vendor'); end if;
 perform pg_advisory_xact_lock(hashtextextended('all_school_regular:'||vk,0));
 select * into p from purchase_orders where id=p_po_id for update;
 if p.status<>'draft' or p.submission_state<>'pending' or not exists(select 1 from all_school_batch_allocations where po_id=p.id and state='queued') or exists(select 1 from all_school_batch_allocations where po_id=p.id and state not in ('queued','cancelled')) then return jsonb_build_object('promoted',false,'reason','not_queued'); end if;
 select * into s from webstores where id=p.all_school_store_id;
 cfg:=coalesce(s.all_school_settings->'purchasing','{}'::jsonb)||coalesce(s.all_school_settings->'purchasing'->'vendors'->p.vendor,'{}'::jsonb);
 if s.org_type<>'all_school' or not coalesce((cfg->>'enabled')::boolean,false) or coalesce(cfg->>'mode','minimum_weekly')='manual' or not exists(select 1 from teamshop_auto_po_settings where vendor=p.vendor and auto_submit_enabled) then return jsonb_build_object('promoted',false,'reason','disabled'); end if;
 max_days:=coalesce((cfg->>'max_wait_days')::integer,7);
 select min(wo.created_at) into oldest from purchase_order_lines l join webstore_orders wo on wo.so_id=l.so_id and wo.store_id=s.id and wo.order_source='all_school' and wo.status in ('paid','batched') where l.po_id=p.id;
 if oldest is null or oldest>now()-make_interval(days=>max_days) then return jsonb_build_object('promoted',false,'reason','waiting'); end if;
 if p.totals_cents>coalesce((cfg->>'max_run_cents')::bigint,100000) then return jsonb_build_object('promoted',false,'reason','run_limit'); end if;
 update so_item_po_lines pl set sizes=(pl.sizes-'batch_queue_id')||jsonb_build_object('_all_school_purchase_order_id',p.id),memo='All School maximum wait — dedicated supplier purchase'
  where exists(select 1 from all_school_batch_allocations a where a.po_id=p.id and a.state='queued' and pl.sizes->>'batch_queue_id'=a.queue_entry->>'id');
 update all_school_batch_allocations set state='cancelled' where po_id=p.id and state='queued';
 update purchase_orders set threshold_eval=threshold_eval||jsonb_build_object('combined_regular',false,'reason','max_wait','promoted_at',now()) where id=p.id returning * into p;
 update app_state set value=value,updated_at=now() where id='batch_pos';
 return jsonb_build_object('promoted',true,'purchase_order',to_jsonb(p));
end $$;
revoke all on function public.promote_all_school_regular_purchase(uuid) from public,anon,authenticated;
grant execute on function public.promote_all_school_regular_purchase(uuid) to service_role;
create function public.record_all_school_po_submission(p_po_id uuid,p_token uuid,p_state text,p_api_order_id text,p_error text,p_vendor_lines jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare p purchase_orders; l record;
begin
 if p_state not in ('submitted','unknown','held') then raise exception 'NSA_BAD_SUBMISSION_STATE'; end if;
 update purchase_orders set submission_state=p_state,api_order_id=nullif(p_api_order_id,''),submission_error=p_error,vendor_lines=p_vendor_lines,status=case when p_state='submitted' then 'created' else status end,
  submitted_at=case when p_state='submitted' then now() else submitted_at end,submitted_by=case when p_state='submitted' then 'all-school-auto' else submitted_by end
  where id=p_po_id and submission_token=p_token and submission_state='submitting' returning * into p;
 if not found then return jsonb_build_object('ok',false,'reason','claim_changed'); end if;
 if p_state='submitted' then
  for l in select * from purchase_order_lines where po_id=p_po_id loop
   update so_item_po_lines set status='waiting',memo='All School automatic purchasing',
    sizes=sizes||jsonb_build_object('api_order_id',p.api_order_id,'vendor_keys',jsonb_build_object('order_no',p.api_order_id,'lines',p_vendor_lines))
    where so_item_id=l.so_item_id::integer and po_id=p.po_number and sizes ? l.size;
   insert into so_item_po_lines(so_item_id,po_id,vendor,sizes,status,created_at,memo)
    select l.so_item_id::integer,p.po_number,p.vendor,jsonb_build_object(l.size,l.qty,'unit_cost',l.unit_cost_cents::numeric/100,'api_order_id',p.api_order_id,'vendor_keys',jsonb_build_object('order_no',p.api_order_id,'lines',p_vendor_lines)),'waiting',now()::text,'All School automatic purchasing'
    where not exists(select 1 from so_item_po_lines where so_item_id=l.so_item_id::integer and po_id=p.po_number and sizes ? l.size);
  end loop;
 end if;
 return jsonb_build_object('ok',true,'purchase_order',to_jsonb(p));
end $$;
revoke all on function public.plan_all_school_purchase(uuid,text,text,bigint[],text,boolean,text,bigint,text,jsonb),public.claim_all_school_po_submission(uuid,uuid),public.record_all_school_po_submission(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.plan_all_school_purchase(uuid,text,text,bigint[],text,boolean,text,bigint,text,jsonb),public.claim_all_school_po_submission(uuid,uuid),public.record_all_school_po_submission(uuid,uuid,text,text,text,jsonb) to service_role;

create function public.claim_all_school_regular_batch(p_vendor_key text,p_allocation_ids uuid[],p_token uuid,p_po_number text,p_source_lines jsonb default '[]',p_ship_to jsonb default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare ids uuid[]; n integer; num integer; expected jsonb; supplied jsonb;
begin
 if not public.is_team_member() then raise exception 'NSA_FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('all_school_regular:'||p_vendor_key,0));
 select array_agg(id order by id) into ids from all_school_batch_allocations where vendor_key=p_vendor_key and state in ('queued','submitting','unknown');
 if ids is null then return jsonb_build_object('claimed',cardinality(coalesce(p_allocation_ids,'{}'))=0,'empty',true,'reason','queue_changed','po_number',p_po_number); end if;
 if exists(select 1 from all_school_batch_allocations where id=any(ids) and state<>'queued') then return jsonb_build_object('claimed',false,'reason','already_claimed_or_unknown'); end if;
 if not(ids <@ coalesce(p_allocation_ids,'{}') and coalesce(p_allocation_ids,'{}') <@ ids) then return jsonb_build_object('claimed',false,'reason','queue_changed'); end if;
 if exists(select 1 from all_school_batch_allocations a join purchase_order_lines l on l.po_id=a.po_id where a.id=any(ids) and not all_school_garment_source_valid(l.so_item_id::integer)) then return jsonb_build_object('claimed',false,'reason','source_line_changed'); end if;
 -- Exact pre-collapse source counts are authoritative. A supplier preview that
 -- removed a short item may not mark its entire durable allocation as ordered.
 with counts as (select a.queue_entry->>'id' batch,(it->>'item_idx')::integer item,upper(trim(sz.key)) size,sum((sz.value)::integer) qty
  from all_school_batch_allocations a cross join lateral jsonb_array_elements(a.queue_entry->'items') it cross join lateral jsonb_each_text(it->'sizes') sz where a.id=any(ids) group by 1,2,3)
 select jsonb_agg(jsonb_build_array(batch,item,size,qty) order by batch,item,size) into expected from counts;
 with counts as (select l->>'sourceBatchId' batch,(l->>'sourceItemIdx')::integer item,upper(trim(l->>'size')) size,sum((l->>'quantity')::integer) qty
  from jsonb_array_elements(p_source_lines) l where exists(select 1 from all_school_batch_allocations a where a.id=any(ids) and a.queue_entry->>'id'=l->>'sourceBatchId') group by 1,2,3)
 select jsonb_agg(jsonb_build_array(batch,item,size,qty) order by batch,item,size) into supplied from counts;
 if expected is distinct from supplied then return jsonb_build_object('claimed',false,'reason','source_quantity_changed'); end if;
 if exists(select 1 from all_school_batch_allocations a join purchase_orders p on p.id=a.po_id where a.id=any(ids) and p.ship_to is distinct from p_ship_to) then return jsonb_build_object('claimed',false,'reason','destination_changed'); end if;
 num:=claim_batch_po_number(nullif(regexp_replace(p_po_number,'\D','','g'),'')::integer,'all-school-regular');
 update all_school_batch_allocations set state='submitting',submission_token=p_token,submitted_po_number='NSA '||num where id=any(ids) and state='queued';
 get diagnostics n=row_count;
 update app_state set value=value,updated_at=now() where id='batch_pos';
 return jsonb_build_object('claimed',n=cardinality(ids),'po_number','NSA '||num,'allocation_ids',to_jsonb(ids));
end $$;
create function public.finish_all_school_regular_batch(p_token uuid,p_po_number text,p_state text,p_api_order_id text,p_vendor_lines jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; p purchase_orders; n integer:=0;
begin
 if not public.is_team_member() then raise exception 'NSA_FORBIDDEN'; end if;
 if p_state not in ('submitted','unknown','cancelled') then raise exception 'NSA_BAD_SUBMISSION_STATE'; end if;
 for a in select * from all_school_batch_allocations where submission_token=p_token and state='submitting' for update loop
  if a.submitted_po_number<>p_po_number then raise exception 'NSA_PO_NUMBER_CHANGED'; end if;
  update all_school_batch_allocations set state=p_state where id=a.id;
  select * into p from purchase_orders where id=a.po_id for update;
  update purchase_orders set submission_state=case when p_state='cancelled' then 'held' else p_state end,status=case when p_state='submitted' then 'created' else status end,api_order_id=p_api_order_id,vendor_lines=p_vendor_lines,
   submitted_at=case when p_state='submitted' then now() else submitted_at end,submitted_by='regular-batch' where id=a.po_id;
  if p_state='submitted' then
   update so_item_po_lines set status='waiting',memo='Batch '||p_po_number||' — '||p.vendor,
    sizes=sizes||jsonb_build_object('batch_po_number',p_po_number,'api_order_id',p_api_order_id,'vendor_keys',jsonb_build_object('order_no',p_api_order_id,'lines',p_vendor_lines)) where sizes->>'batch_queue_id'=a.queue_entry->>'id';
  end if;
  n:=n+1;
 end loop;
 update app_state set value=value,updated_at=now() where id='batch_pos';
 return jsonb_build_object('ok',n>0,'allocations',n);
end $$;
revoke all on function public.claim_all_school_regular_batch(text,uuid[],uuid,text,jsonb,jsonb),public.finish_all_school_regular_batch(uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.claim_all_school_regular_batch(text,uuid[],uuid,text,jsonb,jsonb),public.finish_all_school_regular_batch(uuid,text,text,text,jsonb) to authenticated;

-- The existing supplier proxies consume each token before their external POST.
-- A lost HTTP acknowledgement cannot make a repeated token buy goods twice.
create function public.claim_all_school_vendor_request(p_token uuid,p_po_number text,p_vendor text,p_supplier_account text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; vk text;
begin
 if p_token is null then return jsonb_build_object('claimed',false); end if;
 if exists(select 1 from purchase_orders where submission_token=p_token and supplier_account is not null and supplier_account is distinct from p_supplier_account)
  or exists(select 1 from all_school_batch_allocations a join purchase_orders p on p.id=a.po_id where a.submission_token=p_token and p.supplier_account is not null and p.supplier_account is distinct from p_supplier_account) then return jsonb_build_object('claimed',false,'reason','supplier_account_changed'); end if;
 update purchase_orders set vendor_request_started_at=now()
  where submission_token=p_token and po_number=p_po_number and vendor=p_vendor and submission_state='submitting' and vendor_request_started_at is null and all_school_store_id is not null;
 get diagnostics n=row_count;
 if n=1 then return jsonb_build_object('claimed',true); end if;
 vk:=case when p_vendor='SanMar' then 'sanmar' when p_vendor='S&S Activewear' then 'sss' else null end;
 perform pg_advisory_xact_lock(hashtextextended('all_school_regular:'||coalesce(vk,''),0));
 if exists(select 1 from all_school_batch_allocations where submission_token=p_token and vendor_request_started_at is not null) then return jsonb_build_object('claimed',false); end if;
 update all_school_batch_allocations set vendor_request_started_at=now()
  where submission_token=p_token and submitted_po_number=p_po_number and vendor_key=vk and state='submitting' and vendor_request_started_at is null;
 get diagnostics n=row_count;
 return jsonb_build_object('claimed',n>0);
end $$;
revoke all on function public.claim_all_school_vendor_request(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_all_school_vendor_request(uuid,text,text,text) to service_role;
