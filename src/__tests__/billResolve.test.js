// Unit tests for the resolution-proposal engine (src/billResolve.js).
// Fixtures mirror REAL production cases from the 2026-07-16 reconciliation audit:
// the Trinity typo'd-PO bill, the Agron SKU-suffix bill, and the prefix-less
// old-system PO class.
const { proposeResolutions, cleanAutoAccept, highConfidenceAutoAccept, vendorsCompatible, poParts, editDistance, looksPrePortalGlued } = require('../billResolve');

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
        // Priced lines (a $0 line is a no-money memo with its own semantics — see the
        // zero-dollar describe block): this test is about exact-tier ambiguity only.
        { sku: 'DUPSKU1', size: 'M', qty: 1, unit_price: 10 }, // ambiguous
        { sku: 'UNIQSKU', size: 'L', qty: 1, unit_price: 10 }, // unambiguous
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
    const S = { id: 'SO-S', label: 'SO-S', raw: { id: 'SO-S' }, // weak basis (size_price) + overage = 56
      items: [{ sku: 'DIFFX', size: 'M', qty: 3, unit_cost: 10, item_id: 's1', po_id: '' }] };
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

describe('bulk rollup must respect the ACCOUNT (the OLuSOCG↔FPUTN cross-customer case, 2026-07-23)', () => {
  // Real case: an S&S bill tagged "PO 3283 OLuSOCG" (Orange Lutheran) was bulk-rolled onto
  // Fresno Pacific's "PO 3283 FPUTN" single open line purely because the bare number 3283
  // matched — a wrong-customer proposal. The bulk rollup now refuses a bare-number collision
  // with a different account (alpha_tags), so a different-customer order is never proposed.
  const ssBill = {
    po_number: 'PO 3283 OLuSOCG',
    vendor: 'S&S Activewear',
    items: [
      { sku: 'B027F8504', size: 'M', color: 'Black/ White', qty: 1, unit_price: 15, desc: "Men's Pregame T-Shirt" },
      { sku: 'B027F8505', size: 'L', color: 'Black/ White', qty: 10, unit_price: 15, desc: "Men's Pregame T-Shirt" },
    ],
  };
  const fresnoCand = {
    kind: 'so', id: 'SO-1096', label: 'SO-1096', raw: { id: 'SO-1096' }, alpha_tags: ['FPUTN'],
    items: [
      { sku: 'KC0865', name: 'Adidas Tiro W Woven Top', color: 'Navy/ White', size: 'BULK', qty: 18, unit_cost: 28.13, so_id: 'SO-1096', item_id: 'k1', po_id: 'PO 3283 FPUTN' },
    ],
  };
  test('a different customer sharing only the bare PO number is NOT proposed (no cross-account bulk)', () => {
    const props = proposeResolutions(ssBill, [fresnoCand], { canonSize: canon });
    expect(props.find((p) => p.target.id === 'SO-1096')).toBeUndefined();
  });
  test('the SAME-account order still bulk-rolls — even when the vendor mangled the tag (poAnchored false)', () => {
    // Orange Lutheran order: alpha_tag matches the bill, but its po_id tag is typo'd (missing G),
    // so poAnchored is false — the account-gated bulk path (not the exact-PO override) must fire.
    const orangeCand = {
      kind: 'so', id: 'SO-1251', label: 'SO-1251', raw: { id: 'SO-1251' }, alpha_tags: ['OLUSOCG'],
      items: [
        { sku: 'JX4452', name: 'Adidas Unisex Pregame Tee', color: 'Black/ White', size: 'BULK', qty: 11, unit_cost: 11.25, so_id: 'SO-1251', item_id: 'j1', po_id: 'PO 3283 OLUSOC' },
      ],
    };
    const p = proposeResolutions(ssBill, [orangeCand], { canonSize: canon })[0];
    expect(p).toBeTruthy();
    expect(p.target.id).toBe('SO-1251');
    expect(p.poAnchored).toBe(false);
    expect(p.ties.length).toBe(2);
    expect(p.ties.every((t) => t.basis === 'bulk')).toBe(true);
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
  test('name-token + qty-unique complete the links → high confidence at full coverage', () => {
    // Name runs FIRST now (Predator/Supernova lesson): the backpack line name-ties before
    // any quantity coincidence can claim its bucket; the remaining two resolve by qty.
    const bill = mkBill([
      { sku: 'V1', size: '', color: '', qty: 7, unit_price: 12, desc: 'SOMETHING' },          // qty-unique → i0
      { sku: 'V2', size: '', color: '', qty: 3, unit_price: 99, desc: 'BACKPACK DELUXE' },     // name token → i2
      { sku: 'V3', size: '', color: '', qty: 3, unit_price: 40, desc: 'ZZZ' },                 // qty-unique after i2 taken → i1
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
    expect(basisByLine[2]).toBe('po_qty');
    const tgtByLine = Object.fromEntries(p.ties.map((t) => [t.bill_idx, t.target_idx]));
    expect(tgtByLine[1]).toBe(2); // backpack → Team Backpack, by NAME
    expect(tgtByLine[2]).toBe(1); // pant bucket — same target the old pigeonhole reached
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

// ── Learned vendor-number aliases (bill_sku_aliases → bl._alias_sku) ──────────
// The UA/Seton case: "Under Armour puts on their invoice a different number than
// we order with." Once a pushed bill teaches B199E2655 → 1390159-410, the next
// bill with that number ties at exact grade.
describe('learned vendor-number aliases', () => {
  const uaCand = {
    kind: 'so', id: 'SO-1527', label: 'SO-1527', sub: 'Sales Order · Seton Track', raw: { id: 'SO-1527' },
    items: [
      { sku: '1390159-410', name: 'UA Rival Stretch Woven Full-Zip', color: 'Navy', size: 'L', qty: 5, unit_cost: 42.25, so_id: 'SO-1527', item_id: 'a1', po_id: 'PO 13553 STCC' },
      { sku: '1390160-001', name: 'UA Rival Pant', color: 'Black', size: 'L', qty: 4, unit_cost: 30, so_id: 'SO-1527', item_id: 'a2', po_id: 'PO 13553 STCC' },
    ],
  };
  test('a line with _alias_sku ties to its portal SKU (basis alias), even with no PO anchor', () => {
    const bill = { po_number: 'PO 99999 ZZZ', items: [
      { sku: 'B199E2655', _alias_sku: '1390159-410', size: 'L', qty: 5, unit_price: 42.25 },
    ] };
    const p = proposeResolutions(bill, [uaCand], { canonSize: canon })[0];
    expect(p).toBeTruthy();
    expect(p.ties.length).toBe(1);
    expect(p.ties[0].basis).toBe('alias');
    expect(uaCand.items[p.ties[0].target_idx].sku).toBe('1390159-410');
  });
  test('alias ties are strong bases: full-coverage alias bill reads high with alias evidence', () => {
    const bill = { po_number: 'PO 13553 STCC', items: [
      { sku: 'B199E2655', _alias_sku: '1390159-410', size: 'L', qty: 5, unit_price: 42.25 },
      { sku: 'B199E7777', _alias_sku: '1390160-001', size: 'L', qty: 4, unit_price: 30 },
    ] };
    const p = proposeResolutions(bill, [uaCand], { canonSize: canon })[0];
    expect(p.ties.every((t) => t.basis === 'alias')).toBe(true);
    expect(p.confidence).toBe('high');
    expect(p.evidence.join(' ')).toMatch(/alias/);
  });
});

// ── cleanAutoAccept — "PO matches and the cost matches perfectly → go to match" ──
describe('cleanAutoAccept auto-match gate', () => {
  const cand = {
    kind: 'so', id: 'SO-1527', label: 'SO-1527', sub: 'Sales Order · Seton Track', raw: { id: 'SO-1527' },
    items: [
      { sku: '1390159-410', name: 'UA Rival Full-Zip', color: 'Navy', size: 'L', qty: 5, unit_cost: 42.25, so_id: 'SO-1527', item_id: 'a1', po_id: 'PO 13553 STCC' },
      { sku: '1390160-001', name: 'UA Rival Pant', color: 'Black', size: 'L', qty: 4, unit_cost: 30, so_id: 'SO-1527', item_id: 'a2', po_id: 'PO 13553 STCC' },
    ],
  };
  const cleanBill = { po_number: 'PO 13553 STCC', items: [
    { sku: '1390159-410', size: 'L', qty: 5, unit_price: 42.25 },
    { sku: '1390160-001', size: 'L', qty: 4, unit_price: 30 },
  ] };
  test('fires on the clean class: PO exact, all lines tied, costs equal to the penny', () => {
    const p = proposeResolutions(cleanBill, [cand], { canonSize: canon })[0];
    expect(p.poAnchored).toBe(true);
    expect(p.confidence).toBe('high');
    expect(cleanAutoAccept(p, cleanBill.items)).toBe(true);
  });
  test('refuses when any billed price differs from the order cost', () => {
    const bill = { ...cleanBill, items: cleanBill.items.map((l, i) => (i === 0 ? { ...l, unit_price: 45.0 } : l)) };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p).toBeTruthy();
    expect(cleanAutoAccept(p, bill.items)).toBe(false);
  });
  test('refuses when a line is left unresolved', () => {
    const bill = { ...cleanBill, items: [...cleanBill.items, { sku: 'UNKNOWN999', size: 'M', qty: 2, unit_price: 10 }] };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.unresolved.length).toBe(1);
    expect(cleanAutoAccept(p, bill.items)).toBe(false);
  });
  test('refuses on bucket overage — the 9-billed-into-5-open bulk wrinkle', () => {
    const bulkCand = {
      kind: 'so', id: 'SO-1527', label: 'SO-1527', raw: { id: 'SO-1527' },
      items: [{ sku: '1390159-410', name: 'UA Rival Full-Zip', color: 'Navy', size: 'L', qty: 5, unit_cost: 42.25, so_id: 'SO-1527', item_id: 'a1', po_id: 'PO 13553 STCC' }],
    };
    const bill = { po_number: 'PO 13553 STCC', items: [
      { sku: 'B199E2655', size: 'L', qty: 5, unit_price: 42.25 },
      { sku: 'B196E2652', size: 'XS', qty: 1, unit_price: 42.25 },
      { sku: 'B196E2653', size: 'S', qty: 3, unit_price: 42.25 },
    ] };
    const p = proposeResolutions(bill, [bulkCand], { canonSize: canon })[0];
    expect(p.overageUnits).toBe(4);
    expect(cleanAutoAccept(p, bill.items)).toBe(false);
  });
  test('refuses without an exact PO anchor, even when every SKU ties', () => {
    const bill = { ...cleanBill, po_number: 'PO 13554 STCC' };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.poAnchored).toBe(false);
    expect(cleanAutoAccept(p, bill.items)).toBe(false);
  });
});

// ── highConfidenceAutoAccept — the widened gate (owner, 2026-07-21) ──────────
describe('highConfidenceAutoAccept widened gate', () => {
  const cand = {
    kind: 'so', id: 'SO-1527', label: 'SO-1527', raw: { id: 'SO-1527' },
    items: [
      { sku: '1390159-410', name: 'UA Rival Full-Zip', color: 'Navy', size: 'L', qty: 5, unit_cost: 42.25, so_id: 'SO-1527', item_id: 'a1', po_id: 'PO 13553 STCC' },
      { sku: '1390160-001', name: 'UA Rival Pant', color: 'Black', size: 'L', qty: 4, unit_cost: 30, so_id: 'SO-1527', item_id: 'a2', po_id: 'PO 13553 STCC' },
    ],
  };
  const baseBill = { po_number: 'PO 13553 STCC', items: [
    { sku: '1390159-410', size: 'L', qty: 5, unit_price: 42.25 },
    { sku: '1390160-001', size: 'L', qty: 4, unit_price: 30 },
  ] };
  test('accepts a modest price change (≤25%) that cleanAutoAccept refuses', () => {
    const bill = { ...baseBill, items: baseBill.items.map((l, i) => (i === 0 ? { ...l, unit_price: 45.0 } : l)) }; // +6.5%
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.confidence).toBe('high');
    expect(p.priceChanges.length).toBe(1);
    expect(cleanAutoAccept(p, bill.items)).toBe(false);
    expect(highConfidenceAutoAccept(p)).toBe(true);
  });
  test('still refuses a sharp (>25%) price gap — confidence was demoted upstream', () => {
    const bill = { ...baseBill, items: baseBill.items.map((l, i) => (i === 0 ? { ...l, unit_price: 111.37 } : l)) };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.confidence).not.toBe('high');
    expect(highConfidenceAutoAccept(p)).toBe(false);
  });
  test('still refuses unresolved lines, overage, and non-anchored proposals', () => {
    const extra = { ...baseBill, items: [...baseBill.items, { sku: 'UNKNOWN999', size: 'M', qty: 2, unit_price: 10 }] };
    expect(highConfidenceAutoAccept(proposeResolutions(extra, [cand], { canonSize: canon })[0])).toBe(false);
    const offPo = { ...baseBill, po_number: 'PO 13554 STCC' };
    expect(highConfidenceAutoAccept(proposeResolutions(offPo, [cand], { canonSize: canon })[0])).toBe(false);
    const bulkCand = { kind: 'so', id: 'SO-1527', label: 'SO-1527', raw: { id: 'SO-1527' },
      items: [{ sku: '1390159-410', name: 'UA Rival Full-Zip', size: 'L', qty: 5, unit_cost: 42.25, so_id: 'SO-1527', item_id: 'a1', po_id: 'PO 13553 STCC' }] };
    const overBill = { po_number: 'PO 13553 STCC', items: [
      { sku: 'B199E2655', size: 'L', qty: 5, unit_price: 42.25 },
      { sku: 'B196E2652', size: 'XS', qty: 4, unit_price: 42.25 },
    ] };
    const p = proposeResolutions(overBill, [bulkCand], { canonSize: canon })[0];
    expect(p.overageUnits).toBeGreaterThan(0);
    expect(highConfidenceAutoAccept(p)).toBe(false);
  });
});

// ── Money honesty: a sharp price gap must not read "Strong match" ─────────────
// The Adidas F50 case: right ORDER (PO exact) but $111.37 lines landing on $41.25
// siblings by size alone — accepting would rewrite order costs by 170%.
describe('sharp price gap demotes confidence', () => {
  const cand = {
    kind: 'so', id: 'SO-1367', label: 'SO-1367', sub: 'Sales Order · Fresno Pacific', raw: { id: 'SO-1367' },
    items: [
      { sku: 'JH8559', name: 'Predator Elite FG', color: 'White/Black', size: '8', qty: 4, unit_cost: 41.25, so_id: 'SO-1367', item_id: 'j1', po_id: 'PO 3460 FPUSOC' },
      { sku: 'JH8559', name: 'Predator Elite FG', color: 'White/Black', size: '11', qty: 3, unit_cost: 41.25, so_id: 'SO-1367', item_id: 'j1', po_id: 'PO 3460 FPUSOC' },
    ],
  };
  const bill = { po_number: 'PO 3460 FPUSOC', items: [
    { sku: 'JR5386', size: '8', qty: 3, unit_price: 111.37, desc: 'F50 HYPERFAST ELITE SOLTUR/CBL' },
    { sku: 'JR5386', size: '11', qty: 1, unit_price: 111.37, desc: 'F50 HYPERFAST ELITE SOLTUR/CBL' },
  ] };
  test('PO-anchored full coverage with a 170% cost rewrite reads medium, says why, and never auto-matches', () => {
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.poAnchored).toBe(true);
    expect(p.priceChanges.length).toBeGreaterThan(0);
    expect(p.confidence).toBe('medium');
    expect(p.evidence.join(' ')).toMatch(/differs sharply/);
    expect(cleanAutoAccept(p, bill.items)).toBe(false);
  });
  test('a modest, plausible price update (under 25%) does NOT demote', () => {
    const b2 = { po_number: 'PO 3460 FPUSOC', items: [
      { sku: 'JH8559', size: '8', qty: 4, unit_price: 44.5 },
      { sku: 'JH8559', size: '11', qty: 3, unit_price: 44.5 },
    ] };
    const p = proposeResolutions(b2, [cand], { canonSize: canon })[0];
    expect(p.priceChanges.length).toBe(1);
    expect(p.confidence).toBe('high');
    expect(cleanAutoAccept(p, b2.items)).toBe(false); // price change still blocks AUTO — humans confirm money
  });
});

// ── $0 service lines (embroidery memo) never consume order quantity ───────────
// The real Richardson bill (Inv 4670528, PO 3318 LLBB): 48 caps billed by size plus a
// "91-T1 Direct Embroidery · 48 @ $0.00" service line. Rolled into the cap bucket, that
// $0 line fabricated 96-vs-16 phantom overage. $0 lines carry no money — ignore them.
describe('zero-dollar service lines are ignored', () => {
  const cand = { kind: 'so', id: 'SO-1275', label: 'SO-1275', raw: { id: 'SO-1275' }, items: [
    { sku: 'PTS20', name: 'PTS20 Richardson Cap', color: 'Gold/Navy', size: 'LG-XL', qty: 16, unit_cost: 13, so_id: 'SO-1275', item_id: 'p1', po_id: 'PO 3318 LLBB' },
  ] };
  const bill = { po_number: 'PO 3318 LLBB', items: [
    { sku: 'PTS20S2-GN-XS', size: '', qty: 8, unit_price: 12, desc: 'PTS20 Alternate Gold/Navy XS-S' },
    { sku: 'PTS20S2-GN-SM', size: '', qty: 24, unit_price: 12, desc: 'PTS20 Alternate Gold/Navy SM-M' },
    { sku: 'PTS20S2-GN-ML', size: '', qty: 16, unit_price: 12, desc: 'PTS20 Alternate Gold/Navy LG-X' },
    { sku: '91-T1', size: '', qty: 48, unit_price: 0, desc: 'Direct Embroidery - Team Custom' },
  ] };
  test('the 48-unit $0 embroidery line neither ties nor counts: real overage is 32, not 80', () => {
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p).toBeTruthy();
    expect(p.ties.some((t) => bill.items[t.bill_idx].sku === '91-T1')).toBe(false);
    expect(p.unresolved.includes(3)).toBe(false); // not even "needs a match" — it needs nothing
    expect(p.ties.length).toBe(3);
    expect(p.overageUnits).toBe(32); // 48 caps billed vs 16 ordered — the REAL discrepancy
    expect(cleanAutoAccept(p, bill.items)).toBe(false); // overage + price change still get a human
  });
});

// ── Name evidence beats size/qty coincidence (the Predator/Supernova case) ────
// Real bill: JP6237 "PREDATOR ELITE FT F SOLTUR/THE" sizes 8-/9-/12 @ $115.50 on
// PO 3460 FPUSOC. The order has JH8559 "Adidas Supernova Ease" (a $41.25 running
// shoe, sizes that overlap) AND a CUSTOM "Adidas Soccer Cleats F50 / Predator"
// bulk line @ $105. size_only used to tie the cleats to the Supernova by size.
describe('name evidence beats size/qty coincidence', () => {
  const cand = { kind: 'so', id: 'SO-1367', label: 'SO-1367', raw: { id: 'SO-1367' }, items: [
    { sku: 'JH8559', name: 'Adidas Supernova Ease', color: 'White/Black', size: '8.5', qty: 3, unit_cost: 41.25, so_id: 'SO-1367', item_id: 'j1', po_id: 'PO 3460 FPUSOC' },
    { sku: 'JH8559', name: 'Adidas Supernova Ease', color: 'White/Black', size: '9.5', qty: 7, unit_cost: 41.25, so_id: 'SO-1367', item_id: 'j1', po_id: 'PO 3460 FPUSOC' },
    { sku: 'JH8559', name: 'Adidas Supernova Ease', color: 'White/Black', size: '12', qty: 2, unit_cost: 41.25, so_id: 'SO-1367', item_id: 'j1', po_id: 'PO 3460 FPUSOC' },
    { sku: 'CUSTOM', name: 'Adidas Soccer Cleats F50 / Predator', color: '', size: 'OSFA', qty: 40, unit_cost: 105, so_id: 'SO-1367', item_id: 'c1', po_id: 'PO 3460 FPUSOC' },
  ] };
  const bill = { po_number: 'PO 3460 FPUSOC', items: [
    { sku: 'JP6237', size: '8-', qty: 1, unit_price: 115.5, desc: 'PREDATOR ELITE FT F SOLTUR/THE' },
    { sku: 'JP6237', size: '9-', qty: 5, unit_price: 115.5, desc: 'PREDATOR ELITE FT F SOLTUR/THE' },
    { sku: 'JP6237', size: '12', qty: 2, unit_price: 115.5, desc: 'PREDATOR ELITE FT F SOLTUR/THE' },
  ] };
  const canonShoe = (s) => { const m = String(s || '').trim().match(/^(\d{1,2})\s*[-–]$/); return m ? m[1] + '.5' : String(s || '').toUpperCase().trim(); };
  test('all three cleat lines tie to the Predator CUSTOM line by name — none to the Supernova', () => {
    const p = proposeResolutions(bill, [cand], { canonSize: canonShoe })[0];
    expect(p).toBeTruthy();
    expect(p.poAnchored).toBe(true);
    expect(p.ties).toHaveLength(3);
    expect(p.ties.every((t) => t.basis === 'po_name')).toBe(true);
    expect(p.ties.every((t) => cand.items[t.target_idx].sku === 'CUSTOM')).toBe(true);
    expect(p.overageUnits).toBe(0); // 8 units into 40 open
  });
  test('size_only refuses a >50% price gap even without the name rescue', () => {
    const b2 = { po_number: 'PO 9999 ZZZ', items: [ // unanchored: no PO tiers to fall back on
      { sku: 'JP6237', size: '12', qty: 2, unit_price: 115.5, desc: 'no useful tokens here' },
    ] };
    const c2 = { kind: 'so', id: 'SO-X', label: 'SO-X', raw: { id: 'SO-X' }, items: [
      { sku: 'JH8559', name: 'Adidas Supernova Ease', color: '', size: '12', qty: 2, unit_cost: 41.25, so_id: 'SO-X', item_id: 'x', po_id: 'PO 8888 YYY' },
    ] };
    const props = proposeResolutions(b2, [c2], { canonSize: canonShoe });
    expect(props).toHaveLength(0); // no tie at all beats a confidently wrong one
  });
});

// ── Weak-guess demotion — weak tiers only + huge price gap (the Ultimate365 case) ──
// Real bill: B01153005 "adidas Ultimate365 QTR ZIP Pullover" @ $30, PO "Sample". The
// engine tied it to 510000 "Momentec C2 TEE" @ $3.48 on batch NSA 4554 via color_size
// (+762%) — the money check screamed "BIG GAP" yet the panel still offered an orange
// Accept. Rule: all-weak-tier ties + a >50% unit-cost gap = a hint, never a Best answer.
describe('weak-guess demotion — weak-tier ties with a huge price gap never read as acceptable', () => {
  const teeCand = { kind: 'batch', id: 'B-4554', label: 'NSA 4554', sub: 'Batch PO', raw: { po_number: 'NSA 4554' }, items: [
    { sku: '510000', name: 'Momentec C2 TEE', color: 'Black', size: 'M', qty: 24, unit_cost: 3.48, po_id: 'NSA 4554' },
  ] };
  const pulloverBill = (price) => ({ po_number: 'Sample', items: [
    { sku: 'B01153005', size: 'M', color: 'Black', qty: 1, unit_price: price, desc: 'ADIDAS ULTIMATE365 QTR ZIP PULLOVER' },
  ] });
  test('color_size tie at +762% → weakGuess: low confidence, flagged, auto-accept refused', () => {
    const p = proposeResolutions(pulloverBill(30), [teeCand], { canonSize: canon })[0];
    expect(p).toBeTruthy();
    expect(p.ties.map((t) => t.basis)).toEqual(['color_size']);
    expect(p.weakGuess).toBe(true);
    expect(p.weakGapPct).toBeGreaterThan(700);
    expect(p.confidence).toBe('low');
    expect(p.evidence.join(' ')).toMatch(/hint, not a match/);
    expect(cleanAutoAccept(p, pulloverBill(30).items)).toBe(false);
    expect(highConfidenceAutoAccept(p)).toBe(false);// the widened auto-push gate must refuse a weak guess too
  });
  test('a small price gap no longer rescues CONFLICTING descriptions (owner 2026-07-23): pullover→tee is a hint even at ~9% off', () => {
    const p = proposeResolutions(pulloverBill(3.79), [teeCand], { canonSize: canon })[0]; // ~9% off, but "Ultimate365 Pullover" vs "Momentec C2 TEE"
    expect(p).toBeTruthy();
    expect(p.ties.map((t) => t.basis)).toEqual(['color_size']);
    expect(p.descConflict).toBe(true);
    expect(p.weakGuess).toBe(true);
    expect(p.confidence).toBe('low');
  });
  test('the same weak tie with an AGREEING description and small gap stays proposable', () => {
    const bill = { po_number: 'Sample', items: [
      { sku: 'B01153005', size: 'M', color: 'Black', qty: 1, unit_price: 3.79, desc: 'MOMENTEC C2 TEE BLACK' },
    ] };
    const p = proposeResolutions(bill, [teeCand], { canonSize: canon })[0];
    expect(p).toBeTruthy();
    expect(p.ties.map((t) => t.basis)).toEqual(['color_size']);
    expect(p.descConflict).toBeFalsy();
    expect(p.weakGuess).toBeFalsy();
    expect(p.confidence).toBe('medium'); // unanchored full-coverage — unchanged behavior
  });
  test('strong-tier tie with the same huge gap keeps existing sharp-price behavior (high → medium, never weakGuess)', () => {
    const bill = { po_number: 'PO 9000 ZZT', items: [{ sku: '510000', size: 'M', color: 'Black', qty: 24, unit_price: 30 }] };
    const cand = { kind: 'so', id: 'SO-9000', label: 'SO-9000', raw: { id: 'SO-9000' }, items: [
      { sku: '510000', name: 'Momentec C2 TEE', color: 'Black', size: 'M', qty: 24, unit_cost: 3.48, so_id: 'SO-9000', item_id: 't1', po_id: 'PO 9000 ZZT' },
    ] };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.ties.map((t) => t.basis)).toEqual(['exact']);
    expect(p.weakGuess).toBeFalsy();
    expect(p.confidence).toBe('medium'); // sharp-price demotion from high — today's behavior, unchanged
    expect(p.evidence.join(' ')).toMatch(/differs sharply/);
    expect(cleanAutoAccept(p, bill.items)).toBe(false); // price change still blocks AUTO
  });
  test('an exact-PO anchor exempts a weak-tier tie from the demotion (owner rule: PO match ⇒ right order)', () => {
    const bill = { po_number: 'PO 9001 ZZT', items: [{ sku: 'BXX999', size: 'M', color: 'Black', qty: 2, unit_price: 30, desc: 'no tokens' }] };
    const cand = { kind: 'so', id: 'SO-9001', label: 'SO-9001', raw: { id: 'SO-9001' }, items: [
      { sku: '510000', name: 'Tee', color: 'Black', size: 'M', qty: 2, unit_cost: 3.48, so_id: 'SO-9001', item_id: 't1', po_id: 'PO 9001 ZZT' },
    ] };
    const p = proposeResolutions(bill, [cand], { canonSize: canon })[0];
    expect(p.poAnchored).toBe(true);
    expect(p.ties.map((t) => t.basis)).toEqual(['color_size']);
    expect(p.weakGuess).toBeFalsy(); // the PO anchor is real order-level evidence; money check still flags the price
  });
});

