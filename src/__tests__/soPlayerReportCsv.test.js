// Unit tests for the SO player report's CSV output (src/lib/soPlayerReport.js).
//
// The CSV exists because the PDF can only be read one player at a time (13 printed sheets for
// St. Francis Tennis / SO-2035). Owner requirements it locks in: one row per line item,
// ordered by ORDER NUMBER, and the shipping address repeated on EVERY row so a single
// filtered line still says where the box goes.

jest.mock('xlsx', () => {
  const actual = jest.requireActual('xlsx');
  return { ...actual, writeFile: jest.fn() };
});

const XLSX = require('xlsx');
const { downloadSoPlayerReport } = require('../lib/soPlayerReport');

// Capture what downloadCsv would have written, without a DOM download.
let captured = null;
beforeEach(() => {
  captured = null;
  XLSX.writeFile.mockClear();
  global.Blob = function Blob(parts) { this.parts = parts; captured = String(parts.join('')); };
  global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
  const a = { click: () => {}, set href(v) {}, set download(v) { this._name = v; } };
  jest.spyOn(document, 'createElement').mockReturnValue(a);
  jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
  jest.spyOn(document.body, 'removeChild').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// Two store orders. 99 sorts BEFORE 1010525 numerically but after it as a string — the bug
// this pins. The second order ships to a home; the first is a club delivery (no address),
// which is what every order on SO-2035/SO-2036 actually is.
const ORDERS = [
  { id: 'o-club', order_number: 1010525, created_at: '2026-08-01T12:00:00Z', buyer_name: 'Berenice Garcia', buyer_email: 'b@x.com', buyer_phone: '555-0100', ship_method: 'deliver_club', ship_address: null },
  { id: 'o-home', order_number: 99, created_at: '2026-07-30T09:00:00Z', buyer_name: 'Tyler, Stacy', buyer_email: 's@x.com', buyer_phone: '555-0199', ship_method: 'ship_home', ship_address: { name: 'Stacy Tyler', street1: '12 Oak St', street2: 'Apt 4', city: 'Reno', state: 'NV', zip: '89502', country: 'US' } },
];
const LINES = [
  { order_id: 'o-club', sku: '1203.080', name: 'Girls Racerback Tank', size: 'S', qty: 1, player_name: 'Abbie Garcia', player_number: 7 },
  { order_id: 'o-home', sku: 'AT310-50', name: 'Adidas Techfit VB Shorts W', size: '2XS', qty: 2, player_name: 'Alexandra "Alex" Spitzer', player_number: null },
];
// soItems: what the SO currently carries. AT310-50 is unchanged; the tank was swapped.
const SO_ITEMS = [
  { sku: 'AT310-50', name: 'Adidas Techfit VB Shorts W', color: 'Black', sizes: { '2XS': 2 } },
  { sku: '1203.005', name: 'Girls Racerback Tank', color: 'White', sizes: { S: 1 } },
];

function supabaseStub() {
  const tables = {
    webstores: [{ id: 'ws-1', name: 'St. Francis Tennis', omg_sale_code: 'V7ESK', customer_id: 'c-1', delivery_mode: 'deliver_club', shipstation_carrier: 'ups' }],
    webstore_orders: ORDERS.map((o) => ({ ...o, store_id: 'ws-1', so_id: 'SO-2035', status: 'paid' })),
    webstore_order_items: LINES,
    adidas_ss_sku_xref: [{ ss_sku: 'AT310-50', adidas_article: 'JL5410', rank: 1 }],
    customers: [{ id: 'c-1', name: 'St. Francis', shipping_attention: 'Athletics', shipping_address_line1: '5900 College Rd', shipping_city: 'Reno', shipping_state: 'NV', shipping_zip: '89503' }],
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

const run = (format = 'csv') => downloadSoPlayerReport({
  so: { id: 'SO-2035', webstore_id: 'ws-1', memo: '' },
  soItems: SO_ITEMS, supabase: supabaseStub(), nf: () => {}, format,
});

describe('player report CSV', () => {
  test('emits one row per line item, ordered by order number', async () => {
    expect(await run()).toBe(true);
    const rows = captured.replace(/^﻿/, '').split('\r\n');
    expect(rows).toHaveLength(3); // header + 2 lines
    expect(rows[0].startsWith('Order #,Order Date,Player')).toBe(true);
    // 99 before 1010525 — numeric ordering, not string ordering.
    expect(rows[1].startsWith('99,2026-07-30,')).toBe(true);
    expect(rows[2].startsWith('1010525,2026-08-01,')).toBe(true);
  });

  test('every row carries its order shipping address', async () => {
    await run();
    const rows = captured.replace(/^﻿/, '').split('\r\n');
    // The ship-to-home order's row repeats the full address.
    expect(rows[1]).toContain('12 Oak St');
    expect(rows[1]).toContain('Reno');
    expect(rows[1]).toContain('89502');
    expect(rows[1]).toContain('ship_home');
    // A club delivery has no address to carry — the METHOD still says why it's blank, so the
    // empty columns don't read as missing data.
    expect(rows[2]).toContain('deliver_club');
  });

  test('commas and quotes in names are escaped, never column-shifted', async () => {
    await run();
    const rows = captured.replace(/^﻿/, '').split('\r\n');
    expect(rows[1]).toContain('"Alexandra ""Alex"" Spitzer"'); // quotes doubled
    expect(rows[1]).toContain('"Tyler, Stacy"');               // comma quoted
    // Column count must survive the escaping: parse the row respecting quotes.
    const cells = rows[1].match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter((_, i, a) => i < a.length - 1);
    expect(cells.length).toBe(rows[0].split(',').length);
  });

  test('a substituted line reports the SO item and flags what it replaced', async () => {
    await run();
    const rows = captured.replace(/^﻿/, '').split('\r\n');
    // The tank was swapped 1203.080 → 1203.005 on the SO; the CSV must show what we're
    // actually buying, with the original recorded in Was SKU.
    expect(rows[2]).toContain('1203.005');
    expect(rows[2]).toContain('1203.080');
    expect(rows[2]).toMatch(/substituted/);
  });

  test('keeps the S&S ordering SKU and adds the adidas garment-tag SKU', async () => {
    await run();
    const rows = captured.replace(/^﻿/, '').split('\r\n');
    expect(rows[0]).toContain('SKU,Adidas Tag SKU,Color');
    expect(rows[1]).toContain('AT310-50,JL5410');
  });

  test('PDF report prints both numbers for the S&S item', async () => {
    let html = '';
    const popup = {
      document: { write: (value) => { html += value; }, close: () => {} },
      focus: () => {}, print: () => {},
    };
    jest.spyOn(window, 'open').mockReturnValue(popup);
    jest.spyOn(global, 'setTimeout').mockImplementation(() => 0);
    expect(await run('pdf')).toBe(true);
    expect(html).toContain('<b>S&amp;S:</b> AT310-50 · <b>Adidas tag:</b> JL5410');
  });

  test('product report downloads the exact Silver Screen Domestic columns', async () => {
    expect(await run('product')).toBe(true);
    expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
    const [workbook, filename] = XLSX.writeFile.mock.calls[0];
    expect(workbook.SheetNames).toEqual(['Domestic']);
    expect(filename).toMatch(/^SO-2035_Fulfillment_Template_\d+\.\d+\.\d+\.xlsx$/);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Domestic, { header: 1, defval: '' });
    expect(rows[0]).toEqual([
      'REFERENCE # (if applicable)', 'SHIP TO ATTENTION (required)', 'COMPANY NAME (if applicable)',
      'QUANTITY (required)', 'SIZE (required)', 'COLOR (required)', 'STYLE # (required)',
      'ITEM DESCRIPTION (required)', 'SHIP TO ADDRESS LINE 1 (required)',
      'SHIP TO ADDRESS LINE 2 (if applicable)', 'CITY (required)', 'STATE (required)',
      'POSTAL CODE (required)', 'SHIP METHOD (required)',
      'BILLING - 3RD PARTY SHIPPING ACCOUNT # (if applicable)',
      'BILLING - 3RD PARTY POSTAL CODE (if applicable)',
    ]);
    expect(rows.slice(1).reduce((sum, row) => sum + Number(row[3]), 0)).toBe(3);
    expect(rows.slice(1).map((row) => row[0])).toEqual(['99', '1010525']);
    expect(rows[1][1]).toBe('Alexandra "Alex" Spitzer');
    expect(rows[1].slice(8, 14)).toEqual(['12 Oak St', 'Apt 4', 'Reno', 'NV', '89502', 'UPS Ground']);
    expect(rows.slice(1).some((row) => row[6] === 'AT310-50' && /Adidas tag JL5410/.test(row[7]))).toBe(true);
  });
});
