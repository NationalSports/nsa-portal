-- One paid master generation per supplier style. Browser roles cannot invoke
-- these RPCs; the staff-authenticated admin function supplies the catalog.
create table public.webstore_showcase_families (
  store_id uuid not null references public.webstores(id) on delete cascade,
  family_key text not null,
  request_id uuid not null,
  status text not null check (status in ('queued','generating','review','failed','canceled')),
  inputs jsonb not null,
  master jsonb,
  updated_at timestamptz not null default now(),
  primary key (store_id, family_key)
);
alter table public.webstore_showcase_families enable row level security;
revoke all on public.webstore_showcase_families from public, anon, authenticated;
grant all on public.webstore_showcase_families to service_role;

create function public.queue_showcase_family(p_store uuid, p_key text, p_request uuid, p_inputs jsonb, p_new_master boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare old_job public.webstore_showcase_families; member jsonb; n integer; cached jsonb; leader uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_store::text, 927));
  n := jsonb_array_length(p_inputs->'members');
  if n is null or n < 1 or n > 250 or length(p_key) > 250 then raise exception 'Invalid family'; end if;
  if (select count(distinct wp.id) from jsonb_array_elements(p_inputs->'members') m
      join webstore_products wp on wp.id = (m->>'webstore_product_id')::uuid
      where wp.store_id = p_store and wp.active and wp.kind is distinct from 'bundle') <> n
    then raise exception 'Family catalog changed'; end if;
  -- Lock existing assets before checking state, so concurrent legacy writes
  -- cannot race the active-job check and overwrite a newly queued family.
  perform 1 from webstore_showcase_assets where store_id = p_store
    and webstore_product_id in (select (m->>'webstore_product_id')::uuid from jsonb_array_elements(p_inputs->'members') m)
    order by id for update;
  if exists (select 1 from webstore_showcase_assets where store_id = p_store
      and webstore_product_id in (select (m->>'webstore_product_id')::uuid from jsonb_array_elements(p_inputs->'members') m)
      and status in ('queued','generating')) then raise exception 'This item is already queued or generating'; end if;
  select * into old_job from webstore_showcase_families where store_id = p_store and family_key = p_key for update;
  if not p_new_master and old_job.master->>'signature' = p_inputs->>'master_signature' then cached := old_job.master; end if;
  insert into webstore_showcase_families(store_id,family_key,request_id,status,inputs,master)
    values(p_store,p_key,p_request,'queued',p_inputs,cached)
    on conflict(store_id,family_key) do update set request_id=excluded.request_id,status='queued',inputs=excluded.inputs,master=excluded.master,updated_at=now();
  for member in select * from jsonb_array_elements(p_inputs->'members') loop
    insert into webstore_showcase_assets(store_id,webstore_product_id,product_id,standard_image_url,status,approval_status,
      generation_request_id,prompt_version,analysis)
    values(p_store,(member->>'webstore_product_id')::uuid,member->>'product_id',member->>'standard_image_url','queued','pending',p_request,
      p_inputs->>'version',jsonb_build_object('showcase_settings',member->'settings','family',jsonb_build_object('key',p_key,'version',p_inputs->>'version')))
    on conflict(store_id,webstore_product_id) do update set status='queued',approval_status='pending',generation_request_id=p_request,
      prompt_version=excluded.prompt_version,analysis=excluded.analysis,standard_image_url=excluded.standard_image_url,
      showcase_image_url=null,error_details=null,qa_result='{}',generation_started_at=null,generated_at=null,reviewed_at=null,reviewed_by=null,updated_at=now();
    -- approved_showcase_image_url is deliberately never reset by generation.
  end loop;
  select id into leader from webstore_showcase_assets where store_id=p_store and generation_request_id=p_request order by id limit 1;
  return jsonb_build_object('id',leader,'generation_request_id',p_request,'store_id',p_store,'family_key',p_key);
end $$;

create function public.transition_showcase_family(p_store uuid, p_key text, p_request uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql set search_path = public as $$
declare job public.webstore_showcase_families; n integer; output jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_store::text, 927));
  select * into job from webstore_showcase_families where store_id=p_store and family_key=p_key and request_id=p_request for update;
  if not found then return null; end if;
  n := jsonb_array_length(job.inputs->'members');
  perform 1 from webstore_showcase_assets where store_id=p_store and generation_request_id=p_request order by id for update;
  if p_action in ('fail','cancel') then
    if job.status not in ('queued','generating') then return null; end if;
    update webstore_showcase_families set status=case when p_action='fail' then 'failed' else 'canceled' end,updated_at=now()
      where store_id=p_store and family_key=p_key;
    update webstore_showcase_assets set status=case when p_action='fail' then 'failed' else 'canceled' end,
      error_details=p_payload->>'error',updated_at=now()
      where store_id=p_store and generation_request_id=p_request and status in ('queued','generating');
    return '{}'::jsonb;
  end if;
  if p_action='claim' then
    if job.status <> 'queued' or (select count(*) from webstore_showcase_assets where store_id=p_store and generation_request_id=p_request and status='queued') <> n then return null; end if;
    update webstore_showcase_families set status='generating',updated_at=now() where store_id=p_store and family_key=p_key;
    update webstore_showcase_assets set status='generating',generation_started_at=now(),updated_at=now()
      where store_id=p_store and generation_request_id=p_request;
    return to_jsonb(job);
  end if;
  if job.status <> 'generating' or (select count(*) from webstore_showcase_assets where store_id=p_store and generation_request_id=p_request and status='generating') <> n then return null; end if;
  if p_action='check' then return '{}'::jsonb; end if;
  if p_action='cache' then
    update webstore_showcase_families set master=p_payload,updated_at=now() where store_id=p_store and family_key=p_key;
    return '{}'::jsonb;
  end if;
  if p_action <> 'finish' then raise exception 'Unknown transition'; end if;
  if jsonb_array_length(p_payload->'outputs') <> n or
    (select count(distinct a.webstore_product_id) from jsonb_array_elements(p_payload->'outputs') o join webstore_showcase_assets a
      on a.webstore_product_id=(o->>'webstore_product_id')::uuid
      where a.store_id=p_store and a.generation_request_id=p_request) <> n then raise exception 'Incomplete family outputs'; end if;
  for output in select * from jsonb_array_elements(p_payload->'outputs') loop
    if coalesce(output->>'url','') = '' then raise exception 'Missing image URL'; end if;
    update webstore_showcase_assets set status='review',approval_status='pending',showcase_image_url=output->>'url',
      provider='openai',provider_model=p_payload->>'model',analysis_provider='moonshot',analysis_model=p_payload->>'analysis_model',
      analysis=analysis || jsonb_build_object('generated_showcase_settings',analysis->'showcase_settings'),
      qa_result=output->'qa',generated_at=now(),error_details=null,updated_at=now()
      where store_id=p_store and webstore_product_id=(output->>'webstore_product_id')::uuid and generation_request_id=p_request;
  end loop;
  update webstore_showcase_families set status='review',updated_at=now() where store_id=p_store and family_key=p_key;
  return '{}'::jsonb;
end $$;
revoke all on function public.queue_showcase_family(uuid,text,uuid,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.transition_showcase_family(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.queue_showcase_family(uuid,text,uuid,jsonb,boolean) to service_role;
grant execute on function public.transition_showcase_family(uuid,text,uuid,text,jsonb) to service_role;