// ── Vendor gate — the Momentec→SanMar wrong-cost class (owner, 2026-07-21) ────
describe('vendor gate', () => {
  test('vendorsCompatible: containment, token overlap, stop-words, unknowns', () => {
    expect(vendorsCompatible('Momentec', 'MOMENTEC BRANDS')).toBe(true);
    expect(vendorsCompatible('MOMENTEC BRANDS', 'SANMAR')).toBe(false);
    expect(vendorsCompatible('SCHUTT SPORTS', 'WILSON SPORTING GOODS CO')).toBe(false); // generic tokens don't match
    expect(vendorsCompatible('', 'SANMAR')).toBe(true);   // unknown never blocks
    expect(vendorsCompatible('S&S Activewear', '')).toBe(true);
  });
  const sanmarCand = {
    kind: 'so', id: 'SO-1153', label: 'SO-1153', raw: { id: 'SO-1153' },
    items: ['S', 'M', 'L', '2XL'].map((size, i) => ({
      sku: '1717', name: 'Comfort Colors Heavyweight Tee', size, qty: 50, unit_cost: 5.18,
      so_id: 'SO-1153', item_id: 'c' + i, po_id: 'PO 3100 CLHS', vendor: 'SANMAR',
    })),
  };
  const momentecBill = { po_number: 'PO 3432 WHGB', vendor: 'MOMENTEC BRANDS', items: [
    { sku: '560RW', desc: 'LADIES REVERSIBLE MESH JERSEY', size: 'SMALL', qty: 14, unit_price: 5.86 },
    { sku: '560RW', desc: 'LADIES REVERSIBLE MESH JERSEY', size: 'MEDIU', qty: 14, unit_price: 5.86 },
    { sku: '560RW', desc: 'LADIES REVERSIBLE MESH JERSEY', size: 'LARGE', qty: 5, unit_price: 5.86 },
  ] };
  // Mirrors App._canonBillSize's truncated-word branch (scanned bills cut columns mid-word).
  const scanCanon = (s) => {
    const t = String(s || '').toUpperCase().trim();
    if (/^SMAL{1,2}$/.test(t)) return 'S';
    if (/^MEDIU?M?$/.test(t)) return 'M';
    if (/^LARGE?$/.test(t) || t === 'LARG') return 'L';
    return t;
  };
  test('a Momentec bill never proposes a SanMar-only order by size coincidence', () => {
    const props = proposeResolutions(momentecBill, [sanmarCand], { canonSize: scanCanon });
    expect(props).toHaveLength(0); // unanchored cross-vendor candidate is dropped outright
  });
  test('the same candidate still proposes when the bill has no vendor (unknown never blocks)', () => {
    const noVend = { ...momentecBill, vendor: undefined };
    // Same customer tag as the bill so the (separate) tag-mismatch gate stays out of the way.
    const sameTag = { ...sanmarCand, items: sanmarCand.items.map((it) => ({ ...it, po_id: 'PO 3100 WHGB' })) };
    const props = proposeResolutions(noVend, [sameTag], { canonSize: scanCanon });
    expect(props.length).toBeGreaterThan(0);
  });
  test('an exact-PO anchor rescues a cross-vendor candidate, with the supplier difference in evidence', () => {
    const anchored = { ...sanmarCand, items: sanmarCand.items.map((it) => ({ ...it, po_id: 'PO 3432 WHGB' })) };
    const props = proposeResolutions(momentecBill, [anchored], { canonSize: scanCanon });
    expect(props.length).toBeGreaterThan(0);
    expect(props[0].poAnchored).toBe(true);
    expect(props[0].evidence.join(' ')).toMatch(/supplier differs/);
  });
  test('same-vendor candidate wins normally, and truncated scan sizes tie via canon', () => {
    const momCand = {
      kind: 'so', id: 'SO-1116', label: 'SO-1116', raw: { id: 'SO-1116' },
      items: [
        { sku: '506CRW', name: 'Ladies Microfiber Reversible Jersey', size: 'S', qty: 14, unit_cost: 5.06, so_id: 'SO-1116', item_id: 'm1', po_id: 'PO 3432 WHGB', vendor: 'Momentec' },
        { sku: '506CRW', name: 'Ladies Microfiber Reversible Jersey', size: 'M', qty: 14, unit_cost: 5.06, so_id: 'SO-1116', item_id: 'm2', po_id: 'PO 3432 WHGB', vendor: 'Momentec' },
        { sku: '506CRW', name: 'Ladies Microfiber Reversible Jersey', size: 'L', qty: 5, unit_cost: 5.06, so_id: 'SO-1116', item_id: 'm3', po_id: 'PO 3432 WHGB', vendor: 'Momentec' },
      ],
    };
    const props = proposeResolutions(momentecBill, [momCand, sanmarCand], { canonSize: scanCanon });
    expect(props[0].target.id).toBe('SO-1116');
    expect(props[0].poAnchored).toBe(true);
    expect(props[0].ties.length).toBe(3); // SMALL/MEDIU/LARGE all tied despite truncation
  });
});

