-- Review evidence is separate from accounting and does not alter historic closeouts.
create table public.store_closeout_reviews (
  so_id text primary key references public.sales_orders(id),
  review_token text not null,
  confirmations jsonb not null default '{}'::jsonb,
  reviewed_by text not null,
  reviewed_at timestamptz not null default now(),
  next_check date,
  note text
);
alter table public.store_closeout_reviews enable row level security;
revoke all on public.store_closeout_reviews from public,anon,authenticated;
grant select,insert,update on public.store_closeout_reviews to service_role;

-- Server-owned scope: outside artwork preparation is not outside garment fulfillment.
-- A decorator returning goods to NSA still needs a separate final-delivery confirmation.
create function public.store_closeout_status(p_so_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.sales_orders%rowtype; v_jobs jsonb; v_outside jsonb; v_token text; v_review jsonb; v_due date; v_rep text;
begin
  if current_user<>'service_role' then raise exception 'Staff closeout endpoint required'; end if;
  select * into s from public.sales_orders where id=p_so_id and deleted_at is null;
  if not found or (s.omg_store_id is null and s.webstore_id is null) then raise exception 'Store sales order required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'key',j.key,
      'name',coalesce(nullif(to_jsonb(j)->>'art_name',''),j.key,j.id),
      'status',coalesce(j.prod_status,'not started')) order by j.id),'[]') into v_jobs
    from public.so_jobs j where j.so_id=s.id and coalesce(j.prod_status,'') not in ('completed','shipped','outside')
      and coalesce(j.key,'') not like 'outside_art:%';
  with scopes as (
    select 'po:'||coalesce(nullif(d->>'po_id',''),nullif(d->>'id',''),n::text) as key,
      coalesce(nullif(d->>'vendor',''),nullif(d->>'deco_vendor',''),'Outside decorator') as vendor,
      coalesce(nullif(d->>'po_id',''),'Outside decoration PO') as label
    from jsonb_array_elements(coalesce(s.deco_pos,'[]')) with ordinality p(d,n)
    where coalesce(d->>'topstar_service','')=''
    union all
    select case when nullif(d.deco_po_id,'') is not null then 'po:'||d.deco_po_id
        else 'decoration:'||i.item_index||':'||coalesce(to_jsonb(d)->>'deco_index',to_jsonb(d)->>'id','0') end,
      coalesce(nullif(to_jsonb(d)->>'vendor',''),'Outside decorator'),
      coalesce(nullif(d.deco_po_id,''),concat_ws(' · ',i.sku,i.name,to_jsonb(d)->>'position'))
    from public.so_item_decorations d join public.so_items i on i.id=d.so_item_id
    where i.so_id=s.id and (d.kind='outside_deco' or d.fulfillment='outside' or nullif(d.deco_po_id,'') is not null)
      and coalesce((to_jsonb(d)->>'outside_art')::boolean,false)=false
    union all
    select 'po:'||coalesce(nullif(p.po_id,''),'line-'||p.id),
      coalesce(nullif(p.sizes->>'deco_vendor',''),nullif(p.vendor,''),'Outside vendor'),
      coalesce(nullif(p.po_id,''),concat_ws(' · ',i.sku,i.name))
    from public.so_item_po_lines p join public.so_items i on i.id=p.so_item_id
    where i.so_id=s.id and (p.sizes->>'po_type'='outside_deco' or p.sizes->>'drop_ship'='true')
    union all
    select 'job:'||j.id,coalesce(nullif(to_jsonb(j)->>'assigned_to',''),'Outside vendor'),
      coalesce(nullif(to_jsonb(j)->>'art_name',''),j.key,j.id)
    from public.so_jobs j where j.so_id=s.id and j.prod_status='outside' and coalesce(j.key,'') not like 'outside_art:%'
      and not exists(select 1 from public.so_item_decorations d join public.so_items i on i.id=d.so_item_id where i.so_id=s.id and (d.kind='outside_deco' or d.fulfillment='outside' or nullif(d.deco_po_id,'') is not null))
      and not exists(select 1 from jsonb_array_elements(coalesce(s.deco_pos,'[]')) d where coalesce(d->>'topstar_service','')='')
  ), grouped as (select key,min(vendor) as vendor,string_agg(distinct label,', ' order by label) as label from scopes group by key)
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'vendor',vendor,'label',label) order by key),'[]') into v_outside from grouped;
  -- Undecorated/direct fulfillment and no-job stores still require outside review.
  if v_outside='[]' and not exists(select 1 from public.so_jobs where so_id=s.id and coalesce(prod_status,'')<>'outside' and coalesce(key,'') not like 'outside_art:%') then
    v_outside:='[{"key":"direct","vendor":"Vendor / direct fulfillment","label":"All store items"}]';
  end if;
  select md5(jsonb_build_object('so',to_jsonb(s),
    'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.so_items i where i.so_id=s.id),
    'decorations',(select jsonb_agg(to_jsonb(d) order by i.id,to_jsonb(d)::text) from public.so_item_decorations d join public.so_items i on i.id=d.so_item_id where i.so_id=s.id),
    'purchase_lines',(select jsonb_agg(to_jsonb(p) order by p.id) from public.so_item_po_lines p join public.so_items i on i.id=p.so_item_id where i.so_id=s.id),
    'jobs',(select jsonb_agg(to_jsonb(j) order by j.id) from public.so_jobs j where j.so_id=s.id))::text) into v_token;
  select to_jsonb(r) into v_review from public.store_closeout_reviews r where r.so_id=s.id and r.review_token=v_token;
  begin v_due:=s.created_at::timestamp::date+35; exception when others then v_due:=null; end;
  select coalesce(nullif(s.rep_id,''),nullif(c.primary_rep_id,''),nullif(s.created_by,'')) into v_rep from public.customers c where c.id=s.customer_id;
  if not exists(select 1 from public.team_members where id=v_rep and is_active is not false) then v_rep:=null; end if;
  return jsonb_build_object('so_id',s.id,'version',s._version,'token',v_token,'blocking_jobs',v_jobs,
    'outside',v_outside,'five_week_date',v_due,'assigned_to',v_rep,'review',v_review,'closed',s.store_closed_at is not null);
