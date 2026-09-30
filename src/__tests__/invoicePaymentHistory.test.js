import React from 'react';
import { render, screen } from '@testing-library/react';
import InvoicesPage from '../InvoicesPage';
import { AppDataProvider } from '../AppContext';

jest.mock('../lib/supabase', () => ({ supabase: null }));

const noop = () => {};
const cust = [{ id: 'C1', name: 'Alpha Athletics', contacts: [] }];
const PAY_METHODS = [{ id: 'check', label: 'Check', icon: '📝' }];

function renderDetail(viewInvoice, { invs = [], histInvs = [] } = {}) {
  const value = {
    CC_FEE_PCT: 0.029, PAY_METHODS, REPS: [], canDelete: false, changeLog: [], companyInfo: { name: 'NSA' },
    createAndSettleOmgInvoice: noop, createAndSettleWebstoreInvoice: noop, cu: { id: 'A', role: 'accounting', name: 'A' }, cust,
    deleteInvoice: noop, voidInvoice: noop, editingInvRep: null, histInvs, invBackPg: null, invEditModal: null,
    invF: { search: '', status: 'all', group: 'list', aging: 'all', rep: 'all' }, invSendModalDirect: null, invSort: { f: 'date', d: 'desc' },
    invs, nf: noop, omgStores: [], payModal: null, pdBulkModal: null, portalSettings: {}, setCust: noop, setESO: noop, setESOC: noop,
    setEditingInvRep: noop, setHistInvs: noop, setInvBackPg: noop, setInvEditModal: noop, setInvF: noop, setInvSendModalDirect: noop,
    setInvSort: noop, setInvs: noop, setPayModal: noop, setPdBulkModal: noop, setPg: noop, setSplitModal: noop, setViewInvoice: noop,
    sos: [], splitInvoice: noop, splitModal: null, viewInvoice, webstoreSettle: {},
  };
  return render(<AppDataProvider value={value}><InvoicesPage /></AppDataProvider>);
}

test('portal invoice with payments lists them with paid and balance totals', () => {
  const inv = { id: 'INV-1', customer_id: 'C1', date: '09/01/2026', total: 1000, paid: 400, status: 'partial', payments: [{ amount: 400, method: 'check', ref: 'Check #4471', date: '09/10/2026', cc_fee: 0 }] };
  renderDetail(inv, { invs: [inv] });
  expect(screen.getByText('Payment History')).toBeTruthy();
  expect(screen.getByText('Check #4471')).toBeTruthy();
  expect(screen.getAllByText('$600.00').length).toBeGreaterThan(0);
});

test('unpaid portal invoice still shows the section', () => {
  const inv = { id: 'INV-2', customer_id: 'C1', date: '09/01/2026', total: 500, paid: 0, status: 'open', payments: [] };
  renderDetail(inv, { invs: [inv] });
  expect(screen.getByText('Payment History')).toBeTruthy();
  expect(screen.getByText('No payments recorded yet.')).toBeTruthy();
});

test('NetSuite invoice explains where payments live; unknown balance is not shown as $0', () => {
  const ns = { id: 'INV60331', customer_id: 'C1', date: '01/01/2026', total: 800, open_balance: 250, status: 'open', _hist: true, netsuite_internal_id: 'ns1' };
  const { unmount } = renderDetail(ns, { histInvs: [ns] });
  expect(screen.getByText(/look up the invoice in NetSuite/i)).toBeTruthy();
  expect(screen.getAllByText('$550.00').length).toBeGreaterThan(0);
  unmount();
  const unknown = { ...ns, id: 'INV60332', open_balance: null, netsuite_internal_id: 'ns2' };
  renderDetail(unknown, { histInvs: [unknown] });
  expect(screen.getByText('unknown')).toBeTruthy();
});
