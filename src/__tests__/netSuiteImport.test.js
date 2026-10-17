import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NetSuiteCommissionImport, { mergeNetSuiteImport } from '../NetSuiteCommissionImport';

const invoice = { id: 'INV1', repName: 'Alex', month: '2026-09', invoiceDate: '2026-05-29', paidDate: '2026-09-04', daysToPay: 98, revenue: 3599.7, cost: 2679, gp: 920.7, marginPct: 25.577, rate: .15, commission: 138.11, items: [], customer: 'School', soNumber: 'SO1' };
const reps = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Sam' }];
const csv = 'Internal ID,SO #,Company Name,Invoice #,Invoice Status,Invoice Date,Date of Full Payment,Sales Rep,Item,Quantity,SO Amount,Invoice Amount,PO Amount\n1,SO1,School,INV1,Paid In Full,05/29/2026,09/04/2026,Alex,Jersey,30,3599.70,3599.70,2679';

test('re-import is idempotent and corrected rep/month moves the invoice without touching other data', () => {
  const current = { a: { draw: 50, paid: { '2026-09': { amount: 88.11 } }, nsComm: { '2026-09': 12 }, nsInvoices: { INV1: invoice, OTHER: { ...invoice, id: 'OTHER' } } } };
  const once = mergeNetSuiteImport(current, [invoice], { Alex: 'a' }, { at: 'fixed' });
  expect(mergeNetSuiteImport(once, [invoice], { Alex: 'a' }, { at: 'fixed' })).toEqual(once);
  const moved = mergeNetSuiteImport(once, [{ ...invoice, month: '2026-10' }], { Alex: 'b' });
  expect(moved.a.nsInvoices.INV1).toBeUndefined();
  expect(moved.a.nsInvoices.OTHER).toEqual({ ...invoice, id: 'OTHER' });
  expect(moved.a.draw).toBe(50);
  expect(moved.a.paid).toEqual(current.a.paid);
  expect(moved.b.nsInvoices.INV1.month).toBe('2026-10');
  expect(current.a.nsInvoices.INV1).toEqual(invoice);
});

test('manual replacement only clears affected rep/months', () => {
  const current = { a: { nsComm: { '2026-08': 90, '2026-09': 100 } }, b: { nsComm: { '2026-09': 200 } } };
  expect(mergeNetSuiteImport(current, [invoice], { Alex: 'a' }).a.nsComm['2026-09']).toBe(100);
  const next = mergeNetSuiteImport(current, [invoice], { Alex: 'a' }, { replaceManual: true });
  expect(next.a.nsComm).toEqual({ '2026-08': 90 });
  expect(next.b).toEqual(current.b);
});

test('CSV preview requires an explicit choice for existing manual commission before saving', async () => {
  const current = { a: { nsComm: { '2026-09': 138.11 } } };
  const onSave = jest.fn(async change => { const next = change(current);expect(next.a.nsComm).toEqual({});expect(next.a.nsInvoices.INV1.commission).toBe(138.11);return true; });
  const { container } = render(<NetSuiteCommissionImport reps={reps} repComp={current} onSave={onSave} currentUser={{ name: 'Admin' }} />);
  fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [{ name: 'report.csv', text: async () => csv }] } });
  await screen.findByRole('dialog');
  expect(screen.getByRole('button', { name: 'Import invoices' }).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Replace those manual amounts/));
  fireEvent.click(screen.getByRole('button', { name: 'Import invoices' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  await screen.findByText(/Imported 1 NetSuite invoices/);
});

test('unmatched rep must be mapped and save failure retains the preview for retry', async () => {
  const { container } = render(<NetSuiteCommissionImport reps={[reps[1]]} repComp={{}} onSave={async () => false} />);
  fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [{ name: 'report.csv', text: async () => csv }] } });
  await screen.findByRole('dialog');
  expect(screen.getByRole('button', { name: 'Import invoices' }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Portal rep for Alex'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import invoices' }));
  await screen.findByText(/The import was not saved/);
  expect(screen.getByRole('dialog')).toBeTruthy();
});
