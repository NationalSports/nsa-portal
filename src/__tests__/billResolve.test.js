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

// ── tieLine ladder, exercised through proposeResolutions ────────────────────
describe('tieLine ladder — exact beats variant, ambiguity, price refinement', () => {
  test('exact SKU+size wins even when a variant-tier candidate also exists', () => {
    const bill = { items: [{ sku: 'AB1234', size: 'M', qty: 1, unit_price: 0 }] };
    const cand = {
      id: 'SO-EX', label: 'SO-EX', raw: { id: 'SO-EX' },
      items: [
        { sku: 'AB12345', size: 'M', qty: 5, unit_cost: 1, item_id: 'variant', po_id: '' }, // variant tier only
        { sku: 'AB1234', size: 'M', qty: 5, unit_cost: 1, item_id: 'exact', po_id: '' },    // exact tier
      ],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.ties).toHaveLength(1);
    expect(p.ties[0].basis).toBe('exact');
    expect(p.ties[0].target_idx).toBe(1); // the exact-sku item, not the variant one
  });

  test('ambiguous exact tier (same sku+size, different item_id) ties nothing for that line — coverage drops', () => {
    const bill = {
      items: [
        { sku: 'DUPSKU1', size: 'M', qty: 1, unit_price: 0 }, // ambiguous
        { sku: 'UNIQSKU', size: 'L', qty: 1, unit_price: 0 }, // unambiguous
      ],
    };
    const cand = {
      id: 'SO-AMB', label: 'SO-AMB', raw: { id: 'SO-AMB' },
      items: [
        { sku: 'DUPSKU1', size: 'M', qty: 5, unit_cost: 10, item_id: 'dupA', po_id: 'PO1' },
        { sku: 'DUPSKU1', size: 'M', qty: 5, unit_cost: 10, item_id: 'dupB', po_id: 'PO1' },
        { sku: 'UNIQSKU', size: 'L', qty: 5, unit_cost: 10, item_id: 'z', po_id: 'PO1' },
      ],
    };
    const props = proposeResolutions(bill, [cand], { canonSize: canon });
    expect(props).toHaveLength(1);
    const p = props[0];
    expect(p.ties).toHaveLength(1);
    expect(p.ties[0].bill_idx).toBe(1); // only the UNIQSKU line tied
    expect(p.coverage).toBe(0.5);
  });

  test("a unique '_price' refinement can settle an otherwise-ambiguous exact tier", () => {
    const bill = { items: [{ sku: 'DUPSKU1', size: 'M', qty: 1, unit_price: 12 }] };
    const cand = {
      id: 'SO-PRC', label: 'SO-PRC', raw: { id: 'SO-PRC' },
      items: [
        { sku: 'DUPSKU1', size: 'M', qty: 5, unit_cost: 10, item_id: 'dupA', po_id: 'PO1' },
        { sku: 'DUPSKU1', size: 'M', qty: 5, unit_cost: 12, item_id: 'dupB', po_id: 'PO1' },
      ],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.ties).toHaveLength(1);
    expect(p.ties[0].basis).toBe('exact_price');
    expect(p.ties[0].target_idx).toBe(1); // the $12 bucket, matching the billed price
  });
});

// ── the `used` set: one order item-size bucket absorbs only ONE bill line ──
describe('used set — one order bucket absorbs only one bill line per proposal', () => {
  const cand = {
    id: 'SO-ONE', label: 'SO-ONE', raw: { id: 'SO-ONE' },
    items: [{ sku: 'ONESKU', size: 'M', qty: 5, unit_cost: 10, item_id: 'o1', po_id: 'PO1' }],
  };
  test('2 identical bill lines vs 1 bucket: second line unties, coverage exactly 0.5 → kept', () => {
    const bill = {
      items: [
        { sku: 'ONESKU', size: 'M', qty: 1, unit_price: 10 },
        { sku: 'ONESKU', size: 'M', qty: 1, unit_price: 10 },
      ],
    };
    const props = proposeResolutions(bill, [cand], { canonSize: canon });
    expect(props).toHaveLength(1);
    expect(props[0].coverage).toBe(0.5);
    expect(props[0].ties).toHaveLength(1);
  });
  test('3 identical bill lines vs 1 bucket: coverage 1/3 → filtered out entirely', () => {
    const bill = {
      items: [
        { sku: 'ONESKU', size: 'M', qty: 1, unit_price: 10 },
        { sku: 'ONESKU', size: 'M', qty: 1, unit_price: 10 },
        { sku: 'ONESKU', size: 'M', qty: 1, unit_price: 10 },
      ],
    };
    const props = proposeResolutions(bill, [cand], { canonSize: canon });
    expect(props).toHaveLength(0);
  });
});

