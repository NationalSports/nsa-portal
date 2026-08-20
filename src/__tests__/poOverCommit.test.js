/**
 * Regression: the same units must not quietly land on two POs.
 * SO-1295: JW6602 sold 14 (M2 L3 XL3 2XL3 3XL3); PO 3345 ordered all 14, then PO 3371
 * ordered 9 more of the same line a day later. Both were received and the 9 extras sat
 * on the SO as a cost write-off. poOverCommit is the submit-time check behind the
 * PO form's confirm: it flags any size where the new PO's qty exceeds the line's open
 * count (sizes − picked − already-committed) and names the POs holding the units.
 */
const { poOverCommit } = require('../businessLogic');

const jw6602 = {
  sku: 'JW6602',
  sizes: { M: 2, L: 3, XL: 3, '2XL': 3, '3XL': 3 },
  po_lines: [{ po_id: 'PO 3345 SERF', M: 2, L: 3, XL: 3, '2XL': 3, '3XL': 3, received: {} }],
};

describe('poOverCommit', () => {
  test('the SO-1295 double order is flagged on every size, naming the covering PO', () => {
    const over = poOverCommit(jw6602, { M: 2, L: 4, XL: 1, '2XL': 1, '3XL': 1 });
    expect(over.map(c => c.sz).sort()).toEqual(['2XL', '3XL', 'L', 'M', 'XL'].sort());
    const l = over.find(c => c.sz === 'L');
    expect(l).toMatchObject({ qty: 4, open: 0, committed: 3 });
    expect(l.pos).toEqual(['PO 3345 SERF']);
  });

  test('ordering exactly the open remainder is clean', () => {
    const item = { ...jw6602, po_lines: [{ po_id: 'PO 3345 SERF', M: 2, L: 1 }] };
    expect(poOverCommit(item, { L: 2, XL: 3, '2XL': 3, '3XL': 3 })).toEqual([]);
  });

  test('one unit beyond the open remainder is flagged', () => {
    const item = { ...jw6602, po_lines: [{ po_id: 'PO 3345 SERF', L: 1 }] };
    const over = poOverCommit(item, { L: 3 });
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ sz: 'L', qty: 3, open: 2, committed: 1 });
  });

  test('cancelled PO units free their size back up', () => {
    const item = { ...jw6602, po_lines: [{ po_id: 'PO 3345 SERF', L: 3, cancelled: { L: 3 } }] };
    expect(poOverCommit(item, { L: 3 })).toEqual([]);
  });

  test('pulled house stock counts against open', () => {
    const item = { ...jw6602, po_lines: [], pick_lines: [{ status: 'pulled', L: 3 }] };
    const over = poOverCommit(item, { L: 1 });
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ sz: 'L', qty: 1, open: 0, committed: 0, pos: [] });
  });

  test('a first PO within the line quantities is clean', () => {
    expect(poOverCommit({ ...jw6602, po_lines: [] }, { M: 2, L: 3, XL: 3, '2XL': 3, '3XL': 3 })).toEqual([]);
  });

  test('qty_only lines track under QTY against est_qty', () => {
    const item = { sku: 'DIG', sizes: {}, est_qty: 5, po_lines: [{ po_id: 'PO 1', QTY: 5 }] };
    const over = poOverCommit(item, { QTY: 2 });
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ sz: 'QTY', qty: 2, open: 0, committed: 5, pos: ['PO 1'] });
    expect(poOverCommit({ ...item, po_lines: [] }, { QTY: 5 })).toEqual([]);
  });

  test('tolerates a missing item and empty sizes', () => {
    expect(poOverCommit(null, { L: 1 })).toEqual([]);
    expect(poOverCommit(jw6602, {})).toEqual([]);
    expect(poOverCommit(jw6602, null)).toEqual([]);
  });
});
