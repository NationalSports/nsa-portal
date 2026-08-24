/* Bagging Station pure logic (src/baggingstation/bagLogic.js). */

import {
  claimIsStale, lineSatisfied, lineOnOrder, orderProgress, sortLinesForBag,
  playerHeader, shortSummary, nextOrderPick, batchItemTotals, sortOrders, dominantSize, orderInDeco, CLAIM_STALE_MS,
} from '../baggingstation/bagLogic';

const NOW = Date.parse('2026-08-12T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

describe('claimIsStale', () => {
  test('fresh claim holds, old claim is stale, garbage is stale', () => {
    expect(claimIsStale(iso(60 * 1000), NOW)).toBe(false);
    expect(claimIsStale(iso(CLAIM_STALE_MS + 1000), NOW)).toBe(true);
    expect(claimIsStale(null, NOW)).toBe(true);
    expect(claimIsStale('not-a-date', NOW)).toBe(true);
  });
});

describe('lineSatisfied — mirrors server bagging_line_satisfied', () => {
  test('tapped-off line satisfies', () => {
    expect(lineSatisfied({ qty: 2, bagged_qty: 2 })).toBe(true);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1 })).toBe(false);
  });
  test('open/backordered/refunded shorts cover the gap; found/pulled do not', () => {
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'open' })).toBe(true);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'backordered' })).toBe(true);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'refunded' })).toBe(true);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'found' })).toBe(false);
    expect(lineSatisfied({ qty: 2, bagged_qty: 1, short_qty: 1, short_status: 'pulled' })).toBe(false);
  });
  test('cancelled line is always satisfied', () => {
    expect(lineSatisfied({ qty: 5, bagged_qty: 0, line_status: 'cancelled' })).toBe(true);
  });
});

describe('orderProgress', () => {
  test('unit math across qty>1, shorts, waiting, cancelled', () => {
    const items = [
      { qty: 3, bagged_qty: 2 },
      { qty: 1, bagged_qty: 0, short_qty: 1, short_status: 'open' },
      { qty: 2, bagged_qty: 0, line_status: 'on_order' },
      { qty: 9, bagged_qty: 0, line_status: 'cancelled' }, // excluded entirely
    ];
    const p = orderProgress(items);
    expect(p).toEqual({ total: 6, checked: 2, short: 1, waiting: 2, complete: false });
  });
  test('complete only when every live line is satisfied; empty order is not complete', () => {
    expect(orderProgress([{ qty: 1, bagged_qty: 1 }]).complete).toBe(true);
    expect(orderProgress([]).complete).toBe(false);
  });
});

describe('sortLinesForBag', () => {
  test('bundle parent leads its children; loose lines sorted by size then name', () => {
    const items = [
      { id: 'l2', name: 'Pant', size: 'L' },
      { id: 'c1', name: 'Bundle Sock', size: 'M', bundle_ref: 'b1' },
      { id: 'l1', name: 'Jersey', size: 'YM' },
      { id: 'p1', name: 'Bundle Kit', size: 'M', is_bundle_parent: true, bundle_ref: 'b1' },
    ];
    expect(sortLinesForBag(items).map((i) => i.id)).toEqual(['p1', 'c1', 'l1', 'l2']);
  });
});

describe('playerHeader', () => {
  test('prefers item player fields, falls back to buyer', () => {
    expect(playerHeader({ buyer_name: 'Parent Name' }, [
      { player_name: ' ', player_number: '' },
      { player_name: 'Jimmy Smith', player_number: '23' },
    ])).toEqual({ name: 'Jimmy Smith', number: '23' });
    expect(playerHeader({ buyer_name: 'Parent Name' }, [{}])).toEqual({ name: 'Parent Name', number: '' });
  });
});

describe('shortSummary', () => {
  test('lists only counting shorts', () => {
    const s = shortSummary([
      { id: 'a', name: 'Hoodie', size: 'YS', short_qty: 1, short_status: 'open' },
      { id: 'b', name: 'Jersey', size: 'M', short_qty: 1, short_status: 'found' }, // resolved → excluded
      { id: 'c', name: 'Pant', size: 'L', short_qty: 0, short_status: null },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].text).toBe('1× Hoodie YS');
  });
});

