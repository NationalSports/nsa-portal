import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockRows = { invoice_pay_requests: [] };
const mockCalls = [];
jest.mock('../lib/dbEngine', () => {
  const q = table => {
    const st = { op: 'select', filters: [], payload: null };
    const run = () => {
      const rows = mockRows[table] || (mockRows[table] = []);
      if (st.op === 'insert') { mockCalls.push(['insert', table, st.payload]); rows.unshift({ status: 'open', created_at: new Date().toISOString(), ...st.payload }); return { data: null, error: null }; }
      if (st.op === 'update') { mockCalls.push(['update', table, st.payload, st.filters]); rows.filter(r => st.filters.every(([c, v]) => r[c] === v)).forEach(r => Object.assign(r, st.payload)); return { data: null, error: null }; }
      return { data: rows.filter(r => st.filters.every(([c, v]) => r[c] === v)), error: null };
    };
    const b = { select() { return b; }, order() { return b; }, eq(c, v) { st.filters.push([c, v]); return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; }, update(p) { st.op = 'update'; st.payload = p; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); } };
    return b;
  };
  return { ...jest.requireActual('../lib/dbEngine'), supabase: { from: t => q(t) } };
});
// eslint-disable-next-line import/first
import InvoicesPage from '../InvoicesPage';
// eslint-disable-next-line import/first
import { AppDataProvider } from '../AppContext';

const noop = () => {};
function renderInv(inv, custOverride) {
  const cust = [custOverride || { id: 'C1', name: 'Alpha Athletics', alpha_tag: 'ALPHA', contacts: [{ email: 'coach@alpha.test' }] }];
  const nf = jest.fn();
  const value = {
    CC_FEE_PCT: 0.029, PAY_METHODS: [{ id: 'check', label: 'Check', icon: '' }], REPS: [], canDelete: false, changeLog: [], companyInfo: { name: 'NSA' },
    createAndSettleOmgInvoice: noop, createAndSettleWebstoreInvoice: noop, cu: { id: 'A', role: 'accounting', name: 'Andrea' }, cust,
    deleteInvoice: noop, voidInvoice: noop, editingInvRep: null, histInvs: [], invBackPg: null, invEditModal: null,
    invF: { search: '', status: 'all', group: 'list', aging: 'all', rep: 'all' }, invSendModalDirect: null, invSort: { f: 'date', d: 'desc' },
    invs: [inv], nf, omgStores: [], payModal: null, pdBulkModal: null, portalSettings: {}, setCust: noop, setESO: noop, setESOC: noop,
    setEditingInvRep: noop, setHistInvs: noop, setInvBackPg: noop, setInvEditModal: noop, setInvF: noop, setInvSendModalDirect: noop,
    setInvSort: noop, setInvs: noop, setPayModal: noop, setPdBulkModal: noop, setPg: noop, setSplitModal: noop, setViewInvoice: noop,
    sos: [], splitInvoice: noop, splitModal: null, viewInvoice: inv, webstoreSettle: {},
  };
  render(<AppDataProvider value={value}><InvoicesPage /></AppDataProvider>);
  return nf;
}
const inv = { id: 'INV-5', customer_id: 'C1', date: '09/01/2026', total: 5000, paid: 0, status: 'open', payments: [] };
beforeAll(() => { if (!window.crypto) Object.defineProperty(window, 'crypto', { value: require('crypto').webcrypto }); });
beforeEach(() => { mockRows.invoice_pay_requests = []; mockCalls.length = 0; });

test('staff create a $2,000 link on a $5,000 invoice; the link carries an unguessable token', async () => {
  renderInv(inv);
  fireEvent.click(screen.getByText('Partial Pay Link'));
  fireEvent.change(screen.getByPlaceholderText('2000.00'), { target: { value: '2000' } });
  await act(async () => { fireEvent.click(screen.getByText('Create link')); });
  const ins = mockCalls.find(c => c[0] === 'insert');
  expect(ins[2]).toMatchObject({ invoice_id: 'INV-5', amount: 2000, created_by: 'Andrea' });
  expect(ins[2].id).toMatch(/^PR[0-9a-f]{36}$/);
  const link = screen.getByDisplayValue(/payreq=/).value;
  expect(link).toBe('https://nationalsportsapparel.com/coach?portal=ALPHA&inv=INV-5&payreq=' + ins[2].id);
  await waitFor(() => expect(screen.getByText('Waiting on customer')).toBeTruthy());
});

test('refuses more than the open balance and creates nothing', async () => {
  const nf = renderInv({ ...inv, paid: 4000, status: 'partial' });
  fireEvent.click(screen.getByText('Partial Pay Link'));
  fireEvent.change(screen.getByPlaceholderText('2000.00'), { target: { value: '1500' } });
  await act(async () => { fireEvent.click(screen.getByText('Create link')); });
  expect(nf).toHaveBeenCalledWith(expect.stringMatching(/more than the \$1000\.00 open balance/), 'error');
  expect(mockCalls.filter(c => c[0] === 'insert')).toHaveLength(0);
});

test('no portal tag → the button is disabled', () => {
  renderInv(inv, { id: 'C1', name: 'No Tag', contacts: [] });
  expect(screen.getByText('Partial Pay Link').disabled).toBe(true);
});

test('an open link can be cancelled, not deleted', async () => {
  mockRows.invoice_pay_requests = [{ id: 'PR' + 'a'.repeat(36), invoice_id: 'INV-5', amount: 2000, status: 'open', created_at: '2026-09-29T00:00:00Z' }];
  window.confirm = jest.fn(() => true);
  renderInv(inv);
  await waitFor(() => expect(screen.getByText('Waiting on customer')).toBeTruthy());
  await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
  expect(mockCalls.find(c => c[0] === 'update')[2]).toMatchObject({ status: 'cancelled' });
  await waitFor(() => expect(screen.getByText('Cancelled')).toBeTruthy());
});
