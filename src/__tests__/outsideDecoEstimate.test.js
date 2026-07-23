/* eslint-disable */
// When an art deco is soft-routed Outside → a priced vendor (Silver Screen) but not yet on a Deco PO,
// its cost should come from the vendor's price list (with dark/fleece/mesh auto-detected), not $0 and
// not the in-house rate. An actual Deco PO still supersedes it (no double-count). Guards outsideDecoEstAt,
// decoCostResolved, and calcOrderMargin's use of them.
const { outsideDecoEstAt, decoCostResolved, decoCostAt, calcOrderMargin, outsideDecoSell, OUTSIDE_DECO_MARGIN } = require('../pricing');
const { outsourcedDecoTypes } = require('../businessLogic');

const VENDORS = [{ id: 'dv_ss', name: 'Silver Screen' }];
const PRICING = [
  { deco_vendor_id: 'dv_ss', deco_type: 'screen_print',
    pricing_tiers: { tiers: [{ colors: 2, qty_breaks: [{ min_qty: 1, price: 2.89 }] }] },
    upcharges: { underbase: 0.10, fleece: 0.15, mesh: 0.25 } },
  { deco_vendor_id: 'dv_ss', deco_type: 'embroidery',
    pricing_tiers: { tiers: [{ min_stitches: 0, max_stitches: 999999, qty_breaks: [{ min_qty: 1, price: 5 }] }] },
    upcharges: {} },
];

// Navy fleece hoodie, 48 pcs, 2-color screen print (colorway cw1 has 2 inks), routed outside to Silver Screen.
const mkOrder = (decoOverrides = {}, orderOverrides = {}) => ({
  art_files: [{ id: 'af1', deco_type: 'screen_print', color_ways: [{ id: 'cw1', inks: ['Black', 'White'] }] }],
  items: [{
    sku: 'H1', name: 'Fleece Hoodie', color: 'Navy', nsa_cost: 18, unit_sell: 30, sizes: { S: 48 },
    decorations: [{ kind: 'art', art_file_id: 'af1', color_way_id: 'cw1', fulfillment: 'outside', vendor: 'Silver Screen', ...decoOverrides }],
  }],
  ...orderOverrides,
});

const estAt = (o) => {
  const d = o.items[0].decorations[0];
  return outsideDecoEstAt(o, 0, d, 48, o.art_files, 48, VENDORS, PRICING, outsourcedDecoTypes(o));
};

describe('outsideDecoEstAt — vendor price for a soft-outside deco', () => {
  test('dark + fleece auto-detected: 2.89 × 1.10 × 1.15 = 3.66/ea × 48 = 175.68', () => {
    expect(estAt(mkOrder())).toBeCloseTo(175.68, 2);
  });
  test('a light, non-fleece garment gets no upcharge (base 2.89 × 48 = 138.72)', () => {
    const o = mkOrder({}, {});
    o.items[0].color = 'White'; o.items[0].name = 'Cotton Tee';
    expect(estAt(o)).toBeCloseTo(138.72, 2);
  });
  test('a white MESH jersey gets the mesh upcharge (2.89 × 1.25 = 3.61/ea)', () => {
    const o = mkOrder(); o.items[0].color = 'White'; o.items[0].name = 'Mesh Jersey';
    expect(estAt(o)).toBeCloseTo(3.61 * 48, 2);
  });
  test('covered by an actual Deco PO → 0 (the PO cost is counted separately)', () => {
    const o = mkOrder({}, { deco_pos: [{ deco_type: 'screen_print', item_idxs: [0] }] });
    expect(estAt(o)).toBe(0);
  });
  test('deco_po_id set → 0', () => {
    expect(estAt(mkOrder({ deco_po_id: 'DPO 1' }))).toBe(0);
  });
  test('no vendor → 0', () => {
    expect(estAt(mkOrder({ vendor: undefined }))).toBe(0);
  });
  test('vendor with no price row → 0', () => {
    const o = mkOrder({ vendor: 'Nobody' });
    o.items[0].decorations[0].vendor = 'Nobody';
    expect(outsideDecoEstAt(o, 0, o.items[0].decorations[0], 48, o.art_files, 48, [{ id: 'x', name: 'Nobody' }], PRICING, outsourcedDecoTypes(o))).toBe(0);
  });
  test('in-house deco (no fulfillment) → 0 (handled by the in-house path, not this helper)', () => {
    expect(estAt(mkOrder({ fulfillment: undefined }))).toBe(0);
  });
  test('embroidery uses the embroidery matrix and ignores fleece/mesh', () => {
    const o = mkOrder();
    o.art_files[0].deco_type = 'embroidery'; o.art_files[0].stitches = 8000;
    expect(estAt(o)).toBeCloseTo(5 * 48, 2); // flat 5/ea, no screen-print upcharges
  });
});