// ── sizeless bill lines: sizeOk wildcard ────────────────────────────────────
describe('sizeless bill lines — sizeOk wildcard', () => {
  test('sizeless line against two size buckets of the same sku is ambiguous — no tie', () => {
    const bill = { items: [{ sku: 'MULTI1', size: '', qty: 1, unit_price: 0 }] };
    const cand = {
      id: 'SO-MULTI', label: 'SO-MULTI', raw: { id: 'SO-MULTI' },
      items: [
        { sku: 'MULTI1', size: 'M', qty: 1, unit_cost: 10, item_id: 'm1', po_id: 'PO1' },
        { sku: 'MULTI1', size: 'L', qty: 1, unit_cost: 10, item_id: 'm2', po_id: 'PO1' },
      ],
    };
    const props = proposeResolutions(bill, [cand], { canonSize: canon });
    expect(props).toHaveLength(0); // no ties at all → candidate filtered
  });
  test('sizeless line against a single size bucket ties fine', () => {
    const bill = { items: [{ sku: 'SOLO1', size: '', qty: 2, unit_price: 10 }] };
    const cand = {
      id: 'SO-SOLO', label: 'SO-SOLO', raw: { id: 'SO-SOLO' },
      items: [{ sku: 'SOLO1', size: 'M', qty: 3, unit_cost: 10, item_id: 's1', po_id: 'PO1' }],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.ties).toHaveLength(1);
    expect(p.ties[0].basis).toBe('exact');
    expect(p.ties[0].target_idx).toBe(0);
    expect(p.ties[0]).toMatchObject({ allocated_qty: 2, open_qty: 3 });
  });
});

// ── qtyMirror rules ──────────────────────────────────────────────────────────
describe('qtyMirror rules', () => {
  test('a single tie can never mirror, even when allocated exactly equals open', () => {
    const bill = { items: [{ sku: 'MIRR1', size: 'M', qty: 5, unit_price: 10 }] };
    const cand = {
      id: 'SO-MIRR', label: 'SO-MIRR', raw: { id: 'SO-MIRR' },
      items: [{ sku: 'MIRR1', size: 'M', qty: 5, unit_cost: 10, item_id: 'x1', po_id: '' }],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.ties).toHaveLength(1);
    expect(p.ties[0].allocated_qty).toBe(p.ties[0].open_qty);
    expect(p.qtyMirror).toBe(false); // requires ties.length > 1
  });
  test('partial shipment (10 of 30) breaks qtyMirror; weak-basis ties keep confidence off "high"', () => {
    const bill = {
      items: [
        { sku: 'ZZZZ9', size: 'M', qty: 10, unit_price: 0 },
        { sku: 'ZZZZ8', size: 'L', qty: 5, unit_price: 0 },
      ],
    };
    const cand = {
      id: 'SO-PART', label: 'SO-PART', raw: { id: 'SO-PART' },
      items: [
        { sku: 'AAAA1', size: 'M', qty: 30, unit_cost: 20, item_id: 'p1', po_id: '' },
        { sku: 'BBBB2', size: 'L', qty: 30, unit_cost: 20, item_id: 'p2', po_id: '' },
      ],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.ties).toHaveLength(2);
    expect(p.ties.map((t) => t.basis)).toEqual(['size_only', 'size_only']);
    expect(p.qtyMirror).toBe(false);
    expect(p.coverage).toBe(1);
    expect(p.confidence).not.toBe('high');
  });
});