// ── Negative-evidence gates: tag mismatch + date sanity (owner, 2026-07-22) ──
describe('negative-evidence gates', () => {
  const mk = (tag, extra) => ({
    kind: 'so', id: 'SO-' + tag, label: 'SO-' + tag, raw: { id: 'SO-' + tag, ...(extra || {}) },
    items: [
      { sku: 'ZZ100', name: 'Practice Tee', size: 'M', qty: 10, unit_cost: 8, so_id: 'SO-' + tag, item_id: 'z1', po_id: 'PO 3132 ' + tag },
      { sku: 'ZZ100', name: 'Practice Tee', size: 'L', qty: 10, unit_cost: 8, so_id: 'SO-' + tag, item_id: 'z2', po_id: 'PO 3132 ' + tag },
    ],
  });
  test('weak-only ties to a different-tag order are never proposed (the STOV class)', () => {
    const bill = { po_number: 'PO 3132 TUH', items: [
      { sku: 'B0FAKE1', desc: 'SOMETHING', size: 'M', qty: 10, unit_price: 8 },
      { sku: 'B0FAKE2', desc: 'SOMETHING', size: 'L', qty: 10, unit_price: 8 },
    ] };
    expect(proposeResolutions(bill, [mk('STOV')], { canonSize: canon })).toHaveLength(0);
  });
  test('strong (exact-SKU) ties survive a tag mismatch but are demoted with evidence', () => {
    const bill = { po_number: 'PO 3132 TUH', items: [
      { sku: 'ZZ100', desc: 'Practice Tee', size: 'M', qty: 10, unit_price: 8 },
      { sku: 'ZZ100', desc: 'Practice Tee', size: 'L', qty: 10, unit_price: 8 },
    ] };
    const p = proposeResolutions(bill, [mk('STOV')], { canonSize: canon })[0];
    expect(p).toBeTruthy();
    expect(p.confidence).not.toBe('high');
    expect(p.evidence.join(' ')).toMatch(/DIFFERENT customer/);
  });
  test('a bill shipped before the order existed is never weak-proposed; dates absent = gate off', () => {
    const bill = { po_number: 'PO 9999 QQZ', ship_date: '06/01/2026', items: [
      { sku: 'B0FAKE1', desc: 'X', size: 'M', qty: 10, unit_price: 8 },
      { sku: 'B0FAKE2', desc: 'X', size: 'L', qty: 10, unit_price: 8 },
    ] };
    const late = mk('QQZ', { created_at: '2026-07-15T00:00:00Z' });
    expect(proposeResolutions(bill, [late], { canonSize: canon })).toHaveLength(0);
    const noDate = mk('QQZ');
    expect(proposeResolutions(bill, [noDate], { canonSize: canon }).length).toBeGreaterThan(0);
  });
});

