-- Requests are independent of jobs and approvals. Estimate conversion retains the
-- original request identity through sales_orders.estimate_id, never a copied queue row.
create table public.standalone_art_requests (
  id uuid primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  estimate_id text references public.estimates(id) on delete set null,
  so_id text references public.sales_orders(id) on delete set null,
  source_key text not null, -- immutable origin for deduplication even after document deletion
  art_id text not null,
  art_name text not null check (length(trim(art_name)) > 0),
  request_type text not null check (request_type in ('web_logo','vectorize','create_logo')),
  color_way_id text,
  color_way_label text,
  instructions text not null check (length(trim(instructions)) > 0),
  reference_files jsonb not null default '[]' check (jsonb_typeof(reference_files)='array'),
  source_art jsonb not null default '{}',
  assigned_artist text,
  requested_by text not null,
  requested_by_name text not null,
  created_by_auth uuid not null default auth.uid(),
  status text not null default 'requested' check (status in ('requested','in_progress','completed','cancelled')),
  result_files jsonb not null default '[]' check (jsonb_typeof(result_files)='array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status <> 'completed' or jsonb_array_length(result_files)>0)
);
create unique index standalone_art_requests_open_unique on public.standalone_art_requests
  (customer_id, source_key, art_id, request_type, coalesce(color_way_id,''))
  where status in ('requested','in_progress');
create index standalone_art_requests_estimate on public.standalone_art_requests(estimate_id);
create index standalone_art_requests_customer on public.standalone_art_requests(customer_id);
create index standalone_art_requests_queue on public.standalone_art_requests(status,assigned_artist);
alter table public.standalone_art_requests enable row level security;
create policy standalone_art_requests_staff on public.standalone_art_requests for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));
revoke all on public.standalone_art_requests from public, anon;
grant select, insert, update on public.standalone_art_requests to authenticated;
grant all on public.standalone_art_requests to service_role;

