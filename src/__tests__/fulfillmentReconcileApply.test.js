// The reconciliation has to do more than describe the problem — applying its
// suggestion must actually clear the block. These tests drive the live shape from
// St. Francis XC / SO-2021: a player ordered an XL the sales order does not buy,
// which shows up BOTH as a +1 unit mismatch and as "substituted item or size still
// needs verification" against her order number. One fix should clear both.

jest.mock('xlsx', () => {
  const actual = jest.requireActual('xlsx');
  return { ...actual, writeFile: jest.fn() };
});

const XLSX = require('xlsx');
const { downloadSoPlayerReport, mapLinesToSoItems } = require('../lib/soPlayerReport');
const {
  suggestSoFixes, applySoFixes, pinSourceSku, unpinSourceSku, pinnedSkus, rematchOptions, isBulkSafe,
} = require('../lib/fulfillmentReconcile');

const ORDERS = [
  { id: 'o-green', order_number: 1010509, created_at: '2026-08-01T12:00:00Z', buyer_name: 'A Green', ship_method: 'deliver_club', ship_address: null },
  { id: 'o-col', order_number: 1010471, created_at: '2026-08-02T12:00:00Z', buyer_name: 'E Colonnello', ship_method: 'deliver_club', ship_address: null },
];
const LINES = [
  { order_id: 'o-green', sku: 'AT203', name: "Men's Fleece Hooded Sweatshirt", color: 'Team Power Red/ White', size: 'S', qty: 1, player_name: 'Alexandra Green' },
  { order_id: 'o-col', sku: 'AT203', name: "Men's Fleece Hooded Sweatshirt", color: 'Team Power Red/ White', size: 'XL', qty: 1, player_name: 'Emily Colonnello' },
];
// The sales order buys the S but never the XL — the whole bug in one row.
const SO_ITEMS = () => [
  { sku: 'AT203', name: "Men's Fleece Hooded Sweatshirt", color: 'Team Power Red/ White', sizes: { S: 1 } },
];

function supabaseStub(overrides = {}) {
  const tables = {
    webstores: [{ id: 'ws-1', name: 'St. Francis XC', omg_sale_code: 'SFXC', customer_id: 'c-1', delivery_mode: 'deliver_club', shipstation_carrier: 'ups' }],
    webstore_orders: ORDERS.map((o) => ({ ...o, store_id: 'ws-1', so_id: 'SO-2021', status: 'paid' })),
    webstore_order_items: LINES,
    adidas_ss_sku_xref: [],
    customers: [{ id: 'c-1', name: 'St. Francis', shipping_attention: 'Athletics', shipping_address_line1: '5900 Elvas Ave', shipping_city: 'Sacramento', shipping_state: 'CA', shipping_zip: '95819' }],
    ...overrides,
  };
  return {
    from: (t) => {
      const q = {
        _rows: tables[t] || [],
        select() { return q; },
        eq(c, v) { q._rows = q._rows.filter((r) => r[c] === v); return q; },
        in(c, v) { q._rows = q._rows.filter((r) => v.includes(r[c])); return q; },
        maybeSingle() { return Promise.resolve({ data: q._rows[0] || null, error: null }); },
        then(res) { return Promise.resolve({ data: q._rows, error: null }).then(res); },
      };
      return q;
    },
  };
}

const run = (soItems, onBlocked) => downloadSoPlayerReport({
  so: { id: 'SO-2021', webstore_id: 'ws-1', memo: '' },
  soItems, supabase: supabaseStub(), nf: () => {}, format: 'product', customer: null, onBlocked,
});

