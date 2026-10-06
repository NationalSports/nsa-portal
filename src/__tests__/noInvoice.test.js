import { closeCreatedInError, undoCreatedInError, isCreatedInError, clearNoInvoice, noInvoiceLabel, NO_INVOICE_REASONS, CREATED_IN_ERROR_REASON } from '../lib/noInvoice';

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

 test.each(['complete', 'items_received'])('undo restores billing eligibility with fulfillment status %s', status => {
  const closed = closeCreatedInError({ id: 'SO-1', jobs: [{ prod_status: 'shipped' }] }, { by: 'u1' });
  const reopened = undoCreatedInError(closed, status);
  expect(reopened).toMatchObject({ status, no_invoice_needed: false, no_invoice_reason: null, no_invoice_by: null, no_invoice_at: null, _status_reverted: true });
  expect(reopened.jobs).toEqual(closed.jobs);
 });

// Exercise the actual Reopen handler in each editor: the former early return for
// fulfilled orders ran before the no-invoice stamp could be cleared.
test.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s undoes created-in-error even when auto status is complete', filename => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const section = source.slice(source.indexOf("{isSO&&o.status==='complete'&&<button"));
  const marker = 'onClick={()=>{';
  const body = section.slice(section.indexOf(marker) + marker.length, section.indexOf('}} onMouseEnter'));
  const o = closeCreatedInError({ id: 'SO-1', jobs: [{ prod_status: 'shipped' }] });
  const onSave = jest.fn(), nf = jest.fn();
  const deps = { o, setShowActionsDD: jest.fn(), calcSOStatus: () => 'complete', SO_STATUS_LABELS: { complete: 'Complete' }, nf,
    window: { confirm: () => true }, isCreatedInError, undoCreatedInError, clearNoInvoice, setO: jest.fn(), onSave, onSOReopened: jest.fn() };
  new Function(...Object.keys(deps), body)(...Object.values(deps));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete', no_invoice_needed: false, no_invoice_reason: null }));
  expect(nf.mock.calls.some(args => args[1] === 'error')).toBe(false);
});
