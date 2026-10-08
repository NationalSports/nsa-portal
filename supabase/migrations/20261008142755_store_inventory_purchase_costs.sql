-- Inventory POs are warehouse replenishment, never customer-order purchases.
-- Only consumed units are costed to SOs. Receipt requests and cost snapshots survive retries.
alter table public.product_inventory add column if not exists received_unit_cost numeric;
alter table public.product_inventory add column if not exists cost_receipts uuid[] not null default '{}';
alter table public.webstore_transfers add column if not exists cost_receipts uuid[] not null default '{}';
alter table public.so_item_decorations add column if not exists inventory_cost_missing boolean not null default false;
alter table public.so_item_decorations add column if not exists inventory_cost_basis jsonb;
create table public.store_inventory_receipts (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 po_line_id uuid not null references public.purchase_order_lines(id),
 qty integer not null check(qty>0), unit_cost numeric not null check(unit_cost>=0),
 created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index store_inventory_receipts_line_idx on public.store_inventory_receipts(po_line_id);
create table public.store_inventory_cost_snapshots (
 source_key text primary key, so_id text, product_id text, size text, source_item_ids uuid[], qty integer not null check(qty>0),
 stock_pulled boolean not null default false, unit_cost numeric check(unit_cost>=0), receipt_ids uuid[] not null default '{}',
 created_at timestamptz not null default now()
);
create index store_inventory_cost_snapshots_so_idx on public.store_inventory_cost_snapshots(so_id);
alter table public.store_inventory_receipts enable row level security;
alter table public.store_inventory_cost_snapshots enable row level security;
create policy staff_read on public.store_inventory_receipts for select to authenticated using((select public.is_team_member()));
create policy staff_read on public.store_inventory_cost_snapshots for select to authenticated using((select public.is_team_member()));
revoke all on public.store_inventory_receipts,public.store_inventory_cost_snapshots from anon,authenticated;
grant select on public.store_inventory_receipts,public.store_inventory_cost_snapshots to authenticated;
grant all on public.store_inventory_receipts,public.store_inventory_cost_snapshots to service_role;

create function public.create_store_inventory_po(p_store_id uuid,p_request_id uuid,p_vendor text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l jsonb; t webstore_transfers; wp webstore_products; lines jsonb:='[]'; result jsonb; total bigint:=0; n int; cents bigint; v_size text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' and not coalesce(public.is_team_member(),false) then raise exception 'Staff access required'; end if;
 if p_request_id is null or nullif(trim(p_vendor),'') is null or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Vendor and inventory lines required'; end if;
 if not exists(select 1 from webstores where id=p_store_id and org_type='all_school') then raise exception '24/7 store required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory-po:'||p_request_id,0));
 select jsonb_build_object('purchase_order',to_jsonb(p),'replayed',true) into result from purchase_orders p where client_ref='inventory:'||p_request_id;
 if found then return result; end if;
 for l in select value from jsonb_array_elements(p_lines) loop
  n:=(l->>'qty')::int; cents:=(l->>'unit_cost_cents')::bigint;
  if n is null or n<=0 or cents is null or cents<0 then raise exception 'Positive quantity and explicit cost required'; end if;
  if l->>'transfer_id' is not null then
   select * into strict t from webstore_transfers where id=(l->>'transfer_id')::uuid and store_id=p_store_id;
   lines:=lines||jsonb_build_object('qty',n,'unit_cost_cents',cents,'sku',t.code,'meta',jsonb_build_object('transfer_id',t.id,'label',t.label,'decoration_type',t.decoration_type,'application_method',t.application_method,'artwork_version',t.artwork_version,'width_in',t.width_in,'height_in',t.height_in,'application_instructions',t.application_instructions,'production_file',t.production_file));
  else
   select * into strict wp from webstore_products where id=(l->>'webstore_product_id')::uuid and store_id=p_store_id and product_id is not null;
   if nullif(trim(l->>'size'),'') is null then raise exception 'Garment size required'; end if;
   select sz into v_size from (
    select size sz from product_inventory where product_id=wp.product_id
    union select jsonb_array_elements_text(coalesce(available_sizes,'[]')) from products where id=wp.product_id
   ) s where lower(trim(sz))=lower(trim(l->>'size')) limit 1;
   if v_size is null then raise exception 'Choose a valid garment size from the product catalog'; end if;
   lines:=lines||jsonb_build_object('qty',n,'unit_cost_cents',cents,'product_id',wp.product_id,'sku',wp.sku,'size',v_size,'meta',jsonb_build_object('webstore_product_id',wp.id,'label',coalesce(wp.display_name,wp.sku)));
  end if;
  total:=total+n*cents;
 end loop;
 result:=public.create_purchase_order('inventory:'||p_request_id,jsonb_build_object('vendor',trim(p_vendor),'origin','store_inventory','status','draft','totals_cents',total,'created_by',auth.uid()),lines);
 update purchase_orders set all_school_store_id=p_store_id,submission_state='inventory_draft' where id=(result->'purchase_order'->>'id')::uuid;
 return result;
