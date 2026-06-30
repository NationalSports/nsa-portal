-- Drop empty duplicate tables not used by the app
-- The app uses: so_items, so_item_decorations, so_art_files, so_jobs, so_item_pick_lines, so_item_po_lines
-- These duplicates were left behind from migration 00007 schema alignment

DROP TABLE IF EXISTS production_job_items CASCADE;
DROP TABLE IF EXISTS production_jobs CASCADE;
DROP TABLE IF EXISTS po_shipments CASCADE;
DROP TABLE IF EXISTS pick_lines CASCADE;
DROP TABLE IF EXISTS po_lines CASCADE;
DROP TABLE IF EXISTS sales_order_item_decorations CASCADE;
DROP TABLE IF EXISTS sales_order_art_files CASCADE;
DROP TABLE IF EXISTS sales_order_items CASCADE;
