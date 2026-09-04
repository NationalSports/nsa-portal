import { normalizeBillForReview } from '../qbBillReview';

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
});
