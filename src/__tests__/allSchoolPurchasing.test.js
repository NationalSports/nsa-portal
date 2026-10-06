const { DEFAULT_PURCHASING, purchasingSettings, latestWeeklyCutoff, purchaseDecision } = require('../../netlify/functions/_allSchoolPurchasing');
const { validateAllSchoolBatch } = require('../lib/allSchoolBatchGuard');
const { warehouseDestination, dispatchDedicated } = require('../../netlify/functions/all-school-purchasing');
const settings = overrides => ({ ...DEFAULT_PURCHASING, enabled: true, ...overrides });
const need = overrides => ({ id: 1, qty_needed: 20, unit_cost_cents: 1000, created_at: '2026-10-01T17:00:00Z', ...overrides });
const now = '2026-10-02T18:27:00Z';

test('disabled and manual stores never dispatch, even after maximum wait', () => {
  expect(purchasingSettings({}).enabled).toBe(false);
  expect(purchaseDecision({ pendingNeeds: [need({ created_at: '2026-01-01' })], settings: settings({ enabled: false }), now }).reason).toBe('disabled');
  expect(purchaseDecision({ pendingNeeds: [need({ created_at: '2026-01-01' })], settings: settings({ mode: 'manual' }), now }).reason).toBe('manual');
});
test('threshold uses remaining blank cost per vendor, after own-stock allocation', () => {
  expect(purchaseDecision({ pendingNeeds: [need()], settings: settings(), now })).toMatchObject({ due: true, reason: 'minimum', total_cents: 20000, combine_regular: false });
  expect(purchaseDecision({ pendingNeeds: [need({ qty_on_hand: 15 })], settings: settings(), now })).toMatchObject({ due: false, total_cents: 5000 });
  const store = { all_school_settings: { purchasing: { enabled: true, vendors: { SanMar: { minimum_cents: 30000 } } } } };
  expect(purchasingSettings(store, 'SanMar').minimum_cents).toBe(30000);
  expect(purchasingSettings(store, 'S&S Activewear').minimum_cents).toBe(20000);
});
test('weekly cutoff uses the store timezone and only orders that reached cutoff', () => {
  const cfg = settings({ mode: 'weekly' });
  expect(latestWeeklyCutoff('2026-10-07T15:59:00Z', cfg)).toBe('2026-09-30T16:00:00.000Z');
  expect(latestWeeklyCutoff('2026-10-07T16:00:00Z', cfg)).toBe('2026-10-07T16:00:00.000Z');
  expect(latestWeeklyCutoff('2026-11-04T17:00:00Z', cfg)).toBe('2026-11-04T17:00:00.000Z');
  expect(purchaseDecision({ pendingNeeds: [need({ qty_needed: 2 })], settings: cfg, now: '2026-10-07T16:00:00Z' })).toMatchObject({ due: true, reason: 'weekly', combine_regular: true });
  expect(purchaseDecision({ pendingNeeds: [need({ qty_needed: 2, created_at: '2026-10-07T16:01:00Z' })], settings: cfg, now: '2026-10-07T18:00:00Z' }).due).toBe(false);
});
test('maximum wait, purchase cap and unverified cost are explicit gates', () => {
  expect(purchaseDecision({ pendingNeeds: [need({ qty_needed: 1, created_at: '2026-09-20' })], settings: settings({ mode: 'minimum' }), now })).toMatchObject({ due: true, reason: 'max_wait', combine_regular: true });
  expect(purchaseDecision({ pendingNeeds: [need({ qty_needed: 1, created_at: '2026-09-20' })], settings: settings({ mode: 'minimum_weekly', no_batch_policy: 'hold' }), now })).toMatchObject({ due: true, reason: 'max_wait', combine_regular: true });
  expect(purchaseDecision({ pendingNeeds: [need({ qty_needed: 101 })], settings: settings(), now }).reason).toBe('run_limit');
  expect(purchaseDecision({ pendingNeeds: [need({ unit_cost_cents: 0 })], settings: settings(), now }).reason).toBe('unverified_cost_or_date');
  expect(() => purchasingSettings({ all_school_settings: { purchasing: { timezone: 'bad' } } })).toThrow();
});
test('regular supplier preview must contain every source quantity and warehouse destination', () => {
  const positions = [{ id: 'ASBPO 1', all_school_allocation_id: 'id1', items: [{ item_idx: 0, sizes: { M: 4, L: 2 } }] }];
  const lines = [{ sourceBatchId: 'ASBPO 1', sourceItemIdx: 0, size: 'M', quantity: 4 }, { sourceBatchId: 'ASBPO 1', sourceItemIdx: 0, size: 'L', quantity: 2 }];
  const payload = { PO: { shipment: { shipTo: warehouseDestination() } } };
  expect(validateAllSchoolBatch({ positions, lines, payload }).ok).toBe(true);
  expect(validateAllSchoolBatch({ positions, lines: lines.slice(0, 1), payload }).ok).toBe(false);
  expect(validateAllSchoolBatch({ positions, lines, payload: { PO: { shipment: { shipTo: { ...warehouseDestination(), postalCode: '90210' } } } } }).ok).toBe(false);
});
test('an unknown or submitting result is never resent', async () => {
  const adapter = { resolveVendorPurchaseOrder: jest.fn(), submitResolvedVendorPurchaseOrder: jest.fn() };
  expect(await dispatchDedicated({}, { status: 'draft', submission_state: 'unknown' }, adapter)).toMatchObject({ submitted: false, reason: 'not_pending' });
  expect(await dispatchDedicated({}, { status: 'draft', submission_state: 'submitting' }, adapter)).toMatchObject({ submitted: false, reason: 'not_pending' });
  expect(adapter.resolveVendorPurchaseOrder).not.toHaveBeenCalled();
});

