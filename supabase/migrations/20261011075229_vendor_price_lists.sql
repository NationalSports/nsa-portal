-- Private vendor reference documents. All access goes through a staff-authenticated
-- Netlify endpoint; no catalog/product row is required or modified.
create table public.vendor_price_lists (
  id uuid primary key default gen_random_uuid(),
  vendor_id text not null references public.vendors(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  file_size integer not null check (file_size between 1 and 20971520),
  status text not null default 'uploading' check (status in ('uploading','ready','archived')),
  effective_date date,
  expires_on date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  indexed_at timestamptz,
  check (expires_on is null or effective_date is null or expires_on >= effective_date)
);
create index vendor_price_lists_vendor_idx on public.vendor_price_lists(vendor_id, status);
create table public.vendor_price_list_chunks (
  document_id uuid not null references public.vendor_price_lists(id) on delete cascade,
  ordinal integer not null,
  location text not null,
  content text not null check (length(content) between 1 and 12000),
  search_vector tsvector generated always as (to_tsvector('simple',content)) stored,
  primary key (document_id, ordinal)
);
create index vendor_price_list_chunks_search_idx on public.vendor_price_list_chunks using gin(search_vector);
alter table public.vendor_price_lists enable row level security;
alter table public.vendor_price_list_chunks enable row level security;
revoke all on public.vendor_price_lists, public.vendor_price_list_chunks from anon, authenticated;
grant all on public.vendor_price_lists, public.vendor_price_list_chunks to service_role;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('vendor-price-lists','vendor-price-lists',false,20971520,array['application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- Atomic publication: an incomplete upload can never appear in assistant search.
create function public.publish_vendor_price_list(p_id uuid, p_actor uuid, p_chunks jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from public.vendor_price_lists where id=p_id and created_by=p_actor and status='uploading' for update;
  if not found then raise exception 'Upload is not pending for this user'; end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) not between 1 and 2000 then
    raise exception 'Invalid document chunks';
  end if;
  insert into public.vendor_price_list_chunks(document_id,ordinal,location,content)
    select p_id, ordinality::integer, value->>'location', value->>'content'
    from jsonb_array_elements(p_chunks) with ordinality;
  update public.vendor_price_lists set status='ready',indexed_at=now() where id=p_id;
end $$;
revoke all on function public.publish_vendor_price_list(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_vendor_price_list(uuid,uuid,jsonb) to service_role;

create function public.search_vendor_price_lists(p_query text, p_vendor_id text default null)
returns table(document_id uuid,vendor_id text,vendor_name text,file_name text,location text,content text,effective_date date,created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select d.id,d.vendor_id,v.name,d.file_name,c.location,c.content,d.effective_date,d.created_at
  from public.vendor_price_list_chunks c
  join public.vendor_price_lists d on d.id=c.document_id
  join public.vendors v on v.id=d.vendor_id
  where d.status='ready' and v.is_active is distinct from false
    and (d.effective_date is null or d.effective_date<=current_date)
    and (d.expires_on is null or d.expires_on>=current_date)
    and (p_vendor_id is null or d.vendor_id=p_vendor_id)
    and c.search_vector @@ plainto_tsquery('simple',left(p_query,200))
  order by ts_rank(c.search_vector,plainto_tsquery('simple',left(p_query,200))) desc,d.created_at desc,c.ordinal
  limit 20;
$$;
revoke all on function public.search_vendor_price_lists(text,text) from public,anon,authenticated;
grant execute on function public.search_vendor_price_lists(text,text) to service_role;
