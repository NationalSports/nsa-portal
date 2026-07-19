// Unit tests for the resolution-proposal engine (src/billResolve.js).
// Fixtures mirror REAL production cases from the 2026-07-16 reconciliation audit:
// the Trinity typo'd-PO bill, the Agron SKU-suffix bill, and the prefix-less
// old-system PO class.
const { proposeResolutions, poParts, editDistance, looksPrePortalGlued } = require('../billResolve');

const canon = (s) => String(s || '').toUpperCase().trim();

// ── Real case: Trinity United (bill "PO 3132 TUH" — true order PO 3131 TUH) ──
const trinityBill = {
  po_number: 'PO 3132 STOV', _po_raw: 'PO 3132 TUH', supplier: 'S&S Activewear',
  items: [
    { sku: 'B31608682', size: 'XS', color: 'Chambray', qty: 1, unit_price: 5.75, _ss_style: '9018' },
    { sku: 'B31608683', size: 'S', color: 'Chambray', qty: 1, unit_price: 5.75, _ss_style: '9018' },
    { sku: 'B31608684', size: 'M', color: 'Chambray', qty: 1, unit_price: 5.75, _ss_style: '9018' },
    { sku: 'B31608685', size: 'L', color: 'Chambray', qty: 15, unit_price: 5.75, _ss_style: '9018' },
    { sku: 'B00708043', size: 'S', color: 'Chambray', qty: 30, unit_price: 6.29, _ss_style: '1717' },
    { sku: 'B00708044', size: 'M', color: 'Chambray', qty: 30, unit_price: 6.29, _ss_style: '1717' },
    { sku: 'B00708045', size: 'L', color: 'Chambray', qty: 14, unit_price: 6.29, _ss_style: '1717' },
    { sku: 'B00708046', size: 'XL', color: 'Chambray', qty: 8, unit_price: 6.29, _ss_style: '1717' },
  ],
};
const trinityCand = {
  kind: 'so', id: 'SO-1129', label: 'SO-1129', sub: 'Sales Order · Trinity United HS',
  raw: { id: 'SO-1129' },
  items: [
    { sku: '9018', name: 'CC Youth Tee', color: 'Chambray', size: 'XS', qty: 1, unit_cost: 5.75, so_id: 'SO-1129', item_id: 'y1', po_id: 'PO 3131 TUH' },
    { sku: '9018', name: 'CC Youth Tee', color: 'Chambray', size: 'S', qty: 1, unit_cost: 5.75, so_id: 'SO-1129', item_id: 'y1', po_id: 'PO 3131 TUH' },
    { sku: '9018', name: 'CC Youth Tee', color: 'Chambray', size: 'M', qty: 1, unit_cost: 5.75, so_id: 'SO-1129', item_id: 'y1', po_id: 'PO 3131 TUH' },
    { sku: '9018', name: 'CC Youth Tee', color: 'Chambray', size: 'L', qty: 15, unit_cost: 5.75, so_id: 'SO-1129', item_id: 'y1', po_id: 'PO 3131 TUH' },
    { sku: '1717', name: 'CC Tee', color: 'Chambray', size: 'S', qty: 30, unit_cost: 5.18, so_id: 'SO-1129', item_id: 'u1', po_id: 'PO 3131 TUH' },
    { sku: '1717', name: 'CC Tee', color: 'Chambray', size: 'M', qty: 30, unit_cost: 5.18, so_id: 'SO-1129', item_id: 'u1', po_id: 'PO 3131 TUH' },
    { sku: '1717', name: 'CC Tee', color: 'Chambray', size: 'L', qty: 14, unit_cost: 5.18, so_id: 'SO-1129', item_id: 'u1', po_id: 'PO 3131 TUH' },
    { sku: '1717', name: 'CC Tee', color: 'Chambray', size: 'XL', qty: 8, unit_cost: 5.18, so_id: 'SO-1129', item_id: 'u1', po_id: 'PO 3131 TUH' },
  ],
};
// The wrong order the numeric-core tier picked (Stockdale — Mikasa equipment only).
const stockdaleCand = {
  kind: 'so', id: 'SO-1130', label: 'SO-1130', sub: 'Sales Order · Stockdale HS Volleyball',
  raw: { id: 'SO-1130' },
  items: [
    { sku: 'CUSTOM', name: 'Mikasa Ball Cart', color: 'Black', size: 'OSFA', qty: 1, unit_cost: 200, so_id: 'SO-1130', item_id: 'm1', po_id: 'PO 3132 STOV' },
    { sku: 'CUSTOM', name: 'Mikasa VQ2000', color: 'Black/White', size: 'OSFA', qty: 12, unit_cost: 40, so_id: 'SO-1130', item_id: 'm2', po_id: 'PO 3132 STOV' },
  ],
};

