-- Keep the reviewed v2 garment placement and Weblogo on the production decoration.
-- Legacy recipes retain their prior placement behavior.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.create_all_school_sales_order(uuid)'::regprocedure);
  if position($old0$        v_position := case when v_is_number then coalesce(nullif(v_recipe->'personalization_template'->>'placement',''),'Back') else 'Front' end;$old0$ in definition)=0 then raise exception 'All School variant placement anchor 0 missing'; end if;
  definition := replace(definition,$old0$        v_position := case when v_is_number then coalesce(nullif(v_recipe->'personalization_template'->>'placement',''),'Back') else 'Front' end;$old0$,$new0$        v_position := case when v_is_number then coalesce(nullif(v_recipe->'personalization_template'->>'placement',''),'Back') else 'Front' end;
        v_deco := '{}'::jsonb;
        if v_recipe->>'version'='2' and not v_is_number then
          select d into v_deco from jsonb_array_elements(coalesce(v_recipe->'decorations','[]')) d where d->>'transfer_code'=v_xfer_code limit 1;
          v_position := case v_deco->>'placement'
            when 'left_chest' then 'Left Chest' when 'full_back' then 'Back'
            when 'left_sleeve' then 'Left Sleeve' when 'right_sleeve' then 'Right Sleeve'
            else case when v_deco->>'side'='back' then 'Back' else 'Front' end end;
        end if;$new0$);
  if position($old1$          placement, side, color_label, transfer_code
$old1$ in definition)=0 then raise exception 'All School variant placement anchor 1 missing'; end if;
  definition := replace(definition,$old1$          placement, side, color_label, transfer_code
$old1$,$new1$          placement, side, color_label, transfer_code, web_url
$new1$);
  if position($old2$case when v_is_number then 'upper_back' else 'full_front' end,
          case when v_is_number then 'back' else 'front' end, 'original', v_xfer_code$old2$ in definition)=0 then raise exception 'All School variant placement anchor 2 missing'; end if;
  definition := replace(definition,$old2$case when v_is_number then 'upper_back' else 'full_front' end,
          case when v_is_number then 'back' else 'front' end, 'original', v_xfer_code$old2$,$new2$case when v_is_number then 'upper_back' else coalesce(v_deco->>'placement','full_front') end,
          case when v_is_number then 'back' else coalesce(v_deco->>'side','front') end, 'original', v_xfer_code, nullif(v_deco->>'art_url','')$new2$);
  execute definition;
end $migration$;
