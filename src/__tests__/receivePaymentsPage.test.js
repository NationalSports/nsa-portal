import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// In-memory stand-in for the few supabase mockCalls the page makes.
const mockDb = { payment_receipts: [], invoice_payments: [], customer_invoices: [] };
const mockCalls = [];
function mockQuery(table) {
  const st = { filters: [], op: 'select', payload: null, single: false };
  const run = () => {
    const rows = mockDb[table];
    const match = r => st.filters.every(([c, v]) => String(r[c]) === String(v));
    if (st.op === 'insert') { rows.push({ created_at: new Date().toISOString(), ...st.payload }); mockCalls.push([table, 'insert', st.payload]); return { data: st.single ? rows[rows.length - 1] : [rows[rows.length - 1]], error: null }; }
    if (st.op === 'update') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, st.payload)); mockCalls.push([table, 'update', st.payload, st.filters]); return { data: st.single ? hit[0] || null : hit, error: null }; }
    if (st.op === 'delete') { mockDb[table] = rows.filter(r => !match(r)); mockCalls.push([table, 'delete', st.filters]); return { data: null, error: null }; }
    const hit = rows.filter(match);
    return { data: st.single ? hit[0] || null : hit, error: null };
  };
  const b = {
    select() { return b; }, order() { return b; }, limit() { return b; },
    insert(p) { st.op = 'insert'; st.payload = p; return b; },
    update(p) { st.op = 'update'; st.payload = p; return b; },
    delete() { st.op = 'delete'; return b; },
    eq(c, v) { st.filters.push([c, v]); return b; },
    single() { st.single = true; return b; },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}
jest.mock('../lib/supabase', () => ({ supabase: { from: t => mockQuery(t) } }));

// eslint-disable-next-line import/first
import ReceivePaymentsPage from '../ReceivePaymentsPage';
// eslint-disable-next-line import/first
import { AppDataProvider } from '../AppContext';

const PAY_METHODS = [{ id: 'check', label: 'Check', icon: '' }, { id: 'ach', label: 'ACH/Wire', icon: '' }, { id: 'cc', label: 'Credit Card (+2.9%)', icon: '' }];
const cust = [{ id: 'C1', name: 'Alpha Athletics', alpha_tag: 'ALPHA' }];

let latest = {};
function Harness({ invs0, hist0, nf }) {
  const [invs, setInvs] = useState(invs0);
  const [histInvs, setHistInvs] = useState(hist0);
  latest = { invs, histInvs };
  return <AppDataProvider value={{ cust, invs, setInvs, histInvs, setHistInvs, nf, cu: { id: 'A', name: 'Andrea' }, PAY_METHODS, setPg: jest.fn(), setViewInvoice: jest.fn() }}>
    <ReceivePaymentsPage />
  </AppDataProvider>;
}

beforeEach(() => { mockDb.payment_receipts = []; mockDb.invoice_payments = []; mockDb.customer_invoices = []; mockCalls.length = 0; });

