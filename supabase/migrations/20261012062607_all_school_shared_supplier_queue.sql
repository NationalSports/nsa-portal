-- Shared All School supplier queue. Club never qualifies. Existing PO line links and durable submission claims are retained.
create or replace function public.plan_all_school_purchase(p_store_id uuid,p_vendor text,p_run_key text,p_need_ids bigint[],p_due_reason text,p_combine_regular boolean,p_no_batch_policy text,p_max_run_cents bigint,p_actor text,p_ship_to jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s webstores; n record; it so_items; cfg teamshop_auto_po_settings; lines jsonb:='[]'; total bigint:=0;
 q integer; house integer; pulled integer; reserved integer; committed integer; other_demand integer; have integer;
 result jsonb; po purchase_orders; queue jsonb; regular boolean:=false; vk text; bp jsonb; aid uuid; sid text;
begin
 if coalesce(p_run_key,'')='' then raise exception 'NSA_BAD_INPUT:run key'; end if;
 perform pg_advisory_xact_lock(hashtextextended('all_school_purchase:'||p_vendor,0));
 select * into s from webstores where id=p_store_id for update;
 if not found or s.org_type<>'all_school' then raise exception 'NSA_BAD_SOURCE'; end if;
 if coalesce((s.all_school_settings->'purchasing'->>'enabled')::boolean,false) is not true then return jsonb_build_object('ok',true,'reason','disabled'); end if;
 if p_vendor not in ('SanMar','S&S Activewear','Momentec') then return jsonb_build_object('ok',true,'reason','unsupported_vendor'); end if;
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
   and exists(select 1 from webstore_orders wo where wo.so_id=nd.so_id and exists(select 1 from webstores ws where ws.id=wo.store_id and ws.org_type='all_school' and coalesce((ws.all_school_settings->'purchasing'->>'enabled')::boolean,false) and coalesce(ws.all_school_settings->'purchasing'->>'mode','minimum_weekly')<>'manual' and coalesce((ws.all_school_settings->'purchasing'->'vendors'->p_vendor->>'enabled')::boolean,true) and coalesce(ws.all_school_settings->'purchasing'->'vendors'->p_vendor->>'mode','minimum')<>'manual') and wo.order_source='all_school' and wo.status in ('paid','batched'))
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
 if p_due_reason='minimum' and total<20000 then return jsonb_build_object('ok',true,'reason','below_minimum','total_cents',total); end if;
 if p_due_reason not in ('minimum','max_wait') then raise exception 'NSA_BAD_DUE_REASON'; end if;
 if p_due_reason='max_wait' and not exists(select 1 from webstore_orders wo where wo.created_at<=now()-interval '7 days' and wo.so_id in(select l->>'so_id' from jsonb_array_elements(lines) l)) then return jsonb_build_object('ok',true,'reason','waiting'); end if;
 if total>p_max_run_cents then raise exception 'NSA_PURCHASE_RUN_LIMIT'; end if;
 vk:=case when p_vendor='SanMar' then 'sanmar' when p_vendor='Momentec' then 'momentec' else 'sss' end;
 result:=create_purchase_order(p_run_key,jsonb_build_object('vendor',p_vendor,'supplier_account',cfg.supplier_account,'status','draft','origin','auto','created_by',p_actor,'totals_cents',total,'threshold_eval',jsonb_build_object('lane','all_school','scope','all_school_supplier','store_ids',(select jsonb_agg(distinct wo.store_id) from webstore_orders wo where wo.so_id in(select l->>'so_id' from jsonb_array_elements(lines) l)),'reason',p_due_reason,'combined_regular',regular)),lines);
 select * into po from purchase_orders where id=(result->'purchase_order'->>'id')::uuid;
 update purchase_orders set all_school_store_id=p_store_id,ship_to=p_ship_to where id=po.id returning * into po;
 update teamshop_auto_po_needs nd set po_id=po.id,purchasing_run_key=p_run_key,purchasing_claimed_at=now() where nd.id in(select (l->'meta'->>'need_id')::bigint from jsonb_array_elements(lines) l) and nd.po_id is null;
 if not regular then
  -- Draft dedicated purchases are commitments too. Existing editor fresh-PO
  -- checks must see them before the external request, closing a manual race.
  insert into so_item_po_lines(so_item_id,po_id,vendor,sizes,status,created_at,memo)
   select (l->>'so_item_id')::integer,po.po_number,p_vendor,jsonb_build_object(l->>'size',(l->>'qty')::integer,'unit_cost',(l->>'unit_cost_cents')::numeric/100,'_all_school_purchase_order_id',po.id),'queued',now()::text,'All School automatic purchase — awaiting supplier submission' from jsonb_array_elements(lines) l;
 end if;
 return jsonb_build_object('ok',true,'purchase_order',to_jsonb(po),'lines',lines,'combined_regular',regular,'reason',p_due_reason);
end $$;

create or replace function public.claim_all_school_po_submission(p_po_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare p purchase_orders;
begin
 -- Store/vendor toggles and cancellations are checked again immediately before
 -- the request, rather than trusting a PO planned hours earlier.
 update purchase_orders set submission_state='submitting',submission_token=p_token,submission_error=null where id=p_po_id and status='draft' and submission_state='pending' and all_school_store_id is not null and not exists(select 1 from all_school_batch_allocations where po_id=p_po_id and state<>'cancelled') returning * into p;
 if found and (
  not exists(select 1 from webstores s join teamshop_auto_po_settings cfg on cfg.vendor=p.vendor where s.id=p.all_school_store_id and s.org_type='all_school' and cfg.auto_submit_enabled and coalesce((s.all_school_settings->'purchasing'->>'enabled')::boolean,false) and coalesce(s.all_school_settings->'purchasing'->>'mode','minimum_weekly')<>'manual')
  or exists(select 1 from purchase_order_lines l left join so_items i on i.id=l.so_item_id::integer and i.so_id=l.so_id left join sales_orders so on so.id=l.so_id
   where l.po_id=p_po_id and (i.id is null or not all_school_garment_source_valid(i.id) or i.sku is distinct from l.sku or coalesce((i.sizes->>l.size)::integer,0)<l.qty or lower(coalesce(so.status,'')) in ('cancelled','void','archived','complete','completed','done')
    or not exists(select 1 from webstore_orders wo where wo.so_id=l.so_id and exists(select 1 from webstores ws where ws.id=wo.store_id and ws.org_type='all_school' and coalesce((ws.all_school_settings->'purchasing'->>'enabled')::boolean,false) and coalesce(ws.all_school_settings->'purchasing'->>'mode','minimum_weekly')<>'manual' and coalesce((ws.all_school_settings->'purchasing'->'vendors'->p.vendor->>'enabled')::boolean,true) and coalesce(ws.all_school_settings->'purchasing'->'vendors'->p.vendor->>'mode','minimum')<>'manual') and wo.order_source='all_school' and wo.status in ('paid','batched'))))
 ) then
  update purchase_orders set submission_state='held',submission_error='Source order or purchasing configuration changed before submission' where id=p_po_id;
  return jsonb_build_object('claimed',false,'reason','source_or_configuration_changed');
 end if;
 return jsonb_build_object('claimed',found,'purchase_order',to_jsonb(p));
end $$;

-- Existing regular batches also stop waiting after seven days at the latest.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.promote_all_school_regular_purchase(uuid)'::regprocedure);
 d:=replace(d,'max_days:=coalesce((cfg->>''max_wait_days'')::integer,7);','max_days:=least(coalesce((cfg->>''max_wait_days'')::integer,7),7);');
 execute d;
end $$;
