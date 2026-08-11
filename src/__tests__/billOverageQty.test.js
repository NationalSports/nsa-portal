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
