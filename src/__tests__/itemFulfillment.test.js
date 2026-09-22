import { findIF, buildIFTask, buildNotHere, zeroInventoryFor, notHereSummary, pickSizeKeys, pickUnits, findOverPromised, ifStockCoverage } from '../itemFulfillment';

const so = () => ({
  id: 'SO-2492', customer_id: 'c1', created_by: 'r1', expected_date: '2099-01-01',
  items: [
    { sku: 'JW6602', name: 'Adidas Fleece Hood', color: 'Black', product_id: 'p1',
      sizes: { S: 4, M: 6, L: 6 },
      pick_lines: [{ pick_id: 'IF-1192', status: 'pick', ship_dest: 'in_house', S: 4, M: 6, L: 6 }] },
    { sku: 'JW7788', name: 'Adidas Tee', color: 'White', product_id: 'p2',
      sizes: { M: 3 },
      pick_lines: [{ pick_id: 'IF-1192', status: 'pick', M: 3 }] },
    { sku: 'OTHER', name: 'Not on this IF', product_id: 'p3', sizes: { L: 2 },
      pick_lines: [{ pick_id: 'IF-9999', status: 'pick', L: 2 }] },
  ],
});

describe('pick line size keys', () => {
  test('separates size quantities from metadata and orders them by wear run', () => {
    const pick = { pick_id: 'IF-1', status: 'pick', created_at: 'x', L: 2, S: 1, XL: 3, not_here: { S: 1 } };
    expect(pickSizeKeys(pick)).toEqual(['S', 'L', 'XL']);
    expect(pickUnits(pick)).toBe(6);
  });
});

describe('findIF / buildIFTask', () => {
  test('resolves an IF to its order and every line that shares the pick_id', () => {
    const found = findIF([so()], 'if-1192');
    expect(found.so.id).toBe('SO-2492');
    expect(found.entries.map(e => e.item.sku)).toEqual(['JW6602', 'JW7788']);
  });

  test('returns null for an unknown IF', () => {
    expect(findIF([so()], 'IF-0000')).toBeNull();
    expect(buildIFTask([so()], '')).toBeNull();
  });

  test('always sets _pickId so the detail view renders every item on the IF', () => {
    const t = buildIFTask([so()], 'IF-1192', { customers: [{ id: 'c1', name: 'Glen A Wilson HS' }], reps: [{ id: 'r1', name: 'Jered Hunt' }] });
    expect(t._pickId).toBe('IF-1192');
    expect(t.cName).toBe('Glen A Wilson HS');
    expect(t.rep).toBe('Jered');
    expect(t.needsPull).toBe(19);
    expect(t.isClosed).toBe(false);
    expect(t._skus).toEqual(['JW6602', 'JW7788']);
  });

  test('a fully pulled IF still resolves — the open-pull list no longer carries it', () => {
    const o = so();
    o.items[0].pick_lines = [{ pick_id: 'IF-1192', status: 'pulled', S: 4, M: 6, L: 6 }];
    o.items[1].pick_lines = [{ pick_id: 'IF-1192', status: 'pulled', M: 3 }];
    const t = buildIFTask([o], 'IF-1192');
    expect(t.isClosed).toBe(true);
    expect(t.totalPulled).toBe(19);
    expect(t.needsPull).toBe(0);
  });
});