// ── priceChanges: consistent-only per po_id+sku ─────────────────────────────
describe('priceChanges — consistent-only mirrors the apply rule', () => {
  test('mixed billed prices for the same po_line+sku propose NO price change; a consistent sibling group still does', () => {
    const bill = {
      items: [
        { sku: 'G1', size: 'S', qty: 1, unit_price: 6.0 },
        { sku: 'G1', size: 'M', qty: 1, unit_price: 6.5 }, // mixed vs the 6.0 above
        { sku: 'G2', size: 'S', qty: 1, unit_price: 9.0 },
        { sku: 'G2', size: 'M', qty: 1, unit_price: 9.0 }, // consistent
      ],
    };
    const cand = {
      id: 'SO-MIX', label: 'SO-MIX', raw: { id: 'SO-MIX' },
      items: [
        { sku: 'G1', size: 'S', qty: 1, unit_cost: 5.0, item_id: 'g1s', po_id: 'PO 1000 ABC' },
        { sku: 'G1', size: 'M', qty: 1, unit_cost: 5.0, item_id: 'g1m', po_id: 'PO 1000 ABC' },
        { sku: 'G2', size: 'S', qty: 1, unit_cost: 8.0, item_id: 'g2s', po_id: 'PO 1000 ABC' },
        { sku: 'G2', size: 'M', qty: 1, unit_cost: 8.0, item_id: 'g2m', po_id: 'PO 1000 ABC' },
      ],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.ties).toHaveLength(4);
    expect(p.priceChanges).toHaveLength(1);
    expect(p.priceChanges[0]).toMatchObject({ sku: 'G2', po_id: 'PO 1000 ABC', from: 8.0, to: 9.0 });
  });
  test('zero/blank billed unit_price proposes no price change even though it differs from order cost', () => {
    const bill = { items: [{ sku: 'ZP1', size: 'M', qty: 1, unit_price: '' }] };
    const cand = {
      id: 'SO-ZP', label: 'SO-ZP', raw: { id: 'SO-ZP' },
      items: [{ sku: 'ZP1', size: 'M', qty: 1, unit_cost: 5.0, item_id: 'z1', po_id: 'PO 2000 DEF' }],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.ties).toHaveLength(1);
    expect(p.priceChanges).toHaveLength(0);
  });
  test('two different po_lines, each internally consistent, produce two separate price changes', () => {
    const bill = {
      items: [
        { sku: 'PA1', size: 'S', qty: 1, unit_price: 6.0 },
        { sku: 'PA1', size: 'M', qty: 1, unit_price: 6.0 },
        { sku: 'PB1', size: 'S', qty: 1, unit_price: 4.0 },
        { sku: 'PB1', size: 'M', qty: 1, unit_price: 4.0 },
      ],
    };
    const cand = {
      id: 'SO-TWOPL', label: 'SO-TWOPL', raw: { id: 'SO-TWOPL' },
      items: [
        { sku: 'PA1', size: 'S', qty: 1, unit_cost: 5.0, item_id: 'pa1s', po_id: 'PO 3000 GHI' },
        { sku: 'PA1', size: 'M', qty: 1, unit_cost: 5.0, item_id: 'pa1m', po_id: 'PO 3000 GHI' },
        { sku: 'PB1', size: 'S', qty: 1, unit_cost: 3.0, item_id: 'pb1s', po_id: 'PO 3000 GHI' },
        { sku: 'PB1', size: 'M', qty: 1, unit_cost: 3.0, item_id: 'pb1m', po_id: 'PO 3000 GHI' },
      ],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.priceChanges).toHaveLength(2);
    expect(p.priceChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: 'PA1', from: 5.0, to: 6.0 }),
        expect.objectContaining({ sku: 'PB1', from: 3.0, to: 4.0 }),
      ])
    );
  });
});

