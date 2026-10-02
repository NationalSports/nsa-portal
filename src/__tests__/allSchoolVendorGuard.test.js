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
  const db = client([{ data: [] }, { data: [{ id: 'dedicated' }] }]);
  expect((await guardAllSchoolVendorRequest({ vendor: 'SanMar', poNumber: 'NSA 1234' }, db)).ok).toBe(false);
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