end $$;

-- One line per call keeps lock ordering simple. UI supports partial deliveries.
-- PO stock is tracked here, separate from legacy manual Incoming/Receive fields.
create function public.receive_store_inventory_po(p_line_id uuid,p_request_id uuid,p_qty integer,p_unit_cost numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l purchase_order_lines; po purchase_orders; r store_inventory_receipts; t webstore_transfers; inv product_inventory; have int; avg_cost numeric; ids uuid[];
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' and not coalesce(public.is_team_member(),false) then raise exception 'Staff access required'; end if;
 if p_request_id is null or p_qty is null or p_qty<=0 or p_unit_cost is null or p_unit_cost<0 or p_unit_cost::text in ('NaN','Infinity','-Infinity') then raise exception 'Quantity and actual unit cost required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory-receipt:'||p_request_id,0));
 select * into r from store_inventory_receipts where request_id=p_request_id;
 if found then
  if r.po_line_id<>p_line_id or r.qty<>p_qty or r.unit_cost<>p_unit_cost then raise exception 'Receipt retry does not match original'; end if;
  return to_jsonb(r);
 end if;
 select * into strict l from purchase_order_lines where id=p_line_id for update;
 select * into strict po from purchase_orders where id=l.po_id for update;
 if po.origin<>'store_inventory' or po.status='cancelled' then raise exception 'Open inventory PO required'; end if;
 if p_qty+(select coalesce(sum(qty),0) from store_inventory_receipts where po_line_id=l.id)>l.qty then raise exception 'Receipt exceeds remaining PO quantity'; end if;
 if l.meta->>'transfer_id' is not null then
  select * into strict t from webstore_transfers where id=(l.meta->>'transfer_id')::uuid and store_id=po.all_school_store_id for update;
  have:=greatest(coalesce(t.on_hand,0),0); avg_cost:=t.unit_cost; ids:=t.cost_receipts;
 else
  insert into product_inventory(product_id,size,quantity) values(l.product_id,l.size,0) on conflict(product_id,size) do nothing;
  select * into strict inv from product_inventory where product_id=l.product_id and size=l.size for update;
  have:=greatest(coalesce(inv.quantity,0),0); avg_cost:=inv.received_unit_cost; ids:=inv.cost_receipts;
 end if;
 -- Unknown opening stock must be costed explicitly, never silently valued at zero.
 if have>0 and (avg_cost is null or avg_cost<0) then raise exception 'Set the cost of existing stock before receiving this delivery'; end if;
 avg_cost:=(have*coalesce(avg_cost,0)+p_qty*p_unit_cost)/(have+p_qty);
 insert into store_inventory_receipts(request_id,po_line_id,qty,unit_cost) values(p_request_id,l.id,p_qty,p_unit_cost) returning * into r;
 ids:=case when have=0 then array[r.id] else array_append(ids,r.id) end;
 if t.id is not null then
  update webstore_transfers set on_hand=have+p_qty,unit_cost=avg_cost,cost_receipts=ids where id=t.id;
 else
  update product_inventory set quantity=have+p_qty,received_unit_cost=avg_cost,cost_receipts=ids where id=inv.id;
 end if;
 update purchase_orders set status='created',submission_state=case when not exists(select 1 from purchase_order_lines x where x.po_id=po.id and x.qty>(select coalesce(sum(z.qty),0) from store_inventory_receipts z where z.po_line_id=x.id)) then 'inventory_received' else 'inventory_partial' end where id=po.id;
 return to_jsonb(r);
