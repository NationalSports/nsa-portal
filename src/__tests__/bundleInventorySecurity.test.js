/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/20260902065000_service_scoped_bundle_component_inventory.sql'),
  'utf8',
);

describe('bundle checkout inventory RPC security', () => {
  test('is service-only and uses a fixed search path', () => {
    expect(SQL).toMatch(/security definer\s+set search_path = public/i);
    expect(SQL).toMatch(/revoke all[\s\S]*from anon/i);
    expect(SQL).toMatch(/revoke all[\s\S]*from authenticated/i);
    expect(SQL).toMatch(/grant execute[\s\S]*to service_role/i);
  });

  test('scopes every result to the requested store and normalized vendor SKU', () => {
    expect(SQL).toMatch(/where wp\.store_id = p_store_id/i);
    expect(SQL).toMatch(/regexp_replace\(upper\(ai\.sku\), '\[\^A-Z0-9\]'/i);
    expect(SQL).toMatch(/ai\.source = p\.inventory_source/i);
  });

  test('does not broaden the anonymous storefront view', () => {
    expect(SQL).not.toMatch(/create or replace view\s+webstore_storefront_products/i);
  });
});
