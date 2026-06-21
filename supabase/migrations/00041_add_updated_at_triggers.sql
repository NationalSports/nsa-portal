-- Add missing updated_at triggers to actively used tables
DO $$
DECLARE
  tbl TEXT;
  tbl_list TEXT[] := ARRAY[
    'customers', 'vendors', 'products', 'estimates', 'sales_orders',
    'invoices', 'team_members', 'deco_vendors', 'deco_vendor_pricing',
    'omg_stores'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbl_list LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON %I', tbl, tbl);
      EXECUTE format(
        'CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;
