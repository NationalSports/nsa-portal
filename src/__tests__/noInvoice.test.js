import { closeCreatedInError, isCreatedInError, clearNoInvoice, noInvoiceLabel, NO_INVOICE_REASONS, CREATED_IN_ERROR_REASON } from '../lib/noInvoice';

test('created-in-error closes the order and stamps a no-invoice reason', () => {
  const so = closeCreatedInError({ id: 'SO-1', status: 'items_received' }, { note: 'duplicate of SO-2', by: 'u1', at: 't' });
  expect(so).toMatchObject({ status: 'complete', no_invoice_needed: true, no_invoice_reason: 'Created in error — duplicate of SO-2', no_invoice_by: 'u1', no_invoice_at: 't' });
  expect(isCreatedInError(so)).toBe(true);
  expect(noInvoiceLabel(so)).toBe('NO INVOICE · Created in error — duplicate of SO-2');
});

test('a blank note still records the reason', () => {
  expect(closeCreatedInError({ id: 'SO-1' }, { note: '  ' }).no_invoice_reason).toBe(CREATED_IN_ERROR_REASON);
});

test('other no-invoice reasons are not "created in error", and clearing drops the stamp', () => {
  expect(isCreatedInError({ no_invoice_needed: true, no_invoice_reason: 'Invoiced in NetSuite' })).toBe(false);
  expect(isCreatedInError(clearNoInvoice(closeCreatedInError({ id: 'SO-1' })))).toBe(false);
  expect(NO_INVOICE_REASONS).toContain(CREATED_IN_ERROR_REASON);
});