// ── confidence ladder ────────────────────────────────────────────────────────
describe('confidence ladder', () => {
  test('coverage in [0.7, 0.99] is "medium" regardless of other factors (coverage 0.75)', () => {
    const bill = {
      items: [
        { sku: 'CVA', size: 'S', qty: 1, unit_price: 1 },
        { sku: 'CVB', size: 'S', qty: 1, unit_price: 1 },
        { sku: 'CVC', size: 'S', qty: 1, unit_price: 1 },
        { sku: 'NOPE', size: 'ZZZ', qty: 1, unit_price: 1 }, // no match
      ],
    };
    const cand = {
      id: 'SO-C75', label: 'SO-C75', raw: { id: 'SO-C75' },
      items: [
        { sku: 'CVA', size: 'S', qty: 1, unit_cost: 1, item_id: 'i1', po_id: '' },
        { sku: 'CVB', size: 'S', qty: 1, unit_cost: 1, item_id: 'i2', po_id: '' },
        { sku: 'CVC', size: 'S', qty: 1, unit_cost: 1, item_id: 'i3', po_id: '' },
      ],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.coverage).toBe(0.75);
    expect(p.confidence).toBe('medium');
  });
  test('coverage exactly 0.5 with a tag match is "medium"', () => {
    const bill = {
      po_number: 'PO 4000 XYZ', _po_raw: 'PO 4000 XYZ',
      items: [
        { sku: 'TGM1', size: 'M', qty: 1, unit_price: 1 },
        { sku: 'NOPE2', size: 'QQQ', qty: 1, unit_price: 1 }, // no match
      ],
    };
    const cand = {
      id: 'SO-TAG', label: 'SO-TAG', raw: { id: 'SO-TAG' },
      items: [{ sku: 'TGM1', size: 'M', qty: 1, unit_cost: 1, item_id: 't1', po_id: 'PO 5000 XYZ' }],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.coverage).toBe(0.5);
    expect(p.tagMatch).toBe(true);
    expect(p.confidence).toBe('medium');
  });
  test('coverage 0.6 without a tag match is "low"', () => {
    const bill = {
      items: [
        { sku: 'LOWA', size: 'S', qty: 1, unit_price: 1 },
        { sku: 'LOWB', size: 'S', qty: 1, unit_price: 1 },
        { sku: 'LOWC', size: 'S', qty: 1, unit_price: 1 },
        { sku: 'NOPE3', size: 'ZZZ1', qty: 1, unit_price: 1 }, // no match
        { sku: 'NOPE4', size: 'ZZZ2', qty: 1, unit_price: 1 }, // no match
      ],
    };
    const cand = {
      id: 'SO-LOW', label: 'SO-LOW', raw: { id: 'SO-LOW' },
      items: [
        { sku: 'LOWA', size: 'S', qty: 1, unit_cost: 1, item_id: 'l1', po_id: '' },
        { sku: 'LOWB', size: 'S', qty: 1, unit_cost: 1, item_id: 'l2', po_id: '' },
        { sku: 'LOWC', size: 'S', qty: 1, unit_cost: 1, item_id: 'l3', po_id: '' },
      ],
    };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.coverage).toBe(0.6);
    expect(p.tagMatch).toBe(false);
    expect(p.confidence).toBe('low');
  });
});

// ── poParts edge cases ───────────────────────────────────────────────────────
describe('poParts edge cases', () => {
  test('"DPO" prefix is stripped like "PO"/"P0"', () => {
    expect(poParts('DPO 4123 XYZ')).toMatchObject({ core: '4123', tag: 'XYZ' });
  });
  test('lowercase input is normalized (case-insensitive)', () => {
    expect(poParts('po 3131 tuh')).toMatchObject({ core: '3131', tag: 'TUH' });
  });
  test('trailing punctuation (e.g. an en dash) is stripped before parsing', () => {
    expect(poParts('P08689SBFBQ–')).toMatchObject({ core: '8689', tag: 'SBFBQ' });
  });
  test('pure digits parse as a bare core with an empty tag', () => {
    expect(poParts('5866407')).toMatchObject({ core: '5866407', tag: '' });
  });
  test('non-numeric input yields an empty core (and empty tag)', () => {
    expect(poParts('ABCDEF')).toMatchObject({ core: '', tag: '' });
  });
});

// ── editDistance edge cases ─────────────────────────────────────────────────
describe('editDistance edge cases', () => {
  test('transposition counts as 2 (plain Levenshtein, no Damerau transposition shortcut)', () => {
    expect(editDistance('ab', 'ba')).toBe(2);
  });
  test('pure length difference (one string a prefix of the other)', () => {
    expect(editDistance('abcdef', 'abc')).toBe(3);
    expect(editDistance('abc', 'abcdef')).toBe(3);
  });
  test('one side empty returns the other side\'s length', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });
  test('both sides empty is a distance of 0', () => {
    expect(editDistance('', '')).toBe(0);
  });
});