// ── autoPushSafety — the unattended direct-path gate (Fable audit, 2026-07-22) ──
describe('autoPushSafety direct-path gate', () => {
  const { autoPushSafety } = require('../billResolve');
  const base = { poExact: true, pricePairs: [], billVendor: '', targetVendors: [], docTotal: 100 };
  test('clean exact-PO bill with sane prices passes', () => {
    expect(autoPushSafety({ ...base, pricePairs: [{ bill_unit: 10, unit_cost: 10 }, { bill_unit: 12.4, unit_cost: 10 }] })).toEqual([]); // +24% is within the staged path bound
  });
  test('a >25% per-line price gap blocks (the SanMar 64000 / S&S AT101 class)', () => {
    const r = autoPushSafety({ ...base, pricePairs: [{ bill_unit: 15, unit_cost: 35 }] });
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/sharply/);
  });
  test('an unattended FIRST cost write (order cost 0 → billed >2¢) blocks', () => {
    expect(autoPushSafety({ ...base, pricePairs: [{ bill_unit: 5.25, unit_cost: 0 }] }).length).toBe(1);
  });
  test('prefix/memo (non-exact) PO matches never auto-push', () => {
    expect(autoPushSafety({ ...base, poExact: false })[0]).toMatch(/not exact/);
  });
  test('negative document total (credit-like, PDF-parsed credits have no is_credit) blocks', () => {
    expect(autoPushSafety({ ...base, docTotal: -128.52 })[0]).toMatch(/credit-like/);
  });
  test('vendor mismatch blocks; placeholder vendor ids and unknowns never block', () => {
    expect(autoPushSafety({ ...base, billVendor: 'MOMENTEC BRANDS', targetVendors: ['SanMar'] }).length).toBe(1);
    expect(autoPushSafety({ ...base, billVendor: 'AGRON INC.', targetVendors: ['v1777312659133'] })).toEqual([]);
    expect(autoPushSafety({ ...base, billVendor: 'OUTDOOR CAP CO INC A', targetVendors: ['ns_115'] })).toEqual([]);
    expect(autoPushSafety({ ...base, billVendor: '', targetVendors: ['SanMar'] })).toEqual([]);
  });
  test('vendorsCompatible treats internal vendor-record ids as unknown (fixes the proposal-path false block too)', () => {
    expect(vendorsCompatible('AGRON INC.', 'v1777312659133')).toBe(true);
    expect(vendorsCompatible('WILSON SPORTING GOODS CO', 'ns_166')).toBe(true);
    expect(vendorsCompatible('MOMENTEC BRANDS', 'SANMAR')).toBe(false); // real mismatch still blocks
  });
  test('reasons dedupe — many sharp lines yield distinct messages only', () => {
    const r = autoPushSafety({ ...base, pricePairs: [{ bill_unit: 15, unit_cost: 35 }, { bill_unit: 15, unit_cost: 35 }] });
    expect(r.length).toBe(1);
  });
});

