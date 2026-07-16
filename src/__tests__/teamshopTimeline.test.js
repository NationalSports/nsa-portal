/* Delivery-timeline resolution (netlify/functions/_teamshopTimeline.js,
 * migration 00203). Covers the precedence chain (in-stock beats source band;
 * deco overrides apply as max() and never SHORTEN a band), the shared
 * warehouse allocator (also used by teamshop-auto-po's computeNeeds), the
 * order-level slowest-line pick, and the pre-migration all-null degrade.
 * Same fake-admin stub style as teamshopPublicPrice.test.js. */

const tl = require('../../netlify/functions/_teamshopTimeline');

// Mirrors the 00203 seed rows (the owner's numbers).
const ROWS = [
  { rule_key: 'in_stock', rule_type: 'in_stock', inventory_sources: [], deco_type: null, min_weeks: 1, max_weeks: 1, label: '~1 week', sort_order: 0, active: true },
  { rule_key: 'source_sanmar_ss', rule_type: 'source', inventory_sources: ['sanmar', 'nike', 'ss_activewear'], deco_type: null, min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks', sort_order: 10, active: true },
  { rule_key: 'source_momentec_richardson', rule_type: 'source', inventory_sources: ['momentec', 'richardson'], deco_type: null, min_weeks: 2, max_weeks: 2, label: '~2 weeks', sort_order: 20, active: true },
  { rule_key: 'source_adidas_ua', rule_type: 'source', inventory_sources: ['click', 'ua', 'agron'], deco_type: null, min_weeks: 3, max_weeks: 3, label: '~3 weeks', sort_order: 30, active: true },
  { rule_key: 'deco_screen_print', rule_type: 'deco', inventory_sources: [], deco_type: 'screen_print', min_weeks: 2, max_weeks: 3, label: '~2–3 weeks', sort_order: 40, active: true },
];

function fakeAdmin(tables) {
  return {
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        limit: () => chain,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
}

beforeEach(() => tl._clearCache());

describe('resolveTimeline precedence', () => {
  test('in-stock beats the source band', () => {
    const r = tl.resolveTimeline(ROWS, { inStock: true, source: 'sanmar', decoTypes: [] });
    expect(r).toEqual({ min_weeks: 1, max_weeks: 1, label: '~1 week' });
  });

  test('source band applies when not in stock', () => {
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: 'sanmar', decoTypes: [] }))
      .toEqual({ min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks' });
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: 'momentec', decoTypes: [] }))
      .toEqual({ min_weeks: 2, max_weeks: 2, label: '~2 weeks' });
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: 'click', decoTypes: [] }))
      .toEqual({ min_weeks: 3, max_weeks: 3, label: '~3 weeks' });
  });

  test('screen-print override applies as max() over the source band', () => {
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: 'ss_activewear', decoTypes: ['screen_print'] }))
      .toEqual({ min_weeks: 2, max_weeks: 3, label: '~2–3 weeks' });
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: 'richardson', decoTypes: ['screen_print'] }))
      .toEqual({ min_weeks: 2, max_weeks: 3, label: '~2–3 weeks' });
  });

  test('screen-print override lengthens even an in-stock line', () => {
    expect(tl.resolveTimeline(ROWS, { inStock: true, source: 'sanmar', decoTypes: ['screen_print'] }))
      .toEqual({ min_weeks: 2, max_weeks: 3, label: '~2–3 weeks' });
  });

  test('adidas/UA + screen print stays ~3 weeks — the override never shortens', () => {
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: 'click', decoTypes: ['screen_print'] }))
      .toEqual({ min_weeks: 3, max_weeks: 3, label: '~3 weeks' });
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: 'ua', decoTypes: ['screen_print'] }))
      .toEqual({ min_weeks: 3, max_weeks: 3, label: '~3 weeks' });
  });

  test('a deco type with no override row leaves the band untouched', () => {
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: 'sanmar', decoTypes: ['embroidery', 'dtf'] }))
      .toEqual({ min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks' });
  });

  test('a merged band matching neither row formats a label from the numbers', () => {
    const rows = [
      { rule_type: 'source', inventory_sources: ['sanmar'], min_weeks: 1, max_weeks: 4, label: '~1–4 weeks', sort_order: 0 },
      { rule_type: 'deco', deco_type: 'screen_print', min_weeks: 2, max_weeks: 3, label: '~2–3 weeks', sort_order: 1 },
    ];
    expect(tl.resolveTimeline(rows, { inStock: false, source: 'sanmar', decoTypes: ['screen_print'] }))
      .toEqual({ min_weeks: 2, max_weeks: 4, label: '~2–4 weeks' });
  });

  test('unknown source with no in-stock coverage resolves to null', () => {
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: 'manual', decoTypes: [] })).toBeNull();
    expect(tl.resolveTimeline(ROWS, { inStock: false, source: null, decoTypes: [] })).toBeNull();
  });

  test('in-stock falls through to the source band when the in_stock row is deactivated (absent)', () => {
    const rows = ROWS.filter((r) => r.rule_type !== 'in_stock');
    expect(tl.resolveTimeline(rows, { inStock: true, source: 'sanmar', decoTypes: [] }))
      .toEqual({ min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks' });
  });
});

