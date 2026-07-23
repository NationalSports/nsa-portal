import { nextInvId, computeOrderTracking, validateShipAddress, estimateWeightOz, labelWeightLbs } from '../utils';

// ── Regression: estimateWeightOz ──
describe('estimateWeightOz (regression)', () => {
  test('numeric input no longer throws — returns 8oz default', () => {
    expect(() => estimateWeightOz(12345)).not.toThrow();
    expect(estimateWeightOz(12345)).toBe(8);
  });

  test('object input does not throw', () => {
    expect(() => estimateWeightOz({})).not.toThrow();
    expect(typeof estimateWeightOz({})).toBe('number');
  });

  test('normal strings still match their rule buckets', () => {
    expect(estimateWeightOz('Pullover Hoodie')).toBe(18);
    expect(estimateWeightOz('Basic Tee')).toBe(6);
    expect(estimateWeightOz('Ankle Sock')).toBe(2);
    expect(estimateWeightOz('Unknown Widget')).toBe(8);
  });
});

// ── Regression: labelWeightLbs ──
describe('labelWeightLbs (regression)', () => {
  test('qty:0 contributes 0 weight (used to count as 1)', () => {
    // hoodie(18oz)*1 + tee(6oz)*0 = 18oz -> 1.1lb. If the bug were present,
    // the zero-qty tee would still add 6oz -> 24oz -> 1.5lb.
    const w = labelWeightLbs(
      [{ sku: 'hoodie', qty: 1 }, { sku: 'tee', qty: 0 }],
      {},
      {}
    );
    expect(w).toBe(1.1);
  });

  test('missing qty still counts as 1', () => {
    const w = labelWeightLbs([{ sku: 'tee' }], {}, {});
    expect(w).toBe(0.4); // 6oz / 16 = 0.375lb -> rounds to 0.4
  });

  test('negative/garbage qty counts as 0', () => {
    const w = labelWeightLbs(
      [{ sku: 'hoodie', qty: 1 }, { sku: 'tee', qty: -5 }, { sku: 'tee', qty: 'garbage' }],
      {},
      {}
    );
    expect(w).toBe(1.1); // only the hoodie (18oz) contributes
  });

  test('a weightByPid override of 0 is honored (no fallback to text estimate)', () => {
    // Without the override this would be hoodie(18) + tee(6) = 24oz -> 1.5lb.
    // With the pid-1 override at 0, only the tee's 6oz counts.
    const w = labelWeightLbs(
      [{ product_id: 1, sku: 'hoodie', qty: 1 }, { product_id: 2, sku: 'tee', qty: 1 }],
      {},
      { 1: 0 }
    );
    expect(w).toBe(0.4);
  });

  test('a non-zero override still wins over the text estimate', () => {
    // sku 'tee' would normally estimate 6oz; override forces 100oz.
    const w = labelWeightLbs([{ product_id: 2, sku: 'tee', qty: 1 }], {}, { 2: 100 });
    expect(w).toBe(6.3); // 100oz / 16 = 6.25lb -> rounds to 6.3 (half rounds up)
  });

  test('missing override falls back to the text estimate', () => {
    const w = labelWeightLbs([{ product_id: 3, sku: 'hoodie', qty: 1 }], {}, {});
    expect(w).toBe(1.1);
  });

  test('all-zero-qty items fall back to the store flat weight', () => {
    const w = labelWeightLbs([{ sku: 'hoodie', qty: 0 }], { label_weight_lbs: 5 }, {});
    expect(w).toBe(5);
  });

  test('tiny orders floor at 0.1 lb', () => {
    const w = labelWeightLbs([{ product_id: 9, sku: 'x', qty: 1 }], {}, { 9: 0.5 });
    expect(w).toBe(0.1); // 0.5oz / 16 = 0.03lb, floored up to the 0.1 minimum
  });
});