describe('applying the suggested fix clears the block', () => {
  beforeEach(() => XLSX.writeFile.mockClear());

  test('the block reports both symptoms of the one missing size', async () => {
    let blocked = null;
    expect(await run(SO_ITEMS(), (d) => { blocked = d; })).toBe(false);
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(blocked.issues.join(' ')).toMatch(/2 active customer units do not match 1/);
    expect(blocked.issues.join(' ')).toMatch(/1010471.*needs verification/);
    // One row differs, and it names the player to open.
    expect(blocked.matchup.diffRows).toHaveLength(1);
    expect(blocked.matchup.diffRows[0]).toMatchObject({ sku: 'AT203', size: 'XL', customerUnits: 1, soUnits: 0, delta: 1 });
    expect(blocked.matchup.diffRows[0].who).toEqual(['1010471 · Emily Colonnello']);
    expect(blocked.verifyDetail).toHaveLength(1);
    expect(blocked.verifyDetail[0]).toMatchObject({ order: '1010471', player: 'Emily Colonnello', size: 'XL' });
  });

  test('the suggestion names the exact line, size and new quantity', async () => {
    let blocked = null;
    await run(SO_ITEMS(), (d) => { blocked = d; });
    const fixes = suggestSoFixes({ matchup: blocked.matchup, soItems: blocked.soItems });
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ kind: 'add', itemIndex: 0, size: 'XL', from: 0, to: 1, delta: 1 });
    expect(isBulkSafe(fixes[0])).toBe(true);
  });

  // The point of the whole feature.
  test('applying it makes the file download — both issues gone', async () => {
    let blocked = null;
    await run(SO_ITEMS(), (d) => { blocked = d; });
    const { items: fixed, applied } = applySoFixes(blocked.soItems, suggestSoFixes({ matchup: blocked.matchup, soItems: blocked.soItems }));
    expect(applied).toHaveLength(1);
    expect(fixed[0].sizes).toEqual({ S: 1, XL: 1 });

    let reblocked = null;
    expect(await run(fixed, (d) => { reblocked = d; })).toBe(true);
    expect(reblocked).toBeNull();
    expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
  });

  test('applying does not mutate the order it was given', async () => {
    let blocked = null;
    await run(SO_ITEMS(), (d) => { blocked = d; });
    const before = JSON.parse(JSON.stringify(blocked.soItems));
    applySoFixes(blocked.soItems, suggestSoFixes({ matchup: blocked.matchup, soItems: blocked.soItems }));
    expect(blocked.soItems).toEqual(before);
  });
});

describe('applying against an order that moved on', () => {
  const fixFor = (items) => suggestSoFixes({
    matchup: { diffRows: [{ sku: 'A', name: 'A', color: 'Red', size: 'M', delta: 1, who: [] }] }, soItems: items,
  });

  test('follows the item, not the row number, when lines were reordered', () => {
    const before = [{ sku: 'A', name: 'A', color: 'Red', sizes: { M: 1 } }, { sku: 'B', name: 'B', color: 'Blue', sizes: { M: 5 } }];
    const [fix] = fixFor(before);
    expect(fix.itemIndex).toBe(0);
    // The rep (or a background reload) reordered the order before clicking Apply.
    const now = [before[1], before[0]];
    const { items, applied } = applySoFixes(now, [fix]);
    expect(applied).toHaveLength(1);
    expect(items[0].sizes).toEqual({ M: 5 });   // B untouched — index 0 was NOT written
    expect(items[1].sizes).toEqual({ M: 2 });   // A found by identity and updated
  });

  test('skips, and reports, a fix whose line was deleted', () => {
    const [fix] = fixFor([{ sku: 'A', name: 'A', color: 'Red', sizes: { M: 1 } }]);
    const { items, applied, skipped } = applySoFixes([{ sku: 'B', name: 'B', color: 'Blue', sizes: { M: 5 } }], [fix]);
    expect(applied).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(items[0].sizes).toEqual({ M: 5 }); // nothing written anywhere
  });

  test('leaves every other field on the line untouched', () => {
    const items = [{ sku: 'A', name: 'A', color: 'Red', unit_sell: 24.5, decorations: [{ kind: 'art' }], no_deco: false, sizes: { M: 1, drop_ship: 3, unit_cost: 9.25 } }];
    const { items: out } = applySoFixes(items, fixFor(items));
    expect(out[0]).toMatchObject({ sku: 'A', unit_sell: 24.5, no_deco: false, decorations: [{ kind: 'art' }] });
    expect(out[0].sizes).toEqual({ M: 2, drop_ship: 3, unit_cost: 9.25 });
  });
});

