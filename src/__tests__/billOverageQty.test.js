/* billOverageQty — the ordered-qty ceiling on an accepted over-billing.
 *
 * Guards the residual risk NEA200_RECEIVED_MISMATCH_2026-07-29.md left open: the
 * accepted-overage path rewrote a po_line's ORDERED qty to whatever the bill claimed, with no
 * check that the extra units ever existed. A duplicate / mis-mapped vendor doc therefore minted
 * open units that can never be received, so PO check-in read partial forever while the job
 * board — which counts goods actually in hand — read fully received. Fixtures below are the real
 * SO-1348 rows that surfaced it.
 */
const { billOverageQty } = require('../businessLogic');

describe('billOverageQty — no raise when the bill is not over-claiming', () => {
  test('billed at or under ordered leaves ordered alone', () => {
    expect(billOverageQty(10, 10, 10, 10)).toBe(10);
    expect(billOverageQty(10, 4, 4, 10)).toBe(10);
  });
  test('zero/blank inputs coerce, never NaN or negative', () => {
    expect(billOverageQty(0, 0, 0, 0)).toBe(0);
    expect(billOverageQty(null, undefined, null, undefined)).toBe(0);
    expect(billOverageQty(10, NaN, undefined, undefined)).toBe(10);
  });
  // Repo-wide safeNum convention: a non-number is 0, numeric strings included. po_line size
  // values are real JSONB numbers, so this only ever fires on junk — and it fails CLOSED
  // (no raise), which is the safe direction for a quantity the goods may not justify.
  test('non-numeric input is treated as 0, so no raise happens', () => {
    expect(billOverageQty('10', '20', '10', '10')).toBe(0);
  });
});

describe('billOverageQty — caps a bill claiming units that never arrived (the SO-1348 bug)', () => {
  // po_line 161334, SO-1348 JX4452 Black/White. SO line needs L 10; PO ordered L 10; L 10
  // received. Two adidas docs (6165765243 + 6165765239) each billed L 10 onto this one line,
  // so billed hit 20 and ordered was rewritten 10 -> 20. Check-in then showed "10/20 Rcvd"
  // against a job board correctly reading 12/12 Items Received.
  test('JX4452: ordered stays 10, not 20', () => {
    expect(billOverageQty(10, 20, 10, 10)).toBe(10);
  });
  // po_line 161333, same PO, JX4482 White/Grey 2XL: need 7, ordered 7, received 7, billed 14.
  test('JX4482 2XL: ordered stays 7, not 14', () => {
    expect(billOverageQty(7, 14, 7, 7)).toBe(7);
  });
  // po_line 161339, IS1111 — the largest single inflation on the order (L 20 -> 37).
  test('IS1111 L: ordered stays 20, not 37', () => {
    expect(billOverageQty(20, 37, 20, 20)).toBe(20);
  });
  test('nothing received and nothing needed → ordered is untouched', () => {
    expect(billOverageQty(10, 50, 0, 0)).toBe(10);
  });
});

describe('billOverageQty — a genuine overage still lands', () => {
  test('goods checked in above ordered raise ordered to what arrived', () => {
    // Ordered 10, vendor shipped and warehouse checked in 12, bill says 12.
    expect(billOverageQty(10, 12, 12, 10)).toBe(12);
  });
  test('an SO line that legitimately grew lets the bill catch up', () => {
    // Order was bumped to 15 after the PO was cut; bill for 15 is real.
    expect(billOverageQty(10, 15, 0, 15)).toBe(15);
  });
  test('the raise never exceeds what the bill actually claims', () => {
    // Received 20 and need 20, but the bill only claims 12 — ordered goes to 12, not 20.
    expect(billOverageQty(10, 12, 20, 20)).toBe(12);
  });
  test('partial justification caps at the ceiling, not the claim', () => {
    // Bill claims 30; only 12 arrived and the line needs 10 → ordered lands on 12.
    expect(billOverageQty(10, 30, 12, 10)).toBe(12);
  });
});

describe('billOverageQty — never ratchets a line down', () => {
  test('ordered above both received and need is preserved', () => {
    expect(billOverageQty(20, 25, 5, 5)).toBe(20);
  });
});

// billLineNeed — the per-line `need` fed to billOverageQty. The item's full size qty was a
// shared ceiling: split an item across N po_lines and a duplicate bill could raise EACH line
// as far as the whole need. Need for one line = SO qty minus the other lines' commitment.
const { billLineNeed } = require('../businessLogic');

describe('billLineNeed — per-line share of the SO need', () => {
  const line = (sz, qty, extra) => ({ [sz]: qty, po_id: 'PO X', unit_cost: 5, ...extra });

  test('single line gets the full SO need (unchanged behavior)', () => {
    const a = line('L', 10);
    const it = { sizes: { L: 12 }, po_lines: [a] };
    expect(billLineNeed(it, a, 'L')).toBe(12);
  });

  test('two lines splitting an item: each ceiling is only the uncovered remainder', () => {
    // SO needs L 20; line A ordered 12, line B ordered 8. A duplicate bill on B must not be
    // able to raise B to 20 — B's need is 20 − 12 = 8.
    const a = line('L', 12), b = line('L', 8);
    const it = { sizes: { L: 20 }, po_lines: [a, b] };
    expect(billLineNeed(it, b, 'L')).toBe(8);
    expect(billLineNeed(it, a, 'L')).toBe(12);
  });

  test('other lines already over-cover the need → zero headroom', () => {
    const a = line('L', 25), b = line('L', 5);
    const it = { sizes: { L: 20 }, po_lines: [a, b] };
    expect(billLineNeed(it, b, 'L')).toBe(0);
  });

  test('cancelled units on the other line hand the need back', () => {
    const a = line('L', 12, { cancelled: { L: 12 } }), b = line('L', 8);
    const it = { sizes: { L: 20 }, po_lines: [a, b] };
    expect(billLineNeed(it, b, 'L')).toBe(20);
  });

  test('size absent from the SO item → zero need regardless of siblings', () => {
    const a = line('M', 6);
    const it = { sizes: { L: 10 }, po_lines: [a] };
    expect(billLineNeed(it, a, 'M')).toBe(0);
  });

  test('end-to-end with billOverageQty: duplicate bill on the split line stays capped', () => {
    // The SO-1348 shape, split in two: item needs L 10 across two 5-unit lines, both fully
    // received. A doc double-applied to line B claims 10. Old ceiling (full need 10) allowed
    // ordered 5 → 10; per-line need is 10 − 5 = 5, so ordered holds at 5.
    const a = { L: 5, received: { L: 5 } }, b = { L: 5, received: { L: 5 } };
    const it = { sizes: { L: 10 }, po_lines: [a, b] };
    expect(billOverageQty(5, 10, 5, billLineNeed(it, b, 'L'))).toBe(5);
  });
});
