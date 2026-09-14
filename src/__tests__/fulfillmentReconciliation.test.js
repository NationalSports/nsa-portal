// Tests for the blocked-fulfillment reconciliation (src/lib/soPlayerReport.js).
//
// A blocked Silver Screen file used to surface only as a toast — "SO-2021: 43 active
// customer units do not match 42 Silver Screen job units" — which names the
// disagreement but not where it is, leaving the rep to hand-count two lists to find
// one stray unit. These pin the match-up that replaces that hunt, and (most
// importantly) that adding it did NOT change which files block.

jest.mock('xlsx', () => {
  const actual = jest.requireActual('xlsx');
  return { ...actual, writeFile: jest.fn() };
});

const XLSX = require('xlsx');
const {
  buildFulfillmentMatchup, buildVerifyDetail, downloadSoPlayerReport,
} = require('../lib/soPlayerReport');

describe('buildFulfillmentMatchup', () => {
  // The SO-2021 shape: customers hold one unit more than the sales order carries.
  // The total alone ("43 vs 42") is what the rep already had; the point of the
  // match-up is that it names the row and who to open.
  test('isolates the single differing row and names where to look', () => {
    const orderById = {
      o1: { id: 'o1', order_number: 1010471 },
      o2: { id: 'o2', order_number: 1010472 },
    };
    const lines = [
      { order_id: 'o1', sku: 'GL9698', name: 'Tee', color: 'Black', size: 'M', qty: 2, player_name: 'A. Garcia' },
      { order_id: 'o2', sku: 'GL9698', name: 'Tee', color: 'Black', size: 'M', qty: 1, player_name: 'B. Smith' },
      { order_id: 'o1', sku: 'GL9698', name: 'Tee', color: 'Black', size: 'L', qty: 1, player_name: 'A. Garcia' },
    ];
    const soItems = [{ sku: 'GL9698', name: 'Tee', color: 'Black', sizes: { M: 2, L: 1 } }];

    const m = buildFulfillmentMatchup({ lines, soItems, orderById });
    expect(m.customerUnits).toBe(4);
    expect(m.soUnits).toBe(3);
    // Exactly one row disagrees, and it sorts first.
    expect(m.diffRows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ sku: 'GL9698', size: 'M', customerUnits: 3, soUnits: 2, delta: 1 });
    // The route to the fix: which store order and player to open.
    expect(m.rows[0].who).toEqual(['1010471 · A. Garcia', '1010472 · B. Smith']);
    // The agreeing row is still listed, so the rep can confirm the rest is clean.
    expect(m.rows[1]).toMatchObject({ size: 'L', customerUnits: 1, soUnits: 1, delta: 0 });
  });

  // Order extras are synthesised from the SO's own residual, so counting them as
  // customer demand makes the table agree with itself by construction — and hides
  // that those units have nobody's name on them.
  test('counts unassigned order extras apart from real customer demand', () => {
    const orderById = {
      o1: { id: 'o1', order_number: 1010471 },
      x: { id: 'x', order_number: 'SO-2 ORDER EXTRA', _orderExtra: true },
    };
    const lines = [
      { order_id: 'o1', sku: 'A', name: 'A', color: 'Red', size: 'M', qty: 3, player_name: 'P' },
      { order_id: 'x', sku: 'A', name: 'A', color: 'Red', size: 'M', qty: 2, player_name: 'Order Extra / Unassigned', _orderExtra: true },
    ];
    const soItems = [{ sku: 'A', name: 'A', color: 'Red', sizes: { M: 5 } }];
    const m = buildFulfillmentMatchup({ lines, soItems, orderById });
    expect(m.customerUnits).toBe(3); // not 5 — only three units have a player
    expect(m.extraUnits).toBe(2);
    expect(m.reportUnits).toBe(5);
    expect(m.soUnits).toBe(5);
    expect(m.diffRows).toEqual([]); // the file itself balances
    expect(m.rows[0]).toMatchObject({ customerUnits: 3, extraUnits: 2, reportUnits: 5, delta: 0 });
  });

  test('reports full agreement so a stale Silver Screen job is isolated as the cause', () => {
    const orderById = { o1: { id: 'o1', order_number: 7 } };
    const lines = [{ order_id: 'o1', sku: 'A', name: 'A', color: 'Red', size: 'S', qty: 3, player_name: 'P' }];
    const soItems = [{ sku: 'A', name: 'A', color: 'Red', sizes: { S: 3 } }];
    const m = buildFulfillmentMatchup({ lines, soItems, orderById });
    expect(m.diffRows).toEqual([]);
    expect(m.customerUnits).toBe(3);
    expect(m.soUnits).toBe(3);
  });

  test('ignores the SO size map\'s non-size bookkeeping keys', () => {
    const soItems = [{ sku: 'A', name: 'A', color: 'Red', sizes: { S: 2, drop_ship: 9, unit_cost: 12.5, _note: 4 } }];
    expect(buildFulfillmentMatchup({ lines: [], soItems }).soUnits).toBe(2);
  });

  test('matches a customer line to its SO row through color spacing differences', () => {
    // reportItemKey normalises "Black / White" and "Black/White" to one row; if the
    // match-up used a different key it would invent a phantom +/- pair here.
    const lines = [{ order_id: 'o1', sku: 'A', name: 'A', color: 'Black / White', size: 'M', qty: 2 }];
    const soItems = [{ sku: 'A', name: 'A', color: 'Black/White', sizes: { M: 2 } }];
    const m = buildFulfillmentMatchup({ lines, soItems, orderById: { o1: { id: 'o1', order_number: 1 } } });
    expect(m.rows).toHaveLength(1);
    expect(m.diffRows).toEqual([]);
  });
});