describe('outsideDecoSell — charge marked up off vendor cost to the target margin', () => {
  const marginOf = (cost) => { const sell = outsideDecoSell(cost); return (sell - cost) / sell; };
  test('default target is 36%', () => { expect(OUTSIDE_DECO_MARGIN).toBe(0.36); });
  test('mesh jersey cost $3.61 → charge $5.64 (≈36% margin)', () => {
    expect(outsideDecoSell(3.61)).toBe(5.64);
    expect(marginOf(3.61)).toBeCloseTo(0.36, 2);
  });
  test('base cost $2.89 → charge $4.52 (≈36% margin)', () => {
    expect(outsideDecoSell(2.89)).toBe(4.52);
    expect(marginOf(2.89)).toBeCloseTo(0.36, 2);
  });
  test('0 / invalid cost → 0 (no charge stamped)', () => {
    expect(outsideDecoSell(0)).toBe(0);
    expect(outsideDecoSell(null)).toBe(0);
  });
  test('margin is configurable', () => {
    expect(outsideDecoSell(4, 0.5)).toBe(8); // 50% margin → 2×
  });
});

describe('decoCostResolved — in-house vs outside routing', () => {
  test('in-house deco resolves to the in-house cost (decoCostAt)', () => {
    const o = mkOrder({ fulfillment: undefined, vendor: undefined });
    const d = o.items[0].decorations[0];
    const resolved = decoCostResolved(o, 0, d, 48, o.art_files, 48, null, VENDORS, PRICING, outsourcedDecoTypes(o));
    const inHouse = decoCostAt(d, 48, o.art_files, 48, null);
    expect(resolved).toBe(inHouse);
    expect(resolved).toBeGreaterThan(0);
  });
  test('outside → Silver Screen resolves to the vendor estimate, not the in-house cost', () => {
    const o = mkOrder();
    const d = o.items[0].decorations[0];
    const resolved = decoCostResolved(o, 0, d, 48, o.art_files, 48, null, VENDORS, PRICING, outsourcedDecoTypes(o));
    expect(resolved).toBeCloseTo(175.68, 2);
    expect(resolved).not.toBe(decoCostAt(d, 48, o.art_files, 48, null));
  });
});

describe('calcOrderMargin — outside estimate flows into cost only when pricing is supplied', () => {
  test('with vendor pricing: cost = garment (18×48=864) + Silver Screen deco (175.68)', () => {
    const m = calcOrderMargin(mkOrder(), null, VENDORS, PRICING);
    expect(m.cost).toBeCloseTo(864 + 175.68, 2);
  });
  test('without vendor pricing (legacy call): outside deco cost is 0 — backward compatible', () => {
    const m = calcOrderMargin(mkOrder());
    expect(m.cost).toBeCloseTo(864, 2);
  });
  test('on an actual Deco PO: cost uses the PO, not the estimate (no double-count)', () => {
    const o = mkOrder({}, { deco_pos: [{ deco_type: 'screen_print', item_idxs: [0], qty: 48, unit_cost: 3.66 }] });
    const m = calcOrderMargin(o, null, VENDORS, PRICING);
    expect(m.cost).toBeCloseTo(864 + 48 * 3.66, 2); // PO cost, and the estimate stayed 0
  });
});
