import { matchedBillPoNumber, normalizeBillForReview, prepareQboBackfillBill } from '../qbBillReview';

describe('QuickBooks bill review compatibility', () => {
  test('supplies empty arrays for older server-ledger rows', () => {
    expect(normalizeBillForReview({ doc_number: '202653' })).toEqual({
      doc_number: '202653',
      items: [],
      warnings: [],
    });
  });

  test('preserves valid parsed line items and warnings', () => {
    const items = [{ desc: 'Screen print', amount: 25 }];
    const warnings = ['Review PO'];
    expect(normalizeBillForReview({ items, warnings })).toMatchObject({ items, warnings });
  });

  test('replaces malformed arrays instead of crashing the review card', () => {
    expect(normalizeBillForReview({ items: {}, warnings: 'legacy' })).toMatchObject({
      items: [],
      warnings: [],
    });
  });

  test('reads the canonical PO from every matched bill wrapper', () => {
    expect(matchedBillPoNumber({
      matchedPOSource: 'so_deco_po', matchedPO: { po_id: 'DPO 58012 DOUP' },
    })).toBe('DPO 58012 DOUP');
    expect(matchedBillPoNumber({
      matchedPOSource: 'so_po', matchedPO: { po_id: 'PO 123' },
    })).toBe('PO 123');
    expect(matchedBillPoNumber({
      matchedPOSource: 'batch', matchedPO: { po_number: 'BATCH 5' },
    })).toBe('BATCH 5');
  });

  test('rematches a historical QBO backfill row whose PO target was never persisted', () => {
    const rematch = jest.fn((bill) => ({
      ...bill,
      matchedPOSource: 'so_deco_po',
      matchedPO: { so_id: 'SO-1462', po_id: 'DPO 8003 FPUS' },
    }));

    const bill = prepareQboBackfillBill({
      doc_number: '201342',
      po_number: 'DPO 8003 FPUS',
    }, rematch);

    expect(rematch).toHaveBeenCalledWith(expect.objectContaining({
      doc_number: '201342',
      po_number: 'DPO 8003 FPUS',
      items: [],
      warnings: [],
    }));
    expect(bill).toMatchObject({
      matchedPOSource: 'so_deco_po',
      matchedPO: { so_id: 'SO-1462', po_id: 'DPO 8003 FPUS' },
    });
  });

  test('keeps an already-matched row and does not run the matcher again', () => {
    const rematch = jest.fn();
    const matched = {
      doc_number: '201342',
      po_number: 'DPO 8003 FPUS',
      matchedPOSource: 'so_deco_po',
      matchedPO: { so_id: 'SO-1462' },
    };

    expect(prepareQboBackfillBill(matched, rematch)).toMatchObject(matched);
    expect(rematch).not.toHaveBeenCalled();
  });
});
