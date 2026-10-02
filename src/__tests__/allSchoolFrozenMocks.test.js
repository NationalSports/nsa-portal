import { buildProductionPacket, packetChanges, safeUrl } from '../productionPacket/model';
import { frozenPurchasedMocks } from '../productionPacket/frozenMockData';
import { packetImageUrls, packetPrintHtml } from '../productionPacket/print';

const fixture = (approved = true) => {
  const recipe = { version: 1, webstore_product_id: 'offering', color: 'Navy', image_url: 'https://example.com/bought-front.png', image_back_url: 'https://example.com/bought-back.png', takes_name: true, takes_number: true, mock_approval: { approved, approved_by: 'PRIVATE', approved_at: '2026-10-02T00:00:00Z' }, decorations: [{ art_id: 'art', side: 'front', placement: 'left_chest', art_url: 'https://example.com/old-logo.png', cw_by_color: { navy: { url: 'https://example.com/bought-logo.png' } } }, { kind: 'perso_name', side: 'back', x: 50, y: 25, w: 60 }], personalization_template: { font: 'Block', print_color: 'White', number_template: {font:'Athletic',print_color:'Red',width_in:6,height_in:8,placement:'full_back'}, production_file: { path: 'PRIVATE' }, supplier_id: 'PRIVATE' }, transfer_inventory: [{ code: 'Crest', artwork_version: 'v2', unit_cost: 'PRIVATE' }] };
  const line = { id: 'bought', order_id: 'order', sku: 'TEE', color: 'Navy', size: 'M', qty: 1, player_name: 'McKay <&>', player_number: 0, production_recipe: recipe };
  const item = { id: 'item', sku: 'TEE', color: 'Navy', sizes: { M: 1 }, recipe_snapshot: recipe, source_webstore_item_ids: ['bought'], decorations: [{ kind: 'art', art_file_id: 'art', position: 'Left chest' }] };
  const art = { id: 'art', status: 'approved', deco_type: 'dtf', art_size: '3x3', ink_colors: 'White', prod_files: [{ name: 'Source.ai', url: 'https://example.com/source.ai' }] };
  return { store: { id: 'school', org_type: 'all_school', name: 'School' }, orders: [{ id: 'order', so_id: 'SO-1', status: 'paid' }], lines: [line], salesOrders: [{ id: 'SO-1', webstore_id: 'school', items: [item], art_files: [art] }], catalog: [{ sku: 'TEE', image_url: 'https://example.com/current.png', decorations: [] }] };
};

test('frozen purchased names, number zero, colorway and artwork version reach printable packet without private recipe data', () => {
  const packet = buildProductionPacket(fixture());
  expect(packet.ready).toBe(true);
  expect(packet.garments[0].frozenMocks[0]).toMatchObject({ name: 'McKay <&>', number: '0', qty: 1, approved: true, artworkVersions: [{ code: 'Crest', version: 'v2' }] });
  expect(JSON.stringify(packet)).not.toContain('PRIVATE');
  const html = packetPrintHtml(packet);
  expect(html).toContain('McKay &lt;&amp;&gt;');
  expect(html).toContain('Print number:');
  expect(html).toContain('>0</span>');
  expect(html).toContain('Approved store setup');
  expect(html).toContain('Number: Athletic · Red · 6 × 8 in · full_back.');
  expect(html).not.toContain('PLAYER');
  expect(html).not.toContain('loading="lazy"');
  expect(packetImageUrls(packet)).toEqual(expect.arrayContaining(['https://example.com/bought-front.png', 'https://example.com/bought-back.png', 'https://example.com/bought-logo.png']));
});

test('mutable catalog and art mock changes cannot change frozen purchased preview', () => {
  const data = fixture(), before = buildProductionPacket(data).garments[0].frozenMocks;
  data.catalog[0].image_url = 'https://example.com/changed.png';
  data.salesOrders[0].art_files[0].web_logo_url = 'https://example.com/changed-logo.png';
  expect(buildProductionPacket(data).garments[0].frozenMocks).toEqual(before);
});

test('approval marker, exact linked recipe and source quantity are required for automatic mock readiness', () => {
  const data = fixture(false);
  expect(buildProductionPacket(data).issues.join(' ')).toContain('requires an approved production mock');
  data.lines[0].production_recipe = { ...data.lines[0].production_recipe, color: 'Red' };
  expect(frozenPurchasedMocks(data.salesOrders[0].items[0], data.lines, safeUrl)[0].approved).toBe(false);
  const quantity = fixture(); quantity.lines[0].qty = 2;
  expect(buildProductionPacket(quantity).ready).toBe(false);
});

test('later manually approved garment mock can resolve a pending purchased setup', () => {
  const data = fixture(false);
  data.salesOrders[0].art_files[0].item_mockups = {'TEE|Navy':[{ url: 'https://example.com/manual-approved.png' }]};
  const packet = buildProductionPacket(data);
  expect(packet.ready).toBe(true);
  expect(packetPrintHtml(packet)).toContain('manual-approved.png');
  expect(packetPrintHtml(packet)).not.toContain('Approved store setup');
});

test('unbatched drafts use bought imagery and changed bought spelling appears in revision diff', () => {
  const data = fixture(), before = buildProductionPacket(data);
  data.lines[0].player_name = 'McKAY';
  expect(packetChanges(before, buildProductionPacket(data)).join(' ')).toContain('frozenMocks');
  data.orders[0].so_id = null; data.salesOrders = [];
  const packet = buildProductionPacket(data);
  expect(packet.garments[0].frozenMocks[0].imageFront).toBe('https://example.com/bought-front.png');
  expect(packetPrintHtml(packet)).not.toContain('https://example.com/current.png');
  expect(packet.ready).toBe(false);
});