describe('suggestions refuse to guess', () => {
  const row = (over) => ({ diffRows: [{ sku: 'A', name: 'A', color: 'Red', size: 'M', delta: 1, who: [], ...over }] });

  test('two sales-order lines for the same item and colour get no button', () => {
    const items = [{ sku: 'A', name: 'A', color: 'Red', sizes: { M: 1 } }, { sku: 'A', name: 'A', color: 'Red', sizes: { M: 2 } }];
    const [f] = suggestSoFixes({ matchup: row(), soItems: items });
    expect(f.kind).toBe('ambiguous');
    expect(f.itemIndex).toBeNull();
    expect(applySoFixes(items, [f]).items).toBe(items); // nothing applied
  });

  test('no matching line at all says so instead of editing the wrong one', () => {
    const items = [{ sku: 'B', name: 'B', color: 'Blue', sizes: { M: 1 } }];
    const [f] = suggestSoFixes({ matchup: row(), soItems: items });
    expect(f.kind).toBe('missing_line');
    expect(f.itemIndex).toBeNull();
  });

  test('a surplus on the sales order is offered but kept out of apply-all', () => {
    const items = [{ sku: 'A', name: 'A', color: 'Red', sizes: { M: 3 } }];
    const [f] = suggestSoFixes({ matchup: row({ delta: -2 }), soItems: items });
    expect(f).toMatchObject({ kind: 'reduce', itemIndex: 0, from: 3, to: 1 });
    expect(isBulkSafe(f)).toBe(false); // never removed in bulk — may be intentional extras
    expect(f.note).toMatch(/intentional extras/);
  });

  test("edits the sales order's own spelling of a size rather than adding a second cell", () => {
    const items = [{ sku: 'A', name: 'A', color: 'Red', sizes: { m: 1 } }];
    const [f] = suggestSoFixes({ matchup: row(), soItems: items });
    expect(f.size).toBe('m');
    expect(applySoFixes(items, [f]).items[0].sizes).toEqual({ m: 2 });
  });
});

describe('re-matching an item by hand', () => {
  // Two hoodie SKUs, one sales-order line. Left alone the pairing is a guess.
  const SO = () => [
    { sku: 'AT203', name: 'Fleece Hood', color: 'Black', sizes: { M: 1 } },
    { sku: 'AT216', name: 'Fleece Pant', color: 'Black', sizes: { M: 1 } },
  ];
  const lines = [{ order_id: 'o1', sku: 'HR8472', name: 'Old Hood', color: 'Black', size: 'M', qty: 1, player_name: 'P' }];

  test('a pin overrides the automatic pairing and clears the verify flag', () => {
    const pinned = pinSourceSku(SO(), 'AT216|BLACK', 'HR8472'); // rep says: these are the PANTS
    expect(pinnedSkus(pinned[1])).toEqual(['HR8472']);
    const out = mapLinesToSoItems(lines, pinned).lines;
    expect(out[0]._sku).toBe('AT216');
    expect(out[0]._verify).toBe(false);
    expect(out[0]._wasSku).toBe('HR8472'); // the original is still recorded
  });

  test('pinning one line releases the same SKU from any other', () => {
    let items = pinSourceSku(SO(), 'AT203|BLACK', 'HR8472');
    items = pinSourceSku(items, 'AT216|BLACK', 'HR8472');
    expect(pinnedSkus(items[0])).toEqual([]);
    expect(pinnedSkus(items[1])).toEqual(['HR8472']);
  });

  test('unpinning hands the choice back to the matcher', () => {
    const items = unpinSourceSku(pinSourceSku(SO(), 'AT216|BLACK', 'HR8472'), 'HR8472');
    expect(pinnedSkus(items[1])).toEqual([]);
  });

  test('a pin survives the SO line being zeroed out, which normally releases a match', () => {
    // Zero coverage normally re-opens a group for automatic re-pairing; a pin is a
    // human decision and must outrank that.
    const items = pinSourceSku([{ sku: 'AT216', name: 'Fleece Pant', color: 'Black', sizes: { S: 0 } }], 'AT216|BLACK', 'HR8472');
    const out = mapLinesToSoItems(lines, items).lines;
    expect(out[0]._unmatched).toBeFalsy();
    expect(out[0]._sku).toBe('AT216');
  });

  test('the picker marks which line is currently confirmed', () => {
    const opts = rematchOptions(pinSourceSku(SO(), 'AT216|BLACK', 'HR8472'), 'HR8472');
    expect(opts.map((o) => o.pinned)).toEqual([false, true]);
    expect(opts[1].label).toBe('Fleece Pant · Black');
  });
});

