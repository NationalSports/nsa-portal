/* Tests for netlify/functions/backorder-ready-sweep.js (backorder visibility +
 * decoration-team ready alerts). Two layers, autoRelease.test.js style:
 *   1. Pure: allocateReady (FIFO, never double-counts stock), alertRows
 *      (alerts only on coverage INCREASES past the last notified mark).
 *   2. runSweep against a scripted fake admin — stamps ready state, respects
 *      dashboard-only mode (no email configured), and re-alert semantics.
 */
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => null,
  verifyUser: async () => ({ ok: true, teamMemberId: 'tm-1' }),
}));

const sweep = require('../../netlify/functions/backorder-ready-sweep');
const { allocateReady, alertRows, buildDigestHtml, runSweep } = sweep;

describe('allocateReady (FIFO house-stock allocation)', () => {
  test('oldest need drinks first; stock is never double-counted within a (product,size)', () => {
    const needs = [
      { id: 2, product_id: 'p1', size: 'M', qty_needed: 4, created_at: '2026-08-02' },
      { id: 1, product_id: 'p1', size: 'M', qty_needed: 3, created_at: '2026-08-01' },
    ];
    const ready = allocateReady(needs, { 'p1|M': 5 });
    expect(ready.get(1)).toBe(3); // older order fully covered first
    expect(ready.get(2)).toBe(2); // remainder only — 5 total, never 7
  });
  test('coverage is capped at qty_needed and floors at 0 on no/negative stock', () => {
    const needs = [{ id: 1, product_id: 'p1', size: 'S', qty_needed: 2, created_at: '2026-08-01' }];
    expect(allocateReady(needs, { 'p1|S': 99 }).get(1)).toBe(2);
    expect(allocateReady(needs, {}).get(1)).toBe(0);
    expect(allocateReady(needs, { 'p1|S': -4 }).get(1)).toBe(0);
  });
  test('different sizes/products draw from independent pools', () => {
    const needs = [
      { id: 1, product_id: 'p1', size: 'S', qty_needed: 2, created_at: '2026-08-01' },
      { id: 2, product_id: 'p1', size: 'M', qty_needed: 2, created_at: '2026-08-01' },
    ];
    const ready = allocateReady(needs, { 'p1|S': 2, 'p1|M': 1 });
    expect(ready.get(1)).toBe(2);
    expect(ready.get(2)).toBe(1);
  });
});

describe('alertRows (alert only on increases past the notified mark)', () => {
  const needs = [
    { id: 1, notified_ready_qty: 0, qty_needed: 5 },
    { id: 2, notified_ready_qty: 3, qty_needed: 5 },
    { id: 3, notified_ready_qty: 2, qty_needed: 5 },
  ];
  test('new coverage alerts; unchanged/decreased coverage does not', () => {
    const ready = new Map([[1, 2], [2, 3], [3, 1]]);
    const rows = alertRows(needs, ready);
    expect(rows.map((r) => r.id)).toEqual([1]); // partial arrival alerts once
    expect(rows[0]._ready).toBe(2);
  });
  test('the remainder landing later re-alerts (high-water mark semantics)', () => {
    const ready = new Map([[2, 5]]);
    const rows = alertRows([needs[1]], ready);
    expect(rows.map((r) => r.id)).toEqual([2]);
  });
});

test('buildDigestHtml groups by SO and labels full vs partial coverage', () => {
  const html = buildDigestHtml([{
    so_id: 'SO-9001', store_name: 'Grande FC Club Store',
    rows: [
      { sku: 'PC61', size: 'M', qty_needed: 5, _ready: 5 },
      { sku: 'PC61', size: 'L', qty_needed: 4, _ready: 2 },
    ],
  }]);
  expect(html).toContain('SO-9001 — Grande FC Club Store');
  expect(html).toContain('ALL IN — ready to decorate');
  expect(html).toContain('partial — can start 2');
});

