import { isPrepaidStoreSO, shouldAutoCloseInvoicedSO } from './prepaidStoreFulfillment';

describe('prepaid webstore SO auto-close guard', () => {
  const readyAndFullyInvoiced = { status: 'ready_to_invoice', hasInvoices: true, hasRemainingQty: false };

  test.each([
    ['Club checkout', { id: 'SO-CLUB', webstore_id: 'club-1' }],
    ['All School checkout', { id: 'SO-SCHOOL', webstore_id: 'school-1' }],
  ])('%s stays open after billing until fulfillment closes it', (_label, so) => {
    expect(isPrepaidStoreSO(so)).toBe(true);
    // Even a fully covered invoice is not evidence of a shipped/delivered order.
    expect(shouldAutoCloseInvoicedSO(so, readyAndFullyInvoiced)).toBe(false);
  });

  test('does not classify an OMG SO as a native prepaid webstore checkout', () => {
    expect(isPrepaidStoreSO({ webstore_id: 'store-1', omg_store_id: 'omg-1' })).toBe(false);
  });

  test('preserves existing auto-close behavior for non-webstore SOs, with invoice gates', () => {
    const ordinarySO = { id: 'SO-ORDINARY' };
    expect(shouldAutoCloseInvoicedSO(ordinarySO, readyAndFullyInvoiced)).toBe(true);
    expect(shouldAutoCloseInvoicedSO(ordinarySO, { ...readyAndFullyInvoiced, status: 'in_production' })).toBe(false);
    expect(shouldAutoCloseInvoicedSO(ordinarySO, { ...readyAndFullyInvoiced, hasInvoices: false })).toBe(false);
    expect(shouldAutoCloseInvoicedSO(ordinarySO, { ...readyAndFullyInvoiced, hasRemainingQty: true })).toBe(false);
  });
});