describe('buildVerifyDetail', () => {
  test('turns an order number into the player, item and what was swapped', () => {
    const orderById = { o1: { id: 'o1', order_number: 1010471 } };
    const lines = [
      { order_id: 'o1', _sku: 'NEW1', _name: 'New Tee', _color: 'Black', _size: 'L', size: 'M', qty: 1, player_name: 'A. Garcia', _wasSku: 'OLD1', _wasSize: 'M', _verify: true },
      { order_id: 'o1', _sku: 'FINE', _name: 'Fine', _size: 'S', qty: 1, player_name: 'B. Smith' },
      { order_id: 'o1', sku: 'GHOST', name: 'Ghost', size: 'S', qty: 1, player_name: 'C. Jones', _unmatched: true },
    ];
    const detail = buildVerifyDetail({ lines, orderById });
    expect(detail).toHaveLength(2); // the clean line is not listed
    expect(detail[0]).toMatchObject({
      order: '1010471', player: 'A. Garcia', sku: 'NEW1', size: 'L',
      wasSku: 'OLD1', wasSize: 'M', unmatched: false,
    });
    expect(detail[1]).toMatchObject({ order: '1010471', player: 'C. Jones', sku: 'GHOST', unmatched: true });
  });

  test('collapses identical flagged lines instead of repeating one swap per unit', () => {
    const orderById = { o1: { id: 'o1', order_number: 5 } };
    const one = { order_id: 'o1', _sku: 'N', _name: 'N', _size: 'M', qty: 1, player_name: 'P', _wasSku: 'O', _verify: true };
    expect(buildVerifyDetail({ lines: [one, { ...one }], orderById })).toHaveLength(1);
  });
});

// ── End-to-end: the blocked path a rep actually hits ─────────────────────────
const ORDERS = [
  { id: 'o-club', order_number: 1010525, created_at: '2026-08-01T12:00:00Z', buyer_name: 'Berenice Garcia', ship_method: 'deliver_club', ship_address: null },
  { id: 'o-home', order_number: 99, created_at: '2026-07-30T09:00:00Z', buyer_name: 'Stacy Tyler', ship_method: 'ship_home', ship_address: { name: 'Stacy Tyler', street1: '12 Oak St', city: 'Reno', state: 'NV', zip: '89502', country: 'US' } },
];
const LINES = [
  { order_id: 'o-club', sku: '1203.005', name: 'Girls Racerback Tank', color: 'White', size: 'S', qty: 1, player_name: 'Abbie Garcia', player_number: 7 },
  { order_id: 'o-home', sku: 'AT310-50', name: 'Adidas Techfit VB Shorts W', color: 'Black', size: '2XS', qty: 2, player_name: 'Alex Spitzer' },
];
const SO_ITEMS = [
  { sku: 'AT310-50', name: 'Adidas Techfit VB Shorts W', color: 'Black', sizes: { '2XS': 2 } },
  { sku: '1203.005', name: 'Girls Racerback Tank', color: 'White', sizes: { S: 1 } },
];

function supabaseStub(tableOverrides = {}) {
  const tables = {
    webstores: [{ id: 'ws-1', name: 'St. Francis Tennis', omg_sale_code: 'V7ESK', customer_id: 'c-1', delivery_mode: 'deliver_club', shipstation_carrier: 'ups' }],
    webstore_orders: ORDERS.map((o) => ({ ...o, store_id: 'ws-1', so_id: 'SO-2035', status: 'paid' })),
    webstore_order_items: LINES,
    adidas_ss_sku_xref: [],
    customers: [{ id: 'c-1', name: 'St. Francis', shipping_attention: 'Athletics', shipping_address_line1: '5900 College Rd', shipping_city: 'Reno', shipping_state: 'NV', shipping_zip: '89503' }],
    ...tableOverrides,
  };
  return {
    from: (t) => {
      const q = {
        _rows: tables[t] || [],
        select() { return q; },
        eq(col, val) { q._rows = q._rows.filter((r) => r[col] === val); return q; },
        in(col, vals) { q._rows = q._rows.filter((r) => vals.includes(r[col])); return q; },
        maybeSingle() { return Promise.resolve({ data: q._rows[0] || null, error: null }); },
        then(res) { return Promise.resolve({ data: q._rows, error: null }).then(res); },
      };
      return q;
    },
  };
}