// ── Baseline/characterization: nextInvId ──
describe('nextInvId (baseline)', () => {
  test('empty array -> INV-1001', () => {
    expect(nextInvId([])).toBe('INV-1001');
  });

  test('max+1 on normal ids', () => {
    expect(nextInvId([{ id: 'INV-1001' }, { id: 'INV-1002' }])).toBe('INV-1003');
  });

  test('floors at 1000 for small ids', () => {
    expect(nextInvId([{ id: 'INV-5' }])).toBe('INV-1001');
  });

  test('duplicate ids are fine', () => {
    expect(nextInvId([{ id: 'INV-1005' }, { id: 'INV-1005' }])).toBe('INV-1006');
  });

  // LATENT TRAP: the regex is `/(\d+)$/` — it only grabs the TRAILING run of
  // digits, not the "real" invoice number embedded earlier in the id. An id
  // like 'INV-1005-2' (e.g. a reprinted/split invoice) contributes 2, not
  // 1005, to the max() calculation. This means a suffixed id can silently
  // fail to bump the counter past the base number it was derived from.
  // Pinning current behavior here so a future fix is a deliberate, visible change.
  test('suffixed id contributes its trailing run, not the base number', () => {
    expect(nextInvId([{ id: 'INV-1005-2' }])).toBe('INV-1001'); // max(1000,2)+1
  });

  // CONTRACT NOTE: nextInvId has no notion of "prefix" — it treats any id
  // (regardless of source system) as a number source via its trailing digits.
  // An 'EST-' prefixed id mixed into the same array will still contribute its
  // trailing digits to the shared counter, which is only correct if callers
  // never pass ids from other prefix families into the same invs array.
  test('mixed-prefix id contributes to the shared counter', () => {
    expect(nextInvId([{ id: 'EST-2000' }])).toBe('INV-2001');
  });
});

// ── Baseline/characterization: validateShipAddress ──
describe('validateShipAddress (baseline)', () => {
  const base = { street1: '123 Main St', city: 'Springfield', state: 'CA', zip: '90210' };

  test('happy path -> null', () => {
    expect(validateShipAddress(base)).toBeNull();
  });

  test('missing street', () => {
    expect(validateShipAddress({ ...base, street1: '' })).toBe('Missing street');
  });

  test('missing city', () => {
    expect(validateShipAddress({ ...base, city: '' })).toBe('Missing city');
  });

  test('missing state', () => {
    expect(validateShipAddress({ ...base, state: '' })).toBe('Missing state');
  });

  test('missing zip', () => {
    expect(validateShipAddress({ ...base, zip: '' })).toBe('Missing ZIP');
  });

  test('lowercase state is ok', () => {
    expect(validateShipAddress({ ...base, state: 'ca' })).toBeNull();
  });

  test('ZIP+4 is ok', () => {
    expect(validateShipAddress({ ...base, zip: '90210-1234' })).toBeNull();
  });

  // PIN: a numeric zip that lost a leading zero (e.g. Massachusetts '02134'
  // stored as the number 2134) fails the 5-digit format check because
  // String(2134) is only 4 characters. Upstream code must store ZIPs as
  // strings, not numbers, or this rejects otherwise-valid addresses.
  test('numeric zip that lost its leading zero is rejected', () => {
    expect(validateShipAddress({ ...base, zip: 2134 })).toBe('ZIP must be 5 digits (or ZIP+4)');
  });

  // PIN: non-US addresses skip the state/ZIP FORMAT checks entirely (only
  // presence is checked) — a Canadian postal code and province name pass
  // through unvalidated by design.
  test('non-US country skips state/zip format checks', () => {
    expect(validateShipAddress({ ...base, country: 'CA', state: 'Ontario', zip: 'K1A 0B1' })).toBeNull();
  });
});