create or replace function public.create_standalone_art_request(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  r public.standalone_art_requests;
  v_art jsonb;
  v_cw jsonb;
  v_id uuid := (p_request->>'id')::uuid;
  v_customer text := p_request->>'customer_id';
  v_est text := nullif(p_request->>'estimate_id','');
  v_so text := nullif(p_request->>'so_id','');
  v_art_id text := nullif(p_request->>'art_id','');
begin
  if auth.uid() is null or not public.is_team_member() then raise exception 'Active staff session required'; end if;
  if v_id is null then raise exception 'Request ID is required'; end if;
  -- Retrying a timed-out submission returns the original, not a second request.
  select * into r from standalone_art_requests where id=v_id;
  if found then
    if r.created_by_auth <> auth.uid() then raise exception 'Request ID already used'; end if;
    return to_jsonb(r);
  end if;
  if not exists(select 1 from customers where id=v_customer) then raise exception 'Customer no longer exists'; end if;
  if v_est is not null and not exists(select 1 from estimates where id=v_est and customer_id=v_customer) then
    raise exception 'Save the estimate for this customer before requesting art'; end if;
  if v_so is not null and not exists(select 1 from sales_orders where id=v_so and customer_id=v_customer and (v_est is null or estimate_id=v_est)) then
    raise exception 'Save the order for this customer before requesting art'; end if;
  -- Source metadata is read from the database, not trusted from an old open editor.
  if v_art_id is not null then
    if v_so is not null then select to_jsonb(a) into v_art from so_art_files a where so_id=v_so and id=v_art_id;
    elsif v_est is not null then select to_jsonb(a) into v_art from estimate_art_files a where estimate_id=v_est and id=v_art_id;
    else select a into v_art from customers c, lateral jsonb_array_elements(coalesce(c.art_files,'[]')) a where c.id=v_customer and a->>'id'=v_art_id; end if;
    if v_art is null then raise exception 'Save the art folder before requesting work on it'; end if;
  elsif p_request->>'request_type' <> 'create_logo' then
    raise exception 'Choose an existing art folder';
  else
    v_art_id := 'AR-' || v_id::text;
    v_art := jsonb_build_object('id',v_art_id,'name',p_request->>'art_name','status','waiting_for_art','files','[]'::jsonb,'color_ways','[]'::jsonb);
  end if;
  if p_request->>'request_type'='web_logo' then
    if jsonb_array_length(coalesce(v_art->'color_ways','[]'))>0 then
      select c into v_cw from jsonb_array_elements(v_art->'color_ways') c where c->>'id'=p_request->>'color_way_id';
      if v_cw is null then raise exception 'Choose a current color way before requesting its web logo'; end if;
    elsif nullif(p_request->>'color_way_id','') is not null then raise exception 'This art has no color ways'; end if;
  end if;
  if nullif(p_request->>'assigned_artist','') is not null and not exists (
    select 1 from team_members where id=p_request->>'assigned_artist' and role in ('art','artist') and is_active is distinct from false
  ) then raise exception 'Choose an active artist'; end if;
  insert into standalone_art_requests(id,customer_id,estimate_id,so_id,source_key,art_id,art_name,request_type,color_way_id,color_way_label,
    instructions,reference_files,source_art,assigned_artist,requested_by,requested_by_name)
  values(v_id,v_customer,v_est,v_so,coalesce(v_est,v_so,'library'),v_art_id,p_request->>'art_name',p_request->>'request_type',
    case when p_request->>'request_type'='web_logo' then nullif(p_request->>'color_way_id','') end,
    coalesce(v_cw->>'garment_color',v_cw->>'name','All garments'),p_request->>'instructions',coalesce(p_request->'reference_files','[]'),v_art,
    nullif(p_request->>'assigned_artist',''),p_request->>'requested_by',p_request->>'requested_by_name') returning * into r;
  return to_jsonb(r);
exception when unique_violation then
  raise exception 'An open request already exists for this artwork, request type and color way. Open its request history instead.';
end $$;

-- Merge only the delivered asset; keep approval, mockups, unrelated color ways and
-- production confirmation unchanged. Called inside the same transaction as completion.
create or replace function public.standalone_art_result(p_art jsonb,p_request public.standalone_art_requests,p_files jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare v_entry jsonb; v_keep jsonb; v_art jsonb := p_art;
begin
  if p_request.request_type='web_logo' then
    if p_request.color_way_id is not null and not exists(select 1 from jsonb_array_elements(coalesce(v_art->'color_ways','[]')) c where c->>'id'=p_request.color_way_id) then
      raise exception 'The requested color way was removed. Cancel this request and request the current color way.';
    end if;
    v_entry := jsonb_build_object('url',p_files->0->>'url','name',p_files->0->>'name','color_way',p_request.color_way_label);
    if p_request.color_way_id is null then v_entry := v_entry || jsonb_build_object('is_default',true,'color_way','');
    else v_entry := v_entry || jsonb_build_object('color_way_id',p_request.color_way_id); end if;
    select coalesce(jsonb_agg(w),'[]') into v_keep from jsonb_array_elements(coalesce(v_art->'web_logos','[]')) w
      where case when p_request.color_way_id is not null then w->>'color_way_id' is distinct from p_request.color_way_id
      else not(coalesce((w->>'is_default')::boolean,false) or (nullif(w->>'color_way_id','') is null and coalesce(w->>'color_way','')='')) end;
    v_art := v_art || jsonb_build_object('web_logos',jsonb_build_array(v_entry)||v_keep);
    if p_request.color_way_id is null then v_art := v_art || jsonb_build_object('web_logo_url',p_files->0->>'url'); end if;
  else
    select coalesce(jsonb_agg(f),'[]') into v_keep from jsonb_array_elements(coalesce(v_art->'prod_files','[]')) f
      where not exists(select 1 from jsonb_array_elements(p_files) n where n->>'url'=coalesce(f->>'url',f#>>'{}'));
    v_art := v_art || jsonb_build_object('prod_files',v_keep||p_files);
  end if;
  return v_art;
end $$;

create or replace function public.transition_standalone_art_request(p_id uuid,p_status text,p_files jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  r public.standalone_art_requests;
  v_art jsonb;
  v_library jsonb;
  v_next jsonb;
  v_base jsonb;
  v_so record;
  v_customer jsonb;
  v_est jsonb := null;
  v_orders jsonb := '[]';
begin
  if auth.uid() is null or not public.is_team_member() then raise exception 'Active staff session required'; end if;
  select * into r from standalone_art_requests where id=p_id for update;
  if not found then raise exception 'Art request not found'; end if;
  if r.status=p_status then
    -- A previous completion may have committed even if the response timed out.
    -- Return fresh mirrors on retry without replaying files over newer artwork.
    if p_status='completed' then
      select to_jsonb(c) into v_customer from customers c where id=r.customer_id;
      select jsonb_build_object('id',e.id,'_version',e._version,'updated_at',e.updated_at,'art_files',
        (select coalesce(jsonb_agg(to_jsonb(a)),'[]') from estimate_art_files a where estimate_id=e.id))
        into v_est from estimates e where id=r.estimate_id;
      select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'_version',s._version,'updated_at',s.updated_at,'art_files',
        (select coalesce(jsonb_agg(to_jsonb(a)),'[]') from so_art_files a where so_id=s.id))),'[]') into v_orders
        from sales_orders s where s.customer_id=r.customer_id and (s.id=r.so_id or (r.estimate_id is not null and s.estimate_id=r.estimate_id));
    end if;
    return jsonb_build_object('request',to_jsonb(r),'customer',v_customer,'estimate',v_est,'orders',v_orders);
  end if;
  if r.status not in ('requested','in_progress') or p_status not in ('in_progress','completed','cancelled') then raise exception 'This request is already closed'; end if;
  if p_status='completed' then
    if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files)=0 then raise exception 'Upload the completed artwork first'; end if;
    if exists(select 1 from jsonb_array_elements(p_files) f where coalesce(f->>'url','') !~ '^https://' or coalesce(f->>'name','')='') then raise exception 'Uploaded files must have a name and HTTPS URL'; end if;
    if r.request_type='web_logo' and (jsonb_array_length(p_files)<>1 or lower(p_files->0->>'name') !~ '\.png$') then raise exception 'Upload one transparent PNG for this color way'; end if;
    if r.request_type='vectorize' and exists(select 1 from jsonb_array_elements(p_files) f where lower(f->>'name') !~ '\.(ai|eps|svg|pdf)$') then raise exception 'Upload a vector artwork file (AI, EPS, SVG or PDF)'; end if;
    -- Lock the customer library before merging so separate completions cannot drop
    -- each other's files. Lock source documents too to serialize with normal saves.
    select coalesce(art_files,'[]') into v_library from customers where id=r.customer_id for update;
    if not found then raise exception 'Customer no longer exists'; end if;
    if r.estimate_id is not null then
      perform 1 from estimates where id=r.estimate_id and customer_id=r.customer_id for update;
      if not found then raise exception 'Estimate customer changed; cancel and request art for the correct customer'; end if;
    end if;
    v_base := r.source_art;
    if r.so_id is not null then
      perform 1 from sales_orders where id=r.so_id and customer_id=r.customer_id for update;
      if not found then raise exception 'Order customer changed; cancel and request art for the correct customer'; end if;
      select to_jsonb(a) into v_base from so_art_files a where so_id=r.so_id and id=r.art_id for update;
    elsif r.estimate_id is not null then
      select to_jsonb(a) into v_base from estimate_art_files a where estimate_id=r.estimate_id and id=r.art_id for update;
    else
      select a into v_base from jsonb_array_elements(v_library) a where a->>'id'=r.art_id;
    end if;
    if v_base is null then
      if r.request_type <> 'create_logo' then raise exception 'The source art folder was removed; cancel and request art again'; end if;
      v_base := r.source_art;
    end if;
    -- Validate the live source CW before creating a reusable library copy.
    v_next := standalone_art_result(v_base,r,p_files);
    select a into v_art from jsonb_array_elements(v_library) a where a->>'id'=r.art_id;
    v_art := standalone_art_result(coalesce(v_art,v_base) - 'so_id' - 'estimate_id' - '_version',r,p_files);
    select coalesce(jsonb_agg(case when a->>'id'=r.art_id then v_art else a end),'[]') into v_library from jsonb_array_elements(v_library) a;
    if not exists(select 1 from jsonb_array_elements(v_library) a where a->>'id'=r.art_id) then v_library := v_library || jsonb_build_array(v_art); end if;
    update customers set art_files=v_library where id=r.customer_id returning to_jsonb(customers.*) into v_customer;
    if r.estimate_id is not null then
      select to_jsonb(a) into v_art from estimate_art_files a where estimate_id=r.estimate_id and id=r.art_id for update;
      v_next := standalone_art_result(coalesce(v_art,v_base),r,p_files);
      insert into estimate_art_files(estimate_id,id,name,status,files,prod_files,color_ways,web_logos,web_logo_url)
      values(r.estimate_id,r.art_id,v_next->>'name',coalesce(v_next->>'status','waiting_for_art'),coalesce(v_next->'files','[]'),coalesce(v_next->'prod_files','[]'),coalesce(v_next->'color_ways','[]'),coalesce(v_next->'web_logos','[]'),v_next->>'web_logo_url')
      on conflict(estimate_id,id) do update set prod_files=excluded.prod_files,web_logos=excluded.web_logos,web_logo_url=excluded.web_logo_url;
      -- Bump document version through its normal update trigger, without approving it.
      update estimates set updated_at=now() where id=r.estimate_id;
      select jsonb_build_object('id',r.estimate_id,'_version',(select _version from estimates where id=r.estimate_id),'updated_at',(select updated_at from estimates where id=r.estimate_id),'art_files',(select jsonb_agg(to_jsonb(a)) from estimate_art_files a where estimate_id=r.estimate_id)) into v_est;
    end if;
    for v_so in select id from sales_orders where customer_id=r.customer_id and (id=r.so_id or (r.estimate_id is not null and estimate_id=r.estimate_id)) order by id for update loop
      select to_jsonb(a) into v_art from so_art_files a where so_id=v_so.id and id=r.art_id for update;
      -- Do not resurrect a deliberately deleted/replaced art folder on a converted SO.
      if v_art is null and r.request_type<>'create_logo' then continue; end if;
      v_art := standalone_art_result(coalesce(v_art,v_base),r,p_files);
      insert into so_art_files(so_id,id,name,status,files,prod_files,color_ways,web_logos,web_logo_url)
      values(v_so.id,r.art_id,v_art->>'name',coalesce(v_art->>'status','waiting_for_art'),coalesce(v_art->'files','[]'),coalesce(v_art->'prod_files','[]'),coalesce(v_art->'color_ways','[]'),coalesce(v_art->'web_logos','[]'),v_art->>'web_logo_url')
      on conflict(so_id,id) do update set prod_files=excluded.prod_files,web_logos=excluded.web_logos,web_logo_url=excluded.web_logo_url;
      update sales_orders set updated_at=now() where id=v_so.id;
      v_orders := v_orders || jsonb_build_array(jsonb_build_object('id',v_so.id,'_version',(select _version from sales_orders where id=v_so.id),'updated_at',(select updated_at from sales_orders where id=v_so.id),'art_files',(select jsonb_agg(to_jsonb(a)) from so_art_files a where so_id=v_so.id)));
    end loop;
  end if;
  update standalone_art_requests set status=p_status,updated_at=now(),
    result_files=case when p_status='completed' then p_files else result_files end,
    completed_at=case when p_status='completed' then now() else completed_at end
  where id=p_id returning * into r;
  return jsonb_build_object('request',to_jsonb(r),'customer',v_customer,'estimate',v_est,'orders',v_orders);
end $$;

revoke all on function public.create_standalone_art_request(jsonb) from public,anon;
revoke all on function public.transition_standalone_art_request(uuid,text,jsonb) from public,anon;
revoke all on function public.standalone_art_result(jsonb,public.standalone_art_requests,jsonb) from public,anon;
grant execute on function public.create_standalone_art_request(jsonb), public.transition_standalone_art_request(uuid,text,jsonb), public.standalone_art_result(jsonb,public.standalone_art_requests,jsonb) to authenticated,service_role;

-- An estimate can be converted from an editor opened before an artist delivered.
-- Replay completed results after the SO is durable; pending requests keep their ID.
create or replace function public.sync_standalone_art_conversion(p_estimate_id text,p_so_id text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.standalone_art_requests; v_art jsonb; v_customer text;
begin
  if auth.uid() is null or not public.is_team_member() then raise exception 'Active staff session required'; end if;
  select customer_id into v_customer from sales_orders where id=p_so_id and estimate_id=p_estimate_id;
  if not found then raise exception 'Order does not belong to this estimate'; end if;
  for r in select * from standalone_art_requests where estimate_id=p_estimate_id and customer_id=v_customer and status='completed' order by completed_at,id for update loop
    perform 1 from sales_orders where id=p_so_id for update;
    select to_jsonb(a) into v_art from so_art_files a where so_id=p_so_id and id=r.art_id for update;
    if v_art is null then
      -- New art delivered before conversion may be absent from the editor snapshot.
      select to_jsonb(a) into v_art from estimate_art_files a where estimate_id=p_estimate_id and id=r.art_id;
      if v_art is null then continue; end if;
    end if;
    v_art := standalone_art_result(v_art,r,r.result_files);
    insert into so_art_files(so_id,id,name,status,files,prod_files,color_ways,web_logos,web_logo_url)
    values(p_so_id,r.art_id,v_art->>'name',coalesce(v_art->>'status','waiting_for_art'),coalesce(v_art->'files','[]'),coalesce(v_art->'prod_files','[]'),coalesce(v_art->'color_ways','[]'),coalesce(v_art->'web_logos','[]'),v_art->>'web_logo_url')
    on conflict(so_id,id) do update set prod_files=excluded.prod_files,web_logos=excluded.web_logos,web_logo_url=excluded.web_logo_url;
  end loop;
  update sales_orders set updated_at=now() where id=p_so_id;
  return (select jsonb_build_object('id',s.id,'_version',s._version,'updated_at',s.updated_at,'art_files',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from so_art_files a where so_id=s.id)) from sales_orders s where s.id=p_so_id);
end $$;
revoke all on function public.sync_standalone_art_conversion(text,text) from public,anon;
grant execute on function public.sync_standalone_art_conversion(text,text) to authenticated,service_role;
