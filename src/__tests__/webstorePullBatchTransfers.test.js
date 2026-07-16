/* pullBatchTransfers array support (club-store Group Pull) — unit tests for the
 * extracted pure aggregation, computePullPlan (src/Webstores.js).
 *
 * pullBatchTransfers itself is a closure over the Webstores component's local state
 * (supabase calls + setState) with no standalone test surface, so — per the
 * club-store-flow spec's own fallback ("unit-test the extracted aggregation logic")
 * — the pure "which rows to decrement, which so_ids to stamp" computation was
 * factored out into computePullPlan and is exercised directly here. This is the
 * SAME function pullBatchTransfers calls, not a reimplementation, so a regression in
 * the real code fails this test too.
 *
 * The core guarantee under test: passing an array of so_ids (every converted-but-
 * unpulled club order, each its own Sales Order) decrements each transfer code
 * EXACTLY ONCE (aggregate demand, not once per order) and targets every so_id in the
 * group — while a single so_id (the existing team-store call path) keeps working
 * unchanged.
 */
const { computePullPlan } = require('../Webstores');

const TRANSFERS = [
  { id: 't-logo', code: 'logo-a', on_hand: 50 },
  { id: 't-num-3', code: '3|8in|white', on_hand: 10 },
  { id: 't-untouched', code: 'logo-b', on_hand: 5 },
];

describe('computePullPlan', () => {
  test('single so_id (team-store path, unchanged): one so_id, decrements only needed codes', () => {
    const { soIds, decrements } = computePullPlan('SO-1', { 'logo-a': 4 }, TRANSFERS);
    expect(soIds).toEqual(['SO-1']);
    expect(decrements).toEqual([{ id: 't-logo', on_hand: 46 }]);
  });

  test('array of so_ids (club Group Pull): aggregate need decrements each code ONCE, not once per order', () => {
    // Combined need across every converted-but-unpulled club order (already summed by
    // batchTransfers, the way it always has been for a single SO's group of orders).
    const neededByCode = { 'logo-a': 12, '3|8in|white': 2 };
    const { soIds, decrements } = computePullPlan(['SO-101', 'SO-102', 'SO-103'], neededByCode, TRANSFERS);
    expect(soIds).toEqual(['SO-101', 'SO-102', 'SO-103']);
    // Exactly one decrement row per transfer with demand — never one per so_id.
    expect(decrements).toHaveLength(2);
    expect(decrements).toEqual(expect.arrayContaining([
      { id: 't-logo', on_hand: 38 },
      { id: 't-num-3', on_hand: 8 },
    ]));
    // A code with no demand in this group is left untouched.
    expect(decrements.find((d) => d.id === 't-untouched')).toBeUndefined();
  });

  test('on_hand never goes negative even if demand exceeds stock', () => {
    const { decrements } = computePullPlan('SO-1', { 'logo-a': 999 }, TRANSFERS);
    expect(decrements).toEqual([{ id: 't-logo', on_hand: 0 }]);
  });

  test('empty/undefined so_id array yields no so_ids (caller no-ops)', () => {
    expect(computePullPlan([], {}, TRANSFERS).soIds).toEqual([]);
    expect(computePullPlan([null, undefined], {}, TRANSFERS).soIds).toEqual([]);
  });

  test('no matching demand produces no decrements', () => {
    const { decrements } = computePullPlan('SO-1', { 'nonexistent-code': 5 }, TRANSFERS);
    expect(decrements).toEqual([]);
  });
});