// ── looksPrePortalGlued edge cases ──────────────────────────────────────────
describe('looksPrePortalGlued edge cases', () => {
  test('a 3-digit core is not enough (needs 4+ digits)', () => {
    expect(looksPrePortalGlued('999AB')).toBe(false);
  });
  test('a single trailing letter is not enough (needs 2+ alpha)', () => {
    expect(looksPrePortalGlued('8379S')).toBe(false);
  });
  test('a mixed alpha/digit tail (2+ alpha somewhere in the tail) still counts', () => {
    expect(looksPrePortalGlued('8379SAV2FB')).toBe(true);
  });
  test('leading/trailing whitespace is trimmed before the internal-whitespace check', () => {
    expect(looksPrePortalGlued(' 8379SAVFBJH ')).toBe(true);
  });
});

// ── maxProposals, sorting, and near-tie demotion ────────────────────────────
describe('maxProposals cap, score-descending sort, and the near-tie demotion boundary', () => {
  const bill = {
    po_number: 'PO 1000 ABC', _po_raw: 'PO 1000 ABC',
    items: [{ sku: 'SCR1', size: 'M', qty: 5, unit_price: 10 }],
  };
  // Scores (single-tie, coverage 1 each): 80, 72, 62, 56 — all gaps >= 6, so no
  // near-tie demotion interferes with this part of the test.
  const cand1 = { id: 'SO-C1', label: 'SO-C1', raw: { id: 'SO-C1' }, // tag+core+strong = 80
    items: [{ sku: 'SCR1', size: 'M', qty: 5, unit_cost: 10, item_id: 'c1', po_id: 'PO 1001 ABC' }] };
  const cand2 = { id: 'SO-C2', label: 'SO-C2', raw: { id: 'SO-C2' }, // tag+strong, core far = 72
    items: [{ sku: 'SCR1', size: 'M', qty: 5, unit_cost: 10, item_id: 'c2', po_id: 'PO 9999 ABC' }] };
  const cand3 = { id: 'SO-C3', label: 'SO-C3', raw: { id: 'SO-C3' }, // strong only = 62
    items: [{ sku: 'SCR1', size: 'M', qty: 5, unit_cost: 10, item_id: 'c3', po_id: 'PO 8888 ZZZ' }] };
  const cand4 = { id: 'SO-C4', label: 'SO-C4', raw: { id: 'SO-C4' }, // weak basis + overage = 56
    items: [{ sku: 'DIFF1', size: 'M', qty: 3, unit_cost: 999, item_id: 'c4', po_id: 'PO 7777 ZZZ' }] };

  test('default cap is 3, sorted score-descending', () => {
    const props = proposeResolutions(bill, [cand4, cand3, cand1, cand2], { canonSize: canon });
    expect(props).toHaveLength(3);
    expect(props.map((p) => p.target.id)).toEqual(['SO-C1', 'SO-C2', 'SO-C3']);
    expect(props.map((p) => p.score)).toEqual([80, 72, 62]);
    for (let i = 1; i < props.length; i++) expect(props[i - 1].score).toBeGreaterThanOrEqual(props[i].score);
  });
  test('maxProposals caps the output below the default', () => {
    const props = proposeResolutions(bill, [cand4, cand3, cand1, cand2], { canonSize: canon, maxProposals: 2 });
    expect(props).toHaveLength(2);
    expect(props.map((p) => p.target.id)).toEqual(['SO-C1', 'SO-C2']);
  });

  test('near-tie demotion boundary: a score gap of exactly 6 does NOT demote', () => {
    const b = { items: [{ sku: 'BND1', size: 'M', qty: 5, unit_price: 10 }] };
    const P = { id: 'SO-P', label: 'SO-P', raw: { id: 'SO-P' }, // exact/strong, no overage = 62
      items: [{ sku: 'BND1', size: 'M', qty: 5, unit_cost: 10, item_id: 'p1', po_id: '' }] };
    const S = { id: 'SO-S', label: 'SO-S', raw: { id: 'SO-S' }, // weak basis + overage = 56
      items: [{ sku: 'DIFFX', size: 'M', qty: 3, unit_cost: 999, item_id: 's1', po_id: '' }] };
    const props = proposeResolutions(b, [P, S], { canonSize: canon });
    expect(props[0].target.id).toBe('SO-P');
    expect(props[0].score - props[1].score).toBe(6);
    expect(props[0].confidence).toBe('high'); // unchanged — gap not < 6
    expect(props[0].evidence.join(' ')).not.toMatch(/another order fits almost as well/);
  });
  test('near-tie demotion boundary: a score gap of 4 (< 6) DOES demote and appends evidence', () => {
    const b = { items: [{ sku: 'BND1', size: 'M', qty: 5, unit_price: 10 }] };
    const P = { id: 'SO-P', label: 'SO-P', raw: { id: 'SO-P' }, // exact/strong, no overage = 62
      items: [{ sku: 'BND1', size: 'M', qty: 5, unit_cost: 10, item_id: 'p1', po_id: '' }] };
    const U = { id: 'SO-U', label: 'SO-U', raw: { id: 'SO-U' }, // exact/strong + overage = 58
      items: [{ sku: 'BND1', size: 'M', qty: 3, unit_cost: 10, item_id: 'u1', po_id: '' }] };
    const props = proposeResolutions(b, [P, U], { canonSize: canon });
    expect(props[0].target.id).toBe('SO-P');
    expect(props[0].score - props[1].score).toBe(4);
    expect(props[0].confidence).toBe('medium'); // demoted from 'high'
    expect(props[0].evidence.join(' ')).toMatch(/another order fits almost as well/);
  });
});