describe('blocked Silver Screen download', () => {
  let html; let toasts;
  beforeEach(() => {
    html = ''; toasts = [];
    XLSX.writeFile.mockClear();
    jest.spyOn(window, 'open').mockReturnValue({
      document: { write: (v) => { html += v; }, close: () => {} }, focus: () => {},
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const run = (soOverrides = {}) => downloadSoPlayerReport({
    so: { id: 'SO-2035', webstore_id: 'ws-1', memo: '', ...soOverrides },
    soItems: SO_ITEMS, supabase: supabaseStub(), nf: (m, kind) => toasts.push([m, kind]),
    format: 'product', customer: null,
  });

  // 3 customer units against a job submitted for 9 — the shape of the SO-2021 report.
  const STALE_JOB = { deco_pos: [{ vendor: 'Silver Screen', qty: 9, _silverscreen_job_id: 58505 }] };

  test('still blocks, and writes no workbook', async () => {
    expect(await run(STALE_JOB)).toBe(false);
    expect(XLSX.writeFile).not.toHaveBeenCalled();
  });

  test('opens a reconciliation naming the issue, the counts and the differing rows', async () => {
    await run(STALE_JOB);
    expect(window.open).toHaveBeenCalled();
    expect(html).toContain('Silver Screen file blocked — reconciliation');
    // Every issue, in full — not the first five of them truncated into a toast.
    expect(html).toContain('3 active customer units do not match 9 Silver Screen job units');
    // The three counts, so the rep can see WHICH pair disagrees.
    expect(html).toContain('Customer units');
    expect(html).toContain('Sales order units');
    expect(html).toContain('Silver Screen job');
    // Customers and the SO agree here (3 = 3), so the job is named as the stale side.
    expect(html).toContain('every row agrees');
    // The guidance names the job itself when the deco PO carries its id.
    expect(html).toMatch(/job #58505 was submitted for 9/);
    expect(html).toContain('How to match them up');
  });

  test('points the rep at the reconciliation instead of a truncated issue list', async () => {
    await run(STALE_JOB);
    expect(toasts).toHaveLength(1);
    const [message, kind] = toasts[0];
    expect(kind).toBe('error');
    expect(message).toMatch(/Silver Screen file blocked: 1 issue/);
    expect(message).toMatch(/reconciliation/);
  });

  test('falls back to the issue text when pop-ups are blocked', async () => {
    window.open.mockReturnValue(null);
    expect(await run(STALE_JOB)).toBe(false);
    expect(toasts[0][0]).toContain('3 active customer units do not match 9');
    expect(toasts[0][0]).toMatch(/Allow pop-ups/);
  });

  test('a clean order still downloads — the block set did not widen', async () => {
    expect(await run()).toBe(true);
    expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
    expect(window.open).not.toHaveBeenCalled();
  });

  // The other direction, and the one real gap between the up-front issue check and
  // the builder's own internal check: with no rows to export there are no per-row
  // issues to collect, so the pre-check passes and the builder must still refuse.
  test('an order with nothing to export still refuses, with its own reason', async () => {
    const result = await downloadSoPlayerReport({
      so: { id: 'SO-2035', webstore_id: 'ws-1', memo: '' },
      soItems: [], supabase: supabaseStub({ webstore_order_items: [] }),
      nf: (m, kind) => toasts.push([m, kind]), format: 'product', customer: null,
    });
    expect(result).toBe(false);
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(toasts[0][0]).toContain('No active fulfillment items to export');
  });

  test('never presents the sales-order total as a job quantity nobody submitted', async () => {
    // A Silver Screen deco PO carrying a job id but NO numeric qty: the unit target
    // silently falls back to the SO total. Labelling that "Silver Screen job" would
    // invent a number, and the guidance then tells the rep to go change the real job
    // to match it. The incomplete-job warning is what makes this order block.
    await run({
      deco_pos: [{
        vendor: 'Silver Screen', _silverscreen_job_id: 58505,
        _silverscreen_todo: 'Job #58505 created, but finish it on the Silver Screen portal — only 1 of 2 product lines were added.',
      }],
    });
    expect(window.open).toHaveBeenCalled();          // it really did block and render
    expect(html).toContain('only 1 of 2 product lines were added');
    // No job chip. (The words "Silver Screen job" still appear in the issue text
    // itself — it is the chip and the guidance that must not invent a quantity.)
    expect(html).not.toContain('<div class="l">Silver Screen job</div>');
    expect(html).not.toMatch(/job was submitted for/);
    // The two counts it can actually vouch for are still shown.
    expect(html).toContain('<div class="l">Customer units</div>');
    expect(html).toContain('<div class="l">Sales order units</div>');
  });
});
