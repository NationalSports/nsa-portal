const { guardAllSchoolVendorRequest } = require('../../netlify/functions/_allSchoolVendorGuard');
const token = '00000000-0000-4000-8000-000000000001';
function client(results = []) {
  const rpc = jest.fn().mockResolvedValue({ data: { claimed: true } });
  const request = {};
  for (const name of ['select', 'eq', 'in', 'not']) request[name] = jest.fn(() => request);
  request.limit = jest.fn(async () => results.shift() || { data: [] });
  return { from: jest.fn(() => request), rpc, request };
}

test('active durable allocations prevent old tabs from skipping the purchase claim', async () => {
  const db = client([{ data: [{ id: 'allocation' }] }]);
  expect((await guardAllSchoolVendorRequest({ vendor: 'S&S Activewear', poNumber: 'NSA 1234' }, db)).ok).toBe(false);
  expect(db.request.eq).toHaveBeenCalledWith('vendor_key', 'sss');
  expect(db.rpc).not.toHaveBeenCalled();
});

test('dedicated external reference cannot be replayed without its token', async () => {
  const db = client([{ data: [] }, { data: [] }, { data: [{ id: 'dedicated' }] }]);
  expect((await guardAllSchoolVendorRequest({ vendor: 'SanMar', poNumber: 'NSA 1234' }, db)).ok).toBe(false);
});

// Filter real rows to cover the reference/state mismatch of combined batches.
function rowClient(tables) {
  return { from: table => {
    let rows = tables[table] || [];
    const query = {
      select: () => query,
      eq: (field, value) => { rows = rows.filter(row => row[field] === value); return query; },
      in: (field, values) => { rows = rows.filter(row => values.includes(row[field])); return query; },
      not: (field, operator, value) => { rows = rows.filter(row => row[field] != null); return query; },
      limit: async count => ({ data: rows.slice(0, count) }),
    };
    return query;
  } };
}

test.each(['submitted', 'released'])('completed %s combined batch cannot be resent from an old tab', async state => {
  const db = rowClient({
    all_school_batch_allocations: [{ id: 'allocation', state, vendor_key: 'sss', submitted_po_number: 'NSA 9999', vendor_request_started_at: '2026-10-06T00:00:00Z' }],
    purchase_orders: [{ id: 'dedicated', vendor: 'S&S Activewear', po_number: 'PO 1234', all_school_store_id: 'school' }],
  });
  expect((await guardAllSchoolVendorRequest({ vendor: 'S&S Activewear', poNumber: 'NSA 9999' }, db)).ok).toBe(false);
  expect((await guardAllSchoolVendorRequest({ vendor: 'S&S Activewear', poNumber: 'NSA 10000' }, db)).ok).toBe(true);
  expect((await guardAllSchoolVendorRequest({ vendor: 'SanMar', poNumber: 'NSA 9999' }, db)).ok).toBe(true);
});

test('completed-batch verification errors fail closed', async () => {
  const db = client([{ data: [] }, { error: { message: 'lookup unavailable' } }]);
  expect((await guardAllSchoolVendorRequest({ vendor: 'S&S Activewear', poNumber: 'NSA 9999' }, db)).statusCode).toBe(503);
});

test('ordinary supplier purchases continue when neither queue nor external reference is school-managed', async () => {
  expect((await guardAllSchoolVendorRequest({ vendor: 'SanMar', poNumber: 'NSA 1234' }, client())).ok).toBe(true);
});

test('each token must pass a durable one-time server claim before external send', async () => {
  const db = client();
  db.rpc.mockResolvedValueOnce({ data: { claimed: true } }).mockResolvedValueOnce({ data: { claimed: false } });
  const args = { vendor: 'SanMar', poNumber: 'NSA 1234', token };
  expect((await guardAllSchoolVendorRequest(args, db)).ok).toBe(true);
  expect((await guardAllSchoolVendorRequest(args, db)).ok).toBe(false);
  expect(db.rpc).toHaveBeenCalledWith('claim_all_school_vendor_request', { p_token: token, p_po_number: 'NSA 1234', p_vendor: 'SanMar', p_supplier_account: null });
});

test('database uncertainty and invalid tokens fail closed before any supplier request', async () => {
  const db = client([{ error: { message: 'schema cache unavailable' } }]);
  expect((await guardAllSchoolVendorRequest({ vendor: 'SanMar', poNumber: 'NSA 1234' }, db)).statusCode).toBe(503);
  expect((await guardAllSchoolVendorRequest({ vendor: 'SanMar', poNumber: 'NSA 1234', token: 'invalid' }, db)).ok).toBe(false);
  expect(db.rpc).not.toHaveBeenCalled();
});
