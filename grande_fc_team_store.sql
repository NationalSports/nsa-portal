-- Grande FC — Team Store (demo / sales-meeting reference)
-- Mirrors the Crusaders Soccer Club team store: 1 customer + 1 webstore
-- + 13 storefront products (incl. a "Player Kit" bundle of 4 components).
--
-- Club: Grande Football Club ("Somos Grandes"), Casa Grande, AZ youth academy.
-- Colors: Purple / Gold / Black / White  (primary deep purple #22103F, accent athletic gold #C8960C).
-- Rep: Merc (rep id ...0022).
--
-- Idempotent: skips cleanly if a store with slug 'grande-fc' already exists.
-- Run in the Supabase SQL Editor (or via supabase db execute).

DO $$
DECLARE
  v_rep         text := '00000000-0000-0000-0000-000000000022';  -- Merc
  v_customer_id text := 'c' || (extract(epoch from now()) * 1000)::bigint::text;
  v_store_id    uuid := gen_random_uuid();
  -- bundle + the 4 components it references (need their ids for bundle items)
  p_kit    uuid := gen_random_uuid();
  p_home   uuid := gen_random_uuid();
  p_away   uuid := gen_random_uuid();
  p_shorts uuid := gen_random_uuid();
  p_socks  uuid := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM webstores WHERE slug = 'grande-fc') THEN
    RAISE NOTICE 'Store slug "grande-fc" already exists — skipping seed.';
    RETURN;
  END IF;

  -- 1. Customer -------------------------------------------------------------
  INSERT INTO customers (
    id, name, alpha_tag,
    billing_address_line1, billing_city, billing_state, billing_zip,
    shipping_city, shipping_state, shipping_zip,
    adidas_ua_tier, catalog_markup, payment_terms, tax_rate,
    primary_rep_id, is_active,
    alt_billing_addresses, art_files, pantone_colors, thread_colors,
    tax_exempt, notes, disable_cc_pay, school_colors, search_tags, allowed_brands,
    coach_ai_builder, coach_livelook, coach_build_orders, ad_spend_tracking, coach_roster
  ) VALUES (
    v_customer_id, 'Grande Football Club', 'GFC',
    '', 'Casa Grande', 'AZ', '85122',
    'Casa Grande', 'AZ', '85122',
    'A', 1.65, 'net30', 0.087,
    v_rep, true,
    '[]'::jsonb, '[]'::jsonb,
    '[{"hex":"#22103F","code":"2695"},{"hex":"#C8960C","code":"1245"},{"hex":"#000000","code":"Black"},{"hex":"#FFFFFF","code":"White"}]'::jsonb,
    '[{"name":"Purple"},{"name":"Gold"},{"name":"White"}]'::jsonb,
    false,
    'DEMO — Grande FC sales-meeting reference (grandefootballclub.com). Rep: Merc. Safe to delete after the meeting.',
    false,
    '["Purple","Gold","Black","White"]'::jsonb,
    '{}'::text[],
    '["Adidas"]'::jsonb,
    false, true, true, true, true
  );

  -- 2. Webstore -------------------------------------------------------------
  INSERT INTO webstores (
    id, slug, name, customer_id, rep_id,
    status, open_at, payment_mode, require_login,
    number_enabled, number_unique, number_min, number_max, so_creation,
    fundraise_enabled, fundraise_pct, fundraise_flat, fundraise_show_parents, fundraise_round,
    primary_color, accent_color, hero_blurb, theme,
    ship_home_enabled, deliver_club_enabled, delivery_mode,
    shipstation_carrier, label_weight_lbs, flat_shipping,
    source, is_template, created_via, org_type, store_art,
    size_upcharge_enabled, public_listed, decoration_mode, processing_pct
  ) VALUES (
    v_store_id, 'grande-fc', 'Grande FC — Team Store', v_customer_id, v_rep,
    'open', now(), 'unpaid', false,
    true, false, 0, 99, 'manual',
    true, 10, 0, true, true,
    '#22103F', '#C8960C',
    'Official Grande FC team store — Somos Grandes. Gear up in purple and gold.', 'classic',
    true, true, 'ship_home',
    'fedex', 1, 0,
    'webstore', false, 'staff', 'team', '[]'::jsonb,
    true, false, 'in_house', 5
  );

  -- 3. Bundle-component singles (active=false: sold only inside the Player Kit)
  INSERT INTO webstore_products (
    id, store_id, kind, display_name, retail_price, sort_order, active, fundraise_amount,
    takes_number, sizes_offered, category
  ) VALUES
    (p_home,   v_store_id, 'single', 'Grande FC Home Jersey — Purple', 48, 1, false, 0, true,  ARRAY['YS','YM','YL','S','M','L','XL','2XL']::text[], 'Uniform'),
    (p_away,   v_store_id, 'single', 'Grande FC Away Jersey — White',  48, 2, false, 0, true,  ARRAY['YS','YM','YL','S','M','L','XL','2XL']::text[], 'Uniform'),
    (p_shorts, v_store_id, 'single', 'Match Shorts — Black',           26, 3, false, 0, false, ARRAY['YS','YM','YL','S','M','L','XL','2XL']::text[], 'Uniform'),
    (p_socks,  v_store_id, 'single', 'Team Socks — Purple',            14, 4, false, 0, false, ARRAY['S','M','L']::text[],                          'Uniform');

  -- 4. Player Kit bundle ----------------------------------------------------
  INSERT INTO webstore_products (
    id, store_id, kind, display_name, retail_price, sort_order, active, fundraise_amount,
    category, card_style, track_inventory
  ) VALUES
    (p_kit, v_store_id, 'bundle', 'Player Kit', 136, 0, true, 40, 'Uniform', 'showcase', true);

  INSERT INTO webstore_bundle_items (
    bundle_id, webstore_product_id, qty, size_required, takes_number, sort_order
  ) VALUES
    (p_kit, p_home,   1, true, true,  0),
    (p_kit, p_away,   1, true, true,  1),
    (p_kit, p_shorts, 1, true, false, 2),
    (p_kit, p_socks,  1, true, false, 3);

  -- 5. Remaining active singles --------------------------------------------
  INSERT INTO webstore_products (
    store_id, kind, display_name, retail_price, sort_order, active, fundraise_amount,
    sizes_offered, category
  ) VALUES
    (v_store_id, 'single', 'Quarter-Zip Training Top', 52,  5, true, 8, ARRAY['YS','YM','YL','S','M','L','XL','2XL']::text[], 'Training'),
    (v_store_id, 'single', 'Training Pants',           46,  6, true, 9, ARRAY['YS','YM','YL','S','M','L','XL','2XL']::text[], 'Training'),
    (v_store_id, 'single', 'Club Hoodie — Purple',     58,  7, true, 7, ARRAY['YS','YM','YL','S','M','L','XL','2XL']::text[], 'Sideline'),
    (v_store_id, 'single', 'Club Joggers',             50,  8, true, 5, ARRAY['YS','YM','YL','S','M','L','XL','2XL']::text[], 'Sideline'),
    (v_store_id, 'single', 'Sideline Jacket',          85,  9, true, 10, ARRAY['S','M','L','XL','2XL']::text[],               'Sideline'),
    (v_store_id, 'single', 'Team Backpack',            45, 10, true, 5, ARRAY['OSFA']::text[],                                'Accessories'),
    (v_store_id, 'single', 'Grande FC Beanie',         20, 11, true, 5, ARRAY['OSFA']::text[],                                'Accessories'),
    (v_store_id, 'single', 'Stadium Water Bottle',     14, 12, true, 6, ARRAY['OSFA']::text[],                                'Accessories');

  RAISE NOTICE 'Created Grande FC store % (customer %)', v_store_id, v_customer_id;
END $$;
