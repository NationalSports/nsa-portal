-- A fulfillment-model conversion changes the store and every affected offering
-- together. A stale review or failed child update must leave the timed team store
-- untouched.
create or replace function public.convert_team_store_to_all_school(
  p_store_id uuid,
  p_settings jsonb,
  p_actions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.webstores;
  v_action jsonb;
  v_product_id uuid;
  v_action_name text;
  v_catalog_count integer;
  v_action_count integer;
  v_hidden integer := 0;
  v_mapped integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'NSA_FORBIDDEN:service endpoint required' using errcode = '42501';
  end if;
  if p_store_id is null or jsonb_typeof(p_settings) <> 'object' or jsonb_typeof(p_actions) <> 'array' then
    raise exception 'NSA_BAD_INPUT:store, settings, and reviewed actions required' using errcode = '22023';
  end if;

  select * into v_store
    from public.webstores
   where id = p_store_id
   for update;
  if not found then raise exception 'NSA_NOT_FOUND:webstore' using errcode = 'P0002'; end if;
  if coalesce(v_store.org_type, 'team') <> 'team' or coalesce(v_store.is_template, false)
     or coalesce(v_store.source, '') = 'omg' or v_store.omg_sale_code is not null then
    raise exception 'NSA_BAD_STATE:only regular team stores can be converted' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.webstore_orders
     where store_id = p_store_id
       and so_id is null
       and coalesce(status, '') not in ('cancelled', 'refunded')
  ) then
    raise exception 'NSA_PENDING_ORDERS:batch existing team orders before conversion' using errcode = '22023';
  end if;

  perform 1 from public.webstore_products where store_id = p_store_id for update;
  perform 1 from public.webstore_transfers where store_id = p_store_id for update;
  perform 1
    from public.products blank
   where blank.id in (
     select product_id from public.webstore_products
      where store_id = p_store_id and product_id is not null
   )
   for share;

  select count(*) into v_catalog_count from public.webstore_products where store_id = p_store_id;
  select count(distinct value->>'id') into v_action_count from jsonb_array_elements(p_actions);
  if v_action_count <> v_catalog_count or jsonb_array_length(p_actions) <> v_catalog_count then
    raise exception 'NSA_STALE_REVIEW:catalog changed; review the conversion again' using errcode = '40001';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_actions) action
     where (action->>'id') is null
        or (action->>'action') not in ('keep_active', 'map_dtf', 'deactivate', 'keep_hidden')
        or jsonb_typeof(action->'expected_product') <> 'object'
        or not exists (
          select 1
            from public.webstore_products product
            left join public.products blank on blank.id = product.product_id
           where product.store_id = p_store_id
             and product.id = (action->>'id')::uuid
             and jsonb_build_object(
               'active', product.active is not false,
               'kind', product.kind,
               'product_id', product.product_id,
               'sku', product.sku,
               'image_url', product.image_url,
               'image_back_url', product.image_back_url,
               'decorations', coalesce(product.decorations, '[]'::jsonb),
               'transfer_codes', to_jsonb(coalesce(product.transfer_codes, '{}'::text[])),
               'transfer_code', product.transfer_code,
               'track_inventory', product.track_inventory is not false,
               'takes_name', product.takes_name is true,
               'takes_number', product.takes_number is true,
               'personalization_template', product.personalization_template,
               'num_transfer_sets', to_jsonb(coalesce(product.num_transfer_sets, '{}'::text[])),
               'num_transfer_size', product.num_transfer_size,
               'num_transfer_color', product.num_transfer_color,
               'school_style_group_id', product.school_style_group_id,
               'variant_group_id', product.variant_group_id,
               'school_design_label', product.school_design_label,
               'blank_color', blank.color,
               'inventory_source', blank.inventory_source
             ) = action->'expected_product'
        )
  ) then
    raise exception 'NSA_STALE_REVIEW:catalog or blank setup changed; review the conversion again' using errcode = '40001';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_actions) action
      cross join lateral jsonb_array_elements(coalesce(action->'expected_transfers', '[]'::jsonb)) expected
     where not exists (
       select 1 from public.webstore_transfers transfer
        where transfer.store_id = p_store_id
          and transfer.code = expected->>'code'
          and to_jsonb(transfer) @> expected
     )
  ) then
    raise exception 'NSA_STALE_REVIEW:decoration inventory changed; review the conversion again' using errcode = '40001';
  end if;

  for v_action in select value from jsonb_array_elements(p_actions)
  loop
    v_product_id := (v_action->>'id')::uuid;
    v_action_name := v_action->>'action';
    if v_action_name = 'deactivate' then
      update public.webstore_products
         set active = false, production_approved_at = null, production_approved_by = null
       where id = v_product_id and store_id = p_store_id;
      v_hidden := v_hidden + 1;
    elsif v_action_name = 'map_dtf' then
      if jsonb_typeof(v_action->'decorations') <> 'array' or jsonb_typeof(v_action->'transfer_codes') <> 'array' then
        raise exception 'NSA_BAD_INPUT:DTF mappings require decorations and transfer codes' using errcode = '22023';
      end if;
      update public.webstore_products
         set decorations = v_action->'decorations',
             transfer_codes = array(select jsonb_array_elements_text(v_action->'transfer_codes')),
             transfer_code = null,
             production_approved_at = null,
             production_approved_by = null
       where id = v_product_id and store_id = p_store_id;
      v_mapped := v_mapped + 1;
    end if;
  end loop;

  update public.webstore_products
     set production_approved_at = null, production_approved_by = null
   where store_id = p_store_id;

  update public.webstores
     set org_type = 'all_school',
         status = 'closed',
         close_at = null,
         delivery_mode = 'ship_home',
         number_unique = false,
         so_creation = 'daily',
         theme = 'showcase',
         all_school_settings = p_settings,
         updated_at = now()
   where id = p_store_id
   returning * into v_store;

  return jsonb_build_object(
    'ok', true,
    'store', to_jsonb(v_store),
    'products_reviewed', v_catalog_count,
    'products_hidden', v_hidden,
    'products_mapped_to_dtf', v_mapped
  );
