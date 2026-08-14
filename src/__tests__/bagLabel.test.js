/* 4×6 bag label builder (src/baggingstation/bagLabel.js). */

import { buildBagLabelHtml, bagScanCode, bagScanUrl } from '../baggingstation/bagLabel';

const order = { id: 'ord-123', bag_seq: 15, buyer_name: 'Parent Person' };
const items = [
  { id: 'i1', name: 'Squadra Jersey', color: 'Navy', size: 'YM', qty: 2, bagged_qty: 2, player_name: 'Jimmy Smith', player_number: '23' },
  { id: 'i2', name: 'Team <Hoodie> & Co', size: 'YS', qty: 1, bagged_qty: 0, short_qty: 1, short_status: 'open' },
];
const store = { name: 'Lakeville Soccer Club' };

test('label carries player, store, bag N of M, contents, and the scan QR', () => {
  const html = buildBagLabelHtml({ order, items, store, seqTotal: 42, origin: 'https://portal.test' });
  expect(html).not.toContain('class="num"'); // big jersey number dropped by request
  expect(html).toContain('Jimmy Smith'); // uppercase is CSS text-transform, not markup
  expect(html).toContain('Lakeville Soccer Club');
  expect(html).toContain('Bag 15 of 42');
  expect(html).toContain('2× Squadra Jersey');
  expect(html).toContain(encodeURIComponent(bagScanCode('ord-123')));
});

test('shorted line is flagged on the item and in the shorts box', () => {
  const html = buildBagLabelHtml({ order, items, store, seqTotal: 42, origin: '' });
  expect(html).toContain('⚠ SHORT');
  expect(html).toContain('PROBLEM SHELF — short, resolve before shipping');
  // escaping: raw markup from item names never lands in the HTML
  expect(html).not.toContain('<Hoodie>');
  expect(html).toContain('&lt;Hoodie&gt; &amp; Co');
});

test('backorder child order gets the BACKORDER banner; normal order does not', () => {
  const child = { ...order, backorder_of: 'parent-1', bag_seq: 1 };
  expect(buildBagLabelHtml({ order: child, items, store, origin: '' })).toContain('BACKORDER');
  expect(buildBagLabelHtml({ order, items, store, origin: '' })).not.toContain('BACKORDER —');
});

test('scan url shape', () => {
  expect(bagScanUrl('https://x.test', 'abc')).toBe('https://x.test/bagging-station?scan=WO-abc');
});

test('label carries order number, buyer (when distinct), and item color', () => {
  const o = { ...order, omg_order_number: '48213' };
  const html = buildBagLabelHtml({ order: o, items, store, origin: '' });
  expect(html).toContain('Order #48213');
  expect(html).toContain('Parent Person'); // buyer differs from player → shown
  expect(html).toContain('Navy'); // color when items carry it
});

test('order number falls back to short id; buyer hidden when same as player', () => {
  const o = { id: 'abcdef123456', buyer_name: 'Jimmy Smith' };
  const html = buildBagLabelHtml({ order: o, items: [items[0]], store, origin: '' });
  expect(html).toContain('Order #abcdef12');
  expect((html.match(/Jimmy Smith/g) || []).length).toBeGreaterThan(0);
  expect(html).not.toContain('· Jimmy Smith</div>'); // no duplicate buyer suffix
});

test('9+ item orders switch to the compact item list so everything fits', () => {
  const many = Array.from({ length: 10 }, (_, k) => ({ id: 'x' + k, name: 'Item ' + k, size: 'M', qty: 1, bagged_qty: 1 }));
  expect(buildBagLabelHtml({ order, items: many, store, origin: '' })).toContain('class="items compact"');
  expect(buildBagLabelHtml({ order, items: many.slice(0, 3), store, origin: '' })).toContain('class="items"');
});
