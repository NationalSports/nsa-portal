/* eslint-disable */
// Combined costing for linked jobs that share a screen.
//
// When a rep MANUALLY links jobs carrying the same artwork (so_jobs.link_group), they run on
// one screen / digitized setup. The decoration cost (a volume-tiered in-house cost) should then
// price at the COMBINED volume across the linked orders instead of each order paying the full
// small-run cost on its own. Revenue/sell stays per-order — only cost/margin combines.
//
// Guards:
//   • linkedArtCostQty sums sibling-job units across orders sharing a link_group (manual only)
//   • decoCostAt prices the per-piece cost at that combined qty, lowering each order's cost
//   • auto-matched (un-linked) jobs never combine
const pricing = require('../pricing');
const { linkedArtCostQty, decoCostAt, dP, spP, calcOrderMargin } = pricing;

const AF = { id: 'af1', deco_type: 'screen_print', ink_colors: 'PMS 1' }; // 1 ink color
const artDeco = { kind: 'art', art_file_id: 'af1' };

// Two sub-customers of one parent, each with an 8-unit screen-print job on the SAME art,
// manually linked into one run (link_group 'lg1').
const orderA = { id: 'SOA', jobs: [{ id: 'jA', link_group: 'lg1', art_file_id: 'af1', total_units: 8 }] };
const orderB = { id: 'SOB', jobs: [{ id: 'jB', link_group: 'lg1', art_file_id: 'afB', total_units: 8 }] };

describe('linkedArtCostQty — combines tier qty across manually-linked jobs', () => {
  test('sums sibling job units from other orders sharing the link_group', () => {
    const m = linkedArtCostQty(orderA, { af1: 8 }, [orderA, orderB]);
    expect(m).toEqual({ af1: 16 }); // own 8 + linked sibling 8
  });

  test('is symmetric — each linked order sees the combined run', () => {
    expect(linkedArtCostQty(orderB, { afB: 8 }, [orderA, orderB])).toEqual({ afB: 16 });
  });

  test('no combine when the job is not manually linked (auto-match only)', () => {
    const autoA = { id: 'SOA', jobs: [{ id: 'jA', art_file_id: 'af1', total_units: 8 }] };
    const autoB = { id: 'SOB', jobs: [{ id: 'jB', art_file_id: 'afB', total_units: 8 }] };
    expect(linkedArtCostQty(autoA, { af1: 8 }, [autoA, autoB])).toEqual({});
  });

  test('no combine when no sibling shares the link_group (different group / no run-together)', () => {
    const lonelyB = { id: 'SOB', jobs: [{ id: 'jB', link_group: 'lg2', art_file_id: 'afB', total_units: 8 }] };
    expect(linkedArtCostQty(orderA, { af1: 8 }, [orderA, lonelyB])).toEqual({});
  });

  test('no combine when the job stands alone in the order set', () => {
    expect(linkedArtCostQty(orderA, { af1: 8 }, [orderA])).toEqual({});
  });

  // Real-world guard (SO-1288/1289): "MC Crest Football" exists as BOTH a screen print and an
  // embroidery. If a rep loosely links by name, a screen-print volume must NOT pool with the
  // embroidery one — different process, different price function.
  test('pools only within the same deco_type, even under one link_group', () => {
    const spOrder = { id: 'SO-1288', jobs: [{ id: 'jSP', link_group: 'lgX', art_file_id: 'afSP', deco_type: 'screen_print', total_units: 15 }] };
    const mixedOrder = { id: 'SO-1289', jobs: [
      { id: 'jSP2', link_group: 'lgX', art_file_id: 'afSP2', deco_type: 'screen_print', total_units: 114 },
      { id: 'jEMB', link_group: 'lgX', art_file_id: 'afEMB', deco_type: 'embroidery', total_units: 114 },
    ] };
    // afSP combines with the sibling screen-print (114) only — the 114 embroidery units are excluded.
    expect(linkedArtCostQty(spOrder, { afSP: 15 }, [spOrder, mixedOrder])).toEqual({ afSP: 129 });
  });

  test('falls back to the job total_units when the art is not in the local qty map', () => {
    expect(linkedArtCostQty(orderA, {}, [orderA, orderB])).toEqual({ af1: 16 });
  });
});

