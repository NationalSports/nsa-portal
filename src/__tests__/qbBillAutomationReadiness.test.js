import {
  applyQboBillLiveReadiness,
  buildQboBillReadinessRows,
  isPendingQboBillLedgerRow,
  qboBillReadinessFingerprint,
  summarizeQboBillReadiness,
} from '../qbBillAutomationReadiness';

const accounts = {
  purchases_account: { value: '513', name: 'Purchases' },
  freight_account: { value: '510', name: 'Freight In' },
  sports_inc_fee_account: { value: '580', name: 'Sports Inc Fee' },
  deco_account: { value: '520', name: 'Outside Decoration' },
};
const ledger = overrides => ({
  id: 'ledger-1', status: 'pushed', portal_status: 'success', is_credit: false,
  qb_status: null, qb_bill_id: null, doc_number: 'A-100', vendor: 'SanMar', doc_total: '105.25',
  raw_meta: { doc_number: 'A-100', vendor: 'SanMar', supplier: 'SanMar', doc_total: 105.25, doc_date: '09/10/2026', freight: 5.25, items: [] },
  ...overrides,
});

test('portal-complete unsynced bills and credits enter readiness', () => {
  expect(isPendingQboBillLedgerRow(ledger())).toBe(true);
  expect(isPendingQboBillLedgerRow(ledger({ is_credit: true }))).toBe(true);
  expect(isPendingQboBillLedgerRow(ledger({ qb_status: 'success', qb_bill_id: '42' }))).toBe(false);
  expect(isPendingQboBillLedgerRow(ledger({ portal_status: 'error' }))).toBe(false);
});

test('ledger rows are normalized without mutating accounting amounts', () => {
  const [row] = buildQboBillReadinessRows([ledger()]);
  expect(row).toMatchObject({ ledgerId: 'ledger-1', documentNumber: 'A-100', vendor: 'SanMar', date: '2026-09-10', total: 105.25 });
  expect(qboBillReadinessFingerprint(row)).toEqual({ ledgerId: 'ledger-1', documentNumber: 'A-100', vendor: 'SanMar', date: '2026-09-10', total: 105.25, transactionType: 'Bill' });
});

test('live readiness detects an exact existing QBO bill', () => {
  const rows = buildQboBillReadinessRows([ledger()]);
  const reviewed = applyQboBillLiveReadiness({
    rows, accountRefs: accounts,
    portalVendors: [{ id: 'v1', name: 'SanMar' }], vendorLinks: { v1: '9' },
    qboVendors: [{ Id: '9', DisplayName: 'SanMar', Active: true }],
    qboBills: [{ Id: '77', DocNumber: 'A-100', VendorRef: { value: '9' }, TotalAmt: 105.25, TxnDate: '2026-09-10' }],
  });
  expect(reviewed[0]).toMatchObject({ action: 'already_exists', qboBillId: '77', qboVendorId: '9' });
});

test('live readiness fails closed on same vendor and document with different total', () => {
  const rows = buildQboBillReadinessRows([ledger()]);
  const reviewed = applyQboBillLiveReadiness({
    rows, accountRefs: accounts,
    portalVendors: [{ id: 'v1', name: 'SanMar' }], vendorLinks: { v1: '9' },
    qboVendors: [{ Id: '9', DisplayName: 'SanMar', Active: true }],
    qboBills: [{ Id: '77', DocNumber: 'A-100', VendorRef: { value: '9' }, TotalAmt: 99, TxnDate: '2026-09-10' }],
  });
  expect(reviewed[0].action).toBe('conflict');
  expect(reviewed[0].qboCandidates).toEqual([{ id: '77', type: 'Bill', vendorId: '9', date: '2026-09-10', total: 99, balance: 0 }]);
  expect(reviewed[0].reason).toContain('QBO: Bill #77 vendor 9 2026-09-10 $99.00');
});

test('same document under another vendor is a manual-review conflict', () => {
  const rows = buildQboBillReadinessRows([ledger()]);
  const [reviewed] = applyQboBillLiveReadiness({
    rows, accountRefs: accounts,
    portalVendors: [{ id: 'v1', name: 'SanMar' }], vendorLinks: { v1: '9' },
    qboVendors: [{ Id: '9', DisplayName: 'SanMar', Active: true }],
    qboBills: [{ Id: '88', DocNumber: 'A-100', VendorRef: { value: 'other' }, TotalAmt: 105.25, TxnDate: '2026-09-10' }],
  });
  expect(reviewed.action).toBe('conflict');
  expect(reviewed.reason).toContain('vendor other');
});

test('bill credits are checked against both QBO bills and bill credits but remain write-locked', () => {
  const credit = ledger({ is_credit: true, doc_number: 'C-1', doc_total: -25, raw_meta: { doc_number: 'C-1', vendor: 'SanMar', doc_total: -25, doc_date: '09/10/2026' } });
  const rows = buildQboBillReadinessRows([credit]);
  const common = { rows, accountRefs: accounts, portalVendors: [{ id: 'v1', name: 'SanMar' }], vendorLinks: { v1: '9' }, qboVendors: [{ Id: '9', DisplayName: 'SanMar', Active: true }] };
  expect(applyQboBillLiveReadiness(common)[0]).toMatchObject({ action: 'blocked', transactionType: 'BillCredit' });
  expect(applyQboBillLiveReadiness({ ...common, qboBills: [{ Id: '90', DocNumber: 'C-1', VendorRef: { value: '9' }, TotalAmt: 25, TxnDate: '2026-09-10' }] })[0]).toMatchObject({ action: 'conflict', transactionType: 'BillCredit' });
  expect(applyQboBillLiveReadiness({ ...common, qboBillCredits: [{ Id: '91', DocNumber: 'C-1', VendorRef: { value: '9' }, TotalAmt: 25, TxnDate: '2026-09-10' }] })[0]).toMatchObject({ action: 'already_exists', qboBillId: '91', qboEntityType: 'BillCredit' });
});

test('live readiness blocks missing vendor links and summarizes actions', () => {
  const rows = buildQboBillReadinessRows([ledger()]);
  const reviewed = applyQboBillLiveReadiness({ rows, accountRefs: accounts, portalVendors: [], qboVendors: [], qboBills: [] });
  expect(reviewed[0].action).toBe('blocked');
  expect(summarizeQboBillReadiness(reviewed)).toEqual({ blocked: 1 });
});