describe('buildNotHere', () => {
  test('whole IF: closes every line at 0 and records what was asked for', () => {
    const o = so();
    const r = buildNotHere({ so: o, ifId: 'IF-1192', by: 'u1', at: 'NOW' });
    expect(r.units).toBe(19);
    const [a, b, untouched] = r.items;
    expect(a.pick_lines[0]).toMatchObject({ status: 'pulled', pulled_at: 'NOW', S: 0, M: 0, L: 0, not_here: { S: 4, M: 6, L: 6 }, not_here_by: 'u1' });
    expect(b.pick_lines[0]).toMatchObject({ status: 'pulled', M: 0, not_here: { M: 3 } });
    // A different IF on the same order is untouched.
    expect(untouched.pick_lines[0]).toEqual({ pick_id: 'IF-9999', status: 'pick', L: 2 });
    // The customer still wants the goods — the ordered quantity is never reduced.
    expect(a.sizes).toEqual({ S: 4, M: 6, L: 6 });
  });

  test('one size: the line stays open for the sizes that are still on the shelf', () => {
    const o = so();
    const r = buildNotHere({ so: o, ifId: 'IF-1192', itemIdx: 0, sizes: ['M'], at: 'NOW' });
    expect(r.units).toBe(6);
    const pick = r.items[0].pick_lines[0];
    expect(pick.status).toBe('pick');
    expect(pick).toMatchObject({ S: 4, M: 0, L: 6, not_here: { M: 6 } });
    // The second item on the IF was out of scope.
    expect(r.items[1].pick_lines[0]).toMatchObject({ status: 'pick', M: 3 });
  });

  test('declaring the last open size closes the line', () => {
    let o = so();
    o = { ...o, items: buildNotHere({ so: o, ifId: 'IF-1192', itemIdx: 0, sizes: ['S', 'M'], at: 'T1' }).items };
    expect(o.items[0].pick_lines[0].status).toBe('pick');
    const r = buildNotHere({ so: o, ifId: 'IF-1192', itemIdx: 0, sizes: ['L'], at: 'T2' });
    expect(r.items[0].pick_lines[0]).toMatchObject({ status: 'pulled', pulled_at: 'T2', not_here: { S: 4, M: 6, L: 6 } });
  });

  test('no-ops rather than re-closing an already pulled line or an unknown IF', () => {
    const o = so();
    o.items[0].pick_lines[0].status = 'pulled';
    o.items[1].pick_lines[0].status = 'pulled';
    expect(buildNotHere({ so: o, ifId: 'IF-1192' })).toBeNull();
    expect(buildNotHere({ so: so(), ifId: 'IF-0000' })).toBeNull();
    expect(buildNotHere({ so: so(), ifId: 'IF-1192', itemIdx: 0, sizes: ['4XL'] })).toBeNull();
  });

  test('reports the products and sizes whose stock is now known to be zero', () => {
    const r = buildNotHere({ so: so(), ifId: 'IF-1192' });
    expect(r.declared).toEqual([
      { itemIdx: 0, sku: 'JW6602', productId: 'p1', size: 'S', qty: 4 },
      { itemIdx: 0, sku: 'JW6602', productId: 'p1', size: 'M', qty: 6 },
      { itemIdx: 0, sku: 'JW6602', productId: 'p1', size: 'L', qty: 6 },
      { itemIdx: 1, sku: 'JW7788', productId: 'p2', size: 'M', qty: 3 },
    ]);
  });
});

describe('zeroInventoryFor', () => {
  test('zeroes only the declared sizes and reports the deltas the adjustment log needs', () => {
    const r = zeroInventoryFor({ _inv: { S: 5, M: 2, L: 9 } }, ['S', 'M']);
    expect(r.next).toEqual({ S: 0, M: 0, L: 9 });
    expect(r.deltas).toEqual({ S: -5, M: -2 });
  });

  test('null when nothing changes — no phantom adjustment-log rows', () => {
    expect(zeroInventoryFor({ _inv: { S: 0 } }, ['S'])).toBeNull();
    expect(zeroInventoryFor({ _inv: {} }, ['S'])).toBeNull();
    expect(zeroInventoryFor(null, ['S'])).toBeNull();
  });
});

describe('notHereSummary', () => {
  test('rolls the recorded shortfall up per SKU for display', () => {
    const o = so();
    const after = { ...o, items: buildNotHere({ so: o, ifId: 'IF-1192' }).items };
    expect(notHereSummary(after, 'IF-1192')).toEqual({ JW6602: { S: 4, M: 6, L: 6 }, JW7788: { M: 3 } });
    expect(notHereSummary(o, 'IF-1192')).toEqual({});
  });
});

// The rep's "Short on pull — Create PO" action item is derived in App.js from the order's
// own state; it fires only when EVERY pick line on the item is closed AND every size the
// order still asks for carries a key on a closed line (a size with no such key means the
// line was edited after its pull, which is new demand, not a shortfall). "Not Here" has to
// leave the data in exactly that shape or the rep never learns the goods are missing.
describe('what Not Here hands the rep', () => {
  const closedFor = (item, ifId) => (item.pick_lines || []).filter(pk => pk.pick_id === ifId);

  test('closes every line and leaves a key for each ordered size, so the short-pull alert fires', () => {
    const after = { ...so(), items: buildNotHere({ so: so(), ifId: 'IF-1192' }).items };
    after.items.slice(0, 2).forEach(item => {
      const picks = closedFor(item, 'IF-1192');
      expect(picks.every(pk => pk.status === 'pulled')).toBe(true);
      const pulledSizeKeys = new Set(picks.flatMap(pk => Object.keys(pk).filter(k => ['S', 'M', 'L', 'XL'].includes(k))));
      Object.keys(item.sizes).forEach(sz => expect(pulledSizeKeys.has(sz)).toBe(true));
      const pulled = Object.keys(item.sizes).reduce((a, sz) => a + picks.reduce((x, pk) => x + (pk[sz] || 0), 0), 0);
      const ordered = Object.values(item.sizes).reduce((a, v) => a + v, 0);
      expect(pulled).toBe(0);
      expect(ordered - pulled).toBeGreaterThan(0);// a real gap for the rep to raise a PO against
    });
  });

  test('a partial Not Here leaves the IF open, so the alert waits for the real pull', () => {
    const r = buildNotHere({ so: so(), ifId: 'IF-1192', itemIdx: 0, sizes: ['S'] });
    expect(closedFor(r.items[0], 'IF-1192').some(pk => (pk.status || 'pick') !== 'pulled')).toBe(true);
  });
});

