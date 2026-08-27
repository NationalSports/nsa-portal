/* Portal Assistant confirmed-write helpers (businessLogic.js) + the brain's tool gating
 * (netlify/functions/portal-assistant.js). These are the single source of truth for the
 * assistant's line/PO/inventory mutations — both editors' listeners and App.js previews
 * run these exact functions, so this suite is the drift guard for that path. */
// Same mocking style as teamshopAssistant.test.js: the SDK is mocked out so requiring the
// netlify function never touches the network (and never hits jsdom's missing TextEncoder).
jest.mock('@anthropic-ai/sdk', () => function AnthropicMock() {
  return { messages: { create: jest.fn() } };
});
jest.mock('../../netlify/functions/_shared', () => ({ corsHeaders: () => ({}) }));
const bl = require('../businessLogic');
const fn = require('../../netlify/functions/portal-assistant.js');

const mkOrder = () => ({
  id: 'SO-1001', default_markup: 1.65,
  items: [
    { sku: 'JY6033', name: 'adidas Pregame LS Tee', color: 'Navy', nsa_cost: 10, unit_sell: 16.5, sizes: { M: 6, L: 6, XL: 4 }, available_sizes: ['M', 'L', 'XL'],
      po_lines: [{ po_id: 'PO 57204', M: 6, L: 6, XL: 4, received: {}, billed: {}, status: 'waiting' }] },
    { sku: 'IQ2728', name: 'adidas Polo', color: 'Black', nsa_cost: 20, unit_sell: 33, sizes: { L: 2 }, available_sizes: ['L'], po_lines: [] },
    { sku: 'CUSTQ', name: 'Custom qty line', color: '', nsa_cost: 5, unit_sell: 10, sizes: {}, est_qty: 12, available_sizes: [] },
  ],
  jobs: [{ id: 'JOB-9', _released: true, items: [{ item_idx: 1 }, { item_idx: 2 }] }],
  deco_pos: [{ item_idxs: [1, 2] }],
});

describe('assistantFindLine', () => {
  const o = mkOrder();
  test('exact SKU, word match, ambiguity, miss', () => {
    expect(bl.assistantFindLine(o, 'jy6033').idx).toBe(0);
    expect(bl.assistantFindLine(o, 'black polo').idx).toBe(1);
    expect(bl.assistantFindLine(o, 'adidas').error).toBe('ambiguous');
    expect(bl.assistantFindLine(o, 'zzz-nope').error).toBe('not_found');
  });
});

describe('assistantLineEdit', () => {
  test('sets a size without mutating the input order', () => {
    const o = mkOrder();
    const r = bl.assistantLineEdit(o, 1, { sizes: { L: 5 } }, { by: 'T' });
    expect(r.error).toBeUndefined();
    expect(r.next.items[1].sizes.L).toBe(5);
    expect(o.items[1].sizes.L).toBe(2);
  });
  test('remove_sizes cuts open PO units and notes the PO (planSizeCut path)', () => {
    const r = bl.assistantLineEdit(mkOrder(), 0, { remove_sizes: ['XL'] }, { by: 'T' });
    expect(r.error).toBeUndefined();
    expect(r.next.items[0].sizes.XL).toBe(0);
    expect(r.next.items[0].po_lines[0].XL).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/PO 57204/);
  });
  test('refuses cuts below pulled units and into received units', () => {
    const pulled = mkOrder();
    pulled.items[0].pick_lines = [{ status: 'pulled', XL: 4 }];
    expect(bl.assistantLineEdit(pulled, 0, { sizes: { XL: 0 } }, {}).error).toMatch(/pulled/);
    const rec = mkOrder();
    rec.items[0].po_lines[0].received = { XL: 4 };
    expect(bl.assistantLineEdit(rec, 0, { sizes: { XL: 0 } }, {}).error).toMatch(/editor/);
  });
  test('margin sets sell = cost/(1-m); sell edit rescales _sizeSells', () => {
    expect(bl.assistantLineEdit(mkOrder(), 1, { margin_pct: 40 }, {}).next.items[1].unit_sell).toBe(33.33);
    const o = mkOrder();
    o.items[1]._sizeCosts = { L: 20 }; o.items[1]._sizeSells = { L: 33 };
    const r = bl.assistantLineEdit(o, 1, { unit_sell: 40 }, {});
    expect(r.next.items[1].unit_sell).toBe(40);
    expect(r.next.items[1]._sizeSells.L).toBe(40);
  });
  test('bare qty only for est_qty lines, and flags qty_only so the editor shows it', () => {
    const r = bl.assistantLineEdit(mkOrder(), 2, { qty: 20 }, {});
    expect(r.next.items[2].est_qty).toBe(20);
    expect(r.next.items[2].qty_only).toBe(true);
    expect(bl.assistantLineEdit(mkOrder(), 0, { qty: 20 }, {}).error).toMatch(/per-size/);
  });
  test('size keys normalize onto the real buckets — "xl"/"large" edit XL/L, no phantom size', () => {
    const r = bl.assistantLineEdit(mkOrder(), 0, { sizes: { xl: 2, large: 3 } }, {});
    expect(r.error).toBeUndefined();
    expect(r.next.items[0].sizes.XL).toBe(2);
    expect(r.next.items[0].sizes.L).toBe(3);
    expect(r.next.items[0].sizes.xl).toBeUndefined();
    expect(r.next.items[0].available_sizes).toEqual(['M', 'L', 'XL']);
    // remove_sizes normalizes too: "take off the xl" zeroes XL, not a no-op
    const r2 = bl.assistantLineEdit(mkOrder(), 0, { remove_sizes: ['xl'] }, {});
    expect(r2.next.items[0].sizes.XL).toBe(0);
  });
});