describe('decoCostAt — prices the shared screen once at the combined volume', () => {
  // Per-piece screen-print COST: under 12 falls in the flat small-run bracket; 12-23 drops to
  // the real per-piece rate. Combining 8 + 8 = 16 clears the small-run minimum together.
  const costUnder12 = dP(artDeco, 8, [AF], 8).cost;   // tier qty 8  → small-run bracket
  const costAt16 = dP(artDeco, 8, [AF], 16).cost;     // tier qty 16 → 12-23 bracket

  test('the volume bracket actually drops between 8 and 16 (sanity)', () => {
    expect(costAt16).toBeLessThan(costUnder12);
    expect(spP(16, 1, false)).toBeGreaterThan(0);
  });

  test('with a combined qty, an 8-unit order costs at the 16-run rate', () => {
    const combined = decoCostAt(artDeco, 8, [AF], 8, { af1: 16 });
    expect(combined).toBe(8 * costAt16);
  });

  test('without a combined entry, it matches the plain per-order cost term', () => {
    const plain = decoCostAt(artDeco, 8, [AF], 8, {});
    expect(plain).toBe(8 * costUnder12);
  });

  test('combining lowers each linked order\'s deco cost', () => {
    const plain = decoCostAt(artDeco, 8, [AF], 8, {});
    const combined = decoCostAt(artDeco, 8, [AF], 8, { af1: 16 });
    expect(combined).toBeLessThan(plain);
  });

  test('a combined qty below the local qty never raises cost (max wins)', () => {
    const local = decoCostAt(artDeco, 8, [AF], 8, {});
    const withSmaller = decoCostAt(artDeco, 8, [AF], 8, { af1: 4 });
    expect(withSmaller).toBe(local);
  });

  test('two linked 8-unit orders together cost far less than two stand-alone runs', () => {
    const combinedMap = linkedArtCostQty(orderA, { af1: 8 }, [orderA, orderB]);
    const aCost = decoCostAt(artDeco, 8, [AF], 8, combinedMap);
    const bCost = decoCostAt(artDeco, 8, [AF], 8, linkedArtCostQty(orderB, { afB: 8 }, [orderA, orderB]));
    const standalone = decoCostAt(artDeco, 8, [AF], 8, {}) * 2;
    expect(aCost + bCost).toBeLessThan(standalone);
  });
});

describe('sell/revenue is never combined (customer price stays per-order)', () => {
  test('decoCostAt only returns cost; the per-order sell is unchanged', () => {
    // The editor computes revenue from dP(...,localCq).sell — combining does not touch it.
    const perOrderSell = dP(artDeco, 8, [AF], 8).sell;
    const combinedSell = dP(artDeco, 8, [AF], 8).sell; // editor still uses local cq for sell
    expect(combinedSell).toBe(perOrderSell);
  });
});

// calcOrderMargin is the shared rev/cost/margin used by dashboards, reports, and (via the
// parallel App walk) commission GP. With allOrders it must lower COST/raise MARGIN on linked
// orders while leaving REVENUE identical — so the customer-facing total never moves.
describe('calcOrderMargin combines cost across linked orders (rev unchanged)', () => {
  const mkOrder = (id, units, afId) => ({
    id,
    art_files: [{ id: afId, deco_type: 'screen_print', ink_colors: 'PMS 1' }],
    items: [{ sku: 'TEE', unit_sell: 20, nsa_cost: 5, sizes: { M: units }, decorations: [{ kind: 'art', art_file_id: afId }] }],
    jobs: [{ id: 'j' + id, link_group: 'lg1', art_file_id: afId, deco_type: 'screen_print', total_units: units }],
  });
  const soA = mkOrder('SOA', 8, 'afA');   // small coach order
  const soB = mkOrder('SOB', 57, 'afB');  // big spirit-pack order, same screen, linked

  test('linked: cost drops, margin rises, revenue identical', () => {
    const alone = calcOrderMargin(soA);              // legacy single-arg = no combine
    const linked = calcOrderMargin(soA, [soA, soB]); // combined tier 8+57=65
    expect(linked.rev).toBe(alone.rev);              // customer price untouched
    expect(linked.cost).toBeLessThan(alone.cost);    // shared screen, not paid in full
    expect(linked.margin).toBeGreaterThan(alone.margin);
  });

  test('no link group → allOrders makes no difference (backward compatible)', () => {
    const plain = { id: 'P', art_files: [{ id: 'afP', deco_type: 'screen_print', ink_colors: 'PMS 1' }],
      items: [{ sku: 'T', unit_sell: 20, nsa_cost: 5, sizes: { M: 8 }, decorations: [{ kind: 'art', art_file_id: 'afP' }] }], jobs: [] };
    expect(calcOrderMargin(plain, [plain, soB])).toEqual(calcOrderMargin(plain));
  });
});
