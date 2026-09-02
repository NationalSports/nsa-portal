-- Clone a webstore, its selected products, package components, and transfer
-- setup in one transaction. A failed child copy must never leave a partial
-- draft/template behind.

create or replace function public.clone_webstore_atomic(
  p_source_id uuid,
  p_clone_name text,
  p_slug text,
  p_as_template boolean default false,
  p_start_from_template boolean default false,
  p_rebrand boolean default false,
  p_item_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_template_path boolean := coalesce(p_as_template, false) or coalesce(p_start_from_template, false);
  v_source public.webstores;
  v_store public.webstores;
  v_product public.webstore_products;
  v_new_product public.webstore_products;
  v_bundle_item public.webstore_bundle_items;
  v_new_bundle_item public.webstore_bundle_items;
  v_transfer public.webstore_transfers;
  v_new_transfer public.webstore_transfers;
  v_payload jsonb;
  v_id_map jsonb := '{}'::jsonb;
  v_product_count integer := 0;
  v_bundle_item_count integer := 0;
  v_transfer_count integer := 0;
  v_new_bundle_id uuid;
  v_new_linked_product_id uuid;
begin
  v_role := coalesce(auth.role(), '');
  if v_role <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:active staff required' using errcode = '42501';
  end if;
  if p_source_id is null or nullif(btrim(p_clone_name), '') is null or nullif(btrim(p_slug), '') is null then
    raise exception 'NSA_BAD_INPUT:source, name, and slug required' using errcode = '22023';
  end if;

  select * into v_source
    from public.webstores
   where id = p_source_id
   for share;
  if not found then
    raise exception 'NSA_NOT_FOUND:webstore' using errcode = 'P0002';
  end if;

  v_payload := to_jsonb(v_source) || jsonb_build_object(
    'id', gen_random_uuid(),
    'name', btrim(p_clone_name),
    'slug', btrim(p_slug),
    'status', 'draft',
    'open_at', null,
    'close_at', null,
    'so_next_run_at', null,
    'is_template', coalesce(p_as_template, false),
    'featured_product_ids', null,
    'closed_notified_at', null,
    'created_at', now(),
    'updated_at', now(),
    'presentation_published_at', null,
    'presentation_published_by', null,
    'showcase_generation_batch_id', null,
    'showcase_review_notification_status', 'idle',
    'showcase_review_notified_at', null,
    'showcase_review_notified_to', null,
    'showcase_review_notification_error', null,
    'approval_status', 'approved',
    'approval_deadline', null,
    'approved_by', null,
    'approved_at', null,
    'rejected_reason', null
  );

  -- Templates and rebrand starts must not inherit the source organization's
  -- ownership/contact identity. The draft receives those values in Settings.
  if coalesce(p_rebrand, false) or coalesce(p_as_template, false) then
    v_payload := v_payload || jsonb_build_object(
      'customer_id', null,
      'rep_id', null,
      'csr_id', null,
      'logo_url', null,
      'coach_contact_name', null,
      'coach_contact_email', null,
      'coach_contact_phone', null,
      'director_name', null,
      'director_email', null,
      'director_phone', null
    );
  end if;
  if v_template_path then
    v_payload := v_payload || jsonb_build_object(
      'banner_url', null,
      'hero_blurb', null,
      'store_art', '[]'::jsonb
    );
  end if;

  select * into v_store from jsonb_populate_record(null::public.webstores, v_payload);
  insert into public.webstores select v_store.* returning * into v_store;

  for v_product in
    select p.*
      from public.webstore_products p
     where p.store_id = p_source_id
       and (p_item_ids is null or p.id = any(p_item_ids))
     order by p.sort_order, p.id
  loop
    v_payload := to_jsonb(v_product) || jsonb_build_object(
      'id', gen_random_uuid(),
      'store_id', v_store.id
    );
    if v_template_path then
      v_payload := v_payload || jsonb_build_object(
        'image_url', null,
        'image_back_url', null,
        'extra_image_urls', '[]'::jsonb,
        'decoration_id', null,
        'decorations', '[]'::jsonb,
        'transfer_codes', '[]'::jsonb,
        'num_transfer_sets', '[]'::jsonb
      );
    end if;
    select * into v_new_product from jsonb_populate_record(null::public.webstore_products, v_payload);
    insert into public.webstore_products select v_new_product.* returning * into v_new_product;
    v_id_map := v_id_map || jsonb_build_object(v_product.id::text, v_new_product.id::text);
    v_product_count := v_product_count + 1;
  end loop;

  for v_bundle_item in
    select bi.*
      from public.webstore_bundle_items bi
     where v_id_map ? bi.bundle_id::text
     order by bi.sort_order, bi.id
  loop
    v_new_bundle_id := (v_id_map ->> v_bundle_item.bundle_id::text)::uuid;
    v_new_linked_product_id := case
      when v_bundle_item.webstore_product_id is not null
       and v_id_map ? v_bundle_item.webstore_product_id::text
      then (v_id_map ->> v_bundle_item.webstore_product_id::text)::uuid
      else null
    end;
    v_payload := to_jsonb(v_bundle_item) || jsonb_build_object(
      'id', gen_random_uuid(),
      'bundle_id', v_new_bundle_id,
      'webstore_product_id', v_new_linked_product_id
    );
    if v_template_path then
      v_payload := v_payload || jsonb_build_object('decoration_id', null);
    end if;
    select * into v_new_bundle_item from jsonb_populate_record(null::public.webstore_bundle_items, v_payload);
    insert into public.webstore_bundle_items select v_new_bundle_item.*;
    v_bundle_item_count := v_bundle_item_count + 1;
  end loop;

  if not v_template_path then
    for v_transfer in
      select t.* from public.webstore_transfers t where t.store_id = p_source_id order by t.id
    loop
      v_payload := to_jsonb(v_transfer) || jsonb_build_object(
        'id', gen_random_uuid(),
        'store_id', v_store.id,
        'on_hand', 0,
        'on_order', 0,
        'incoming', 0,
        'incoming_eta', null,
        'created_at', now()
      );
      select * into v_new_transfer from jsonb_populate_record(null::public.webstore_transfers, v_payload);
      insert into public.webstore_transfers select v_new_transfer.*;
      v_transfer_count := v_transfer_count + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'store', to_jsonb(v_store),
    'products_copied', v_product_count,
    'bundle_items_copied', v_bundle_item_count,
    'transfers_copied', v_transfer_count
  );
end;
$$;

revoke all on function public.clone_webstore_atomic(uuid, text, text, boolean, boolean, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.clone_webstore_atomic(uuid, text, text, boolean, boolean, boolean, uuid[])
  to service_role;

comment on function public.clone_webstore_atomic(uuid, text, text, boolean, boolean, boolean, uuid[]) is
  'Active-staff-only atomic webstore/template clone. Copies selected products, remapped package components, and reset transfer setup without leaving partial stores.';