describe('findOverPromised', () => {
  // Two orders want the same hood. Rejecting one zeroes the shelf; the other is now
  // promised stock that does not exist, and its pull will also come up empty.
  const twoOrders = () => ([
    { id: 'SO-1', items: [{ sku: 'JW6602', product_id: 'p1', sizes: { M: 6 },
      pick_lines: [{ pick_id: 'IF-1192', status: 'pick', M: 6 }] }] },
    { id: 'SO-2', items: [{ sku: 'JW6602', product_id: 'p1', sizes: { M: 4, L: 2 },
      pick_lines: [{ pick_id: 'IF-2000', status: 'pick', M: 4, L: 2 }] }] },
  ]);

  test('names the other open IFs that can no longer be filled', () => {
    const declared = [{ itemIdx: 0, sku: 'JW6602', productId: 'p1', size: 'M', qty: 6 }];
    expect(findOverPromised({ sos: twoOrders(), declared, excludeIFs: ['IF-1192'] }))
      .toEqual([{ soId: 'SO-2', ifId: 'IF-2000', sku: 'JW6602', sizes: [{ size: 'M', need: 4 }] }]);
  });

  test('does not report the IF that was just rejected', () => {
    const declared = [{ sku: 'JW6602', productId: 'p1', size: 'M', qty: 6 }];
    const hits = findOverPromised({ sos: twoOrders(), declared, excludeIFs: ['if-1192'] });
    expect(hits.some(h => h.ifId === 'IF-1192')).toBe(false);
  });

  test('ignores sizes that were not zeroed, and lines already closed', () => {
    const sos = twoOrders();
    // L was never declared, so SO-2's L is unaffected.
    const declared = [{ sku: 'JW6602', productId: 'p1', size: 'M', qty: 6 }];
    expect(findOverPromised({ sos, declared, excludeIFs: ['IF-1192'] })[0].sizes)
      .toEqual([{ size: 'M', need: 4 }]);
    sos[1].items[0].pick_lines[0].status = 'pulled';
    expect(findOverPromised({ sos, declared, excludeIFs: ['IF-1192'] })).toEqual([]);
  });

  test('matches by SKU when the line carries no product_id', () => {
    const sos = twoOrders();
    delete sos[1].items[0].product_id;
    const declared = [{ sku: 'jw6602', productId: 'p1', size: 'M', qty: 6 }];
    expect(findOverPromised({ sos, declared, excludeIFs: ['IF-1192'] })).toHaveLength(1);
  });

  test('nothing declared, nothing reported', () => {
    expect(findOverPromised({ sos: twoOrders(), declared: [], excludeIFs: [] })).toEqual([]);
    expect(findOverPromised({})).toEqual([]);
  });
});

describe('ifStockCoverage', () => {
  const inv = { p1: { _inv: { S: 2, M: 0, XL: 40 } }, p2: { _inv: { M: 10 } } };
  const find = sub => inv[sub.productId];

  test('counts only the sizes the IF needs — 40 XL does not cover a missing M', () => {
    const task = { _subTasks: [{ productId: 'p1', sku: 'JW6602', szKeys: ['S', 'M'], sizes: { S: 2, M: 5 }, pulled: {} }] };
    const r = ifStockCoverage(task, find);
    expect(r.need).toBe(7);
    expect(r.have).toBe(2);         // the 40 XL are irrelevant
    expect(r.covered).toBe(false);
    expect(r.short).toEqual([{ sku: 'JW6602', size: 'M', need: 5, have: 0 }]);
  });

  test('adds up across the SKUs of a multi-item IF', () => {
    const task = { _subTasks: [
      { productId: 'p1', sku: 'A', szKeys: ['S'], sizes: { S: 2 }, pulled: {} },
      { productId: 'p2', sku: 'B', szKeys: ['M'], sizes: { M: 3 }, pulled: {} },
    ] };
    expect(ifStockCoverage(task, find)).toMatchObject({ need: 5, have: 5, covered: true, short: [] });
  });

  test('already-pulled units are not still needed', () => {
    const task = { _subTasks: [{ productId: 'p1', sku: 'A', szKeys: ['S'], sizes: { S: 2 }, pulled: { S: 2 } }] };
    expect(ifStockCoverage(task, find)).toMatchObject({ need: 0, have: 0, covered: false });
  });

  test('an unknown product reads as nothing on hand rather than throwing', () => {
    const task = { _subTasks: [{ productId: 'nope', sku: 'X', szKeys: ['S'], sizes: { S: 3 }, pulled: {} }] };
    expect(ifStockCoverage(task, find)).toMatchObject({ need: 3, have: 0, none: true });
    expect(ifStockCoverage(task, () => null).have).toBe(0);
  });

  test('falls back to the row itself when it has no sub-tasks', () => {
    expect(ifStockCoverage({ productId: 'p2', sku: 'B', szKeys: ['M'], sizes: { M: 4 }, pulled: {} }, find))
      .toMatchObject({ need: 4, have: 4, covered: true });
  });
});