// ── skuNumBase — Agron letter-suffix stripping (owner report 2026-07-22) ──
describe('skuNumBase (Agron suffix)', () => {
  const { skuNumBase } = require('../billResolve');
  test('strips a single trailing letter from a numeric article base', () => {
    expect(skuNumBase('5162436D')).toBe('5162436');
    expect(skuNumBase('5161961C')).toBe('5161961');
    expect(skuNumBase('5162436')).toBeNull();       // no suffix → not applicable
  });
  test('never touches real alphanumeric SKUs', () => {
    expect(skuNumBase('JX4499')).toBeNull();          // ends in a digit
    expect(skuNumBase('R25TFM')).toBeNull();          // letters throughout
    expect(skuNumBase('1390159-410')).toBeNull();     // ends in a digit
    expect(skuNumBase('B00708043')).toBeNull();       // S&S B-number, ends in digit
    expect(skuNumBase('510000')).toBeNull();          // pure digits, no suffix
    expect(skuNumBase('AT101')).toBeNull();           // base too short / not the pattern
    expect(skuNumBase('5162436DD')).toBeNull();       // two trailing letters → not the pattern
  });
});

// ── detailLinesReconcile — AI-read vendor detail lines vs the SI summary total (owner 2026-07-23) ──
describe('detailLinesReconcile (trust AI detail lines only when they sum to the SI total)', () => {
  const { detailLinesReconcile } = require('../billResolve');
  const lines = (...exts) => exts.map(e => ({ extension: e }));
  it('reconciles when the AI lines sum to the summary merch total', () => {
    expect(detailLinesReconcile(lines(414.57, 197.34), 611.91).reconciled).toBe(true);
    expect(detailLinesReconcile(lines(1679.01), 1679.01).reconciled).toBe(true);
    expect(detailLinesReconcile(lines(100, 100.5), 200).reconciled).toBe(true); // sub-$2 rounding ok
  });
  it('does NOT reconcile a real disagreement (flag for a human)', () => {
    expect(detailLinesReconcile(lines(500), 611.91).reconciled).toBe(false);
    expect(detailLinesReconcile(lines(700, 200), 611.91).reconciled).toBe(false);
  });
  it('never reconciles when a side is missing/zero', () => {
    expect(detailLinesReconcile([], 611.91).reconciled).toBe(false);
    expect(detailLinesReconcile(lines(611.91), 0).reconciled).toBe(false);
    expect(detailLinesReconcile(null, 100).reconciled).toBe(false);
  });
  it('reports the sums for the warning message', () => {
    const r = detailLinesReconcile(lines(100, 50), 160);
    expect(r.lineSum).toBe(150); expect(r.merchTotal).toBe(160); expect(r.diff).toBe(-10);
  });
});

