-- ═══ TEST DATA — split-job pricing (PR #1789) ═══
-- Creates a throwaway SO mirroring the SO-1393 shape: two black District garments
-- (24-pc hoodie line + 1-pc sweatpant line) sharing one 1-color front screen print.
-- Paste into the Supabase SQL editor and run; it prints the new SO id.
--
-- How to test (on the PR #1789 deploy preview):
--  1. Open the new SO — one auto job for 25 units appears under Production Jobs.
--     Line deco price shows the combined 24-35 tier: $3.40/pc ($85 total).
--  2. ✂️ Split → "Split by SKU" → select the DT6117 sweatpant.
--     Both jobs flag "$ Split-priced" and the deco price on BOTH lines jumps to the
--     blended per-run price: ($50 flat for the 1-pc run + 24 × $3.40) / 25 ≈ $5.26/pc,
--     $131.60 total.
--  3. On either job, click "$?" to request a combined-pricing override (any user),
--     then approve/deny it as admin/super_admin — approval drops both lines back
--     to $3.40/pc. "Merge Back" also restores combined pricing.
-- NOTE: apply migration 00233_split_job_pricing.sql first if you want the split
-- pricing to survive a reload — without it the flags are stripped on save (the
-- in-session behavior still demos correctly).

DO $$
DECLARE
  v_num  INT;
  v_so   TEXT;
  v_i24  INT;
  v_i1   INT;
BEGIN
  -- Next real SO number — a non-numeric id would get auto-renamed by the app,
  -- and this keeps the SO-id sequence intact.
  SELECT COALESCE(MAX((regexp_match(id, '^SO-(\d+)$'))[1]::INT), 1000) + 1
    INTO v_num FROM sales_orders;
  v_so := 'SO-' || v_num;

  INSERT INTO customers (id, name, alpha_tag, adidas_ua_tier, catalog_markup, tax_rate, is_active)
  VALUES ('CUST-TEST-SPLIT', 'ZZ TEST — Split Pricing (safe to delete)', 'ZZTEST', 'B', 1.65, 0, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO sales_orders (id, customer_id, memo, created_at, updated_at, shipping_type, shipping_value, default_markup)
  VALUES (v_so, 'CUST-TEST-SPLIT',
          'TEST — split-job pricing (mirrors SO-1393: 24+1 pcs, 1-color front print). Safe to delete.',
          now()::TEXT, now()::TEXT, 'flat', 0, 1.65);

  -- One 1-color screen-print design shared by both lines ("Navy" = 1 ink line).
  INSERT INTO so_art_files (id, so_id, name, deco_type, ink_colors, status)
  VALUES ('ART-TEST-SPLIT', v_so, 'Test Warrior Logo', 'screen_print', 'Navy', 'art_complete');

  INSERT INTO so_items (so_id, item_index, sku, name, brand, color, nsa_cost, unit_sell, sizes)
  VALUES (v_so, 0, 'DT6150', 'District V.I.T. Heavyweight Fleece Hoodie', 'District', 'Black',
          22, 36.25, '{"S":4,"M":11,"L":5,"XL":3,"2XL":1}')
  RETURNING id INTO v_i24;

  INSERT INTO so_items (so_id, item_index, sku, name, brand, color, nsa_cost, unit_sell, sizes)
  VALUES (v_so, 1, 'DT6117', 'District V.I.T. Fleece Open-Bottom Sweatpant', 'District', 'Black',
          20, 33, '{"2XL":1}')
  RETURNING id INTO v_i1;

  INSERT INTO so_item_decorations (so_item_id, deco_index, kind, position, art_file_id)
  VALUES (v_i24, 0, 'art', 'Front Center', 'ART-TEST-SPLIT'),
         (v_i1,  0, 'art', 'Front Center', 'ART-TEST-SPLIT');

  RAISE NOTICE 'Created % — open it in the portal (production job auto-generates on open).', v_so;
END $$;

-- ═══ Cleanup when done (uncomment and set the SO id the script printed) ═══
-- DELETE FROM sales_orders WHERE id = 'SO-XXXX';        -- cascades items/decos/art/jobs
-- DELETE FROM customers   WHERE id = 'CUST-TEST-SPLIT';
