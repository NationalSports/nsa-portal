/* eslint-disable */
/**
 * Production Work Order sheet (National Team Shop layout).
 *
 * Verifies the pure renderer (src/lib/workOrderSheet.js) faithfully carries the
 * job data onto the sheet, and — most importantly — that the names/numbers
 * roster pairs numbers with names BY INDEX without sorting (sorting would
 * mis-associate a name with the wrong number on a roster-seeded order).
 *
 * SAFE: pure functions only — no Supabase, no DOM, no network.
 */
const { buildWorkOrderDoc, pairRoster } = require('../lib/workOrderSheet');

const baseData = (over = {}) => ({
  id: 'NT-48210', rush: true, methodName: 'Embroidery', crest: 'E',
  barcodeLabel: 'NT-48210 · EAGLES',
  footerLeft: 'Printed X · Embroidery 3 · JM',
  meta: [
    { k: 'Customer', v: 'Eastside Eagles' },
    { k: 'SO #', v: 'SO-48210' },
    { k: 'Total pieces', v: '34 pcs' },
  ],
  mocks: [{ label: 'Front · Left chest', dim: '3.5"W', side: 'front' }],
  specs: [{ k: 'Method', v: 'Embroidery' }, { k: 'Placement', v: 'Left chest' }],
  colorsLabel: 'Thread colors',
  colors: [{ name: 'Navy', code: 'PMS 289', hex: '#192853' }],
  lines: [{ name: 'PosiCharge Polo', color: 'Navy', sku: 'ST650-NVY', deco: 'Left-chest EMB', qty: 34, sizes: [{ s: 'S', q: 4 }, { s: 'M', q: 30 }] }],
  totalPieces: 34,
  notes: 'Do not scale down.',
  signoff: [{ role: 'Picked by' }, { role: 'Decorated by' }, { role: 'QC by' }, { role: 'Packed by' }],
  includePickList: true,
  ...over,
});

describe('buildWorkOrderDoc — data carried onto the sheet', () => {
  const html = buildWorkOrderDoc(baseData());

  test('renders a complete self-contained document', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('@page{size:letter portrait');
  });

  test('carries id, method and rush badge', () => {
    expect(html).toContain('NT-48210');
    expect(html).toContain('Embroidery');
    expect(html).toContain('>Rush<');
  });

  test('rush badge is omitted when not rush', () => {
    expect(buildWorkOrderDoc(baseData({ rush: false }))).not.toContain('>Rush<');
  });

  test('carries meta grid, line items, sizes and total pieces', () => {
    expect(html).toContain('Eastside Eagles');
    expect(html).toContain('SO-48210');
    expect(html).toContain('ST650-NVY');
    expect(html).toContain('>30<'); // size M qty
    expect(html).toContain('Line Items &amp; Pick List');
  });

  test('carries decoration spec + thread color swatch', () => {
    expect(html).toContain('Thread colors');
    expect(html).toContain('Navy');
    expect(html).toContain('#192853');
  });

  test('renders the four sign-off roles', () => {
    ['Picked by', 'Decorated by', 'QC by', 'Packed by'].forEach((r) => expect(html).toContain(r));
  });

  test('escapes HTML in text fields', () => {
    const h = buildWorkOrderDoc(baseData({ meta: [{ k: 'Customer', v: 'A & B Sports' }] }));
    expect(h).toContain('A &amp; B Sports');
    expect(h).not.toContain('A & B Sports');
  });
});

describe('buildWorkOrderDoc — ported production features', () => {
  test('DST "scan to load" barcodes render when present', () => {
    const h = buildWorkOrderDoc(baseData({ dstBarcodes: [{ base: 'EAGLES', dg: 'DG-1', art: 'Crest', svg: '<svg></svg>' }] }));
    expect(h).toContain('MACHINE DESIGNS — SCAN TO LOAD');
    expect(h).toContain('EAGLES');
  });

  test('missing-DST warning renders for embroidery jobs with no digitized file', () => {
    expect(buildWorkOrderDoc(baseData({ dstWarning: true }))).toContain('NO DST FILE ATTACHED');
  });

  test('runs-together siblings block renders', () => {
    const h = buildWorkOrderDoc(baseData({ siblings: { unitsTotal: 88, list: [{ soId: 'SO-2', cust: 'Wildcats', qty: 18, matched: true }] } }));
    expect(h).toContain('Runs together');
    expect(h).toContain('SO-2');
  });

  test('production files block renders', () => {
    expect(buildWorkOrderDoc(baseData({ prodFiles: ['eagles-crest.dst'] }))).toContain('eagles-crest.dst');
  });
});