// ── pdfCrossCheckConflict — silent PDF reinforcement of an EDI-pushed bill (owner 2026-07-22) ──
describe('pdfCrossCheckConflict (PDF reinforces EDI, speak up only on disagreement)', () => {
  const { pdfCrossCheckConflict } = require('../billResolve');
  it('is silent when the PDF total matches what was pushed', () => {
    expect(pdfCrossCheckConflict(100, 100)).toBe(false);
    expect(pdfCrossCheckConflict(100.5, 100)).toBe(false);   // sub-dollar noise
    expect(pdfCrossCheckConflict(1000, 1015)).toBe(false);   // within 2%
  });
  it('surfaces a real disagreement', () => {
    expect(pdfCrossCheckConflict(120, 100)).toBe(true);      // 20% high
    expect(pdfCrossCheckConflict(80, 100)).toBe(true);       // 20% low
    expect(pdfCrossCheckConflict(102.5, 100)).toBe(true);    // >$1 and >2%
  });
  it('never alarms when a total is missing or zero (no comparison)', () => {
    expect(pdfCrossCheckConflict(0, 100)).toBe(false);
    expect(pdfCrossCheckConflict(100, 0)).toBe(false);
    expect(pdfCrossCheckConflict(100, null)).toBe(false);
    expect(pdfCrossCheckConflict(undefined, 100)).toBe(false);
    expect(pdfCrossCheckConflict(NaN, 100)).toBe(false);
  });
});