describe('bulk rollup — bought in bulk, billed by size (the KJ3429/CUSTOM cleats case)', () => {
  const bill = {
    po_number: 'PO 3460 FPUSOC',
    items: [
      { sku: 'KJ3429', size: '8-', color: '', qty: 2, unit_price: 111.37, desc: 'F50 HYPERFAST ELITE CBLACK/CBL' },
      { sku: 'KJ3429', size: '9', color: '', qty: 6, unit_price: 111.37, desc: 'F50 HYPERFAST ELITE CBLACK/CBL' },
      { sku: 'KJ3429', size: '10', color: '', qty: 2, unit_price: 111.37, desc: 'F50 HYPERFAST ELITE CBLACK/CBL' },
    ],
  };
  const mkCand = (openQty, extraLine) => ({
    kind: 'so', id: 'SO-1367', label: 'SO-1367', raw: { id: 'SO-1367' },
    items: [
      { sku: 'CUSTOM', name: 'Adidas Soccer Cleats F50 / Predator', color: '', size: 'BULK', qty: openQty, unit_cost: 111.37, so_id: 'SO-1367', item_id: 'c1', po_id: 'PO 3460 FPUSOC' },
      ...(extraLine ? [{ sku: 'JX9', name: 'Other thing', color: '', size: 'M', qty: 4, unit_cost: 9, so_id: 'SO-1367', item_id: 'c2', po_id: 'PO 3460 FPUSOC' }] : []),
    ],
  });
  test('all sized lines roll up onto the PO single bulk line; sum 10 == 10 open → qty mirror, high confidence', () => {
    const p = proposeResolutions(bill, [mkCand(10)], { canonSize: canon })[0];
    expect(p).toBeTruthy();
    expect(p.coverage).toBe(1);
    expect(p.ties).toHaveLength(3);
    expect(p.ties.every((t) => t.basis === 'bulk' && t.target_idx === 0)).toBe(true);
    expect(p.qtyMirror).toBe(true);
    expect(p.overageUnits).toBe(0);
    expect(p.confidence).toBe('high');
    expect(p.evidence.join(' ')).toMatch(/roll up to the PO/);
  });
  test('rollup overage is bucket-cumulative: 10 billed vs 8 open → 2 over, not per-line noise', () => {
    const p = proposeResolutions(bill, [mkCand(8)], { canonSize: canon })[0];
    expect(p.overageUnits).toBe(2);
    expect(p.qtyMirror).toBe(false);
  });
  test('two distinct open lines: NO bulk guess between them — anchored proposal surfaces with the rest unresolved for click-linking', () => {
    const props = proposeResolutions(bill, [mkCand(10, true)], { canonSize: canon });
    expect(props).toHaveLength(1);
    const p = props[0];
    expect(p.poAnchored).toBe(true);
    expect(p.ties.every((t) => t.basis !== 'bulk')).toBe(true); // rollup refused to guess
    expect(p.unresolved.length).toBeGreaterThan(0);             // remainder left to the human
    expect(p.confidence).toBe('medium');
  });
  test('ladder ties still win first; rollup only mops up the untied remainder', () => {
    const cand = mkCand(4);
    cand.items.push({ sku: 'KJ3429', name: 'F50 Hyperfast', color: '', size: '9', qty: 6, unit_cost: 111.37, so_id: 'SO-1367', item_id: 'c1', po_id: 'PO 3460 FPUSOC' });
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    const bases = p.ties.map((t) => t.basis).sort();
    expect(bases.filter((b) => b === 'bulk').length).toBeLessThan(3);
    expect(p.ties.some((t) => /^(exact|variant)/.test(t.basis))).toBe(true);
  });
});