end $$;

create function public.set_store_opening_inventory_cost(p_store_id uuid,p_product_id text,p_size text,p_unit_cost numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' and not coalesce(public.is_team_member(),false) then raise exception 'Staff access required'; end if;
 if p_unit_cost is null or p_unit_cost<0 or p_unit_cost::text in ('NaN','Infinity','-Infinity') then raise exception 'Explicit unit cost required'; end if;
 if not exists(select 1 from webstore_products where store_id=p_store_id and product_id=p_product_id) then raise exception 'Store garment required'; end if;
 update product_inventory set received_unit_cost=p_unit_cost where product_id=p_product_id and size=p_size and cardinality(cost_receipts)=0;
 if not found then raise exception 'Opening stock not found or already has received costs'; end if;
end $$;

-- Immutable pick costs keyed by the durable pick identifier, not rebuildable SO row IDs.
create function public.snapshot_store_inventory_pick() returns trigger language plpgsql security definer set search_path=public as $$
declare it so_items; s record; inv product_inventory; snap store_inventory_cost_snapshots; basis jsonb:='{}'; k text;
begin
 if new.status<>'pulled' then return new; end if;
 select * into strict it from so_items where id=new.so_item_id;
 if coalesce(cardinality(it.source_webstore_item_ids),0)=0 then return new; end if;
 for s in select key,value from jsonb_each(coalesce(new.sizes,'{}')) where jsonb_typeof(value)='number' and key!~'^_' loop
  if not (it.sizes ? s.key) or (s.value::text)::numeric<=0 then continue; end if;
  k:='pick:'||it.so_id||':'||new.pick_id||':'||it.product_id||':'||s.key||':'||(select string_agg(x::text,',' order by x) from unnest(it.source_webstore_item_ids) x);
  select * into snap from store_inventory_cost_snapshots where source_key=k;
  if not found then
   select * into inv from product_inventory where product_id=it.product_id and size=s.key;
   insert into store_inventory_cost_snapshots(source_key,so_id,qty,unit_cost,receipt_ids)
    values(k,it.so_id,(s.value::text)::int,null,'{}') on conflict do nothing;
   select * into strict snap from store_inventory_cost_snapshots where source_key=k;
  end if;
  if snap.qty<>(s.value::text)::int then raise exception 'Received-cost pick quantity changed; reconcile the original pick before changing it'; end if;
  basis:=basis||jsonb_build_object(s.key,jsonb_build_object('qty',snap.qty,'unit_cost',snap.unit_cost,'receipt_ids',snap.receipt_ids));
 end loop;
 new.sizes:=new.sizes||jsonb_build_object('_inventory_costs',basis);
 return new;
end $$;
create trigger snapshot_store_inventory_pick before insert or update on public.so_item_pick_lines for each row execute function public.snapshot_store_inventory_pick();

create function public.snapshot_store_decoration_cost() returns trigger language plpgsql security definer set search_path=public as $$
declare t webstore_transfers;
begin
 if new.status='consumed' and (tg_op='INSERT' or old.status is distinct from 'consumed') then
  select * into strict t from webstore_transfers where store_id=new.store_id and code=new.transfer_code;
  if t.unit_cost is null then raise exception 'Set decoration inventory unit cost before consuming stock: %',t.label; end if;
  insert into store_inventory_cost_snapshots(source_key,so_id,qty,unit_cost,receipt_ids)
   values('decoration:'||new.id,(select so_id from webstore_orders where id=new.order_id),new.consumed_qty,t.unit_cost,t.cost_receipts) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger snapshot_store_decoration_cost before insert or update on public.all_school_decoration_allocations for each row execute function public.snapshot_store_decoration_cost();

create function public.price_store_decoration() returns trigger language plpgsql security definer set search_path=public as $$
declare it so_items; a record; t webstore_transfers; snap store_inventory_cost_snapshots; total numeric:=0; q numeric; missing boolean:=false; basis jsonb:='[]';
begin
 select * into strict it from so_items where id=new.so_item_id;
 if new.transfer_code is null or coalesce(cardinality(it.source_webstore_item_ids),0)=0 then return new; end if;
 select coalesce(sum(value::numeric),0) into q from jsonb_each_text(it.sizes);
 for a in select * from all_school_decoration_allocations where order_item_id=any(it.source_webstore_item_ids) and transfer_code=new.transfer_code and status in ('reserved','consumed') loop
  select * into snap from store_inventory_cost_snapshots where source_key='decoration:'||a.id;
  if found then
   missing:=missing or snap.unit_cost is null; total:=total+snap.qty*coalesce(snap.unit_cost,0);
   basis:=basis||jsonb_build_object('qty',snap.qty,'unit_cost',snap.unit_cost,'receipt_ids',snap.receipt_ids,'received',true);
  else
   select * into t from webstore_transfers where store_id=a.store_id and code=a.transfer_code;
   missing:=missing or t.unit_cost is null; total:=total+a.required_qty*coalesce(t.unit_cost,0);
   basis:=basis||jsonb_build_object('qty',a.required_qty,'unit_cost',t.unit_cost,'received',false);
  end if;
 end loop;
 if basis='[]'::jsonb then missing:=true; end if;
 new.cost_each:=total/greatest(q,1); new.inventory_cost_missing:=missing; new.inventory_cost_basis:=basis;
 return new;
end $$;
create trigger price_store_decoration before insert or update on public.so_item_decorations for each row execute function public.price_store_decoration();
create function public.refresh_consumed_store_costs() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='consumed' then
  update so_item_decorations d set cost_each=d.cost_each from so_items i where d.so_item_id=i.id and new.order_item_id=any(i.source_webstore_item_ids) and d.transfer_code=new.transfer_code;
 end if;
 return new;
end $$;
create trigger refresh_consumed_store_costs after insert or update on public.all_school_decoration_allocations for each row execute function public.refresh_consumed_store_costs();
revoke all on function public.create_store_inventory_po(uuid,uuid,text,jsonb),public.receive_store_inventory_po(uuid,uuid,integer,numeric),public.set_store_opening_inventory_cost(uuid,text,text,numeric) from public,anon;
grant execute on function public.create_store_inventory_po(uuid,uuid,text,jsonb),public.receive_store_inventory_po(uuid,uuid,integer,numeric),public.set_store_opening_inventory_cost(uuid,text,text,numeric) to authenticated,service_role;
revoke all on function public.snapshot_store_inventory_pick(),public.snapshot_store_decoration_cost(),public.price_store_decoration(),public.refresh_consumed_store_costs() from public,anon,authenticated;

-- Capture the unit cost in the SAME transaction as the physical warehouse pull.
-- Ordinary orders still use the existing pull function unchanged.
create function public.pull_store_inventory(p_pulls jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare x jsonb; it so_items; inv product_inventory; snap store_inventory_cost_snapshots; k text; r jsonb; rows jsonb:='[]'; sources uuid[];
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' and not coalesce(public.is_team_member(),false) then raise exception 'Staff access required'; end if;
 if jsonb_typeof(p_pulls)<>'array' then raise exception 'Pull lines required'; end if;
 for x in select value from jsonb_array_elements(p_pulls) order by value->>'product_id',value->>'size' loop
  if jsonb_array_length(coalesce(x->'source_item_ids','[]'))=0 then
   r:=public.pull_house_inventory(jsonb_build_array(x)); rows:=rows||(r->'rows'); continue;
  end if;
  select array_agg(v::uuid order by v::uuid) into sources from jsonb_array_elements_text(x->'source_item_ids') v;
  select * into strict it from so_items where so_id=x->>'so_id' and product_id=x->>'product_id' and source_webstore_item_ids @> sources and source_webstore_item_ids <@ sources;
  if nullif(x->>'pick_id','') is null or (x->>'qty')::int<=0 or not (it.sizes ? (x->>'size')) then raise exception 'Valid pick, size and quantity required'; end if;
  select * into strict inv from product_inventory where product_id=it.product_id and size=x->>'size' for update;
  k:='pick:'||it.so_id||':'||(x->>'pick_id')||':'||it.product_id||':'||(x->>'size')||':'||array_to_string(sources,',');
  select * into snap from store_inventory_cost_snapshots where source_key=k;
  if found and snap.stock_pulled then
   if snap.qty<>(x->>'qty')::int then raise exception 'Pull retry quantity differs'; end if;
  else
   if (x->>'qty')::int+(select coalesce(sum(qty),0) from store_inventory_cost_snapshots where so_id=it.so_id and product_id=it.product_id and size=x->>'size' and source_item_ids=sources and stock_pulled and source_key<>k)>(it.sizes->>(x->>'size'))::int then raise exception 'Pull exceeds the remaining order quantity'; end if;
   if inv.received_unit_cost is null then raise exception 'Set opening garment stock cost before pulling: % %',it.sku,x->>'size'; end if;
   if inv.quantity<(x->>'qty')::int then raise exception 'Not enough warehouse stock'; end if;
   insert into store_inventory_cost_snapshots(source_key,so_id,product_id,size,source_item_ids,qty,unit_cost,receipt_ids,stock_pulled)
    values(k,it.so_id,it.product_id,x->>'size',sources,(x->>'qty')::int,inv.received_unit_cost,inv.cost_receipts,true)
    on conflict(source_key) do update set product_id=excluded.product_id,size=excluded.size,source_item_ids=excluded.source_item_ids,qty=excluded.qty,unit_cost=excluded.unit_cost,receipt_ids=excluded.receipt_ids,stock_pulled=true returning * into snap;
   perform public.pull_house_inventory(jsonb_build_array(x));
  end if;
  rows:=rows||jsonb_build_object('product_id',it.product_id,'size',x->>'size','pick_id',x->>'pick_id','source_item_ids',sources,'quantity',(select quantity from product_inventory where id=inv.id),'found',true,'inventory_cost',jsonb_build_object('qty',snap.qty,'unit_cost',snap.unit_cost,'receipt_ids',snap.receipt_ids));
 end loop;
 return jsonb_build_object('ok',true,'rows',rows);
end $$;
revoke all on function public.pull_store_inventory(jsonb) from public,anon;
grant execute on function public.pull_store_inventory(jsonb) to authenticated,service_role;

-- Refresh pending estimates after a stock-cost edit/receipt. Consumed snapshots stay frozen.
create function public.refresh_store_inventory_estimates() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.unit_cost is distinct from old.unit_cost then
  update so_item_decorations d set cost_each=d.cost_each from so_items i
  where d.so_item_id=i.id and d.transfer_code=new.code and exists(
   select 1 from all_school_decoration_allocations a where a.order_item_id=any(i.source_webstore_item_ids) and a.store_id=new.store_id and a.transfer_code=new.code and a.status='reserved');
 end if;
 return new;
end $$;
create trigger refresh_store_inventory_estimates after update of unit_cost on public.webstore_transfers for each row execute function public.refresh_store_inventory_estimates();
revoke all on function public.refresh_store_inventory_estimates() from public,anon,authenticated;

-- Close only the unreceived balance; historical receipts and their costs remain intact.
create function public.close_store_inventory_po(p_po_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' and not coalesce(public.is_team_member(),false) then raise exception 'Staff access required'; end if;
 update purchase_orders set status='cancelled',submission_state='inventory_closed' where id=p_po_id and origin='store_inventory';
 if not found then raise exception 'Inventory PO not found'; end if;
end $$;
revoke all on function public.close_store_inventory_po(uuid) from public,anon;
grant execute on function public.close_store_inventory_po(uuid) to authenticated,service_role;