end $$;
revoke all on function public.store_closeout_status(text) from public,anon,authenticated;
grant execute on function public.store_closeout_status(text) to service_role;

create function public.review_store_closeout(p_so_id text,p_actor_id text,p_action text,
  p_expected_version bigint default null,p_review jsonb default '{}'::jsonb,p_invoice jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.sales_orders%rowtype; r jsonb; c jsonb; scope jsonb; evidence jsonb; missing text[]:='{}';
  v_note text; v_next date; v_result jsonb; v_todo public.assigned_todos%rowtype;
begin
  if current_user<>'service_role' then raise exception 'Staff closeout endpoint required'; end if;
  if not exists(select 1 from public.team_members where id=p_actor_id and is_active is not false) then raise exception 'Active staff actor required'; end if;
  if p_action not in ('inspect','follow_up','close') then raise exception 'Unknown closeout action'; end if;
  perform pg_advisory_xact_lock(hashtext('webstore_batch:'||p_so_id));
  select * into s from public.sales_orders where id=p_so_id for update;
  r:=public.store_closeout_status(p_so_id);
  if p_action='inspect' then return jsonb_build_object('ok',true,'review_status',r); end if;
  if s.store_closed_at is not null then
    if p_action='close' then return public.close_store(s.id,s._version,p_actor_id,true,true,null); end if;
    raise exception 'Store is already closed. Reload before changing its review.';
  end if;
  if s._version is distinct from p_expected_version or r->>'token' is distinct from p_review->>'token' then
    raise exception 'Order or vendor details changed. Reload the closeout review and confirm again.';
  end if;
  c:=coalesce(p_review->'confirmations','{}');
  if jsonb_typeof(c) is distinct from 'object' then raise exception 'Invalid confirmation details'; end if;
  if c->'shipped' is distinct from 'true'::jsonb then missing:=array_append(missing,'Final shipment to families is unconfirmed'); end if;
  if c->'costs' is distinct from 'true'::jsonb then missing:=array_append(missing,'All final costs are unconfirmed'); end if;
  for scope in select value from jsonb_array_elements(r->'outside') loop
    evidence:=c->'outside'->(scope->>'key');
    if evidence->'shipped' is distinct from 'true'::jsonb then missing:=array_append(missing,(scope->>'label')||': final shipment unconfirmed'); end if;
    if evidence->'costs' is distinct from 'true'::jsonb then missing:=array_append(missing,(scope->>'label')||': final vendor costs unconfirmed'); end if;
    if length(btrim(coalesce(evidence->>'evidence',''))) < 3 then missing:=array_append(missing,(scope->>'label')||': shipment and final-cost reference missing'); end if;
  end loop;
  for scope in select value from jsonb_array_elements(r->'blocking_jobs') loop
    missing:=array_append(missing,(scope->>'id')||' — '||(scope->>'name')||': '||(scope->>'status'));
  end loop;
  v_note:=left(btrim(coalesce(p_review->>'note','')),2000);
  if p_action='follow_up' and v_note='' then raise exception 'Describe what is missing and the next action'; end if;
  begin v_next:=case when p_action='close' and cardinality(missing)=0 then current_date+1 else coalesce(nullif(p_review->>'nextCheck','')::date,current_date+1) end; exception when others then raise exception 'Choose a valid next-check date'; end;
  if v_next<current_date or v_next>current_date+30 then raise exception 'Next check must be today or within 30 days'; end if;
  insert into public.store_closeout_reviews(so_id,review_token,confirmations,reviewed_by,reviewed_at,next_check,note)
  values(s.id,r->>'token',c,p_actor_id,now(),v_next,v_note)
  on conflict(so_id) do update set review_token=excluded.review_token,confirmations=excluded.confirmations,
    reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,next_check=excluded.next_check,note=excluded.note;
  if p_action='close' and cardinality(missing)=0 then
    begin
      v_result:=public.close_store(s.id,s._version,p_actor_id,true,true,p_invoice);
      return v_result;
    exception when others then
      -- Roll back the accounting subtransaction, keep an actionable rep follow-up.
      missing:=array_append(missing,sqlerrm);
    end;
  end if;
  if r->>'assigned_to' is null then raise exception 'Assign an active rep to this sales order before saving the follow-up'; end if;
  insert into public.assigned_todos(id,title,description,created_by,assigned_to,so_id,customer_id,priority,status,due_date,created_at,updated_at)
  values('store-closeout:'||s.id,'Closeout follow-up — '||s.id,
    'Store remains open. '||array_to_string(missing,'; ')||E'\nNext action: '||v_note||E'\nFive-week date from SO creation: '||coalesce(r->>'five_week_date','Unknown'),
    p_actor_id,r->>'assigned_to',s.id,s.customer_id,2,'open',v_next,now(),now())
  on conflict(id) do update set title=excluded.title,description=excluded.description,assigned_to=excluded.assigned_to,
    status='open',due_date=excluded.due_date,completed_at=null,completed_by=null,completion_note=null,updated_at=now()
  returning * into v_todo;
  return jsonb_build_object('ok',p_action='follow_up','follow_up_saved',true,'todo',to_jsonb(v_todo),
    'error',case when p_action='close' then 'Closeout blocked. '||array_to_string(missing,'; ') else null end,
    'review_status',public.store_closeout_status(s.id));
end $$;
revoke all on function public.review_store_closeout(text,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.review_store_closeout(text,text,text,bigint,jsonb,jsonb) to service_role;

-- Keep an explicit next check when a later SO/job save refreshes its reminder.
create or replace function public.refresh_store_closeout_todo(p_so_id text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.sales_orders%rowtype; v_rep text; v_due date; v_outside boolean;
begin
  select * into s from public.sales_orders where id=p_so_id;
  if not found or (s.omg_store_id is null and s.webstore_id is null) then return; end if;
  if s.deleted_at is not null or s.store_closed_at is not null then
    update public.assigned_todos set status='completed',updated_at=now() where id='store-closeout:'||s.id and status='open'; return;
  end if;
  v_outside := not exists(select 1 from public.so_jobs j where j.so_id=s.id and coalesce(j.prod_status,'')<>'outside' and coalesce(j.key,'') not like 'outside_art:%')
    or exists(select 1 from public.so_jobs j where j.so_id=s.id and j.prod_status='outside' and coalesce(j.key,'') not like 'outside_art:%')
    or exists(select 1 from public.so_item_po_lines p join public.so_items it on it.id=p.so_item_id where it.so_id=s.id and (p.sizes->>'po_type'='outside_deco' or p.sizes->>'drop_ship'='true'))
    or exists(select 1 from public.so_item_decorations d join public.so_items it on it.id=d.so_item_id where it.so_id=s.id and (d.kind='outside_deco' or d.fulfillment='outside' or nullif(d.deco_po_id,'') is not null) and coalesce((to_jsonb(d)->>'outside_art')::boolean,false)=false)
    or exists(select 1 from jsonb_array_elements(coalesce(s.deco_pos,'[]')) d where coalesce(d->>'topstar_service','')='');
  if not v_outside and not exists(select 1 from public.store_closeout_reviews where so_id=s.id) then
    delete from public.assigned_todos where id='store-closeout:'||s.id and status='open'; return;
  end if;
  select coalesce(s.rep_id,c.primary_rep_id,s.created_by) into v_rep from public.customers c where c.id=s.customer_id;
  if not exists(select 1 from public.team_members where id=v_rep and is_active is not false) then return; end if;
  begin v_due := s.created_at::timestamp::date + 35; exception when others then return; end;
  select coalesce((select next_check from public.store_closeout_reviews where so_id=s.id),v_due) into v_due;
  if v_due is null then return; end if;
  insert into public.assigned_todos(id,title,description,created_by,assigned_to,so_id,customer_id,priority,status,due_date,created_at,updated_at)
  values('store-closeout:'||s.id,'Closeout check — '||s.id,
    'Confirm every item has shipped to families and all garment, decoration, freight and platform costs are recorded. Use Close Store to reconcile existing payments. Five weeks alone never releases commissions.',
    coalesce(s.created_by,v_rep),v_rep,s.id,s.customer_id,2,'open',v_due,now(),now())
  on conflict(id) do update set assigned_to=excluded.assigned_to,due_date=excluded.due_date,updated_at=now();
end $$;

-- Purchase-line changes need an AFTER refresh so new drop-ship metadata is visible.
create trigger store_closeout_todo_changed after insert or update or delete on public.so_item_po_lines
for each row execute function public.store_closeout_todo_changed();