describe('pickSlowest (order-level estimate)', () => {
  test('picks the slowest line by max_weeks, ties by min_weeks', () => {
    const a = { min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks' };
    const b = { min_weeks: 3, max_weeks: 3, label: '~3 weeks' };
    const c = { min_weeks: 2, max_weeks: 2, label: '~2 weeks' };
    expect(tl.pickSlowest([a, b, c])).toBe(b);
    expect(tl.pickSlowest([a, c])).toBe(c); // max ties at 2 → greater min wins
  });

  test('null when any line is unknown, or when there are no lines', () => {
    expect(tl.pickSlowest([{ min_weeks: 1, max_weeks: 1, label: '~1 week' }, null])).toBeNull();
    expect(tl.pickSlowest([])).toBeNull();
  });
});

describe('makeOnHandAllocator (shared with teamshop-auto-po computeNeeds)', () => {
  test('allocates per (product, size), never double-counting shared stock', () => {
    const alloc = tl.makeOnHandAllocator([{ product_id: 'p1', size: 'M', quantity: 10 }]);
    expect(alloc.take('p1', 'M', 6)).toBe(6);
    expect(alloc.take('p1', 'M', 6)).toBe(4); // only 4 left
    expect(alloc.take('p1', 'M', 1)).toBe(0);
  });

  test('size keys are trimmed/case-insensitive; unknown product takes 0', () => {
    const alloc = tl.makeOnHandAllocator([{ product_id: 'p1', size: ' m ', quantity: 3 }]);
    expect(alloc.take('p1', 'M', 2)).toBe(2);
    expect(alloc.take('p2', 'M', 2)).toBe(0);
    expect(alloc.take(null, 'M', 2)).toBe(0);
  });

  test('takeAny drains across sizes for the size-less representative line', () => {
    const alloc = tl.makeOnHandAllocator([
      { product_id: 'p1', size: 'S', quantity: 1 },
      { product_id: 'p1', size: 'M', quantity: 2 },
    ]);
    expect(alloc.takeAny('p1', 2)).toBe(2);
    expect(alloc.takeAny('p1', 5)).toBe(1);
  });
});

describe('computeTimelines (end-to-end over a fake admin)', () => {
  const PRODUCTS = {
    p1: { id: 'p1', inventory_source: 'sanmar' },
    p2: { id: 'p2', inventory_source: 'click' },
    p3: { id: 'p3', inventory_source: null },
  };

  test('fully covered line → in-stock band; uncovered line → source band; order = slowest', async () => {
    const admin = fakeAdmin({
      teamshop_delivery_timelines: { data: ROWS, error: null },
      product_inventory: { data: [{ product_id: 'p1', size: 'M', quantity: 5 }], error: null },
    });
    const res = await tl.computeTimelines(admin, [
      { product_id: 'p1', size: 'M', qty: 5, deco_types: [] },
      { product_id: 'p2', size: 'L', qty: 2, deco_types: [] },
    ], PRODUCTS);
    expect(res.lines[0]).toEqual({ min_weeks: 1, max_weeks: 1, label: '~1 week' });
    expect(res.lines[1]).toEqual({ min_weeks: 3, max_weeks: 3, label: '~3 weeks' });
    expect(res.order).toEqual({ min_weeks: 3, max_weeks: 3, label: '~3 weeks' });
  });

  test('two lines cannot both claim the same warehouse units', async () => {
    const admin = fakeAdmin({
      teamshop_delivery_timelines: { data: ROWS, error: null },
      product_inventory: { data: [{ product_id: 'p1', size: 'M', quantity: 6 }], error: null },
    });
    const res = await tl.computeTimelines(admin, [
      { product_id: 'p1', size: 'M', qty: 6, deco_types: [] },
      { product_id: 'p1', size: 'M', qty: 1, deco_types: [] },
    ], PRODUCTS);
    expect(res.lines[0].label).toBe('~1 week');
    expect(res.lines[1].label).toBe('~1.5–2 weeks'); // stock already claimed
  });

  test('a partially covered line is NOT in stock (source band applies)', async () => {
    const admin = fakeAdmin({
      teamshop_delivery_timelines: { data: ROWS, error: null },
      product_inventory: { data: [{ product_id: 'p1', size: 'M', quantity: 3 }], error: null },
    });
    const res = await tl.computeTimelines(admin, [{ product_id: 'p1', size: 'M', qty: 5, deco_types: [] }], PRODUCTS);
    expect(res.lines[0].label).toBe('~1.5–2 weeks');
  });

  test('the size-less representative line checks stock across all sizes', async () => {
    const admin = fakeAdmin({
      teamshop_delivery_timelines: { data: ROWS, error: null },
      product_inventory: { data: [{ product_id: 'p1', size: 'S', quantity: 1 }], error: null },
    });
    const res = await tl.computeTimelines(admin, [{ product_id: 'p1', size: null, qty: 1, deco_types: [] }], PRODUCTS);
    expect(res.lines[0].label).toBe('~1 week');
  });

  test('unknown source → null line AND null order (never a partial promise)', async () => {
    const admin = fakeAdmin({
      teamshop_delivery_timelines: { data: ROWS, error: null },
      product_inventory: { data: [], error: null },
    });
    const res = await tl.computeTimelines(admin, [
      { product_id: 'p3', size: 'M', qty: 1, deco_types: [] },
      { product_id: 'p1', size: 'M', qty: 1, deco_types: [] },
    ], PRODUCTS);
    expect(res.lines[0]).toBeNull();
    expect(res.lines[1]).not.toBeNull();
    expect(res.order).toBeNull();
  });

  test('unreadable warehouse stock fails LONG: nobody is in stock, source bands apply', async () => {
    const admin = fakeAdmin({
      teamshop_delivery_timelines: { data: ROWS, error: null },
      product_inventory: { data: null, error: { message: 'boom' } },
    });
    const res = await tl.computeTimelines(admin, [{ product_id: 'p1', size: 'M', qty: 1, deco_types: [] }], PRODUCTS);
    expect(res.lines[0].label).toBe('~1.5–2 weeks');
  });

  test('pre-migration (relation missing) → all null, pricing untouched', async () => {
    const admin = fakeAdmin({
      teamshop_delivery_timelines: { data: null, error: { code: '42P01', message: 'relation "teamshop_delivery_timelines" does not exist' } },
    });
    const res = await tl.computeTimelines(admin, [{ product_id: 'p1', size: 'M', qty: 1, deco_types: [] }], PRODUCTS);
    expect(res).toEqual({ lines: [null], order: null });
  });

  test('zero active rows → all null', async () => {
    const admin = fakeAdmin({ teamshop_delivery_timelines: { data: [], error: null } });
    const res = await tl.computeTimelines(admin, [{ product_id: 'p1', size: 'M', qty: 1, deco_types: [] }], PRODUCTS);
    expect(res).toEqual({ lines: [null], order: null });
  });
});

describe('loadTimelines cache', () => {
  test('rule rows are cached for the hot path; _clearCache forces a re-read', async () => {
    let reads = 0;
    const admin = {
      from(table) {
        const chain = {
          select: () => chain, eq: () => chain, order: () => chain, in: () => chain,
          then: (resolve) => { reads += 1; return Promise.resolve({ data: ROWS, error: null }).then(resolve); },
        };
        return chain;
      },
    };
    await tl.loadTimelines(admin);
    await tl.loadTimelines(admin);
    expect(reads).toBe(1);
    tl._clearCache();
    await tl.loadTimelines(admin);
    expect(reads).toBe(2);
  });
});