describe('PO-anchored linking (owner rule: exact PO match ⇒ right order, only lines open)', () => {
  const po = 'PO 5150 KCHS';
  const mkBill = (items) => ({ po_number: po, items });
  const bucket = (ti) => ({ so_id: 'SO-77', item_id: 'i' + ti, po_id: po });
  const cand = (items) => ({ kind: 'so', id: 'SO-77', label: 'SO-77', raw: { id: 'SO-77' }, items });
  test('always proposes the exact-PO order, even with ZERO auto-ties (unresolved listed for click-linking)', () => {
    const bill = mkBill([
      { sku: 'VENDOR-A', size: '', color: '', qty: 3, unit_price: 40, desc: 'MYSTERY WIDGET' },
      { sku: 'VENDOR-B', size: '', color: '', qty: 7, unit_price: 55, desc: 'OTHER WIDGET' },
    ]);
    const c = cand([
      { sku: 'CUSTOM', name: 'Warmup Jacket', color: '', size: 'BULK', qty: 3, unit_cost: 40, ...bucket(0) },
      { sku: 'CUSTOM', name: 'Warmup Pant', color: '', size: 'BULK', qty: 3, unit_cost: 41, ...bucket(1) },
      { sku: 'CUSTOM', name: 'Backpack', color: '', size: 'BULK', qty: 9, unit_cost: 20, ...bucket(2) },
    ]);
    // qty 3 is ambiguous (two buckets), qty 7 matches none exactly → still proposes, poAnchored
    const p = proposeResolutions(mkBill([{ sku: 'X1', size: '', color: '', qty: 5, unit_price: 1, desc: '' }]), [c], { canonSize: canon })[0];
    expect(p).toBeTruthy();
    expect(p.poAnchored).toBe(true);
    expect(p.unresolved).toEqual([0]);
    expect(p.confidence).toBe('medium');
    expect(p.evidence[0]).toMatch(/PO number matches this order EXACTLY/);
  });
  test('qty-unique + name-token + pigeonhole complete the links → high confidence at full coverage', () => {
    const bill = mkBill([
      { sku: 'V1', size: '', color: '', qty: 7, unit_price: 12, desc: 'SOMETHING' },          // qty-unique → i0
      { sku: 'V2', size: '', color: '', qty: 3, unit_price: 99, desc: 'BACKPACK DELUXE' },     // name token → i2
      { sku: 'V3', size: '', color: '', qty: 3, unit_price: 40, desc: 'ZZZ' },                 // pigeonhole → i1 (price 40 matches nothing)
    ]);
    const c = cand([
      { sku: 'CUSTOM', name: 'Warmup Jacket', color: '', size: 'BULK', qty: 7, unit_cost: 12, ...bucket(0) },
      { sku: 'CUSTOM', name: 'Warmup Pant', color: '', size: 'BULK', qty: 3, unit_cost: 41, ...bucket(1) },
      { sku: 'CUSTOM', name: 'Team Backpack', color: '', size: 'BULK', qty: 3, unit_cost: 99, ...bucket(2) },
    ]);
    const p = proposeResolutions(bill, [c], { canonSize: canon })[0];
    expect(p.coverage).toBe(1);
    expect(p.confidence).toBe('high');
    const basisByLine = Object.fromEntries(p.ties.map((t) => [t.bill_idx, t.basis]));
    expect(basisByLine[0]).toBe('po_qty');
    expect(basisByLine[1]).toBe('po_name');
    expect(basisByLine[2]).toBe('po_last_pair');
  });
  test('a merely core-matched (tag differs) candidate is NOT anchored — no loose tiers, floor still applies', () => {
    const bill = { po_number: 'PO 5150 AAAA', items: [{ sku: 'V1', size: '', color: '', qty: 7, unit_price: 12, desc: 'X' }] };
    const c = cand([{ sku: 'CUSTOM', name: 'Warmup Jacket', color: '', size: 'BULK', qty: 7, unit_cost: 12, ...bucket(0) }]);
    const props = proposeResolutions(bill, [c], { canonSize: canon });
    expect(props.some((p) => p.poAnchored)).toBe(false);
  });
});