describe('assistantRemoveLine guard + apply (rmI parity)', () => {
  test('SO line with a PO refuses; frozen jobs surface as warning', () => {
    const o = mkOrder();
    expect(bl.assistantRemoveLineGuard(o, 0, true).error).toMatch(/PO/);
    expect(bl.assistantRemoveLineGuard(o, 1, true).frozenJobIds).toEqual(['JOB-9']);
  });
  test('apply drops the line, remaps job/deco idxs, stamps the tombstone', () => {
    const next = bl.assistantRemoveLineApply(mkOrder(), 1, 'IQ2728|Black');
    expect(next.items.map((i) => i.sku)).toEqual(['JY6033', 'CUSTQ']);
    expect(next._deletedItemKeys).toEqual(['IQ2728|Black']);
    expect(next.jobs[0].items).toEqual([{ item_idx: 1 }]);
    expect(next.deco_pos[0].item_idxs).toEqual([1]);
  });
});

describe('assistant PO line removal', () => {
  test('whole-line removal returns sizes to open and stamps _deletedPoIds when the PO is gone', () => {
    const o = mkOrder();
    const m = bl.assistantFindPoLine(o, { poRef: '57204', sku: 'JY6033' });
    expect(m).toHaveLength(1);
    const r = bl.assistantRemovePoLine(o, { itemIdx: m[0].itemIdx, plIdx: m[0].plIdx, size: null });
    expect(r.error).toBeUndefined();
    expect(r.next.items[0].po_lines).toHaveLength(0);
    expect(r.next._deletedPoIds).toEqual(['PO 57204']);
  });
  test('size-level removal cancels open units (no tombstone); received units refuse', () => {
    const o = mkOrder();
    const m = bl.assistantFindPoLine(o, { sku: 'JY6033' });
    const r = bl.assistantRemovePoLine(o, { itemIdx: m[0].itemIdx, plIdx: m[0].plIdx, size: 'XL' });
    expect(r.next.items[0].po_lines[0].cancelled.XL).toBe(4);
    expect(r.next._deletedPoIds).toBeUndefined();
    const rec = mkOrder();
    rec.items[0].po_lines[0].received = { M: 2 };
    const m2 = bl.assistantFindPoLine(rec, { sku: 'JY6033' });
    expect(bl.assistantRemovePoLine(rec, { itemIdx: m2[0].itemIdx, plIdx: m2[0].plIdx, size: null }).error).toMatch(/received|billed/);
  });
});

describe('portal-assistant brain: prompt + tool gating', () => {
  const catalogs = { screen: { id: 'orders', title: 'Sales Orders' }, screens: [], tours: [], targets: [], openRecord: { type: 'sales_order', id: 'SO-1001', customer: 'FPU' }, isAdmin: false };
  test('READ-ONLY rule is gone; writes are confirm-gated; role-aware inventory line', () => {
    const p = fn.buildSystemPrompt(catalogs);
    expect(p).not.toMatch(/READ-ONLY/);
    expect(p).toMatch(/confirmation card/);
    expect(p).toMatch(/ADMIN-ONLY/);
    expect(fn.buildSystemPrompt({ ...catalogs, isAdmin: true })).toMatch(/adjust_inventory/);
  });
  test('adjust_inventory is offered to admins only; write tools present for everyone', () => {
    const names = (isAdmin) => fn.buildTools({ tours: [], targets: [], screens: [], isAdmin }).map((t) => t.name);
    expect(names(true)).toContain('adjust_inventory');
    expect(names(false)).not.toContain('adjust_inventory');
    ['add_line', 'update_line', 'remove_line', 'po_remove_line'].forEach((t) => expect(names(false)).toContain(t));
  });
});
