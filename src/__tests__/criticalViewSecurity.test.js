/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260902123000_security_invoker_public_facades.sql'), 'utf8');

const CRITICAL_VIEWS = [
  'webstores_public',
  'inventory_unified',
  'webstore_product_eta',
  'webstore_storefront_products',
  'webstore_templates_public',
  'adidas_crawl_queue',
  'adidas_crawl_coverage',
];

test.each(CRITICAL_VIEWS)('%s is caller-scoped and unavailable to browser roles', (view) => {
  expect(MIGRATION).toMatch(new RegExp(`alter view public\\.${view} set \\(security_invoker = true\\)`, 'i'));
  expect(MIGRATION).toMatch(new RegExp(`revoke all on public\\.${view} from public, anon, authenticated`, 'i'));
  expect(MIGRATION).toMatch(new RegExp(`grant select on public\\.${view} to service_role`, 'i'));
});

test('browser code no longer queries critical views directly', () => {
  const files = [
    'src/App.js', 'src/Webstores.js', 'src/RosterOrders.js',
    'src/lib/publicTeamStores.js', 'src/lib/storeInventory.js',
    'src/storefront/AdidasInventory.js', 'src/storefront/BuildStore.js',
    'src/storefront/Storefront.js', 'src/storefront/TeamStores.js',
  ];
  const direct = /\.from\(['"](?:webstores_public|inventory_unified|webstore_templates_public|webstore_storefront_products|webstore_product_eta|adidas_crawl_queue|adidas_crawl_coverage)['"]\)/;
  files.forEach((file) => expect(fs.readFileSync(path.join(ROOT, file), 'utf8')).not.toMatch(direct));
});