// Two ways a pin could quietly do more than the rep agreed to. Both were live
// defects found by review, not by inspection — keep them pinned.
describe('a pin means "this item", never more', () => {
  const SOLO = (pins) => [{ sku: 'AT203', name: 'Fleece Hood', color: 'Black', sizes: { S: 1 }, ...(pins ? { _matchSkus: pins } : {}) }];
  const XL_LINE = [{ order_id: 'o1', sku: 'HR8472', name: 'Old Hood', color: 'Black', size: 'XL', qty: 1, player_name: 'Emily Colonnello' }];

  test('confirming the garment does not also confirm a size the order never bought', () => {
    // The sales order buys one S. The customer bought an XL. With only one spare
    // size to land on, allocateCurrentSizes moves the unit without calling it
    // ambiguous — so if the pin cleared verify outright, Emily would be shipped a
    // Small on a file that downloads perfectly clean.
    const out = mapLinesToSoItems(XL_LINE, SOLO(['HR8472'])).lines;
    expect(out[0]._size).toBe('S');
    expect(out[0]._wasSize).toBe('XL');
    expect(out[0]._verify).toBe(true);
  });

  test('so the file still refuses to download after the rep confirms the item', async () => {
    let blocked = null;
    const res = await downloadSoPlayerReport({
      so: { id: 'SO-2021', webstore_id: 'ws-1', memo: '' },
      soItems: SOLO(['HR8472']),
      supabase: supabaseStub({ webstore_order_items: XL_LINE.map((l) => ({ ...l, order_id: 'o-col' })) }),
      nf: () => {}, format: 'product', customer: null, onBlocked: (d) => { blocked = d; },
    });
    expect(res).toBe(false);
    expect(blocked.issues.join(' ')).toMatch(/needs verification/);
  });

  test('a pin copied onto a duplicated line claims nothing, rather than the first one winning', () => {
    // Duplicating a sales-order line clones _matchSkus with it. Two lines claiming
    // one source SKU is not a decision, so matching falls back to automatic (which
    // flags for review) instead of silently picking whichever sorts first.
    const dupes = [
      { sku: 'AT216', name: 'Fleece Pant', color: 'Blue', sizes: { M: 1 }, _matchSkus: ['HR8472'] },
      { sku: 'AT216', name: 'Fleece Pant', color: 'Red', sizes: { M: 1 }, _matchSkus: ['HR8472'] },
    ];
    const line = [{ order_id: 'o1', sku: 'HR8472', name: 'Old', color: 'Black', size: 'M', qty: 1, player_name: 'P' }];
    const out = mapLinesToSoItems(line, dupes).lines;
    // Whatever the automatic matcher decides, it must not arrive pin-confirmed.
    expect(out[0]._verify).toBe(true);
  });

  test('two identical lines are not offered in the re-match picker at all', () => {
    const dupes = [
      { sku: 'A', name: 'A', color: 'Red', sizes: { M: 1 } },
      { sku: 'A', name: 'A', color: 'Red', sizes: { M: 2 } },
      { sku: 'B', name: 'B', color: 'Blue', sizes: { M: 1 } },
    ];
    expect(rematchOptions(dupes, 'SRC').map((o) => o.label)).toEqual(['B · Blue']);
    // ...and pinning to an identity that matches two lines writes nothing.
    expect(pinSourceSku(dupes, 'A|RED', 'SRC')).toBe(dupes);
  });
});

