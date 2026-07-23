/* Unit tests for the webstore "money math" fixes (#6–#9).
 *
 * The club-fundraising proration (netFundraise) is the shared rule behind the payout
 * statement (src/Webstores.js AnalyticsTab), the store-close summary email
 * (netlify/functions/_webstoreClose.js), and the commission-cost carry (App.js). It is
 * exported from _webstoreClose so the exact formula is pinned here. The order-edit total
 * re-derivation (#6) is replicated as a spec so its intended numeric behavior is guarded. */
const { netFundraise } = require('../../netlify/functions/_webstoreClose');

describe('#9 netFundraise — club fundraising net of the coupon discount', () => {
  test('no discount → full fundraise owed', () => {
    expect(netFundraise({ subtotal: 50, fundraise_amt: 10, discount_amt: 0 })).toBe(10);
  });

  test('100%-off order → nothing collected into the pot, nothing owed', () => {
    // A $60 order (subtotal 50 + fundraise 10) fully comped: discount caps at 60.
    expect(netFundraise({ subtotal: 50, fundraise_amt: 10, discount_amt: 60 })).toBe(0);
  });

  test('partial discount reduces fundraise proportionally', () => {
    // 20% off $60 pot = $12 off; fundraise share = 12 * (10/60) = $2 → owed $8.
    expect(netFundraise({ subtotal: 50, fundraise_amt: 10, discount_amt: 12 })).toBe(8);
  });

  test('discount larger than the merch base is capped (never negative)', () => {
    // Coupon that also covered shipping: discount_amt can exceed subtotal+fundraise.
    expect(netFundraise({ subtotal: 50, fundraise_amt: 10, discount_amt: 999 })).toBe(0);
  });

  test('zero-fundraise order owes nothing', () => {
    expect(netFundraise({ subtotal: 40, fundraise_amt: 0, discount_amt: 5 })).toBe(0);
  });

  test('gross fundraise (old behavior) overpaid the club — regression guard', () => {
    // Before the fix the payout summed the gross fundraise_amt (10) regardless of the
    // discount; the club was owed only 8. This asserts we no longer pay the gross.
    const o = { subtotal: 50, fundraise_amt: 10, discount_amt: 12 };
    expect(netFundraise(o)).toBeLessThan(Number(o.fundraise_amt));
    expect(netFundraise(o)).toBe(8);
  });
});

describe('#6 order-edit total — re-derive processing + tax from the stored ratio', () => {
  // Mirrors saveOrderEdits in src/Webstores.js: processing and tax are levied on the
  // product subtotal, so they scale from the order's own stored (fee/subtotal, tax/subtotal)
  // ratios; total = max(0, subtotal + fundraise + shipping + processing − discount) + tax.
  const round2 = (n) => Math.round(n * 100) / 100;
  function recompute(order, newSubtotal, newFundraise) {
    const oldSub = Number(order.subtotal) || 0;
    const processing = round2(oldSub > 0 ? (Number(order.processing_fee) || 0) / oldSub * newSubtotal : (Number(order.processing_fee) || 0));
    const tax = round2(oldSub > 0 ? (Number(order.tax) || 0) / oldSub * newSubtotal : (Number(order.tax) || 0));
    // #2: the coupon discount scales with the merchandise pot (subtotal + fundraise) it was
    // a percentage of — same shape as saveOrderEdits, which also persists this scaled value.
    const oldPot = oldSub + (Number(order.fundraise_amt) || 0);
    const discount = round2(oldPot > 0 ? (Number(order.discount_amt) || 0) / oldPot * (newSubtotal + newFundraise) : (Number(order.discount_amt) || 0));
    const preTax = round2(Math.max(0, newSubtotal + newFundraise + (Number(order.shipping_fee) || 0) + processing - discount));
    return { processing, tax, discount, total: round2(preTax + tax) };
  }

  // A real order like the live test: $22 subtotal, $3 fundraise, $15 ship, 5% processing, CA tax.
  const order = { subtotal: 22, fundraise_amt: 3, shipping_fee: 15, processing_fee: 1.10, tax: 2.31, discount_amt: 0, total: 43.41 };

  test('a size-only edit (subtotal unchanged) preserves the charged total exactly', () => {
    const r = recompute(order, 22, 3);
    expect(r.processing).toBe(1.10);
    expect(r.tax).toBe(2.31);
    expect(r.total).toBe(43.41); // must NOT drop below what the card paid (the old bug)
  });

  test('removing half the merch scales processing + tax down proportionally', () => {
    // Subtotal halves to $11; processing 0.55, tax ~1.155→1.16, +$3 fundraise +$15 ship.
    const r = recompute(order, 11, 3);
    expect(r.processing).toBe(0.55);
    expect(r.tax).toBeCloseTo(1.16, 2);
    // preTax = 11 + 3 + 15 + 0.55 = 29.55 ; +tax
    expect(r.total).toBeCloseTo(30.71, 2);
  });

  test('old formula (dropping tax + processing) undercut the total — regression guard', () => {
    const oldTotal = round2(Math.max(0, 22 + 3 - 0) + 15); // = 40.00, the buggy value
    const fixed = recompute(order, 22, 3).total;           // = 43.41, what was charged
    expect(oldTotal).toBe(40);
    expect(fixed).toBeGreaterThan(oldTotal);
  });
});

