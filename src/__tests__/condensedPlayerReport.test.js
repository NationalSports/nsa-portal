// The condensed player report puts a DOLLAR figure next to a family's name, so its
// money basis is the part worth testing hard. The recurring trap in this schema is
// that a per-line unit_price is not a valid basis: it is $0 on 43% of OMG-imported
// lines (measured in production, 1024/2384) and on every bundle component, whose
// package price sits on a parent line the report scope drops. These tests pin the
// order-level basis down so nobody "simplifies" it back into a line sum.
import { buildCondensedPlayerRows, orderNetCollected, originalOrderTotal } from '../lib/webstoreOrderMoney';

const line = (order_id, player_name, qty = 1, extra = {}) => ({ order_id, player_name, qty, ...extra });

describe('order valuation', () => {
  test('original_total wins over an edited total — the immutable amount billed', () => {
    expect(originalOrderTotal({ total: 288.64, original_total: 300 })).toBe(300);
    expect(originalOrderTotal({ total: 288.64 })).toBe(288.64);
  });

  test('refunds come off the top and never go negative', () => {
    expect(orderNetCollected({ total: 1473.64, refunded_amt: 73.64 })).toBeCloseTo(1400, 2);
    expect(orderNetCollected({ total: 100, refunded_amt: 250 })).toBe(0);
  });

  test('missing/garbage orders value at zero rather than NaN', () => {
    expect(orderNetCollected(null)).toBe(0);
    expect(orderNetCollected({})).toBe(0);
    expect(orderNetCollected({ total: 'abc' })).toBe(0);
  });
});

describe('condensed player rows', () => {
  const orderById = {
    o1: { id: 'o1', buyer_name: 'Kelly Stout', total: 72.16 },
    o2: { id: 'o2', buyer_name: 'Deena Nichols', total: 656.21 },
    o3: { id: 'o3', buyer_name: 'Nicholas Boyett', total: 1473.64, refunded_amt: 73.64 },
  };
  const lines = [
    line('o1', 'Isla Stout', 1, { player_number: 7 }),
    line('o1', 'Isla Stout', 1, { player_number: 7 }),
    line('o2', 'Mason Nichols', 18),
    line('o3', 'Boyett', 40),
  ];

  test('one row per player, alphabetical, with items and net total', () => {
    const { rows, totalUnits, grandTotal } = buildCondensedPlayerRows({ lines, orderById });
    expect(rows.map((r) => r.label)).toEqual(['Boyett', 'Isla Stout', 'Mason Nichols']);
    expect(rows.map((r) => r.units)).toEqual([40, 2, 18]);
    expect(rows.map((r) => r.total)).toEqual([1400, 72.16, 656.21]);
    expect(rows[1].buyers).toEqual(['Kelly Stout']);
    expect(totalUnits).toBe(60);
    expect(grandTotal).toBeCloseTo(2128.37, 2);
  });

  // The whole reason this does not sum unit_price. An OMG store's lines are $0;
  // a line-sum total would report $0.00 for every family in it.
  test('total ignores unit_price entirely — $0 OMG lines still value correctly', () => {
    const omgLines = [line('o1', 'Isla Stout', 2, { unit_price: 0 })];
    const { rows, grandTotal } = buildCondensedPlayerRows({ lines: omgLines, orderById });
    expect(rows[0].total).toBe(72.16);
    expect(grandTotal).toBe(72.16);
  });

  // Bundle components are $0 with the package price on a dropped parent line.
  test('a player whose only lines are $0 bundle components still shows the package price', () => {
    const bundleLines = [
      line('o2', 'Mason Nichols', 1, { unit_price: 0, bundle_product_id: 'b1' }),
      line('o2', 'Mason Nichols', 1, { unit_price: 0, bundle_product_id: 'b1' }),
    ];
    const { rows } = buildCondensedPlayerRows({ lines: bundleLines, orderById });
    expect(rows[0].total).toBe(656.21);
  });

  test("a player's several orders sum, and each order counts once however many lines it has", () => {
    const multi = [line('o1', 'Isla Stout', 1), line('o1', 'Isla Stout', 5), line('o2', 'Isla Stout', 2)];
    const { rows, grandTotal } = buildCondensedPlayerRows({ lines: multi, orderById });
    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(8);
    expect(rows[0].total).toBeCloseTo(728.37, 2); // 72.16 + 656.21, not 72.16*2 + 656.21
    expect(grandTotal).toBeCloseTo(728.37, 2);
    expect(rows[0].buyers).toEqual(['Kelly Stout', 'Deena Nichols']);
  });

  // Production has never produced a multi-player order, but nothing forbids one.
  // It must not silently double the store's money.
  test('an order shared by two players is flagged and counted once in the grand total', () => {
    const shared = [line('o2', 'Ana Vance', 2), line('o2', 'Bo Vance', 3)];
    const { rows, grandTotal, anyShared } = buildCondensedPlayerRows({ lines: shared, orderById });
    expect(rows.map((r) => r.total)).toEqual([656.21, 656.21]);
    expect(rows.every((r) => r.shared)).toBe(true);
    expect(anyShared).toBe(true);
    expect(grandTotal).toBe(656.21); // NOT 1312.42
  });

  test('unnamed players fall back to the buyer without merging separate buyers', () => {
    const anon = [line('o1', '', 1), line('o2', '', 1)];
    const { rows, grandTotal } = buildCondensedPlayerRows({ lines: anon, orderById });
    expect(rows.map((r) => r.label)).toEqual(['Deena Nichols (buyer)', 'Kelly Stout (buyer)']);
    expect(grandTotal).toBeCloseTo(728.37, 2);
    expect(anyShared(rows)).toBe(false);
    function anyShared(rs) { return rs.some((r) => r.shared); }
  });

  test('empty input yields zeroes, not NaN', () => {
    const { rows, totalUnits, grandTotal, anyShared } = buildCondensedPlayerRows({ lines: [], orderById: {} });
    expect(rows).toEqual([]);
    expect(totalUnits).toBe(0);
    expect(grandTotal).toBe(0);
    expect(anyShared).toBe(false);
  });

  // The store header's Sales number is sum(orderNetCollected) over live orders. A
  // whole-store run of this report must tie out to it, or the rep sees two numbers.
  test('grand total ties out to the store Sales figure for the same orders', () => {
    const storeSales = Object.values(orderById).reduce((sum, o) => sum + orderNetCollected(o), 0);
    const { grandTotal } = buildCondensedPlayerRows({ lines, orderById });
    expect(grandTotal).toBeCloseTo(storeSales, 2);
  });
});