describe('batchItemTotals — the staging start page', () => {
  const orders = [
    { webstore_order_items: [
      { sku: 'JR1', name: 'Jersey', color: 'Navy', size: 'YM', qty: 2, bagged_qty: 1 },
      { sku: 'JR1', name: 'Jersey', color: 'Navy', size: 'M', qty: 1, bagged_qty: 0 },
      { sku: 'KIT', name: 'Bundle Kit', size: 'M', qty: 1, is_bundle_parent: true }, // skipped
    ] },
    { webstore_order_items: [
      { sku: 'JR1', name: 'Jersey', color: 'Navy', size: 'YM', qty: 1, bagged_qty: 0, short_qty: 1, short_status: 'open' },
      { sku: 'PT2', name: 'Pant', color: 'Black', size: 'YM', qty: 1, bagged_qty: 1 },
      { sku: 'XX', name: 'Cancelled thing', size: 'S', qty: 5, line_status: 'cancelled' }, // skipped
    ] },
  ];
  test('aggregates per product × size with bagged/short, sizes in wear order', () => {
    const { sizes, rows, totals } = batchItemTotals(orders);
    expect(sizes).toEqual(['YM', 'M']); // wear order, not alphabetical
    expect(rows.map((r) => r.name)).toEqual(['Jersey', 'Pant']);
    const jersey = rows[0];
    expect(jersey.sizes.get('YM')).toEqual({ total: 3, bagged: 1, short: 1 });
    expect(jersey.sizes.get('M')).toEqual({ total: 1, bagged: 0, short: 0 });
    expect(totals).toEqual({ total: 5, bagged: 2, short: 1, remaining: 2 });
  });
});

describe('orderInDeco — deco gate mirrors server bagging_order_ready', () => {
  test('blocks while any live line is pre-bagging; on_order does not block', () => {
    expect(orderInDeco({}, [{ line_status: 'in_production' }])).toBe(true);
    expect(orderInDeco({}, [{ line_status: 'received' }])).toBe(true);
    expect(orderInDeco({}, [{}])).toBe(true); // missing status = pending
    expect(orderInDeco({}, [{ line_status: 'bagging' }, { line_status: 'on_order' }])).toBe(false);
    expect(orderInDeco({}, [{ line_status: 'shipped' }])).toBe(false);
    expect(orderInDeco({}, [{ line_status: 'pending', is_bundle_parent: true }, { line_status: 'bagging' }])).toBe(false);
  });
  test('backorder child orders are exempt', () => {
    expect(orderInDeco({ backorder_of: 'parent' }, [{ line_status: 'pending' }])).toBe(false);
  });
});

describe('sortOrders / dominantSize — board sort modes', () => {
  const o = (id, created, size, player) => ({
    id, created_at: created,
    webstore_order_items: [{ size, qty: 1, player_name: player }],
  });
  const orders = [
    o('a', '2026-08-03', 'L', 'Zoe'),
    o('b', '2026-08-01', 'YM', 'Adam'),
    o('c', '2026-08-02', 'M', 'Mia'),
  ];
  test('oldest / size / name orderings', () => {
    expect(sortOrders(orders, 'oldest').map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(sortOrders(orders, 'size').map((x) => x.id)).toEqual(['b', 'c', 'a']); // YM < M < L wear order
    expect(sortOrders(orders, 'name').map((x) => x.id)).toEqual(['b', 'c', 'a']); // Adam, Mia, Zoe
  });
  test('dominantSize picks the highest-qty size, wear order breaking ties', () => {
    expect(dominantSize([{ size: 'M', qty: 1 }, { size: 'YM', qty: 2 }])).toBe('YM');
    expect(dominantSize([{ size: 'L', qty: 1 }, { size: 'YS', qty: 1 }])).toBe('YS'); // tie → earlier wear order
    expect(dominantSize([])).toBeNull();
  });
});

describe('nextOrderPick', () => {
  test('skips bagged and freshly-claimed-by-others; oldest first; own claim ok', () => {
    const orders = [
      { id: 'done', bagged_at: iso(0), created_at: '2026-08-01' },
      { id: 'held', bagging_claimed_by: 'other', bagging_claimed_at: iso(60 * 1000), created_at: '2026-08-02' },
      { id: 'stale', bagging_claimed_by: 'other', bagging_claimed_at: iso(CLAIM_STALE_MS * 2), created_at: '2026-08-04' },
      { id: 'mine', bagging_claimed_by: 'me', bagging_claimed_at: iso(1000), created_at: '2026-08-03' },
    ];
    expect(nextOrderPick(orders, 'me', NOW).id).toBe('mine');
    expect(nextOrderPick(orders.filter((o) => o.id !== 'mine'), 'me', NOW).id).toBe('stale');
    expect(nextOrderPick([], 'me', NOW)).toBeNull();
  });
});