describe('#2 order-edit coupon discount — scale with the merchandise pot, not the stale dollars', () => {
  const round2 = (n) => Math.round(n * 100) / 100;
  function recompute(order, newSubtotal, newFundraise) {
    const oldSub = Number(order.subtotal) || 0;
    const processing = round2(oldSub > 0 ? (Number(order.processing_fee) || 0) / oldSub * newSubtotal : (Number(order.processing_fee) || 0));
    const tax = round2(oldSub > 0 ? (Number(order.tax) || 0) / oldSub * newSubtotal : (Number(order.tax) || 0));
    const oldPot = oldSub + (Number(order.fundraise_amt) || 0);
    const discount = round2(oldPot > 0 ? (Number(order.discount_amt) || 0) / oldPot * (newSubtotal + newFundraise) : (Number(order.discount_amt) || 0));
    const preTax = round2(Math.max(0, newSubtotal + newFundraise + (Number(order.shipping_fee) || 0) + processing - discount));
    return { processing, tax, discount, total: round2(preTax + tax) };
  }

  // 2 jerseys @ $40 (subtotal 80), a 50%-off coupon → discount_amt 40, so the card
  // charged $40. Staff edit the order down to 1 jersey (subtotal 40).
  const order = { subtotal: 80, fundraise_amt: 0, shipping_fee: 0, processing_fee: 0, tax: 0, discount_amt: 40, total: 40 };

  test('halving the merch halves the coupon discount', () => {
    const r = recompute(order, 40, 0);
    expect(r.discount).toBe(20);  // 40 * (40 / 80)
    expect(r.total).toBe(20);     // 40 − 20
  });

  test('old formula (full stale discount) collapsed the goods total toward $0 — regression guard', () => {
    const buggy = round2(Math.max(0, 40 + 0 + 0 + 0 - 40)); // = 0, less than the ~$40 card charge
    const fixed = recompute(order, 40, 0).total;            // = 20
    expect(buggy).toBe(0);
    expect(fixed).toBeGreaterThan(buggy);
  });

  test('the scaled pot includes fundraising (discount base is subtotal + fundraise)', () => {
    // 20%-off a $60 pot (subtotal 50 + fundraise 10) → discount_amt 12. Remove half the
    // merch: subtotal 25 + fundraise 5 = pot 30. Scaled discount = 12 * (30/60) = 6.
    const o = { subtotal: 50, fundraise_amt: 10, shipping_fee: 0, processing_fee: 0, tax: 0, discount_amt: 12, total: 48 };
    const r = recompute(o, 25, 5);
    expect(r.discount).toBe(6);
    expect(r.total).toBe(24); // 25 + 5 − 6
  });

  test('a size-only edit (pot unchanged) leaves the discount exactly as charged', () => {
    const r = recompute(order, 80, 0);
    expect(r.discount).toBe(40);
    expect(r.total).toBe(40);
  });
});
