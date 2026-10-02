-- Additive All School Store data. Existing team/club behavior and prices are unchanged.
begin;
alter table public.webstores add column if not exists all_school_settings jsonb not null default '{}'::jsonb;
alter table public.webstore_products add column if not exists school_program_ids text[] not null default '{}';
alter table public.webstore_products add column if not exists school_shared boolean not null default false;
alter table public.webstore_products add column if not exists school_template_id uuid references public.webstore_products(id) on delete set null;
alter table public.webstore_order_items add column if not exists production_recipe jsonb;
alter table public.so_items add column if not exists recipe_snapshot jsonb;
alter table public.so_items add column if not exists source_webstore_item_ids uuid[];
alter table public.webstore_transfers add column if not exists decoration_type text not null default 'dtf';
alter table public.webstore_transfers add column if not exists application_method text not null default 'heat_press';
alter table public.webstore_transfers add column if not exists application_instructions text;
alter table public.webstore_transfers add column if not exists supplier_id text;
alter table public.webstore_transfers add column if not exists width_in numeric;
alter table public.webstore_transfers add column if not exists height_in numeric;
alter table public.webstore_transfers add column if not exists artwork_version text;
alter table public.webstore_transfers add column if not exists production_file jsonb;

create index if not exists webstore_school_programs_idx on public.webstore_products using gin(school_program_ids);
create index if not exists webstore_school_template_idx on public.webstore_products(store_id,school_template_id) where school_template_id is not null;

-- Private, immutable artwork objects. Staff upload unique paths; only backend
-- workers can attach the files to supplier email. No public download policy.
insert into storage.buckets(id,name,public,file_size_limit)
values ('all-school-art','all-school-art',false,20971520)
on conflict(id) do nothing;
create policy all_school_art_staff_read on storage.objects for select to authenticated
using (bucket_id='all-school-art' and public.is_team_member());
create policy all_school_art_staff_insert on storage.objects for insert to authenticated
with check (bucket_id='all-school-art' and public.is_team_member());

-- Reserve physical decorations by paid order line. Server-only writes ensure two
-- customers cannot both allocate the same last patch/transfer.
create table public.all_school_decoration_allocations (
 id bigint generated always as identity primary key,
 store_id uuid not null references public.webstores(id),
 order_id uuid not null references public.webstore_orders(id),
 order_item_id uuid not null references public.webstore_order_items(id),
 transfer_code text not null,
 required_qty integer not null check(required_qty>0),
 reserved_qty integer not null default 0 check(reserved_qty>=0),
 consumed_qty integer not null default 0 check(consumed_qty>=0),
 status text not null default 'reserved' check(status in ('reserved','consumed','released')),
 recipe jsonb not null,
 source_player_number text,
 created_at timestamptz not null default now(),
 unique(order_item_id,transfer_code),
 check(reserved_qty<=required_qty and consumed_qty<=reserved_qty)
);
alter table public.all_school_decoration_allocations enable row level security;
revoke all on public.all_school_decoration_allocations from public,anon,authenticated;
grant select on public.all_school_decoration_allocations to authenticated;
grant all on public.all_school_decoration_allocations to service_role;
grant usage,select on sequence public.all_school_decoration_allocations_id_seq to service_role;
create policy all_school_allocation_staff_read on public.all_school_decoration_allocations
for select to authenticated using(public.is_team_member());
create index all_school_allocation_stock_idx on public.all_school_decoration_allocations(store_id,transfer_code) where status='reserved';
commit;

alter table public.webstore_products add column if not exists personalization_template jsonb;