const dispatchAdmin = (vendorEnabled = true, claimed = true) => ({
  from: table => {
    const result = table === 'teamshop_auto_po_settings' ? { data: { auto_submit_enabled: vendorEnabled }, error: null } : { data: [{ sku: 'PC61', size: 'M', qty: 1 }], error: null };
    const query = { select: () => query, eq: () => query, order: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result) };
    return query;
  },
  rpc: jest.fn(async name => name === 'claim_all_school_po_submission' ? { data: { claimed, purchase_order: { id: 'po1', submission_state: 'submitting' } } } : { data: { ok: true } }),
});
const pendingPo = { id: 'po1', vendor: 'SanMar', status: 'draft', submission_state: 'pending', ship_to: warehouseDestination() };
test('global vendor disable is rechecked before pending draft dispatch', async () => {
  const adapter = { resolveVendorPurchaseOrder: jest.fn() };
  expect(await dispatchDedicated(dispatchAdmin(false), pendingPo, adapter)).toMatchObject({ submitted: false, reason: 'vendor_disabled' });
  expect(adapter.resolveVendorPurchaseOrder).not.toHaveBeenCalled();
});
test('losing a durable submission claim cannot issue a vendor request', async () => {
  const adapter = { resolveVendorPurchaseOrder: jest.fn(async () => ({ ok: true })), submitResolvedVendorPurchaseOrder: jest.fn() };
  expect(await dispatchDedicated(dispatchAdmin(true, false), pendingPo, adapter)).toMatchObject({ submitted: false, reason: 'already_claimed' });
  expect(adapter.submitResolvedVendorPurchaseOrder).not.toHaveBeenCalled();
});
test('transport exception after claim records unknown and never releases the claim', async () => {
  const admin = dispatchAdmin();
  const adapter = { resolveVendorPurchaseOrder: jest.fn(async () => ({ ok: true, vendor_lines: [] })), submitResolvedVendorPurchaseOrder: jest.fn(async () => { throw new Error('connection lost'); }) };
  expect(await dispatchDedicated(admin, pendingPo, adapter)).toMatchObject({ submitted: false, state: 'unknown' });
  expect(admin.rpc.mock.calls[1]).toEqual(['record_all_school_po_submission', expect.objectContaining({ p_state: 'unknown', p_error: 'connection lost' })]);
  expect(admin.rpc).toHaveBeenCalledTimes(2);
});