describe('desc-derived style hint (SanMar 2649531-class SKUs — style leads the description)', () => {
  const { descStyleToken } = require('../billResolve');
  test('descStyleToken extracts the leading mfr style, digit-required, never a word', () => {
    expect(descStyleToken('64800L. GLDN Softstyle Wms Piq')).toBe('64800L');
    expect(descStyleToken('LST550 Sport-Tek Womens PosiCharge')).toBe('LST550');
    expect(descStyleToken('YOUTH GARMENT-DYED TEE')).toBe('');
    expect(descStyleToken('')).toBe('');
  });
  test('the real SanMar SO-1396 case: numeric per-size SKUs tie by desc style + color + size', () => {
    const bill = {
      po_number: 'PO 3521 OLuST',
      items: [
        { sku: '2649531', size: 'S', color: 'Black', qty: 60, unit_price: 6.62, desc: '64800L. GLDN Softstyle Wms Piq' },
        { sku: '2649551', size: 'S', color: 'Red', qty: 60, unit_price: 6.62, desc: '64800L. GLDN Softstyle Wms Piq' },
      ],
    };
    const cand = { kind: 'so', id: 'SO-1396', label: 'SO-1396', raw: { id: 'SO-1396' },
      items: [
        { sku: '64800L', name: 'Gildan Softstyle Wms Pique 64800L', color: 'Black', size: 'S', qty: 60, unit_cost: 6.62, so_id: 'SO-1396', item_id: 'g1', po_id: 'PO 3521 OLuST' },
        { sku: '64800L', name: 'Gildan Softstyle Wms Pique 64800L', color: 'Red', size: 'S', qty: 60, unit_cost: 6.62, so_id: 'SO-1396', item_id: 'g2', po_id: 'PO 3521 OLuST' },
        { sku: '18600', name: 'Gildan Heavy Blend Hoodie 18600', color: 'Black', size: 'S', qty: 15, unit_cost: 15.26, so_id: 'SO-1396', item_id: 'h1', po_id: 'PO 3521 OLuST' },
      ] };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.coverage).toBe(1);
    expect(p.ties.map((t) => t.basis).every((b2) => /^style/.test(b2))).toBe(true);
    expect(p.confidence).toBe('high');
  });
  test('duplicate order lines (same style+color+size on two item rows) stay ambiguous → unresolved for chips', () => {
    const bill = { po_number: 'PO 3521 OLuST', items: [
      { sku: '2649531', size: 'S', color: 'Black', qty: 60, unit_price: 6.62, desc: '64800L. GLDN Softstyle Wms Piq' } ] };
    const cand = { kind: 'so', id: 'SO-1396', label: 'SO-1396', raw: { id: 'SO-1396' },
      items: [
        { sku: '64800L', name: 'Gildan 64800L', color: 'Black', size: 'S', qty: 30, unit_cost: 6.62, so_id: 'SO-1396', item_id: 'dupA', po_id: 'PO 3521 OLuST' },
        { sku: '64800L', name: 'Gildan 64800L', color: 'Black', size: 'S', qty: 30, unit_cost: 6.62, so_id: 'SO-1396', item_id: 'dupB', po_id: 'PO 3521 OLuST' },
      ] };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.poAnchored).toBe(true);
    expect(p.unresolved).toEqual([0]); // never guesses between duplicate lines
  });
});