-- Frozen physical component demand. Every configured number set consumes one
-- transfer per digit, per garment; repeated digits are counted independently.
create or replace function public.all_school_transfer_demand(p_recipe jsonb,p_qty integer,p_player_number text)
returns table(transfer_code text,required_qty integer) language plpgsql immutable set search_path=public as $$
declare v_demand jsonb:='{}'; v_code text; v_set text; v_digit text; v_sets jsonb; v_inventory jsonb; v_matches integer;
begin
 if coalesce(p_qty,0)<=0 then return; end if;
 for v_code in select distinct jsonb_array_elements_text(coalesce(p_recipe->'transfer_codes','[]')) loop
  if coalesce(v_code,'')<>'' then v_demand:=jsonb_set(v_demand,array[v_code],to_jsonb(p_qty)); end if;
 end loop;
 v_sets:=coalesce(p_recipe->'num_transfer_sets','[]');
 if jsonb_array_length(v_sets)=0 and nullif(p_recipe->>'num_transfer_size','') is not null then
  v_sets:=jsonb_build_array((p_recipe->>'num_transfer_size')||'|'||coalesce(p_recipe->>'num_transfer_color',''));
 end if;
 if coalesce((p_recipe->>'takes_number')::boolean,false) and jsonb_array_length(v_sets)>0 and nullif(p_player_number,'') is not null then
  if p_player_number !~ '^[0-9]{1,4}$' then raise exception 'NSA_BAD_NUMBER:digits required'; end if;
  for v_set in select jsonb_array_elements_text(v_sets) loop
   for v_digit in select substring(p_player_number from n for 1) from generate_series(1,length(p_player_number)) n loop
    select count(*),min(ti->>'code') into v_matches,v_code
    from jsonb_array_elements(coalesce(p_recipe->'transfer_inventory','[]')) ti
    where ti->>'kind'='number' and coalesce(ti->>'digit',split_part(ti->>'code','|',1))=v_digit
      and coalesce(ti->>'tsize',ti->>'size','')=split_part(v_set,'|',1)
      and coalesce(ti->>'color','')=split_part(v_set,'|',2);
    if v_matches<>1 or nullif(v_code,'') is null then raise exception 'NSA_MISSING_NUMBER_TRANSFER:%|%',v_digit,v_set; end if;
    v_demand:=jsonb_set(v_demand,array[v_code],to_jsonb(coalesce((v_demand->>v_code)::integer,0)+p_qty));
   end loop;
  end loop;
 end if;
 return query select d.key,d.value::integer from jsonb_each_text(v_demand) d order by d.key;
