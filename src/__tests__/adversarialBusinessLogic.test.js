/* eslint-disable */
// ═══════════════════════════════════════════════
// ADVERSARIAL / CHARACTERIZATION TESTS — src/businessLogic.js
//
// These tests exercise edge cases and "questionable but deliberately left
// unchanged" behaviors found in a prior traced analysis of businessLogic.js.
// Each was RE-VERIFIED by running the real function before being written
// here (see PR description / commit for the trace). Where current behavior
// is dubious, the test PINS it (with a comment explaining the concern) so
// any future change to that behavior is a deliberate, visible diff — not a
// silent drift. A couple are true regression tests: the underlying bug was
// just fixed, so those assert the new CORRECT behavior instead.
// ═══════════════════════════════════════════════
const {
  calcTotals, calcSOStatus, poCommitted, emP, npP, twaP,
  createInvoice, buildQBSalesOrder,
  checkInventoryConflicts, itemEditReconciles, calcQualifyingSpend,
  calcPromoItemSell,
} = require('../businessLogic');

const makeSOItem = (overrides = {}) => ({
  sku: 'ADI-T1000', name: 'Adidas Tee', color: 'Black',
  nsa_cost: 12, unit_sell: 25,
  sizes: { S: 5, M: 10, L: 8, XL: 3 },
  decorations: [], pick_lines: [], po_lines: [],
  ...overrides,
});

const makeSO = (overrides = {}) => ({
  id: 'SO-9001', customer_id: 'c1',
  items: [makeSOItem()], art_files: [], jobs: [], deco_pos: [],
  ...overrides,
});

// ─────────────────────────────────────────────
// 1. Negative sizes: calcTotals vs calcSOStatus diverge
// ─────────────────────────────────────────────
describe('Gap 1: negative size quantities diverge between calcTotals and calcSOStatus', () => {
  test('calcTotals treats a negative size as a real (credit) quantity — rev/cost/grand go negative', () => {
    const so = makeSO({ items: [makeSOItem({ sizes: { S: -5 }, unit_sell: 25, nsa_cost: 12 })] });
    const totals = calcTotals(so, {});
    // PINNED: -5 * 25 = -125 revenue, -5 * 12 = -60 cost. calcTotals sums raw
    // safeNum(size) with no positivity guard, so a negative line acts as a
    // credit against the order's totals.
    expect(totals.rev).toBe(-125);
    expect(totals.cost).toBe(-60);
    expect(totals.grand).toBe(-125);
  });

  test('calcSOStatus ignores the same negative size entirely (filters v > 0) — order reads as need_order', () => {
    const so = makeSO({ items: [makeSOItem({ sizes: { S: -5 } })] });
    // PINNED DIVERGENCE: calcSOStatus filters entries to `safeNum(v) > 0`, so a
    // negative-size line contributes NOTHING to totalSz — the order looks like
    // it has zero units ordered (need_order), even though calcTotals just
    // billed it as -$125 of revenue above. Same order, two functions,
    // contradictory reads of the same negative line. Left unchanged because
    // negative sizes are meant to be used as credit lines that shouldn't
    // affect fulfillment status — but this test exists so nobody "fixes" one
    // side without noticing the other silently disagrees.
    expect(calcSOStatus(so)).toBe('need_order');
  });
});

// ─────────────────────────────────────────────
// 2. poCommitted: cancelled > ordered goes negative
// ─────────────────────────────────────────────
describe('Gap 2: poCommitted goes negative when cancelled exceeds ordered', () => {
  test('cancelled > ordered on a PO line returns a negative committed quantity', () => {
    const poLines = [{ S: 5, cancelled: { S: 10 } }];
    // PINNED: poCommitted does `ordered - cancelled` with no floor at 0. A data
    // entry mistake (cancelling more than was ever ordered) silently produces
    // a negative "committed" number, which callers summing this into coverage
    // math would need to handle carefully.
    expect(poCommitted(poLines, 'S')).toBe(-5);
  });
});

// ─────────────────────────────────────────────
// 3. emP / npP: negative inputs land in the smallest bracket
// ─────────────────────────────────────────────
describe('Gap 3: emP/npP silently bracket negative inputs into the lowest tier', () => {
  test('emP(-100, 6) prices as if stitch count and qty were the smallest legit values', () => {
    // PINNED: EM.sb.findIndex(b => st <= b) matches the FIRST bracket boundary
    // a value is <=, so a negative stitch count (-100) matches bracket 0 the
    // same as a real low stitch count would. No lower bound is enforced.
    expect(emP(-100, 6)).toBe(8);
  });

  test('npP(-5) prices as the smallest quantity bracket', () => {
    // PINNED: same pattern — NP.bk.findIndex(b => q <= b) matches bracket 0 for
    // any q <= 10, including negative quantities.
    expect(npP(-5)).toBe(7);
  });
});