// ── Baseline/characterization: computeOrderTracking ──
describe('computeOrderTracking (baseline)', () => {
  test('single order fully received -> ready status', () => {
    const so = { items: [{ sku: 'ABC', product_id: 'p1', name: 'Test Hoodie', po_lines: [{ billed: { M: 5 }, received: { M: 5 } }], pick_lines: [] }] };
    const orders = [{ id: 'o1', omg_order_number: '1001', items: [{ id: 'f0', sku: 'ABC', product_id: 'p1', size: 'M', qty: 5 }] }];
    const out = computeOrderTracking({ orders, so, products: [] });
    expect(out.f0.status).toBe('ready');
    expect(out.f0.need).toBe(0);
  });

  test('FIFO across two orders sharing one SO line — second order gets remaining supply and reads partial', () => {
    const so = { items: [{ sku: 'ABC', product_id: 'p1', name: 'Test Hoodie', po_lines: [{ billed: { M: 5 }, received: { M: 5 } }], pick_lines: [] }] };
    const orders = [
      { id: 'o1', omg_order_number: '1001', items: [{ id: 'f1', sku: 'ABC', product_id: 'p1', size: 'M', qty: 3 }] },
      { id: 'o2', omg_order_number: '1002', items: [{ id: 'f2', sku: 'ABC', product_id: 'p1', size: 'M', qty: 4 }] },
    ];
    const out = computeOrderTracking({ orders, so, products: [] });
    expect(out.f1.status).toBe('ready');
    expect(out.f1.received).toBe(3);
    expect(out.f1.need).toBe(0);
    expect(out.f2.status).toBe('partial');
    expect(out.f2.received).toBe(2); // only 2 units left in the pool after order 1 drew 3 of 5
    expect(out.f2.need).toBe(2);
  });

  // PIN / DATA-LOSS CONTRACT: the output is keyed by order-line id (`out[i.id]`).
  // If two different order lines (from two different orders) happen to share
  // the same `item.id`, the later-processed order (FIFO order) silently
  // overwrites the earlier one's entry — the first order's tracking info is
  // lost from the returned map. Callers must guarantee item ids are unique
  // across the whole `orders` array passed in, not just within one order.
  test('duplicate item.id across two orders — second overwrites first', () => {
    const orders = [
      { id: 'o1', omg_order_number: '1', items: [{ id: 'dup1', sku: 'AAA', product_id: 'pA', size: 'M', qty: 1 }] },
      { id: 'o2', omg_order_number: '2', items: [{ id: 'dup1', sku: 'BBB', product_id: 'pB', size: 'M', qty: 9 }] },
    ];
    const out = computeOrderTracking({ orders, so: null, products: [] });
    expect(Object.keys(out)).toHaveLength(1);
    expect(out.dup1.ordered).toBe(9); // order2's line won, order1's is gone
  });

  // PIN: qty:0 (cancelled-ish line) and a NaN qty both coerce to 0 via
  // `Number(i.qty) || 0`, and 0 >= 0 is true, so both read as fully
  // "shipped" rather than "awaiting" — a zero-need line reads as done.
  test('qty:0 or NaN line is marked shipped', () => {
    const orders = [{ id: 'o1', omg_order_number: '1', items: [
      { id: 'z1', sku: 'ZZZ', size: 'M', qty: 0 },
      { id: 'z2', sku: 'ZZZ', size: 'M', qty: NaN },
    ] }];
    const out = computeOrderTracking({ orders, so: null, products: [] });
    expect(out.z1.status).toBe('shipped');
    expect(out.z1.need).toBe(0);
    expect(out.z2.status).toBe('shipped');
    expect(out.z2.need).toBe(0);
  });

  test('unresolvable sku -> awaiting with need=ordered', () => {
    const so = { items: [{ sku: 'ABC', product_id: 'p1', name: 'Test Hoodie', po_lines: [{ billed: { M: 5 }, received: { M: 5 } }], pick_lines: [] }] };
    const orders = [{ id: 'o1', omg_order_number: '1001', items: [{ id: 'u1', sku: 'NOPE', product_id: 'pX', size: 'M', qty: 7 }] }];
    const out = computeOrderTracking({ orders, so, products: [] });
    expect(out.u1.status).toBe('awaiting');
    expect(out.u1.need).toBe(7);
    expect(out.u1.ordered).toBe(7);
  });
});
