const { createVendorPurchaseAdapter } = require('../../netlify/functions/_allSchoolVendorApi');
const env = { INTERNAL_FUNCTION_SECRET: 'test-only', SANMAR_USERNAME: 'test', SANMAR_PASSWORD: 'test', SS_ACCOUNT_NUMBER: 'test', SS_API_KEY: 'test' };
const po = { id: 'po-1', po_number: 'NSA 9999', vendor: 'S&S Activewear', all_school_store_id: 'store-1', submission_state: 'pending', ship_to: { companyName: 'NSA', address1: '123 Main', city: 'Orange', region: 'CA', postalCode: '92867', country: 'US' } };
const source = (overrides = {}) => ({ so_id: 'so-1', so_item_id: 'item-1', sku: 'AT203', size: 'M', qty: 3, unit_cost_cents: 1500, meta: { color: 'Black', ss_sku: 'B123', sanmar_part_id: '12345' }, ...overrides });
const reply = (data, statusCode = 200) => ({ statusCode, body: JSON.stringify(data) });
const claim = header => ({ ...header, submission_state: 'submitting', submission_token: 'token-1' });
function adapter(ssHandler = jest.fn(), sanmarHandler = jest.fn()) { return createVendorPurchaseAdapter({ env, ssHandler, sanmarHandler }); }

test('incomplete address and duplicate source allocation cannot reach a supplier', async () => {
  const ss = jest.fn(); const api = adapter(ss);
  expect((await api.resolveVendorPurchaseOrder({ purchaseOrder: { ...po, ship_to: {} }, lines: [source()] })).state).toBe('held');
  expect((await api.resolveVendorPurchaseOrder({ purchaseOrder: po, lines: [source(), source()] })).state).toBe('held');
  expect(ss).not.toHaveBeenCalled();
});

test('shared payload merges legitimate source needs and cannot submit before durable claim', async () => {
  const ss = jest.fn(); const api = adapter(ss);
  const resolved = await api.resolveVendorPurchaseOrder({ purchaseOrder: po, lines: [source(), source({ so_item_id: 'item-2', qty: 2 })] });
  expect(resolved.payload.lines).toEqual([{ identifier: 'B123', qty: 5 }]);
  expect(resolved.payload.poNumber).toBe('NSA 9999');
  expect(resolved.payload.testOrder).toBe(false);
  expect(resolved.payload.rejectLineErrors).toBe(true);
  expect((await api.submitResolvedVendorPurchaseOrder({ purchaseOrder: po, resolved })).state).toBe('held');
  expect(ss).not.toHaveBeenCalled();
});

test('missing supplier IDs resolve through the existing shared resolver before submission', async () => {
  const ss = jest.fn(async event => reply(event.queryStringParameters.path.startsWith('/Styles') ? [{ styleID: 1, partNumber: 'AT203' }] : [{ sku: 'B123', colorName: 'Black', sizeName: 'M' }]));
  const result = await adapter(ss).resolveVendorPurchaseOrder({ purchaseOrder: po, lines: [source({ meta: { color: 'Black' } })] });
  expect(result.ok).toBe(true); expect(result.payload.lines).toEqual([{ identifier: 'B123', qty: 3 }]);
  expect(ss.mock.calls.every(([event]) => event.httpMethod === 'GET')).toBe(true);
});

test('S&S confirmation reads back external PO and reconciles warehouse-split quantities', async () => {
  const orders = [{ orderNumber: '1', poNumber: po.po_number, lines: [{ sku: 'B123', qtyOrdered: 1 }] }, { orderNumber: '2', poNumber: po.po_number, lines: [{ sku: 'B123', qtyOrdered: 2 }] }];
  const ss = jest.fn(async event => reply(event.httpMethod === 'POST' ? orders.map(({ lines, ...header }) => header) : orders));
  const api = adapter(ss), resolved = await api.resolveVendorPurchaseOrder({ purchaseOrder: po, lines: [source()] });
  const result = await api.submitResolvedVendorPurchaseOrder({ purchaseOrder: claim(po), resolved });
  expect(result.ok).toBe(true); expect(result.api_order_id).toBe('1,2'); expect(result.verified).toBe(true);
  expect(ss.mock.calls.map(([e]) => e.httpMethod)).toEqual(['POST', 'GET']);
  expect(ss.mock.calls[1][0].queryStringParameters.path).toContain('NSA%209999');
});

test.each([{ readback: [] }, { readback: [{ orderNumber: '1', poNumber: po.po_number, lines: [{ sku: 'B123', qtyOrdered: 6 }] }] }, { readback: [{ orderNumber: '1', poNumber: 'OTHER', lines: [{ sku: 'B123', qtyOrdered: 3 }] }] }])('missing, oversized, and wrong PO readback is unknown without retry', async ({ readback }) => {
  const ss = jest.fn(async event => reply(event.httpMethod === 'POST' ? [{ orderNumber: '1' }] : readback));
  const api = adapter(ss), resolved = await api.resolveVendorPurchaseOrder({ purchaseOrder: po, lines: [source()] });
  expect((await api.submitResolvedVendorPurchaseOrder({ purchaseOrder: claim(po), resolved })).state).toBe('unknown');
  expect(ss).toHaveBeenCalledTimes(2);
});

test('timeout is unknown, sends once, and does not substitute email', async () => {
  const ss = jest.fn(async () => { throw new Error('timeout'); });
  const api = adapter(ss), resolved = await api.resolveVendorPurchaseOrder({ purchaseOrder: po, lines: [source()] });
  expect((await api.submitResolvedVendorPurchaseOrder({ purchaseOrder: claim(po), resolved })).state).toBe('unknown');
  expect(ss).toHaveBeenCalledTimes(1);
});

test('mutated resolved payload cannot reach a supplier', async () => {
  const ss = jest.fn(); const api = adapter(ss), resolved = await api.resolveVendorPurchaseOrder({ purchaseOrder: po, lines: [source()] });
  resolved.payload.lines[0].qty = 9;
  expect((await api.submitResolvedVendorPurchaseOrder({ purchaseOrder: claim(po), resolved })).state).toBe('held');
  expect(ss).not.toHaveBeenCalled();
});

test('SanMar requires exact stable PO transaction confirmation and reports line detail unverified', async () => {
  const sanmar = jest.fn(async () => reply({ transactionId: 'txn-1', orderNumber: po.po_number }));
  const api = adapter(undefined, sanmar), header = { ...po, vendor: 'SanMar' };
  const resolved = await api.resolveVendorPurchaseOrder({ purchaseOrder: header, lines: [source()] });
  const result = await api.submitResolvedVendorPurchaseOrder({ purchaseOrder: claim(header), resolved });
  expect(result).toMatchObject({ ok: true, api_order_id: 'txn-1', verified: false, confirmation: 'transaction' });
  expect(sanmar.mock.calls[0][0].queryStringParameters.env).toBe('prod');
});


test.each(['SanMar', 'S&S Activewear'])('configured %s account mismatch holds before catalog or purchase I/O', async vendor => {
  const ss = jest.fn(), sanmar = jest.fn();
  const result = await adapter(ss, sanmar).resolveVendorPurchaseOrder({ purchaseOrder: { ...po, vendor, supplier_account: 'different-account' }, lines: [source()] });
  expect(result).toMatchObject({ ok: false, state: 'held' });
  expect(ss).not.toHaveBeenCalled(); expect(sanmar).not.toHaveBeenCalled();
});
