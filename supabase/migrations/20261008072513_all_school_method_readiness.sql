-- All School only: stocked decorations do not need a second art approval.
-- Checkout freezes method_readiness after checking mockup + inventory / DST.
-- Keep the frozen mock readiness gate and physical allocation/release gates.
do $migration$
declare definition text; original text;
begin
 definition := pg_get_functiondef('public.create_all_school_sales_order(uuid)'::regprocedure);
 if position('all_school_method_readiness_v1' in definition)>0 then return; end if;
 if position($expected$and coalesce(v_art_entry->>'status', '') = 'approved'$expected$ in definition)=0
 or position($expected$(v_art_entry->>'prod_files_attached')::boolean is true$expected$ in definition)=0
 or position($expected$and nullif(ti->>'width_in','')::numeric>0 and nullif(ti->>'height_in','')::numeric>0
          and ti->'production_file'->>'path' is not null$expected$ in definition)=0 then
  raise exception 'Unexpected All School conversion definition; readiness patterns do not match';
 end if;
 original := definition;
 definition := replace(definition,
 $old$and coalesce(v_art_entry->>'status', '') = 'approved'$old$,
 $new$and (coalesce(v_art_entry->>'status', '') = 'approved' or v_art_entry->>'deco_type' = 'embroidery')$new$);
 -- The existing embroidery branch still requires DST; do not let the generic
 -- prod_files_attached flag bypass that requirement.
 definition := replace(definition,
 $old$(v_art_entry->>'prod_files_attached')::boolean is true$old$,
 $new$((v_art_entry->>'prod_files_attached')::boolean is true and v_art_entry->>'deco_type' <> 'embroidery')$new$);
 definition := replace(definition,
 $old$and nullif(ti->>'width_in','')::numeric>0 and nullif(ti->>'height_in','')::numeric>0
          and ti->'production_file'->>'path' is not null$old$,
 $new$and coalesce(ti->>'decoration_type','dtf') in ('dtf','heat_press','heat_transfer','twill','patch','chenille','embroidered_patch','woven_patch','sublimation_patch','screen_print_transfer')$new$);
 if definition = original then
  raise exception 'Unexpected All School conversion definition; review before applying method readiness';
 end if;
 if position('and nullif(ti->>''width_in'','''')::numeric>0' in definition)>0 then
  raise exception 'Transfer readiness replacement did not match';
 end if;
 definition := replace(definition, 'v_auto_art := v_art_entry is not null', E'-- all_school_method_readiness_v1\nv_auto_art := v_art_entry is not null');
 execute definition;
end $migration$;