test('one check split across portal + NetSuite invoices, extra stays unapplied', async () => {
  const invs0 = [
    { id: 'INV-1', customer_id: 'C1', date: '02/01/2026', total: 1000, paid: 0, status: 'open', payments: [] },
    { id: 'INV-2', customer_id: 'C1', date: '03/01/2026', total: 500, paid: 0, status: 'open', payments: [] },
  ];
  const hist0 = [{ id: 'INV60331', customer_id: 'C1', date: '01/01/2026', total: 300, open_balance: 300, status: 'open', _hist: true, netsuite_internal_id: 'ns1' }];
  mockDb.customer_invoices = [{ netsuite_internal_id: 'ns1', open_balance: 300, status: 'open' }];
  const nf = jest.fn();
  render(<Harness invs0={invs0} hist0={hist0} nf={nf} />);

  await waitFor(() => expect(screen.getByText('💰 Receive a Payment').disabled).toBe(false));
  fireEvent.click(screen.getByText('💰 Receive a Payment'));
  fireEvent.change(screen.getByPlaceholderText(/customer name/), { target: { value: 'alpha' } });
  fireEvent.click(screen.getByText('Alpha Athletics'));
  fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '2000' } });
  fireEvent.change(screen.getByPlaceholderText('4471'), { target: { value: '4471' } });
  expect(screen.getByText(/\$200\.00 will stay on Alpha Athletics/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByText(/Save payment/)); });

  // The check itself.
  expect(mockDb.payment_receipts).toHaveLength(1);
  const r = mockDb.payment_receipts[0];
  expect(r).toMatchObject({ customer_id: 'C1', amount: 2000, method: 'check', ref: '4471' });
  expect(r.ns_applications).toEqual([expect.objectContaining({ invoice_id: 'INV60331', amount: 300 })]);
  // NetSuite invoice balance lowered.
  expect(mockDb.customer_invoices[0]).toMatchObject({ open_balance: 0, status: 'paid' });
  // Portal invoices: ordinary payments tagged with the receipt, invoices settled.
  const i1 = latest.invs.find(i => i.id === 'INV-1'), i2 = latest.invs.find(i => i.id === 'INV-2');
  expect(i1).toMatchObject({ paid: 1000, status: 'paid' });
  expect(i2).toMatchObject({ paid: 500, status: 'paid' });
  expect(i1.payments[0]).toMatchObject({ amount: 1000, method: 'check', receipt_id: r.id, cc_fee: 0, ref: 'Check #4471 · ' + r.id });
  // History row shows the $200 left over.
  await waitFor(() => expect(screen.getByText('Apply $200.00')).toBeTruthy());
  expect(nf).toHaveBeenCalledWith(expect.stringMatching(/\$200\.00 left on the account/));
});

test('applying leftover re-checks the database and refuses money already used elsewhere', async () => {
  // Receipt for $500; the database already has it fully applied, but this screen's invoices don't show it.
  mockDb.payment_receipts = [{ id: 'RCPT-X', customer_id: 'C1', amount: 500, method: 'check', ref: '9', received_date: '09/01/2026', ns_applications: [], created_at: '2026-09-01T00:00:00Z' }];
  mockDb.invoice_payments = [{ invoice_id: 'INV-OTHER', amount: 500, receipt_id: 'RCPT-X' }];
  const invs0 = [{ id: 'INV-5', customer_id: 'C1', date: '04/01/2026', total: 400, paid: 0, status: 'open', payments: [] }];
  const nf = jest.fn();
  render(<Harness invs0={invs0} hist0={[]} nf={nf} />);
  await waitFor(() => expect(screen.getByText('Apply $500.00')).toBeTruthy());
  fireEvent.click(screen.getByText('Apply $500.00'));
  await act(async () => { fireEvent.click(screen.getByText('Apply $400.00')); });
  expect(nf).toHaveBeenCalledWith(expect.stringMatching(/Only \$0\.00 is left/), 'error');
  expect(latest.invs[0]).toMatchObject({ paid: 0, payments: [] });
});

test('a payment that was applied cannot be deleted even if this screen thinks it was not', async () => {
  mockDb.payment_receipts = [{ id: 'RCPT-Y', customer_id: 'C1', amount: 100, method: 'check', ref: '1', received_date: '09/01/2026', ns_applications: [], created_at: '2026-09-01T00:00:00Z' }];
  mockDb.invoice_payments = [{ invoice_id: 'INV-OTHER', amount: 100, receipt_id: 'RCPT-Y' }];
  const nf = jest.fn();
  window.confirm = jest.fn(() => true);
  render(<Harness invs0={[]} hist0={[]} nf={nf} />);
  await waitFor(() => expect(screen.getByText('Delete')).toBeTruthy());
  await act(async () => { fireEvent.click(screen.getByText('Delete')); });
  expect(mockDb.payment_receipts).toHaveLength(1);
  expect(nf).toHaveBeenCalledWith(expect.stringMatching(/already been applied/), 'error');
});

test('a payment already posted to QuickBooks cannot be deleted', async () => {
  mockDb.payment_receipts = [{ id: 'RCPT-Q', customer_id: 'C1', amount: 100, method: 'check', ref: '2', received_date: '09/01/2026', ns_applications: [], qb_payment_id: '812', created_at: '2026-09-01T00:00:00Z' }];
  render(<Harness invs0={[]} hist0={[]} nf={jest.fn()} />);
  await waitFor(() => expect(screen.getByText('Apply $100.00')).toBeTruthy());
  expect(screen.queryByText('Delete')).toBeNull();
});