// ── Account gate + tightened weak-guess rails (owner 2026-07-23: "matches are pulling
// things that aren't even related" — the A514-for-A430 case, live bill doc 100898884) ──
describe('account/vendor/description gating of weak proposals', () => {
  // The REAL failing case: an S&S bill tagged OVHF (B-number SKUs, "Performance Piqué"),
  // whose own order was fully billed, got offered a BATCH serving OLuBB/CIVIF with a
  // different product (Ultimate365 @ $29.23 vs billed $20.13) on color+size alone.
  const ovhfBill = {
    po_number: 'PO17801OVHF', supplier: 'S&S Activewear',
    items: [
      { sku: 'B07953355', desc: "Men's Performance Piqué Polo", color: 'Grey Three', size: 'L', qty: 2, unit_price: 20.13 },
      { sku: 'B07953356', desc: "Men's Performance Piqué Polo", color: 'Grey Three', size: 'XL', qty: 7, unit_price: 20.13 },
      { sku: 'B07953357', desc: "Men's Performance Piqué Polo", color: 'Grey Three', size: '2XL', qty: 2, unit_price: 22.49 },
      { sku: 'B07953358', desc: "Men's Performance Piqué Polo", color: 'Grey Three', size: '3XL', qty: 1, unit_price: 22.49 },
    ],
  };
  const wrongBatch = {
    kind: 'batch', id: 'NSA 4553', label: 'NSA 4553', sub: 'Batch · S&S Activewear · OLuBB, CIVIF',
    raw: { po_number: 'NSA 4553' }, alpha_tags: ['OLUBB', 'CIVIF'],
    items: [
      { sku: 'A514', name: "Men's Ultimate365 Solid Polo", color: 'Grey Three', size: 'L', qty: 4, unit_cost: 29.23, vendor: 'S&S Activewear' },
      { sku: 'A514', name: "Men's Ultimate365 Solid Polo", color: 'Grey Three', size: 'XL', qty: 8, unit_cost: 29.23, vendor: 'S&S Activewear' },
      { sku: 'A514', name: "Men's Ultimate365 Solid Polo", color: 'Grey Three', size: '2XL', qty: 4, unit_cost: 29.23, vendor: 'S&S Activewear' },
      { sku: 'A514', name: "Men's Ultimate365 Solid Polo", color: 'Grey Three', size: '3XL', qty: 2, unit_cost: 29.23, vendor: 'S&S Activewear' },
    ],
  };
  test('the A514 case: a weak-only tie to a batch serving OTHER schools is never proposed', () => {
    const props = proposeResolutions(ovhfBill, [wrongBatch], { canonSize: canon });
    expect(props).toHaveLength(0);
  });
  test('without customer info (no alpha_tags), the 31% price gap alone now refuses one-click accept', () => {
    const cand = { ...wrongBatch, alpha_tags: [] };
    const props = proposeResolutions(ovhfBill, [cand], { canonSize: canon });
    if (props.length) { // may surface as a hint, but never as an acceptable answer
      expect(props[0].weakGuess).toBe(true);
      expect(props[0].confidence).toBe('low');
    }
  });
  test('description conflict alone (prices close) also refuses one-click accept', () => {
    const cand = {
      ...wrongBatch, alpha_tags: [],
      items: wrongBatch.items.map((it) => ({ ...it, unit_cost: 20.13 })), // price agrees now
    };
    const props = proposeResolutions(ovhfBill, [cand], { canonSize: canon });
    expect(props.length).toBeGreaterThan(0);
    expect(props[0].descConflict).toBe(true);
    expect(props[0].weakGuess).toBe(true);
  });
  test('the RIGHT customer with agreeing descriptions still proposes cleanly', () => {
    const rightCand = {
      kind: 'so', id: 'SO-1574', label: 'SO-1574', sub: 'Sales Order · OVHF', raw: { id: 'SO-1574' },
      alpha_tags: ['OVHF'],
      items: [
        { sku: 'A430', name: "Adidas Men's Performance Piqué Polo", color: 'Grey Three', size: 'L', qty: 2, unit_cost: 20.13, po_id: 'PO 17801 OVHF', vendor: 'S&S Activewear' },
        { sku: 'A430', name: "Adidas Men's Performance Piqué Polo", color: 'Grey Three', size: 'XL', qty: 7, unit_cost: 20.13, po_id: 'PO 17801 OVHF', vendor: 'S&S Activewear' },
        { sku: 'A430', name: "Adidas Men's Performance Piqué Polo", color: 'Grey Three', size: '2XL', qty: 2, unit_cost: 22.49, po_id: 'PO 17801 OVHF', vendor: 'S&S Activewear' },
        { sku: 'A430', name: "Adidas Men's Performance Piqué Polo", color: 'Grey Three', size: '3XL', qty: 1, unit_cost: 22.49, po_id: 'PO 17801 OVHF', vendor: 'S&S Activewear' },
      ],
    };
    const props = proposeResolutions(ovhfBill, [wrongBatch, rightCand], { canonSize: canon });
    expect(props.length).toBeGreaterThan(0);
    expect(props[0].target.id).toBe('SO-1574');
    expect(props[0].accountMismatch).toBeFalsy();
    expect(props[0].weakGuess).toBeFalsy();
    expect(props[0].poAnchored).toBe(true); // PO17801OVHF ↔ PO 17801 OVHF normalize equal
  });
  test('strong SKU evidence still survives an account mismatch (demoted, with the warning)', () => {
    const crossBill = { po_number: 'PO 9000 AAAA', supplier: 'S&S Activewear',
      items: [{ sku: 'A514', desc: 'Ultimate365 Polo', color: 'Grey Three', size: 'L', qty: 4, unit_price: 29.23 }] };
    const props = proposeResolutions(crossBill, [wrongBatch], { canonSize: canon });
    expect(props.length).toBeGreaterThan(0);
    expect(props[0].accountMismatch).toBe(true);
    expect(props[0].confidence).not.toBe('high');
    expect(props[0].evidence.join(' ')).toMatch(/wrong account/);
  });
  test('bill tag glued with a rep suffix still matches its own customer (no false block)', () => {
    const cand = { ...wrongBatch, alpha_tags: ['SCF'] };
    const bill = { ...ovhfBill, po_number: 'PO 3552 SCF REP' };
    const props = proposeResolutions(bill, [{ ...cand, items: cand.items.map((it) => ({ ...it, unit_cost: 20.13, name: "Men's Performance Piqué Polo" })) }], { canonSize: canon });
    // SCFREP startsWith SCF → same account, so the account gate must NOT drop it
    expect(props.length).toBeGreaterThan(0);
    expect(props[0].accountMismatch).toBeFalsy();
  });
});

