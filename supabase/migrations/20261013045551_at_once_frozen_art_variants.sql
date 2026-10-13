-- Freeze new Club artwork recipes and keep different garment/design variants separate.
-- Existing orders without v2 recipes retain their existing conversion behavior.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.create_club_sales_order(uuid)'::regprocedure);
  if position($old0$player_name text, player_number text, collected numeric$old0$ in definition)=0 then raise exception 'Club artwork patch anchor 0 missing'; end if;
  definition := replace(definition,$old0$player_name text, player_number text, collected numeric$old0$,$new0$player_name text, player_number text, collected numeric, production_recipe jsonb$new0$);
  if position($old1$    end
    from webstore_order_items i
    left join _club_bundle_alloc$old1$ in definition)=0 then raise exception 'Club artwork patch anchor 1 missing'; end if;
  definition := replace(definition,$old1$    end
    from webstore_order_items i
    left join _club_bundle_alloc$old1$,$new1$    end, case when i.production_recipe->>'version'='2' then i.production_recipe end
    from webstore_order_items i
    left join _club_bundle_alloc$new1$);
  if position($old2$as k_sku,
               min(l.product_id)$old2$ in definition)=0 then raise exception 'Club artwork patch anchor 2 missing'; end if;
  definition := replace(definition,$old2$as k_sku,
               min(l.product_id)$old2$,$new2$as k_sku, l.production_recipe as k_recipe,
               min(l.product_id)$new2$);
  if position($old3$         group by 1, 2
      ) g$old3$ in definition)=0 then raise exception 'Club artwork patch anchor 3 missing'; end if;
  definition := replace(definition,$old3$         group by 1, 2
      ) g$old3$,$new3$         group by 1, 2, 3
      ) g$new3$);
  if position($old4$coalesce(l2.sku, '') = g.k_sku$old4$ in definition)=0 then raise exception 'Club artwork patch anchor 4 missing'; end if;
  definition := replace(definition,$old4$coalesce(l2.sku, '') = g.k_sku$old4$,$new4$coalesce(l2.sku, '') = g.k_sku and l2.production_recipe is not distinct from g.k_recipe$new4$);
  if position($old5$coalesce(l3.sku, '') = g.k_sku$old5$ in definition)=0 then raise exception 'Club artwork patch anchor 5 missing'; end if;
  definition := replace(definition,$old5$coalesce(l3.sku, '') = g.k_sku$old5$,$new5$coalesce(l3.sku, '') = g.k_sku and l3.production_recipe is not distinct from g.k_recipe$new5$);
  if position($old6$coalesce(l4.sku, '') = g.k_sku$old6$ in definition)=0 then raise exception 'Club artwork patch anchor 6 missing'; end if;
  definition := replace(definition,$old6$coalesce(l4.sku, '') = g.k_sku$old6$,$new6$coalesce(l4.sku, '') = g.k_sku and l4.production_recipe is not distinct from g.k_recipe$new6$);
  if position($old7$     order by id limit 1;

    -- Bundle-component$old7$ in definition)=0 then raise exception 'Club artwork patch anchor 7 missing'; end if;
  definition := replace(definition,$old7$     order by id limit 1;

    -- Bundle-component$old7$,$new7$     order by id limit 1;
    if v_grp.k_recipe is not null then
      select * into v_wp from jsonb_populate_record(null::webstore_products,
        coalesce(to_jsonb(v_wp),'{}') || v_grp.k_recipe || jsonb_build_object('id',v_grp.k_recipe->>'webstore_product_id'));
    end if;

    -- Bundle-component$new7$);
  if position($old8$     where coalesce(code, '') <> '';$old8$ in definition)=0 then raise exception 'Club artwork patch anchor 8 missing'; end if;
  definition := replace(definition,$old8$     where coalesce(code, '') <> '';$old8$,$new8$     where coalesce(code, '') <> '';
    if v_grp.k_recipe is not null then
      v_takes_num := coalesce((v_grp.k_recipe->>'takes_number')::boolean,false);
      v_takes_name := coalesce((v_grp.k_recipe->>'takes_name')::boolean,false);
      select array_agg(value) into v_xfer_codes from jsonb_array_elements_text(coalesce(v_grp.k_recipe->'transfer_codes','[]'));
    end if;$new8$);
  if position($old9$    v_di := 0;$old9$ in definition)=0 then raise exception 'Club artwork patch anchor 9 missing'; end if;
  definition := replace(definition,$old9$    v_di := 0;$old9$,$new9$    if v_grp.k_recipe is not null then
      update so_items set recipe_snapshot=v_grp.k_recipe,
        source_webstore_item_ids=(select array_agg(item_id order by item_id) from _club_lines where coalesce(product_id,'')=v_grp.k_pid and coalesce(sku,'')=v_grp.k_sku and production_recipe=v_grp.k_recipe)
      where id=v_item_id;
    end if;
    v_di := 0;$new9$);
  if position($old10$    loop
      v_position := case v_deco->>'placement'$old10$ in definition)=0 then raise exception 'Club artwork patch anchor 10 missing'; end if;
  definition := replace(definition,$old10$    loop
      v_position := case v_deco->>'placement'$old10$,$new10$    loop
      if v_grp.k_recipe is not null and nullif(v_deco->>'transfer_code','') is not null then continue; end if;
      v_position := case v_deco->>'placement'$new10$);
  if position($old11$v_deco_type := coalesce(nullif(v_art.deco_type, ''), 'screen_print');$old11$ in definition)=0 then raise exception 'Club artwork patch anchor 11 missing'; end if;
  definition := replace(definition,$old11$v_deco_type := coalesce(nullif(v_art.deco_type, ''), 'screen_print');$old11$,$new11$v_deco_type := coalesce(case when v_grp.k_recipe is not null then nullif(v_deco->>'type','') end, nullif(v_art.deco_type, ''), 'screen_print');$new11$);
  if position($old12$         where store_id = v_ord.store_id and code = v_xfer_code limit 1;$old12$ in definition)=0 then raise exception 'Club artwork patch anchor 12 missing'; end if;
  definition := replace(definition,$old12$         where store_id = v_ord.store_id and code = v_xfer_code limit 1;$old12$,$new12$         where store_id = v_ord.store_id and code = v_xfer_code limit 1;
        v_deco_type := 'heat_press'; v_position := 'Front'; v_deco := '{}'::jsonb;
        if v_grp.k_recipe is not null then
          select * into v_transfer from jsonb_populate_record(null::webstore_transfers,
            (select ti from jsonb_array_elements(v_grp.k_recipe->'transfer_inventory') ti where ti->>'code'=v_xfer_code));
          select d into v_deco from jsonb_array_elements(v_grp.k_recipe->'decorations') d where d->>'transfer_code'=v_xfer_code limit 1;
          v_deco_type := coalesce(v_transfer.decoration_type,'heat_press');
          v_position := coalesce(nullif(v_deco->>'placement',''),'full_front');
        end if;$new12$);
  if position($old13$v_item_id, v_di, 'art', 'Front', 'heat_press',$old13$ in definition)=0 then raise exception 'Club artwork patch anchor 13 missing'; end if;
  definition := replace(definition,$old13$v_item_id, v_di, 'art', 'Front', 'heat_press',$old13$,$new13$v_item_id, v_di, 'art', v_position, v_deco_type,$new13$);
  if position($old14$          'full_front', 'front', 'original', v_xfer_code$old14$ in definition)=0 then raise exception 'Club artwork patch anchor 14 missing'; end if;
  definition := replace(definition,$old14$          'full_front', 'front', 'original', v_xfer_code$old14$,$new14$          coalesce(v_deco->>'placement','full_front'), coalesce(v_deco->>'side','front'), coalesce(v_deco->>'color_label','original'), v_xfer_code$new14$);
  if position($old15$v_grp.units, 'heat_press', 'xfer:' || v_xfer_code,$old15$ in definition)=0 then raise exception 'Club artwork patch anchor 15 missing'; end if;
  definition := replace(definition,$old15$v_grp.units, 'heat_press', 'xfer:' || v_xfer_code,$old15$,$new15$v_grp.units, v_deco_type, 'xfer:' || v_xfer_code,$new15$);
  if position($old16$coalesce(v_transfer.label, v_xfer_code), 'Front', false);$old16$ in definition)=0 then raise exception 'Club artwork patch anchor 16 missing'; end if;
  definition := replace(definition,$old16$coalesce(v_transfer.label, v_xfer_code), 'Front', false);$old16$,$new16$coalesce(v_transfer.label, v_xfer_code), v_position, false);$new16$);
  if position($old17$          placement, side, color_label, transfer_code
$old17$ in definition)=0 then raise exception 'Club artwork patch anchor 17 missing'; end if;
  definition := replace(definition,$old17$          placement, side, color_label, transfer_code
$old17$,$new17$          placement, side, color_label, transfer_code, web_url
$new17$);
  if position($old18$coalesce(v_deco->>'color_label','original'), v_xfer_code
$old18$ in definition)=0 then raise exception 'Club artwork patch anchor 18 missing'; end if;
  definition := replace(definition,$old18$coalesce(v_deco->>'color_label','original'), v_xfer_code
$old18$,$new18$coalesce(v_deco->>'color_label','original'), v_xfer_code, nullif(v_deco->>'art_url','')
$new18$);
  if position($old19$    v_job_name := coalesce(v_job.logo_name$old19$ in definition)=0 then raise exception 'Club artwork patch anchor 19 missing'; end if;
  definition := replace(definition,$old19$    v_job_name := coalesce(v_job.logo_name$old19$,$new19$    if exists(select 1 from so_items where so_id=v_so_id and recipe_snapshot->>'version'='2') then
      v_job_key := v_job_key || '::' || md5(v_job.logo_ref);
    end if;
    v_job_name := coalesce(v_job.logo_name$new19$);
  execute definition;
end $migration$;
