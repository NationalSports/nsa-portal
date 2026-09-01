import { mergePromoHistoryInvoices, summarizePaidPromoHistoryLines } from '../lib/promoHistory';

describe('NetSuite promo history fallback', () => {
  const customers = [{ id: 'BASEBALL', netsuite_internal_id: '1462' }];

  test('summarizes paid invoice lines into one promo invoice', () => {
    const invoices = summarizePaidPromoHistoryLines([
      { id: '1', netsuite_internal_id: '63102', document_number: 'INV63102', transaction_type: 'invoice', transaction_date: '2026-06-10', status: 'Paid In Full', raw_customer_nsid: '1462', amount: 300 },
      { id: '2', netsuite_internal_id: '63102', document_number: 'INV63102', transaction_type: 'invoice', transaction_date: '2026-06-10', status: 'Paid In Full', raw_customer_nsid: '1462', amount: 68.8 },
    ], customers);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ customer_id: 'BASEBALL', status: 'paid', subtotal: 368.8, total: 368.8 });
  });

  test('skips open transactions and customers outside the family', () => {
    expect(summarizePaidPromoHistoryLines([
      { id: '1', netsuite_internal_id: 'OPEN', transaction_type: 'invoice', transaction_date: '2026-06-10', status: 'Open', raw_customer_nsid: '1462', amount: 100 },
      { id: '2', netsuite_internal_id: 'OTHER', transaction_type: 'invoice', transaction_date: '2026-06-10', status: 'Paid In Full', raw_customer_nsid: '9999', amount: 100 },
    ], customers)).toEqual([]);
  });

  test('deduplicates a line fallback when the header exists and repairs a missing customer link', () => {
    const lineInvoice = { netsuite_internal_id: '63102', customer_id: 'BASEBALL', subtotal: 368.8, status: 'paid' };
    const header = { netsuite_internal_id: '63102', customer_id: null, subtotal: 350, status: 'paid', memo: 'header wins' };
    expect(mergePromoHistoryInvoices([header], [lineInvoice])).toEqual([
      expect.objectContaining({ customer_id: 'BASEBALL', subtotal: 350, memo: 'header wins' }),
    ]);
  });
});