// ── Credit-memo reversal (owner 2026-07-23: RA 74599650 — burgundy A430s returned off
// invoice 100785124, greys re-shipped on 100898884) ──
describe('proposeCreditReversal — tie a credit to the BILLED goods it reverses', () => {
  const { proposeCreditReversal, creditOriginalDoc } = require('../billResolve');
  const targets = [
    { sku: 'A430', size: 'L',   billed: 2, unit_cost: 20.13, po_id: 'PO 17801 OVHF', docs: [{ doc: '100785124', cost: 40.26, date: '07/17/2026' }] },
    { sku: 'A430', size: 'XL',  billed: 7, unit_cost: 20.13, po_id: 'PO 17801 OVHF', docs: [{ doc: '100785124', cost: 140.91, date: '07/17/2026' }] },
    { sku: 'A430', size: '2XL', billed: 2, unit_cost: 22.49, po_id: 'PO 17801 OVHF', docs: [{ doc: '100785124', cost: 44.98, date: '07/17/2026' }] },
    { sku: 'A430', size: '3XL', billed: 1, unit_cost: 22.49, po_id: 'PO 17801 OVHF', docs: [{ doc: '100785124', cost: 22.49, date: '07/17/2026' }] },
    { sku: '41800', size: 'M',  billed: 28, unit_cost: 8.14, po_id: 'PO 17801 OVHF', docs: [{ doc: '100785124', cost: 227.92, date: '07/17/2026' }] },
  ];
  const raCredit = {
    is_credit: true, po_number: 'PO 17802 OVHF', doc_number: '74599650', merchandise_total: -248.64,
    rawText: 'Return Order Confirmation RA Confirmation: 74599650 ... C1: 100785124 C2: Do Not Need',
    items: [ // RA prints negative pieces — abs() is used
      { sku: 'A430', size: 'XL',  qty: -7, unit_price: 20.13, extension: -140.91 },
      { sku: 'A430', size: '3XL', qty: -1, unit_price: 22.49, extension: -22.49 },
      { sku: 'A430', size: 'L',   qty: -2, unit_price: 20.13, extension: -40.26 },
      { sku: 'A430', size: '2XL', qty: -2, unit_price: 22.49, extension: -44.98 },
    ],
  };
  test('the real RA: every line ties to its billed bucket, anchored to the original invoice', () => {
    const plan = proposeCreditReversal(raCredit, targets, {});
    expect(plan.ok).toBe(true);
    expect(plan.ties).toHaveLength(4);
    expect(plan.totalUnits).toBe(12);
    expect(plan.originalDoc).toBe('100785124');
    expect(plan.originalDocKnown).toBe(true);
    // XL line reverses 7 from the XL bucket
    const xl = plan.ties.find(t => t.bill_idx === 0);
    expect(targets[xl.target_idx].size).toBe('XL');
    expect(xl.qty).toBe(7);
  });
  test('clamps to what was billed and says so', () => {
    const over = { ...raCredit, items: [{ sku: 'A430', size: 'L', qty: -5, unit_price: 20.13, extension: -100.65 }] };
    const plan = proposeCreditReversal(over, targets, {});
    expect(plan.ties[0].qty).toBe(2); // only 2 billed
    expect(plan.reasons.join(' ')).toMatch(/clamped/);
  });
  test('never guesses: an unknown SKU stays unresolved and the plan is not ok', () => {
    const stray = { ...raCredit, items: [{ sku: 'ZZZ999', size: 'L', qty: -2, unit_price: 20.13, extension: -40.26 }] };
    const plan = proposeCreditReversal(stray, targets, {});
    expect(plan.ok).toBe(false);
    expect(plan.unresolved).toHaveLength(1);
  });
  test('vendor letter-suffix SKUs still tie (5162436D reverses billed 5162436)', () => {
    const t2 = [{ sku: '5162436', size: 'L', billed: 3, unit_cost: 7.5, docs: [{ doc: 'X1', cost: 22.5 }] }];
    const c2 = { is_credit: true, rawText: '', items: [{ sku: '5162436D', size: 'L', qty: -3, unit_price: 7.5, extension: -22.5 }] };
    const plan = proposeCreditReversal(c2, t2, {});
    expect(plan.ok).toBe(true);
    expect(plan.ties[0].qty).toBe(3);
  });
  test('warns when the referenced original invoice is not among the billed docs', () => {
    const other = { ...raCredit, rawText: 'C1: 999999999' };
    const plan = proposeCreditReversal(other, targets, {});
    expect(plan.originalDocKnown).toBe(false);
    expect(plan.reasons.join(' ')).toMatch(/not among the docs/);
  });
  test('creditOriginalDoc reads the common formats', () => {
    expect(creditOriginalDoc('blah C1: 100785124 blah')).toBe('100785124');
    expect(creditOriginalDoc('Original Invoice: 100785124')).toBe('100785124');
    expect(creditOriginalDoc('ORIG INV 100785124')).toBe('100785124');
    expect(creditOriginalDoc('no reference here')).toBe('');
  });
});

// ── creditAutoApplySafe — only OBVIOUS credits auto-apply (owner 2026-07-23) ──
describe('creditAutoApplySafe — stricter than invoice auto-push', () => {
  const { proposeCreditReversal, creditAutoApplySafe } = require('../billResolve');
  const targets = [
    { sku: 'A430', size: 'L',  billed: 2, unit_cost: 20.13, docs: [{ doc: '100785124', cost: 40.26 }] },
    { sku: 'A430', size: 'XL', billed: 7, unit_cost: 20.13, docs: [{ doc: '100785124', cost: 140.91 }] },
  ];
  const base = { is_credit: true, rawText: 'C1: 100785124', items: [
    { sku: 'A430', size: 'L',  qty: -2, unit_price: 20.13, extension: -40.26 },
    { sku: 'A430', size: 'XL', qty: -7, unit_price: 20.13, extension: -140.91 },
  ] };
  test('fully tied + anchored to the named original invoice + nothing clamped → safe', () => {
    const plan = proposeCreditReversal(base, targets, {});
    expect(plan.ok).toBe(true);
    expect(creditAutoApplySafe(plan)).toBe(true);
  });
  test('no original-invoice reference → NOT safe (waits for the human)', () => {
    const plan = proposeCreditReversal({ ...base, rawText: '' }, targets, {});
    expect(plan.ok).toBe(true); // still manually applicable
    expect(creditAutoApplySafe(plan)).toBe(false);
  });
  test('references a doc that did not bill these lines → NOT safe', () => {
    const plan = proposeCreditReversal({ ...base, rawText: 'C1: 999999999' }, targets, {});
    expect(creditAutoApplySafe(plan)).toBe(false);
  });
  test('clamped quantities → NOT safe', () => {
    const over = { ...base, items: [{ sku: 'A430', size: 'L', qty: -5, unit_price: 20.13, extension: -100.65 }] };
    const plan = proposeCreditReversal(over, targets, {});
    expect(plan.ok).toBe(true); // human can still apply the clamped 2
    expect(creditAutoApplySafe(plan)).toBe(false);
  });
  test('any unresolved line → NOT safe', () => {
    const stray = { ...base, items: [...base.items, { sku: 'ZZZ1', size: 'M', qty: -1, unit_price: 5, extension: -5 }] };
    expect(creditAutoApplySafe(proposeCreditReversal(stray, targets, {}))).toBe(false);
  });
});
