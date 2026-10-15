/** @jest-environment node */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const endpoint = fs.readFileSync(path.join(root, 'netlify/functions/webstore-convert-all-school.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014034000_atomic_team_to_all_school_conversion.sql'), 'utf8');
const conversionSql = migration.split('-- A checkout that read the team store')[0];
const admin = fs.readFileSync(path.join(root, 'src/Webstores.js'), 'utf8');
const checkout = fs.readFileSync(path.join(root, 'netlify/functions/webstore-checkout.js'), 'utf8');
const migrationDir = path.join(root, 'supabase/migrations');
const effectiveLogoMigration = fs.readdirSync(migrationDir).sort().map((file) => fs.readFileSync(path.join(migrationDir, file), 'utf8'))
  .filter((sql) => /create or replace function public\.create_webstore_logo_option/i.test(sql)).pop();
const schemaColumns = JSON.parse(fs.readFileSync(path.join(root, 'supabase/schema-columns.json'), 'utf8')).tables;
const adminHelpers = fs.readFileSync(path.join(root, 'src/allSchool/adminHelpers.js'), 'utf8');

test('conversion is admin-authenticated and delegates one atomic RPC', () => {
  expect(endpoint).toContain('verifyAdmin(event)');
  expect(endpoint).toContain("sb.rpc('convert_team_store_to_all_school'");
  expect(endpoint).not.toMatch(/from\(['"]webstore_products['"]\)\.update/);
});

test('atomic conversion rejects stale reviews and deactivates rather than deleting products', () => {
  expect(conversionSql).toMatch(/STALE_REVIEW/);
  expect(conversionSql).toMatch(/PENDING_ORDERS/);
  expect(conversionSql).toMatch(/set active = false/);
  expect(conversionSql).not.toMatch(/delete\s+from\s+public\.webstore_products/i);
  expect(conversionSql).toMatch(/org_type = 'all_school'/);
  expect(conversionSql).toMatch(/status = 'closed'/);
  expect(conversionSql).toMatch(/grant execute[\s\S]*to service_role/i);
  expect(conversionSql).not.toMatch(/grant execute[\s\S]*to authenticated/i);
});

test('conversion updates only production fields so logo-choice grouping survives', () => {
  expect(conversionSql).not.toMatch(/school_style_group_id\s*=/);
  expect(conversionSql).not.toMatch(/school_design_label\s*=/);
  expect(conversionSql).not.toMatch(/variant_group_id\s*=/);
});

test('team logo creation links source colors and inserts copies in one transaction', () => {
  expect(admin).toContain("supabase.rpc('create_webstore_logo_option'");
  expect(migration).toMatch(/function public\.create_webstore_logo_option/);
  expect(migration).toMatch(/update public\.webstore_products[\s\S]*insert into public\.webstore_products/);
});

test('effective logo-option function inserts only real webstore_products columns', () => {
  const insert = /insert into public\.webstore_products\s*\(([\s\S]*?)\)\s*values/i.exec(effectiveLogoMigration);
  expect(insert).toBeTruthy();
  const insertedColumns = insert[1].split(',').map((column) => column.trim()).filter(Boolean);
  const actualColumns = new Set(schemaColumns.webstore_products);
  expect(insertedColumns.filter((column) => !actualColumns.has(column))).toEqual([]);
  expect(insertedColumns).toContain('size_skus');
  expect(effectiveLogoMigration).not.toMatch(/\bsize_sku_overrides\b/);
  expect(adminHelpers).not.toMatch(/\bsize_sku_overrides\b/);
});

test('converted stores reject stale team checkouts at the database boundary', () => {
  expect(migration).toMatch(/guard_all_school_order_source/);
  expect(migration).toMatch(/for key share/);
  expect(migration).toMatch(/NSA_STORE_CONVERTED/);
  expect(migration).toMatch(/PENDING_ORDERS/);
  expect(checkout).toMatch(/NSA_STORE_CONVERTED[\s\S]*store_converted/);
});