// "i just need to print the damn file. i need an option for that."
// The reconciliation is advice, not a veto. A rep who knows the situation can send
// the file — except where the workbook would be structurally unusable, since
// overriding there just produces something Silver Screen's importer rejects.
describe('sending the file anyway', () => {
  // The CSV path really writes a Blob and clicks a link; stub the DOM side of that.
  beforeEach(() => {
    XLSX.writeFile.mockClear();
    global.Blob = function Blob(parts) { this.parts = parts; };
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    jest.spyOn(document, 'createElement').mockReturnValue({ click: () => {}, set href(v) {}, set download(v) {} });
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const SHORT_SO = () => [{ sku: 'AT203', name: "Men's Fleece Hooded Sweatshirt", color: 'Team Power Red/ White', sizes: { S: 1 } }];

  test('a unit mismatch blocks by default and downloads when forced', async () => {
    expect(await run(SHORT_SO(), () => {})).toBe(false);
    expect(XLSX.writeFile).not.toHaveBeenCalled();

    const forced = await downloadSoPlayerReport({
      so: { id: 'SO-2021', webstore_id: 'ws-1', memo: '' },
      soItems: SHORT_SO(), supabase: supabaseStub(), nf: () => {}, format: 'product',
      customer: null, onBlocked: () => {}, force: true,
    });
    expect(forced).toBe(true);
    expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
    // Every customer unit is in the file, including the one the SO was short on.
    const rows = XLSX.utils.sheet_to_json(XLSX.writeFile.mock.calls[0][0].Sheets.Domestic, { header: 1, defval: '' });
    expect(rows.slice(1).reduce((n, r) => n + Number(r[3]), 0)).toBe(2);
  });

  test('the CSV exports even when the workbook would not', async () => {
    const ok = await downloadSoPlayerReport({
      so: { id: 'SO-2021', webstore_id: 'ws-1', memo: '' },
      soItems: SHORT_SO(), supabase: supabaseStub(), nf: () => {}, format: 'csv',
      customer: null, onBlocked: () => {}, force: true,
    });
    expect(ok).toBe(true);
  });

  test('but a row their importer would reject still refuses, and says why', async () => {
    // No customer and no shipping address anywhere: the required ship-to columns
    // cannot be filled, so "anyway" would hand Silver Screen an unusable sheet.
    let blocked = null;
    const noAddress = supabaseStub({ customers: [], webstores: [{ id: 'ws-1', name: 'St. Francis XC', omg_sale_code: 'SFXC', customer_id: null, delivery_mode: 'deliver_club', shipstation_carrier: 'ups' }] });
    const res = await downloadSoPlayerReport({
      so: { id: 'SO-2021', webstore_id: 'ws-1', memo: '' },
      soItems: SHORT_SO(), supabase: noAddress, nf: () => {}, format: 'product',
      customer: null, onBlocked: (d) => { blocked = d; }, force: true,
    });
    expect(res).toBe(false);
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(blocked.canOverride).toBe(false);
    expect(blocked.issues.join(' ')).toMatch(/missing (ship-to attention|address line 1|city|state|postal code)/);
    // The unit mismatch is waived; only the unfillable columns are left.
    expect(blocked.issues.join(' ')).not.toMatch(/do not match/);
  });
});