describe('buildWorkOrderDoc — pick list is conditional (clubstore / NTS only)', () => {
  const sheetCount = (h) => (h.match(/class="wo-sheet"/g) || []).length;

  test('clubstore/NTS order: pick list renders on its own IF page', () => {
    const h = buildWorkOrderDoc(baseData({ includePickList: true, roster: null }));
    expect(h).toContain('Line Items &amp; Pick List');
    expect(h).toContain('Item fulfillment · pick list');
    expect(sheetCount(h)).toBe(2); // work order + pick page
  });

  test('contract/bulk order: no pick list, no IF page', () => {
    const h = buildWorkOrderDoc(baseData({ includePickList: false, roster: null }));
    expect(h).not.toContain('Line Items &amp; Pick List');
    expect(h).not.toContain('Item fulfillment');
    expect(sheetCount(h)).toBe(1); // single-page work order
  });

  test('production files still render on page 1 even without a pick list', () => {
    const h = buildWorkOrderDoc(baseData({ includePickList: false, roster: null, prodFiles: ['dolphin-sep.ai'] }));
    expect(h).toContain('dolphin-sep.ai');
    expect(h).not.toContain('Line Items &amp; Pick List');
  });

  test('contract order WITH a names/numbers roster still gets the roster page', () => {
    const roster = { title: 'R', garment: 'G', personalization: [], summary: [{ s: 'M', q: 1 }], total: 1, groups: [{ size: 'M', count: 1, players: [{ num: '7', name: 'A B', back: 'A B' }] }] };
    const h = buildWorkOrderDoc(baseData({ includePickList: false, roster }));
    expect(h).toContain('Player Roster');
    expect(h).not.toContain('Line Items &amp; Pick List');
    expect(sheetCount(h)).toBe(2); // work order + roster (no pick page)
  });

  test('clubstore order with a roster = work order + pick page + roster (3 sheets)', () => {
    const roster = { title: 'R', garment: 'G', personalization: [], summary: [{ s: 'M', q: 1 }], total: 1, groups: [{ size: 'M', count: 1, players: [{ num: '7', name: 'A B', back: 'A B' }] }] };
    expect(sheetCount(buildWorkOrderDoc(baseData({ includePickList: true, roster })))).toBe(3);
  });
});

describe('pairRoster — numbers↔names paired by index, NOT sorted', () => {
  const SZ = ['S', 'M', 'L', 'XL', '2XL'];

  test('pairs each number with the name at the same index', () => {
    const { groups, total } = pairRoster(
      { M: ['9', '3', '21'] },
      { M: ['Andre Boone', 'Eli Nakamura', 'Dominic Alvarez'] },
      SZ,
    );
    expect(total).toBe(3);
    const players = groups[0].players;
    expect(players[0]).toEqual({ num: '9', name: 'Andre Boone', back: 'ANDRE BOONE' });
    expect(players[1]).toEqual({ num: '3', name: 'Eli Nakamura', back: 'ELI NAKAMURA' });
    expect(players[2]).toEqual({ num: '21', name: 'Dominic Alvarez', back: 'DOMINIC ALVAREZ' });
  });

  test('does NOT sort within a size — original (unsorted) order is preserved', () => {
    const { groups } = pairRoster({ M: ['9', '3', '21'] }, { M: ['A', 'B', 'C'] }, SZ);
    expect(groups[0].players.map((p) => p.num)).toEqual(['9', '3', '21']);
  });

  test('sizes are ordered by size run (S before M before 2XL)', () => {
    const { groups } = pairRoster({ '2XL': ['1'], S: ['2'], M: ['3'] }, {}, SZ);
    expect(groups.map((g) => g.size)).toEqual(['S', 'M', '2XL']);
  });

  test('handles numbers-only or names-only rosters and drops empty slots', () => {
    expect(pairRoster({ M: ['7', ''] }, {}, SZ).total).toBe(1);
    expect(pairRoster({}, { L: ['Sam Petrov'] }, SZ).groups[0].players[0].name).toBe('Sam Petrov');
  });

  test('rendered roster page keeps players in stored order', () => {
    const { groups, total } = pairRoster({ M: ['9', '3', '21'] }, { M: ['Andre Boone', 'Eli Nakamura', 'Dominic Alvarez'] }, SZ);
    const h = buildWorkOrderDoc(baseData({
      mocks: [{ label: 'Front', side: 'front' }, { label: 'Back', side: 'back' }],
      roster: { title: 'Names & numbers', garment: 'Polo', personalization: [], summary: groups.map((g) => ({ s: g.size, q: g.count })), total, groups },
    }));
    expect(h).toContain('Player Roster');
    expect(h.indexOf('Andre Boone')).toBeLessThan(h.indexOf('Dominic Alvarez'));
  });
});
