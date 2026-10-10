-- New color/design jobs use image edits without an analysis provider.
-- Preserve provider metadata for legacy jobs that still report an analysis model.
create or replace function public.transition_showcase_family(p_store uuid, p_key text, p_request uuid, p_action text, p_payload jsonb default '{}')
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
    if coalesce(output->>'error','') <> '' then
      update webstore_showcase_assets set status='failed',error_details=output->>'error',updated_at=now()
        where store_id=p_store and webstore_product_id=(output->>'webstore_product_id')::uuid and generation_request_id=p_request;
      continue;
    end if;
    if coalesce(output->>'url','') = '' then raise exception 'Missing image URL'; end if;
    update webstore_showcase_assets set status='review',approval_status='pending',showcase_image_url=output->>'url',
      provider='openai',provider_model=p_payload->>'model',analysis_provider=case when p_payload->>'analysis_model' is null then null else 'moonshot' end,analysis_model=p_payload->>'analysis_model',
      analysis=analysis || jsonb_build_object('generated_showcase_settings',analysis->'showcase_settings'),
      qa_result=output->'qa',generated_at=now(),error_details=null,updated_at=now()
      where store_id=p_store and webstore_product_id=(output->>'webstore_product_id')::uuid and generation_request_id=p_request;
  end loop;
  update webstore_showcase_families set status='review',updated_at=now() where store_id=p_store and family_key=p_key;
  return '{}'::jsonb;
end $$;