// ─────────────────────────────────────────────
// 4. twaP: out-of-range index silently falls back to TWA[0]
// ─────────────────────────────────────────────
describe('Gap 4: twaP falls back to TWA[0] for an out-of-range index', () => {
  test('twaP(999) returns the Left Chest 1 Color price instead of erroring', () => {
    // PINNED: `TWA[idx || 0] || TWA[0]` — an out-of-range idx makes TWA[idx]
    // undefined, and the `|| TWA[0]` fallback silently substitutes the FIRST
    // menu price rather than surfacing the bad index. A garbled/legacy
    // dtf_size value therefore prices as "Left Chest 1 Color" ($12) with no
    // error.
    expect(twaP(999)).toBe(12);
  });
});

// ─────────────────────────────────────────────
// 5. NaN propagation asymmetry: item line vs decoration line
// ─────────────────────────────────────────────
describe('Gap 5: NaN unit_sell propagates unguarded on item lines, but dP guards decoration overrides', () => {
  test('buildQBSalesOrder: a NaN unit_sell item line NaNs its own rate/amount and the doc total', () => {
    const so = makeSO({
      created_at: '2026-01-01', memo: 'm',
      items: [makeSOItem({ unit_sell: NaN, sizes: { S: 5 }, decorations: [] })],
    });
    const qb = buildQBSalesOrder(so, { name: 'Cust' }, { income_account: 'Sales' });
    // PINNED: buildQBSalesOrder reads `rate: it.unit_sell` RAW (no safeNum), so
    // a NaN unit_sell produces a NaN rate/amount on that line, and the total
    // (lines.reduce) is NaN for the whole document.
    expect(Number.isNaN(qb.lines[0].rate)).toBe(true);
    expect(Number.isNaN(qb.lines[0].amount)).toBe(true);
    expect(Number.isNaN(qb.total)).toBe(true);
  });

  test('by contrast, dP guards a non-finite decoration sell_override so the deco line stays finite (not suppressed, not NaN)', () => {
    // dP() explicitly checks `!Number.isFinite(Number(d.sell_override))` and
    // nulls the override before pricing — this is the SAME guard covered by
    // gap 10 below. The upshot is an asymmetry: nothing in buildQBSalesOrder
    // protects the raw item unit_sell the way dP protects decoration
    // sell_override — one path can NaN the whole document total, the other
    // cannot NaN via this route.
    const so = makeSO({
      created_at: '2026-01-01', memo: 'm',
      items: [makeSOItem({ unit_sell: 25, sizes: { S: 5 }, decorations: [{ kind: 'twill', dtf_size: 0, sell_override: NaN }] })],
    });
    const qb = buildQBSalesOrder(so, { name: 'Cust' }, { income_account: 'Sales' });
    const decoLine = qb.lines.find(l => l.desc.startsWith('Decoration'));
    expect(decoLine).toBeDefined();
    expect(decoLine.rate).toBe(12); // TWA[0].sell — computed price used, override discarded
    expect(Number.isFinite(qb.total)).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 6. createInvoice: duplicate / out-of-range invSelItems indexes
// ─────────────────────────────────────────────
describe('Gap 6: createInvoice trusts invSelItems indexes without deduping or bounds-checking', () => {
  test('a duplicate index [0, 0] double-bills that line', () => {
    const so = makeSO({ items: [makeSOItem({ sizes: { S: 2 }, unit_sell: 10, nsa_cost: 5, decorations: [] })] });
    const single = createInvoice(so, [0], {}, {});
    const dup = createInvoice(so, [0, 0], {}, {});
    // PINNED / MUST-PREVENT-IN-UI: createInvoice does not dedupe invSelItems,
    // so passing the same index twice bills the line twice. There is no
    // guard here — the UI selecting invoice line items MUST prevent
    // duplicate selection, because this function will not catch it.
    expect(single.total).toBe(20);
    expect(dup.total).toBe(40);
    expect(dup.lineItems).toHaveLength(2);
  });

  test('an out-of-range index is skipped silently rather than erroring', () => {
    const so = makeSO({ items: [makeSOItem({ sizes: { S: 2 }, unit_sell: 10, nsa_cost: 5, decorations: [] })] });
    const result = createInvoice(so, [5], {}, {});
    // PINNED: items[5] is undefined; both the selTotals reduce (`if (!it)
    // return acc`) and the lineItems map (`if (!it) return null`, filtered by
    // Boolean) silently drop it. No error, no line, $0 total.
    expect(result.total).toBe(0);
    expect(result.lineItems).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// 7. checkInventoryConflicts: negative newInv flags pending picks
// ─────────────────────────────────────────────
describe('Gap 7: checkInventoryConflicts flags pending picks against a negative newInv value', () => {
  test('a negative available quantity is treated as a real shortfall', () => {
    const currentSO = { id: 'SO-1' };
    const otherSO = { id: 'SO-2', items: [
      { sku: 'X', product_id: 'p1', pick_lines: [{ status: 'pending', S: 3, pick_id: 'IF1' }] },
    ] };
    // PINNED: checkInventoryConflicts does `qty > (newInv[sz] || 0)` with no
    // guard on newInv being negative — a negative inventory value (e.g. from
    // an over-committed adjustment) just makes every pending pick look like a
    // conflict, same as it would if inventory were 0.
    const warnings = checkInventoryConflicts(currentSO, { sku: 'X', product_id: 'p1' }, { S: -5 }, [currentSO, otherSO]);
    expect(warnings).toEqual([{ so: 'SO-2', pick: 'IF1', sizes: ['S: needs 3, only -5'] }]);
  });
});

// ─────────────────────────────────────────────
// 8. itemEditReconciles: null element in an otherwise-valid array
// ─────────────────────────────────────────────
describe('Gap 8: itemEditReconciles tolerates a null element in the client items array', () => {
  test('a null entry does not crash and does not block a correct reconciliation', () => {
    // keyOf(null) resolves to '' (falsy), which toMs() skips outright — so a
    // stray null in the array (e.g. a sparse-array hole from a client-side
    // splice bug) neither crashes nor corrupts the multiset match against the
    // real DB rows.
    expect(() => itemEditReconciles([{ sku: 'A' }, null, { sku: 'B' }], [{ sku: 'A' }, { sku: 'B' }])).not.toThrow();
    expect(itemEditReconciles([{ sku: 'A' }, null, { sku: 'B' }], [{ sku: 'A' }, { sku: 'B' }])).toBe(true);
  });
});

// ─────────────────────────────────────────────
// 9. calcQualifyingSpend: float-prone margin at the >= threshold boundary
// ─────────────────────────────────────────────
describe('Gap 9: calcQualifyingSpend margin boundary is float-precision sensitive', () => {
  test('a 0.1/0.08 sell/cost pair that "should" be exactly the 20% threshold misses it due to float rounding', () => {
    const so = { items: [{ sku: 'A', sizes: { S: 10 }, unit_sell: 0.1, nsa_cost: 0.08, decorations: [] }] };
    // Naive division (0.1-0.08)/0.1 === 0.20000000000000004 (>= 0.2, would
    // qualify). But calcQualifyingSpend computes rev/cost via qty * unit_sell
    // / qty * nsa_cost first (10*0.1=1, 10*0.08=0.8), and (1-0.8)/1 evaluates
    // to 0.19999999999999996 in IEEE754 — just UNDER the 0.2 threshold. PINNED:
    // this line does NOT qualify (total stays 0), which is deterministic
    // given these exact inputs but is a float-rounding artifact, not an
    // intentional business rule about this specific price point.
    expect(calcQualifyingSpend(so, 0.2)).toBe(0);
  });

  test('a margin that lands exactly on a clean float value at the threshold does qualify', () => {
    const so = { items: [{ sku: 'A', sizes: { S: 1 }, unit_sell: 100, nsa_cost: 80, decorations: [] }] };
    // (100-80)/100 = 0.2 exactly in floating point — the >= comparison
    // includes the boundary when it lands on a clean value, contrasting with
    // the float-rounding miss above.
    expect(calcQualifyingSpend(so, 0.2)).toBe(100);
  });
});

// ─────────────────────────────────────────────
// 10. REGRESSION: sell_override sanitization + calcPromoItemSell negative cost guard
// ─────────────────────────────────────────────
describe('Gap 10 (regression — assert the fixed behavior): non-numeric sell_override no longer NaNs totals', () => {
  test('calcTotals: a decoration sell_override of "abc" is discarded — computed twill price applies, totals stay finite', () => {
    const so = makeSO({ items: [makeSOItem({ sizes: { S: 5 }, unit_sell: 20, nsa_cost: 10, decorations: [{ kind: 'twill', dtf_size: 0, sell_override: 'abc' }] })] });
    const totals = calcTotals(so, {});
    // Fixed behavior: dP() nulls out a non-finite sell_override before
    // pricing, so 'abc' is ignored and the computed TWA[0] price (sell 12,
    // cost 6) applies instead of propagating NaN through rev/cost/grand.
    expect(Number.isFinite(totals.rev)).toBe(true);
    expect(Number.isFinite(totals.grand)).toBe(true);
    expect(totals.rev).toBe(160); // 5*20 item + 5*12 deco
    expect(totals.cost).toBe(80); // 5*10 item + 5*6 deco
  });

  test('calcTotals: a numeric-STRING sell_override ("12.5") still coerces and applies (not treated as invalid)', () => {
    const so = makeSO({ items: [makeSOItem({ sizes: { S: 5 }, unit_sell: 20, nsa_cost: 10, decorations: [{ kind: 'twill', dtf_size: 0, sell_override: '12.5' }] })] });
    const totals = calcTotals(so, {});
    // Number('12.5') is finite, so the guard leaves it alone and it prices at
    // 12.5 per unit instead of falling back to the computed TWA price.
    expect(totals.rev).toBe(162.5); // 5*20 item + 5*12.5 deco
  });

  test('calcPromoItemSell: a negative nsa_cost now returns 0 instead of a negative sell price', () => {
    expect(calcPromoItemSell({ nsa_cost: -10 })).toBe(0);
  });

  test('calcPromoItemSell: a positive nsa_cost still doubles as before, and retail_price still wins when present', () => {
    expect(calcPromoItemSell({ nsa_cost: 10 })).toBe(20);
    expect(calcPromoItemSell({ nsa_cost: 10, retail_price: 99 })).toBe(99);
  });
});
