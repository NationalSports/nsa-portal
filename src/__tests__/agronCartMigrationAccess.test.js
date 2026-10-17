import fs from 'fs';
import path from 'path';

const migration = fs.readFileSync(path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20261017224810_expose_agron_cart_catalog.sql',
), 'utf8');

test('Agron cart catalog migration preserves existing base-table privileges', () => {
  expect(migration).not.toMatch(/revoke\s+all\s+on\s+public\.agron_inventory\s+from\s+authenticated/i);
  expect(migration).not.toMatch(/revoke\s+all\s+on\s+public\.agron_products_staging\s+from\s+authenticated/i);
});

test('Agron cart catalog grants only its required columns on locked-down databases', () => {
  expect(migration).toMatch(/grant\s+select\s*\(\s*sku\s*,\s*size\s*,\s*upc\s*\)\s+on\s+public\.agron_inventory\s+to\s+authenticated/i);
  expect(migration).toMatch(/grant\s+select\s*\(\s*code\s*,\s*product_number\s*\)\s+on\s+public\.agron_products_staging\s+to\s+authenticated/i);
  expect(migration).toMatch(/with\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
  expect(migration).toMatch(/revoke\s+all\s+on\s+public\.agron_cart_catalog\s+from\s+anon/i);
});
