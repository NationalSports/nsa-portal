/* eslint-disable */
// An invoice line's stored amount already carries its decorations (INV-64434: KD5420 stored
// as $37 = $30 polo + $7 embroidery). Documents printed "$37.00" with a "+$7.00/ea" note,
// which read as $37 AND $7. splitInvoiceLine hands back the garment-only remainder so the
// document prints $30 and $7 on separate rows that still add up to the invoice exactly.
const { splitInvoiceLine } = require('../safeHelpers');

test('KD5420 on INV-64434: $814 line splits into $30 x 22 garment + $154 embroidery', () => {
  expect(splitInvoiceLine(814, 22, [154])).toEqual({ garmentAmt: 660, garmentRate: 30 });
});

test('SO-1131 KV2196: two split prints (17 x $4.10 + 6 x $6.40) leave the $12 garment', () => {
  expect(splitInvoiceLine(372.1, 22, [69.7, 38.4])).toEqual({ garmentAmt: 264, garmentRate: 12 });
});

test('no decorations, no qty, or decorations worth more than the line → null (keep combined rate)', () => {
  expect(splitInvoiceLine(396, 6, [])).toBeNull();
  expect(splitInvoiceLine(100, 0, [10])).toBeNull();
  expect(splitInvoiceLine(0, 1, [7])).toBeNull();
});