describe('proposeResolutions — the Trinity typo case', () => {
  test('finds the RIGHT order with high confidence: full coverage, qty mirror, tag match, core one off', () => {
    const props = proposeResolutions(trinityBill, [stockdaleCand, trinityCand], { canonSize: canon });
    expect(props.length).toBeGreaterThan(0);
    const p = props[0];
    expect(p.target.id).toBe('SO-1129');
    expect(p.coverage).toBe(1);
    expect(p.qtyMirror).toBe(true);
    expect(p.tagMatch).toBe(true);
    expect(p.coreDistance).toBe(1);
    expect(p.confidence).toBe('high');
    expect(p.ties).toHaveLength(8);
    expect(p.ties.every((t) => t.basis === 'style' || /^style/.test(t.basis))).toBe(true);
  });
  test('reports the 1717 price change ($5.18 → $6.29) an accept would sync', () => {
    const p = proposeResolutions(trinityBill, [trinityCand], { canonSize: canon })[0];
    expect(p.priceChanges).toHaveLength(1);
    expect(p.priceChanges[0]).toMatchObject({ sku: '1717', from: 5.18, to: 6.29 });
  });
  test('never proposes the Mikasa order (zero line ties → filtered)', () => {
    const props = proposeResolutions(trinityBill, [stockdaleCand], { canonSize: canon });
    expect(props).toHaveLength(0);
  });
});

describe('proposeResolutions — SKU suffix variants (Agron 5162436D case)', () => {
  const bill = {
    po_number: 'PO 7800 WVCVB',
    items: [
      { sku: '5162436D', size: '', color: '', qty: 1, unit_price: 10.0, desc: '5-STAR TEAM 3 CREW' },
      { sku: '5161961C', size: '', color: '', qty: 24, unit_price: 12.5, desc: '5 STAR TEAM GRIP CREW' },
    ],
  };
  const cand = {
    kind: 'so', id: 'SO-1403', label: 'SO-1403', raw: { id: 'SO-1403' },
    items: [
      { sku: '5162436', name: 'Adidas 5-Star Team 3 Crew', color: '', size: 'OSFA', qty: 1, unit_cost: 10.0, so_id: 'SO-1403', item_id: 'a', po_id: 'PO 7800 WVCVB' },
      { sku: '5161961', name: 'Adidas 5 Star Grip Crew', color: '', size: 'OSFA', qty: 24, unit_cost: 12.5, so_id: 'SO-1403', item_id: 'b', po_id: 'PO 7800 WVCVB' },
    ],
  };
  test('ties both lines by SKU variant, sizeless bill lines allowed', () => {
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.coverage).toBe(1);
    expect(p.ties.map((t) => t.basis)).toEqual(['variant', 'variant']);
    expect(p.confidence).toBe('high');
  });
});

describe('honesty rules', () => {
  test('two orders fitting equally well can never be "high" confidence', () => {
    const mk = (id) => ({ kind: 'so', id, label: id, raw: { id },
      items: [{ sku: 'JX1', name: 'Tee', color: 'Navy', size: 'L', qty: 5, unit_cost: 10, so_id: id, item_id: id + 'i', po_id: 'PO 9000 AAA' }] });
    const bill = { po_number: 'PO 9000 AAA', items: [{ sku: 'JX1', size: 'L', color: 'Navy', qty: 5, unit_price: 10 }] };
    const props = proposeResolutions(bill, [mk('SO-A'), mk('SO-B')], { canonSize: canon });
    expect(props[0].confidence).not.toBe('high');
    expect(props[0].evidence.join(' ')).toMatch(/another order fits almost as well/);
  });
  test('overage is surfaced, never hidden: billed 3 vs 2 open flags one overage unit', () => {
    const bill = { po_number: 'PO 3345 SERF', items: [{ sku: 'JW6597', size: 'L', color: '', qty: 3, unit_price: 20 }] };
    const cand = { kind: 'so', id: 'SO-9', label: 'SO-9', raw: { id: 'SO-9' },
      items: [{ sku: 'JW6597', name: 'Pant', color: '', size: 'L', qty: 2, unit_cost: 20, so_id: 'SO-9', item_id: 'x', po_id: 'PO 3345 SERF' }] };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.overageUnits).toBe(1);
    expect(p.ties[0].overage).toBe(1);
    expect(p.evidence.join(' ')).toMatch(/exceed the order/);
  });
});

describe('poParts / editDistance / looksPrePortalGlued', () => {
  test('poParts decomposes portal and mangled POs', () => {
    expect(poParts('PO 3131 TUH')).toMatchObject({ core: '3131', tag: 'TUH' });
    expect(poParts('8379SAVFBJH')).toMatchObject({ core: '8379', tag: 'SAVFBJH' });
    expect(poParts('P08689SBFBQ')).toMatchObject({ core: '8689', tag: 'SBFBQ' });
    expect(poParts('')).toMatchObject({ core: '', tag: '' });
  });
  test('editDistance basics', () => {
    expect(editDistance('3131', '3132')).toBe(1);
    expect(editDistance('3131', '3131')).toBe(0);
    expect(editDistance('3131', '8050')).toBeGreaterThan(1);
  });
  test('looksPrePortalGlued catches the prefix-less old-system class only', () => {
    expect(looksPrePortalGlued('8379SAVFBJH')).toBe(true);
    expect(looksPrePortalGlued('8711CSB')).toBe(true);
    expect(looksPrePortalGlued('PO 3131 TUH')).toBe(false);   // portal format
    expect(looksPrePortalGlued('PO6591NSA')).toBe(false);     // has PO prefix — other rule owns it
    expect(looksPrePortalGlued('5866407')).toBe(false);       // bare vendor number — unknown, not "outside"
  });
});
