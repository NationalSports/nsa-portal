-- Correct the logo-option copier shipped in 20261014034000. The catalog's
-- per-size SKU map is webstore_products.size_skus; the prior function named a
-- nonexistent alias, so PostgreSQL could not plan the INSERT.
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
      track_inventory, size_skus, variant_label, personalization_template,
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
      v_copy.size_skus, v_copy.variant_label, v_copy.personalization_template,
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