// ── runSweep against a scripted fake admin ───────────────────────────────────
function fakeAdmin(script) {
  const calls = [];
  const queues = {};
  Object.entries(script).forEach(([k, v]) => { queues[k] = [...v]; });
  const nextResult = (key, call) => {
    calls.push({ key, ...call });
    const q = queues[key];
    if (!q || !q.length) return { data: null, error: null };
    return q.length > 1 ? q.shift() : q[0];
  };
  return {
    calls,
    from(table) {
      const call = { table, op: 'select', filters: [], payload: null };
      const builder = {
        select() { call.op = 'select'; return builder; },
        update(payload) { call.op = 'update'; call.payload = payload; return builder; },
        eq(col, val) { call.filters.push(['eq', col, val]); return builder; },
        gt(col, val) { call.filters.push(['gt', col, val]); return builder; },
        lt(col, val) { call.filters.push(['lt', col, val]); return builder; },
        in(col, val) { call.filters.push(['in', col, val]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() { return Promise.resolve(nextResult(table + '.' + call.op, call)); },
        then(resolve, reject) { return Promise.resolve(nextResult(table + '.' + call.op, call)).then(resolve, reject); },
      };
      return builder;
    },
  };
}

const NEED = {
  id: 1, so_id: 'SO-9001', so_item_id: 11, product_id: 'p1', sku: 'PC61', size: 'M',
  qty_ordered: 5, qty_needed: 5, vendor: 'SanMar', po_id: null, skip_reason: null,
  created_at: '2026-08-01T00:00:00Z', ready_qty: 0, ready_at: null,
  notified_ready_qty: 0, ready_notified_at: null, expected_date: null,
};

test('runSweep stamps ready state and marks notified in dashboard-only mode (no email configured)', async () => {
  const admin = fakeAdmin({
    'teamshop_auto_po_needs.select': [{ data: [NEED], error: null }],
    'sales_orders.select': [{ data: [{ id: 'SO-9001', memo: 'Club — order #12', status: 'need_order', webstore_id: 'ws1' }], error: null }],
    'webstores.select': [{ data: [{ id: 'ws1', name: 'Grande FC' }], error: null }],
    'product_inventory.select': [{ data: [{ product_id: 'p1', size: 'M', quantity: 3 }], error: null }],
    'products.select': [{ data: [{ id: 'p1', sku: 'PC61', inventory_source: 'sanmar' }], error: null }],
    'inventory_unified.select': [{ data: [{ sku: 'PC61', size: 'M', source: 'sanmar', future_delivery_date: '2026-08-25' }], error: null }],
    'teamshop_auto_po_needs.update': [{ data: null, error: null }],
    'teamshop_settings.select': [{ data: { backorder_alert_email: null }, error: null }],
  });
  const s = await runSweep(admin, 'test');
  expect(s.ok).toBe(true);
  expect(s.open).toBe(1);
  expect(s.ready_rows).toBe(1);
  expect(s.alerted).toBe(1); // partial (3 of 5) still alerts
  expect(s.emailed).toBe(false);

  const updates = admin.calls.filter((c) => c.key === 'teamshop_auto_po_needs.update');
  // First stamp: ready_qty 3 + ready_at + expected date for the short remainder.
  expect(updates[0].payload).toMatchObject({ ready_qty: 3, expected_date: '2026-08-25' });
  expect(updates[0].payload.ready_at).toBeTruthy();
  // Dashboard-only mode: notified mark advances so the same partial doesn't re-alert.
  expect(updates[1].payload).toMatchObject({ notified_ready_qty: 3 });
});

test('runSweep skips needs on finished SOs and reports zero open', async () => {
  const admin = fakeAdmin({
    'teamshop_auto_po_needs.select': [{ data: [NEED], error: null }],
    'sales_orders.select': [{ data: [{ id: 'SO-9001', memo: '', status: 'complete', webstore_id: null }], error: null }],
  });
  const s = await runSweep(admin, 'test');
  expect(s.ok).toBe(true);
  expect(s.open).toBe(0);
});

describe('checkTransferLowStock (00238 — weekly-throttled, open stores only)', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key';
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '' }));
  });
  afterEach(() => { delete process.env.BREVO_API_KEY; delete global.fetch; });

  test('alerts the low open-store transfer; skips incoming, closed stores, and recently-notified rows', async () => {
    const admin = fakeAdmin({
      'webstore_transfers.select': [{ data: [
        { id: 1, store_id: 'ws1', code: 'LOGO', label: 'Crest', kind: 'design', on_hand: 2, incoming: 0, low_stock_notified_at: null },
        { id: 2, store_id: 'ws1', code: '4|M|White', kind: 'number', digit: 4, tsize: 'M', color: 'White', on_hand: 1, incoming: 5, low_stock_notified_at: null }, // supplier order in → skip
        { id: 3, store_id: 'ws2', code: 'X', kind: 'design', on_hand: 0, incoming: 0, low_stock_notified_at: null }, // closed store → skip
        { id: 4, store_id: 'ws1', code: 'Y', kind: 'design', on_hand: 3, incoming: 0, low_stock_notified_at: new Date().toISOString() }, // throttled → skip
      ], error: null }],
      'webstores.select': [{ data: [
        { id: 'ws1', name: 'Grande FC', status: 'open' },
        { id: 'ws2', name: 'Old Store', status: 'closed' },
      ], error: null }],
      'webstore_transfers.update': [{ data: null, error: null }],
    });
    const n = await sweep.checkTransferLowStock(admin, 'ops@nsa.com');
    expect(n).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to).toEqual([{ email: 'ops@nsa.com' }]);
    expect(body.htmlContent).toContain('Grande FC');
    expect(body.htmlContent).toContain('Crest');
    // Only the alerted row gets the throttle stamp.
    expect(admin.calls.filter((c) => c.key === 'webstore_transfers.update').length).toBe(1);
  });

  test('a failed email send stamps nothing (retries next pass)', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    const admin = fakeAdmin({
      'webstore_transfers.select': [{ data: [
        { id: 1, store_id: 'ws1', code: 'LOGO', kind: 'design', on_hand: 2, incoming: 0, low_stock_notified_at: null },
      ], error: null }],
      'webstores.select': [{ data: [{ id: 'ws1', name: 'Grande FC', status: 'open' }], error: null }],
    });
    const n = await sweep.checkTransferLowStock(admin, 'ops@nsa.com');
    expect(n).toBe(0);
    expect(admin.calls.filter((c) => c.key === 'webstore_transfers.update').length).toBe(0);
  });
});

test('runSweep degrades quietly when 00202/00236 are not applied', async () => {
  const admin = fakeAdmin({
    'teamshop_auto_po_needs.select': [{ data: null, error: { code: '42P01', message: 'relation "teamshop_auto_po_needs" does not exist' } }],
  });
  const s = await runSweep(admin, 'test');
  expect(s.ok).toBe(true);
  expect(s.enabled).toBe(false);
});
