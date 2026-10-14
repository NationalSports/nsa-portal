alter table public.webstore_build_requests
  add column selected_items jsonb,
  add column selected_art jsonb,
  add column start_from_type text,
  add column start_from_id text,
  add column start_from_url text;

comment on column public.webstore_build_requests.selected_items is
  'Optional product preload array shaped as {product_id,sku,name,brand,image_url}.';
comment on column public.webstore_build_requests.selected_art is
  'Optional customer art preload array shaped as {art_id,name,is_main}.';
comment on column public.webstore_build_requests.start_from_type is
  'Starting point: blank, store_templates row, existing webstore, or an itemorder.com shop URL.';

create or replace function public.valid_webstore_build_selected_items(items jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select items is null
    or (
      jsonb_typeof(items) = 'array'
      and jsonb_array_length(items) <= 50
      and not exists (
        select 1
        from jsonb_array_elements(items) as item
        where jsonb_typeof(item) <> 'object'
          or length(coalesce(item->>'product_id', '')) not between 1 and 200
          or length(coalesce(item->>'sku', '')) not between 1 and 100
          or length(coalesce(item->>'name', '')) not between 1 and 500
          or length(coalesce(item->>'brand', '')) > 200
          or length(coalesce(item->>'image_url', '')) > 2000
          or (
            coalesce(item->>'image_url', '') <> ''
            and coalesce(item->>'image_url', '') !~ '^https://'
          )
      )
    );
$$;

revoke all on function public.valid_webstore_build_selected_items(jsonb) from public, anon;
grant execute on function public.valid_webstore_build_selected_items(jsonb) to authenticated, service_role;

create or replace function public.valid_webstore_build_selected_art(items jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select items is null
    or (
      jsonb_typeof(items) = 'array'
      and jsonb_array_length(items) <= 50
      and (
        select count(*)
        from jsonb_array_elements(items) as item
        where item->>'is_main' = 'true'
      ) <= 1
      and not exists (
        select 1
        from jsonb_array_elements(items) as item
        where jsonb_typeof(item) <> 'object'
          or length(coalesce(item->>'art_id', '')) not between 1 and 200
          or length(coalesce(item->>'name', '')) not between 1 and 500
          or jsonb_typeof(item->'is_main') is distinct from 'boolean'
      )
    );
$$;

revoke all on function public.valid_webstore_build_selected_art(jsonb) from public, anon;
grant execute on function public.valid_webstore_build_selected_art(jsonb) to authenticated, service_role;

alter table public.webstore_build_requests
  add constraint webstore_build_requests_valid_selected_items
    check (public.valid_webstore_build_selected_items(selected_items)),
  add constraint webstore_build_requests_valid_selected_art
    check (public.valid_webstore_build_selected_art(selected_art)),
  add constraint webstore_build_requests_valid_start_from
    check (
      (
        start_from_type is null
        and start_from_id is null
        and start_from_url is null
      )
      or (
        start_from_type = 'blank'
        and start_from_id is null
        and start_from_url is null
      )
      or (
        start_from_type in ('template', 'store')
        and length(trim(coalesce(start_from_id, ''))) > 0
        and start_from_url is null
      )
      or (
        start_from_type = 'omg_url'
        and start_from_id is null
        and start_from_url ~ '^https://([A-Za-z0-9-]+[.])*itemorder[.]com/shop(/|$)'
      )
    );

alter table public.webstore_build_requests
  drop constraint webstore_build_requests_has_instructions,
  add constraint webstore_build_requests_has_instructions
  check (
    length(trim(request_text)) > 0
    or jsonb_array_length(attachment_urls) > 0
    or jsonb_array_length(coalesce(selected_items, '[]'::jsonb)) > 0
    or jsonb_array_length(coalesce(selected_art, '[]'::jsonb)) > 0
  );