end $$;
revoke all on function public.all_school_transfer_demand(jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.all_school_transfer_demand(jsonb,integer,text) to service_role;

create or replace function public.reserve_all_school_decorations(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o webstore_orders; li record; t webstore_transfers; v_code text; held integer; take_qty integer; short_qty integer:=0; prev all_school_decoration_allocations; demand record;
begin
 select * into o from webstore_orders where id=p_order_id for update;
 if not found or coalesce(o.order_source,'')<>'all_school' or coalesce(o.status,'') not in ('paid','batched') then
  raise exception 'NSA_BAD_SOURCE:paid All School order required';
 end if;
 -- One lock per store ensures deterministic allocation when carts contain the same
 -- components in different order. Physical rows remain unchanged until consumption.
 perform pg_advisory_xact_lock(hashtextextended('school-deco:'||o.store_id::text,0));
 for li in select * from webstore_order_items where order_id=o.id and not coalesce(is_bundle_parent,false)
   and qty>0 and coalesce(line_status,'') not in ('cancelled','canceled','refunded') order by id loop
  if exists(select 1 from all_school_decoration_allocations a
    where a.order_item_id=li.id and a.status='consumed' and (a.recipe is distinct from li.production_recipe
      or a.source_player_number is distinct from li.player_number or not exists(
        select 1 from public.all_school_transfer_demand(li.production_recipe,li.qty,li.player_number) d
        where d.transfer_code=a.transfer_code and d.required_qty=a.required_qty))) then
    raise exception 'NSA_CONSUMED_RECIPE_CHANGED:source correction requires manual stock reconciliation';
  end if;
  -- Release obsolete unconsumed components after an authorized source correction.
  update all_school_decoration_allocations a set status='released',reserved_qty=0
    where a.order_item_id=li.id and a.status='reserved' and not exists(
      select 1 from public.all_school_transfer_demand(li.production_recipe,li.qty,li.player_number) d where d.transfer_code=a.transfer_code);
  for demand in select * from public.all_school_transfer_demand(li.production_recipe,li.qty,li.player_number) loop
   v_code:=demand.transfer_code;
   select * into prev from all_school_decoration_allocations where order_item_id=li.id and transfer_code=v_code for update;
   if found and prev.status='consumed' then
    if prev.required_qty<>demand.required_qty or prev.recipe is distinct from li.production_recipe or prev.source_player_number is distinct from li.player_number then raise exception 'NSA_CONSUMED_RECIPE_CHANGED:%',v_code; end if;
    continue;
   end if;
   select * into t from webstore_transfers where store_id=o.store_id and webstore_transfers.code=v_code for update;
   if not found then raise exception 'NSA_MISSING_TRANSFER:%',v_code; end if;
   select coalesce(sum(a.reserved_qty),0)::integer into held from all_school_decoration_allocations a
    join webstore_orders ao on ao.id=a.order_id
    where a.store_id=o.store_id and a.transfer_code=v_code and a.order_item_id<>li.id and a.status='reserved'
      and ao.status in ('paid','batched');
   take_qty:=least(demand.required_qty,greatest(0,coalesce(t.on_hand,0)-held));
   insert into all_school_decoration_allocations(store_id,order_id,order_item_id,transfer_code,required_qty,reserved_qty,recipe,source_player_number)
    values(o.store_id,o.id,li.id,v_code,demand.required_qty,take_qty,coalesce(li.production_recipe,'{}'),li.player_number)
    on conflict(order_item_id,transfer_code) do update set required_qty=excluded.required_qty,reserved_qty=excluded.reserved_qty,status='reserved',recipe=excluded.recipe,source_player_number=excluded.source_player_number;
   short_qty:=short_qty+demand.required_qty-take_qty;
  end loop;
 end loop;
 return jsonb_build_object('ok',true,'short_qty',short_qty);
end $$;
revoke all on function public.reserve_all_school_decorations(uuid) from public,anon,authenticated;
grant execute on function public.reserve_all_school_decorations(uuid) to service_role;

create or replace function public.consume_all_school_decorations(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o webstore_orders; a record; r jsonb;
begin
 if coalesce(current_setting('role',true),'') <> 'service_role' and not public.is_team_member() then raise exception 'NSA_FORBIDDEN'; end if;
 select * into o from webstore_orders where id=p_order_id for update;
 if not found or coalesce(o.order_source,'')<>'all_school' then raise exception 'NSA_BAD_SOURCE'; end if;
 r:=public.reserve_all_school_decorations(p_order_id);
 if (r->>'short_qty')::integer>0 then return jsonb_build_object('ok',false,'reason','decoration_shortage','short_qty',r->'short_qty'); end if;
 for a in select transfer_code,sum(reserved_qty)::integer qty from all_school_decoration_allocations
   where order_id=o.id and status='reserved' group by transfer_code order by transfer_code loop
  update webstore_transfers set on_hand=on_hand-a.qty where store_id=o.store_id and code=a.transfer_code and on_hand>=a.qty;
  if not found then raise exception 'NSA_DECORATION_SHORTAGE:%',a.transfer_code; end if;
 end loop;
 update all_school_decoration_allocations set consumed_qty=reserved_qty,status='consumed' where order_id=o.id and status='reserved';
 update webstore_orders set transfers_pulled=true,transfers_pulled_at=now() where id=o.id;
 -- Only stocked transfer jobs become ready from a physical pull. Personalized
 -- name/number jobs continue waiting for their supplier batch receipt.
 update so_jobs j set dtf_prints_status='received'
 where j.so_id=o.so_id and j.deco_type='dtf'
   and exists(select 1 from job_stage_events e where e.so_id=j.so_id and e.job_id=j.id
     and e.event='created' and e.payload->>'logo_ref' like 'xfer:%')
   and (public.all_school_materials_ready(j.so_id,j.id)->>'ready')::boolean;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.consume_all_school_decorations(uuid) from public,anon;
grant execute on function public.consume_all_school_decorations(uuid) to authenticated,service_role;

create or replace function public.release_all_school_decorations_on_cancel()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.order_source='all_school' and new.status in ('cancelled','canceled','refunded') then
  update all_school_decoration_allocations set status='released',reserved_qty=0 where order_id=new.id and status='reserved';
 end if;
 return new;
end $$;
revoke all on function public.release_all_school_decorations_on_cancel() from public,anon,authenticated;
create trigger all_school_decoration_cancel after update of status on public.webstore_orders
for each row execute function public.release_all_school_decorations_on_cancel();

create or replace function public.release_all_school_line_decorations()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if coalesce(new.line_status,'') in ('cancelled','canceled','refunded') or coalesce(new.qty,0)<=0 then
  update all_school_decoration_allocations set status='released',reserved_qty=0 where order_item_id=new.id and status='reserved';
 elsif new.qty < old.qty then
  update all_school_decoration_allocations a set required_qty=d.required_qty,reserved_qty=least(a.reserved_qty,d.required_qty)
   from public.all_school_transfer_demand(new.production_recipe,new.qty,new.player_number) d
   where a.order_item_id=new.id and a.status='reserved' and a.transfer_code=d.transfer_code;
 end if;
 return new;
end $$;
revoke all on function public.release_all_school_line_decorations() from public,anon,authenticated;
create trigger all_school_line_decoration_cancel after update of line_status,qty on public.webstore_order_items
for each row execute function public.release_all_school_line_decorations();

alter table public.webstore_orders add column if not exists target_ship_days integer;
alter table public.webstore_orders add column if not exists ship_target_at timestamptz;
alter table public.webstore_orders add column if not exists shipping_quote jsonb;
create unique index if not exists all_school_template_program_unique on public.webstore_products(store_id,school_template_id,school_program_ids) where school_template_id is not null;

-- Re-derive production eligibility from the paid source lines and physical
-- consumption ledger. The browser cannot grant readiness by changing a flag.
create or replace function public.all_school_materials_ready(p_so_id text,p_job_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o webstore_orders; j so_jobs; si so_items; li webstore_order_items;
 ji jsonb; source_id uuid; v_code text; a all_school_decoration_allocations; demand record;
 v_sizes jsonb; v_units integer; v_job_units integer:=0;
begin
 select * into o from webstore_orders where so_id=p_so_id and order_source='all_school' limit 1;
 if not found or coalesce(o.status,'') not in ('paid','batched') then
   return jsonb_build_object('ready',false,'reason','source_order_not_paid');
 end if;
 select * into j from so_jobs where so_id=p_so_id and id=p_job_id;
 if not found or jsonb_array_length(coalesce(j.items,'[]'))=0 then
   return jsonb_build_object('ready',false,'reason','source_job_missing');
 end if;
 for ji in select value from jsonb_array_elements(j.items) loop
   select * into si from so_items where so_id=p_so_id and item_index=(ji->>'item_idx')::integer;
   if not found or coalesce(array_length(si.source_webstore_item_ids,1),0)=0 then
     return jsonb_build_object('ready',false,'reason','source_item_references_missing');
   end if;
   foreach source_id in array si.source_webstore_item_ids loop
     select * into li from webstore_order_items where id=source_id and order_id=o.id;
     if not found or coalesce(li.qty,0)<=0 or coalesce(li.line_status,'') in ('cancelled','canceled','refunded') then
       return jsonb_build_object('ready',false,'reason','source_line_inactive');
     end if;
     if li.production_recipe is distinct from si.recipe_snapshot then
       return jsonb_build_object('ready',false,'reason','source_recipe_changed');
     end if;
     for demand in select * from public.all_school_transfer_demand(si.recipe_snapshot,li.qty,li.player_number) loop
       v_code:=demand.transfer_code;
       select * into a from all_school_decoration_allocations
         where order_item_id=source_id and order_id=o.id and store_id=o.store_id and transfer_code=v_code;
       if not found or a.status<>'consumed' or a.required_qty<>demand.required_qty or a.consumed_qty<a.required_qty
         or a.recipe is distinct from si.recipe_snapshot or a.source_player_number is distinct from li.player_number then
         return jsonb_build_object('ready',false,'reason','decoration_not_physically_consumed','transfer_code',v_code);
       end if;
     end loop;
   end loop;
   select jsonb_object_agg(q.size,q.qty),coalesce(sum(q.qty),0)::integer into v_sizes,v_units from (
     select coalesce(nullif(size,''),'OS') size,sum(qty)::integer qty from webstore_order_items
       where id=any(si.source_webstore_item_ids) and order_id=o.id group by 1
   ) q;
   if coalesce(v_sizes,'{}') is distinct from coalesce(si.sizes,'{}')
     or coalesce((ji->>'units')::integer,0)<>v_units then
     return jsonb_build_object('ready',false,'reason','source_quantity_changed');
   end if;
   v_job_units:=v_job_units+v_units;
 end loop;
 if v_job_units<>j.total_units then return jsonb_build_object('ready',false,'reason','job_quantity_changed'); end if;
 return jsonb_build_object('ready',true);
end $$;
revoke all on function public.all_school_materials_ready(text,text) from public,anon,authenticated;
grant execute on function public.all_school_materials_ready(text,text) to service_role;

-- Approve the whole offering, not merely the existence of an artwork file.
alter table public.webstore_products add column if not exists production_approved_at timestamptz;
alter table public.webstore_products add column if not exists production_approved_by text;
create or replace function public.invalidate_all_school_setup_approval()
returns trigger language plpgsql security definer set search_path=public as $$
declare k text;
begin
 if tg_op='INSERT' then
  new.production_approved_at:=null; new.production_approved_by:=null; return new;
 end if;
 foreach k in array array['product_id','sku','color','variant_label','image_url','image_back_url','decorations','transfer_code','transfer_codes','takes_name','takes_number','num_transfer_sets','num_transfer_size','num_transfer_color','personalization_template'] loop
  if to_jsonb(new)->k is distinct from to_jsonb(old)->k then
   new.production_approved_at:=null; new.production_approved_by:=null; exit;
  end if;
 end loop;
 return new;
end $$;
revoke all on function public.invalidate_all_school_setup_approval() from public,anon,authenticated;
create trigger all_school_setup_approval before insert or update on public.webstore_products
for each row execute function public.invalidate_all_school_setup_approval();

create or replace function public.invalidate_all_school_transfer_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (to_jsonb(new)-'on_hand'-'updated_at') is distinct from (to_jsonb(old)-'on_hand'-'updated_at') then
  update webstore_products set production_approved_at=null,production_approved_by=null
   where store_id=new.store_id and (transfer_code=old.code or old.code=any(transfer_codes)
     or (old.kind='number' and takes_number=true));
 end if;
 return new;
end $$;
revoke all on function public.invalidate_all_school_transfer_approval() from public,anon,authenticated;
create trigger all_school_transfer_approval after update on public.webstore_transfers
for each row execute function public.invalidate_all_school_transfer_approval();

alter table public.webstore_orders add column if not exists payment_received_at timestamptz;
create or replace function public.stamp_all_school_shipment_target()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.order_source='all_school' and new.status in ('paid','batched') then
  new.payment_received_at:=coalesce(old.payment_received_at,new.payment_received_at,now());
  new.ship_target_at:=coalesce(old.ship_target_at,new.payment_received_at+make_interval(days=>greatest(1,least(90,coalesce(new.target_ship_days,14)))));
 end if;
 return new;
end $$;
revoke all on function public.stamp_all_school_shipment_target() from public,anon,authenticated;
create trigger all_school_shipment_target before update of status on public.webstore_orders
for each row execute function public.stamp_all_school_shipment_target();