end;
$$;

revoke all on function public.convert_team_store_to_all_school(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.convert_team_store_to_all_school(uuid, jsonb, jsonb)
  to service_role;

comment on function public.convert_team_store_to_all_school(uuid, jsonb, jsonb) is
  'Service-only atomic conversion of a fully reviewed regular team webstore into a closed All School store.';

-- A checkout that read the team store just before conversion must not insert a
-- legacy order after the conversion commits. The store-row lock alone cannot
-- serialize that stale request because checkout inserts do not update webstores.
create or replace function public.guard_all_school_order_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_org_type text;
begin
  select org_type into v_org_type
    from public.webstores
   where id = new.store_id
   for key share;
  if v_org_type = 'all_school' and coalesce(new.order_source, '') <> 'all_school' then
    raise exception 'NSA_STORE_CONVERTED:reload this store before ordering' using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_all_school_order_source on public.webstore_orders;
create trigger guard_all_school_order_source
before insert or update of order_source, store_id on public.webstore_orders
for each row execute function public.guard_all_school_order_source();

revoke all on function public.guard_all_school_order_source() from public, anon, authenticated;

-- Serialize every catalog mutation with the store conversion row lock. This
-- prevents an insert or edit from landing after the reviewed catalog snapshot.
create or replace function public.lock_webstore_for_catalog_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_store_id uuid;
begin
  v_store_id := case when tg_op = 'DELETE' then old.store_id else new.store_id end;
  perform 1 from public.webstores where id = v_store_id for key share;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists lock_webstore_for_catalog_write on public.webstore_products;
create trigger lock_webstore_for_catalog_write
before insert or update or delete on public.webstore_products
for each row execute function public.lock_webstore_for_catalog_write();

revoke all on function public.lock_webstore_for_catalog_write() from public, anon, authenticated;

-- Team and All School logo choices link the original colors and insert the new
-- design colors as one transaction. A failed insert must not leave the live
-- source listing relabeled or regrouped.
create or replace function public.create_webstore_logo_option(
  p_store_id uuid,
  p_source_ids uuid[],
  p_style_group_id uuid,
  p_current_label text,
  p_copies jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_copy_json jsonb;
  v_copy public.webstore_products;
  v_ids uuid[] := '{}';
  v_source_count integer;
begin
  if not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:active staff required' using errcode = '42501';
  end if;
  if p_store_id is null or p_style_group_id is null or coalesce(array_length(p_source_ids, 1), 0) = 0
     or jsonb_typeof(p_copies) <> 'array' or jsonb_array_length(p_copies) = 0 then
    raise exception 'NSA_BAD_INPUT:source colors and logo copies required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.webstores
     where id = p_store_id and coalesce(org_type, 'team') in ('team', 'all_school')
       and coalesce(source, '') <> 'omg' and omg_sale_code is null
     for key share
  ) then
    raise exception 'NSA_BAD_STATE:logo choices are not supported for this store' using errcode = '22023';
  end if;

  perform 1 from public.webstore_products
   where store_id = p_store_id and id = any(p_source_ids)
   for update;
  select count(*) into v_source_count
    from public.webstore_products
   where store_id = p_store_id and id = any(p_source_ids);
  if v_source_count <> array_length(p_source_ids, 1) then
    raise exception 'NSA_STALE_REVIEW:source colors changed' using errcode = '40001';
  end if;

  update public.webstore_products
     set school_style_group_id = p_style_group_id,
         school_design_label = left(btrim(p_current_label), 80)
   where store_id = p_store_id and id = any(p_source_ids);

  for v_copy_json in select value from jsonb_array_elements(p_copies)
  loop
    select * into v_copy from jsonb_populate_record(null::public.webstore_products, v_copy_json);
    v_copy.id := gen_random_uuid();
    v_copy.store_id := p_store_id;
    v_copy.school_style_group_id := p_style_group_id;
    insert into public.webstore_products (
      id, store_id, kind, product_id, sku, retail_price, fundraise_amount,
      image_url, image_back_url, takes_number, takes_name, name_upcharge,
      transfer_codes, transfer_code, num_transfer_sets, num_transfer_size,
      num_transfer_color, decorations, category, kit_name, required, options,
      display_name, sizes_offered, active, deco_upcharge, deco_cost_estimate,
      track_inventory, size_sku_overrides, variant_label, personalization_template,
      weight_oz, variant_group_id, school_style_group_id, school_design_label,
      school_program_ids, school_shared, school_template_id, sort_order
    ) values (
      v_copy.id, v_copy.store_id, v_copy.kind, v_copy.product_id, v_copy.sku,
      v_copy.retail_price, v_copy.fundraise_amount, v_copy.image_url,
      v_copy.image_back_url, v_copy.takes_number, v_copy.takes_name,
      v_copy.name_upcharge, v_copy.transfer_codes, v_copy.transfer_code,
      v_copy.num_transfer_sets, v_copy.num_transfer_size, v_copy.num_transfer_color,
      v_copy.decorations, v_copy.category, v_copy.kit_name, v_copy.required,
      v_copy.options, v_copy.display_name, v_copy.sizes_offered, v_copy.active,
      v_copy.deco_upcharge, v_copy.deco_cost_estimate, v_copy.track_inventory,
      v_copy.size_sku_overrides, v_copy.variant_label, v_copy.personalization_template,
      v_copy.weight_oz, v_copy.variant_group_id, v_copy.school_style_group_id,
      v_copy.school_design_label, v_copy.school_program_ids, v_copy.school_shared,
      v_copy.school_template_id, v_copy.sort_order
    );
    v_ids := array_append(v_ids, v_copy.id);
  end loop;

  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids));
end;
$$;

revoke all on function public.create_webstore_logo_option(uuid, uuid[], uuid, text, jsonb)
  from public, anon;
grant execute on function public.create_webstore_logo_option(uuid, uuid[], uuid, text, jsonb)
  to authenticated;

comment on function public.create_webstore_logo_option(uuid, uuid[], uuid, text, jsonb) is
  'Active-staff-only atomic source linkage and insertion for team and All School per-item logo choices.';
