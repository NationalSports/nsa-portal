import {
  allocationErrors, applicationRef, autoAllocate, customerFamilyIds, isoToPaymentDate, openInvoicesFor, receiptSummary,
} from '../lib/paymentReceipts';
import { canReceivePayments } from '../lib/receivePaymentsAccess';

const invs = [
  { id: 'INV-3', customer_id: 'c1', date: '03/01/2026', total: 500, paid: 0, status: 'open', payments: [] },
  { id: 'INV-1', customer_id: 'c1', date: '01/15/2026', total: 1000, paid: 400, status: 'partial', payments: [{ amount: 400, ref: 'Check #1 · RCPT-A', receipt_id: 'RCPT-A', date: '02/01/2026' }] },
  { id: 'INV-2', customer_id: 'c2', date: '02/01/2026', total: 300, paid: 300, status: 'paid', payments: [] },
  { id: 'INV-9', customer_id: 'c1', date: '01/01/2026', total: 200, paid: 0, status: 'void', payments: [] },
];
const hist = [
  { id: 'INV60331', customer_id: 'c1', date: '12/01/2025', total: 800, open_balance: 250, status: 'open', _hist: true, netsuite_internal_id: 'ns1' },
  { id: 'INV60000', customer_id: 'c1', date: '11/01/2025', total: 800, open_balance: null, status: 'open', _hist: true, netsuite_internal_id: 'ns2' },
];

describe('openInvoicesFor', () => {
  it('lists only collectible invoices for the customers, oldest first, NetSuite included', () => {
    const rows = openInvoicesFor(['c1'], invs, hist);
    expect(rows.map(r => r.id)).toEqual(['INV60331', 'INV-1', 'INV-3']);
    expect(rows.find(r => r.id === 'INV-1').balance).toBe(600);
    expect(rows.find(r => r.id === 'INV60331').balance).toBe(250);
  });
});

describe('autoAllocate', () => {
  it('fills oldest first and stops when the money runs out', () => {
    const rows = openInvoicesFor(['c1'], invs, hist);
    expect(autoAllocate(700, rows)).toEqual({ 'h:ns1': 250, 'p:INV-1': 450 });
  });
  it('leaves the excess unallocated (overpayment stays on account)', () => {
    const rows = openInvoicesFor(['c1'], invs, hist);
    const a = autoAllocate(2000, rows);
    expect(Object.values(a).reduce((x, y) => x + y, 0)).toBe(1350);
  });
});

describe('allocationErrors', () => {
  const rows = openInvoicesFor(['c1'], invs, hist);
  it('rejects more than an invoice balance', () => {
    expect(allocationErrors(5000, { 'p:INV-3': 600 }, rows)[0]).toMatch(/INV-3/);
  });
  it('rejects applying more than the payment', () => {
    expect(allocationErrors(100, { 'p:INV-3': 60, 'p:INV-1': 60 }, rows).join()).toMatch(/only \$100\.00/);
  });
  it('accepts a valid split with money left over', () => {
    expect(allocationErrors(1000, { 'p:INV-3': '500', 'h:ns1': 250 }, rows)).toEqual([]);
  });
});

describe('receiptSummary', () => {
  it('sums portal payments tagged with the receipt plus NetSuite applications', () => {
    const r = { id: 'RCPT-A', amount: 1000, ns_applications: [{ invoice_id: 'INV60331', amount: 250 }] };
    const s = receiptSummary(r, invs);
    expect(s.applied).toBe(650);
    expect(s.unapplied).toBe(350);
    expect(s.applications.map(a => a.invoice_id)).toEqual(['INV-1', 'INV60331']);
  });
});

describe('applicationRef', () => {
  it('never reuses a ref already on the invoice (unique on invoice_id + ref)', () => {
    expect(applicationRef('Check #1', 'RCPT-A', [])).toBe('Check #1 · RCPT-A');
    expect(applicationRef('Check #1', 'RCPT-A', ['Check #1 · RCPT-A'])).toBe('Check #1 · RCPT-A-2');
    expect(applicationRef('Check #1', 'RCPT-A', ['Check #1 · RCPT-A', 'Check #1 · RCPT-A-2'])).toBe('Check #1 · RCPT-A-3');
  });
});

describe('helpers', () => {
  it('formats dates like invoice payments', () => { expect(isoToPaymentDate('2026-09-30')).toBe('09/30/2026'); });
  it('includes sub-accounts in a customer family', () => {
    expect(customerFamilyIds({ id: 'p' }, [{ id: 'p' }, { id: 'k1', parent_id: 'p' }, { id: 'x', parent_id: 'q' }])).toEqual(['p', 'k1']);
  });
});

describe('canReceivePayments', () => {
  it('allows only the named people, not every admin', () => {
    expect(canReceivePayments({ id: '00000000-0000-0000-0000-000000000040', role: 'accounting' })).toBe(true);
    expect(canReceivePayments({ id: '00000000-0000-0000-0000-000000000010', role: 'admin' })).toBe(true);
    expect(canReceivePayments({ id: 'someone-else', role: 'admin' })).toBe(false);
    expect(canReceivePayments(null)).toBe(false);
  });
});
