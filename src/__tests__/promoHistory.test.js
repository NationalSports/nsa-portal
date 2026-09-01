import { mergePromoHistoryInvoices, promoHalfWindows, summarizePaidPromoHistoryLines, withEarnedPromoAllocation } from '../lib/promoHistory';

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

  test('raises the current allocation from prior-half paid history for a directly opened order', () => {
    const parent = {
      id: 'PARENT',
      promo_programs: [{ id: 'PROGRAM', type: 'percent_of_spend', spend_percentage: 0.1, is_active: true }],
      promo_periods: [{ id: 'H2', customer_id: 'PARENT', period_start: '2026-07-01', period_end: '2026-12-31', allocated: 227.83, used: 196.75 }],
    };
    const histInvs = [{ customer_id: 'BASEBALL', date: '2026-02-01', status: 'paid', subtotal: 55103.62, invoice_type: 'invoice' }];
    const result = withEarnedPromoAllocation({
      customer: parent,
      allCustomers: [parent, { id: 'BASEBALL', parent_id: 'PARENT' }],
      sos: [], invs: [], histInvs,
      now: new Date('2026-09-01T12:00:00Z'),
    });
    expect(promoHalfWindows(new Date('2026-09-01T12:00:00Z')).previous).toEqual({ start: '2026-01-01', end: '2026-06-30' });
    expect(result.promo_periods[0]).toMatchObject({ allocated: 5510.35, used: 196.75 });
  });
});
