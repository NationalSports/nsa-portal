jest.mock('../../netlify/functions/_shared', () => ({ verifyQBOUser: jest.fn() }));
jest.mock('../../netlify/functions/_qb', () => ({ getValidAccessToken: jest.fn(), qbRequest: jest.fn() }));
const { verifyQBOUser } = require('../../netlify/functions/_shared');
const { getValidAccessToken, qbRequest } = require('../../netlify/functions/_qb');
const { handler } = require('../../netlify/functions/financial-expenses');
const { validateInput, validateMappings, buildPayload, matchesPosting, receiptBuffer, OWNERS } = require('../../netlify/functions/_financialExpenses');
const id = 'c0402a77-6564-4a70-8b98-09256bfba465';
const owner = '00000000-0000-0000-0000-000000000001';
const input = { id, company: 'national', realm_id: '123', merchant: 'Airline', amount: '124.95', currency: 'USD',
  expense_date: '2026-08-31', purpose: 'Customer visit', payment_kind: 'business', expense_account_id: '1', payment_account_id: '2' };
const expense = { Id: '1', AcctNum: '62000', Name: 'Travel', AccountType: 'Expense', Active: true };
const bank = { Id: '2', AcctNum: '10100', Name: 'Checking', AccountType: 'Bank', Active: true, CurrencyRef: { value: 'USD' } };
const card = { ...bank, AccountType: 'Credit Card' };
const payable = { ...bank, AccountType: 'Accounts Payable' };
const vendor = { Id: '3', DisplayName: 'Steve Peterson', Active: true };
const makeRow = () => {
  const row = { ...validateInput(input), submitted_by: owner, realm_id: '123', status: 'submitted', qb_entity_type: 'Purchase', updated_at: new Date().toISOString() };
  row.qb_payload = buildPayload(row, { expense, payment: bank });
  return row;
};
const event = body => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ company: 'national', ...body }) });
// Stateful database fake exercises claims, company filters, persistence failures,
// and repeated calls rather than merely asserting the same payload twice.
function fakeAdmin(initial) {
  let row = initial && JSON.parse(JSON.stringify(initial));
  let failSave = false;
  const admin = {
    storage: { from: jest.fn(() => ({ upload: jest.fn(async () => ({ data: {} })), createSignedUrl: jest.fn(async () => ({ data: { signedUrl: 'https://private.example/receipt' } })) })) },
    from: jest.fn(() => {
      let op = 'select', values, filters = [], claim = false;
      const q = {
        select: () => q, order: () => q, range: () => q,
        eq: (key, value) => { filters.push([key, value]); return q; },
        or: () => { claim = true; return q; },
        update: v => { op = 'update'; values = v; return q; },
        insert: v => { op = 'insert'; values = v; return q; },
        maybeSingle: () => execute(), single: () => execute(), then: (resolve, reject) => execute().then(resolve, reject),
      };
      async function execute() {
        if (op === 'insert') { if (row) return { error: { code: '23505' } }; row = { ...values, status: 'submitted' }; return { data: { ...row } }; }
        if (!row || filters.some(([k, v]) => row[k] !== v)) return { data: null };
        if (claim && row.status === 'posting' && Date.parse(row.updated_at) > Date.now() - 120000) return { data: null };
        if (op === 'update') {
          if (values.status === 'posted' && failSave) { failSave = false; return { error: { message: 'Database unavailable after posting' } }; }
          row = { ...row, ...values };
        }
        return { data: { ...row } };
      }
      return q;
    }),
    row: () => row, failSave: () => { failSave = true; },
  };
  return admin;
}
function fakeQbo() {
  let remote = null;
  qbRequest.mockImplementation(async (method, path, token, payload) => {
    if (method === 'POST') { remote = { ...payload, Id: '900', TotalAmt: 124.95 }; return { status: 200, data: { Purchase: remote } }; }
    if (path.includes('/query?')) return { status: 200, data: { QueryResponse: { Purchase: remote ? [remote] : [] } } };
    if (path.endsWith('/account/1')) return { status: 200, data: { Account: expense } };
    if (path.endsWith('/account/2')) return { status: 200, data: { Account: bank } };
    throw new Error('Unexpected path ' + path);
  });
  return { setRemote: value => { remote = value; } };
}
beforeEach(() => { jest.clearAllMocks(); getValidAccessToken.mockResolvedValue({ access_token: 'server-secret', realm_id: '123' }); });
test('server owner allowlist matches existing Financials access', () => {
  const { FINANCIALS_ALLOWED_USER_IDS } = require('../lib/financialAccess');
  expect([...OWNERS]).toEqual(FINANCIALS_ALLOWED_USER_IDS);
});
test.each(['0', '-1', '1.001', '1e2', 'NaN', '10000000'])('rejects invalid amount %s', amount => {
  expect(() => validateInput({ ...input, amount })).toThrow();
});
test.each(['2026-02-30', '2026-99-99', 'tomorrow', '9999-01-01'])('rejects invalid date %s', expense_date => {
  try { validateInput({ ...input, expense_date }); throw new Error('Expected invalid date'); } catch (e) { expect(e.status).toBe(400); }
});
test('normalizes cents without floating-point drift', () => expect(validateInput({ ...input, amount: '0.29' }).amount_cents).toBe(29));
test('blocks missing, inactive, foreign-currency and non-expense accounts', () => {
  for (const account of [null, { ...expense, Active: false }, { ...expense, CurrencyRef: { value: 'CAD' } }, { ...expense, AccountType: 'Income' }]) {
    expect(() => validateMappings(makeRow(), [account, bank].filter(Boolean), [])).toThrow();
  }
});
test('business-paid bank and card expenses use the selected account', () => {
  for (const payment of [bank, card]) {
    const payload = buildPayload(makeRow(), validateMappings(makeRow(), [expense, payment], []));
    expect(payload.AccountRef).toEqual({ value: '2' });
    expect(payload.PaymentType).toBe(payment === bank ? 'Cash' : 'CreditCard');
    expect(payload.Line[0].AccountBasedExpenseLineDetail.AccountRef).toEqual({ value: '1' });
    expect(payload.VendorRef).toBeUndefined();
  }
});
test('personal expenses become an unpaid bill to the payee, with no bank withdrawal', () => {
  const row = { ...makeRow(), payment_kind: 'personal', vendor_id: '3' };
  const payload = buildPayload(row, validateMappings(row, [expense, payable], [vendor]));
  expect(payload.VendorRef).toEqual({ value: '3' });
  expect(payload.APAccountRef).toEqual({ value: '2' });
  expect(payload.AccountRef).toBeUndefined(); expect(payload.PaymentType).toBeUndefined();
  expect(() => validateMappings(row, [expense, bank], [vendor])).toThrow();
  expect(() => validateMappings(row, [expense, payable], [])).toThrow();
});
test('rejects disguised HTML receipts and oversized files', () => {
  expect(() => receiptBuffer({ type: 'image/png', name: 'receipt.png', base64: Buffer.from('<script>alert(1)</script>').toString('base64') })).toThrow();
  expect(() => receiptBuffer({ type: 'application/pdf', name: 'large.pdf', base64: 'A'.repeat(4194305) })).toThrow();
  expect(receiptBuffer({ type: 'application/pdf', name: 'receipt.pdf', base64: Buffer.from('%PDF-1.7\n').toString('base64') }).buffer.length).toBeGreaterThan(0);
});
test('blocks unauthorized callers before database or QBO reads', async () => {
  verifyQBOUser.mockResolvedValue({ ok: false, status: 401, error: 'Sign in' });
  expect((await handler(event({ action: 'list' }))).statusCode).toBe(401);
  verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: 'another-admin' });
  expect((await handler(event({ action: 'options' }))).statusCode).toBe(403);
  expect(getValidAccessToken).not.toHaveBeenCalled();
});
test('options return live QuickBooks account numbers with each applicable account', async () => {
  const admin = fakeAdmin(null); verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin });
  qbRequest.mockResolvedValueOnce({ status: 200, data: { QueryResponse: { Account: [expense, bank] } } });
  const response = await handler(event({ action: 'options' }));
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body).accounts).toEqual([
    expect.objectContaining({ Id: '1', AcctNum: '62000', Name: 'Travel', AccountType: 'Expense' }),
    expect.objectContaining({ Id: '2', AcctNum: '10100', Name: 'Checking', AccountType: 'Bank' }),
  ]);
});
test('submits once without touching QBO transaction writes', async () => {
  const admin = fakeAdmin(null); fakeQbo();
  verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin });
  const first = await handler(event({ ...input, action: 'submit' }));
  expect(first.statusCode).toBe(200);
  expect(admin.row()).toMatchObject({ submitted_by: owner, amount_cents: 12495, realm_id: '123',
    expense_account_number: '62000', expense_account_name: 'Travel', payment_account_number: '10100', payment_account_name: 'Checking' });
  const second = await handler(event({ ...input, action: 'submit' }));
  expect(JSON.parse(second.body).alreadySubmitted).toBe(true);
  expect(qbRequest.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(0);
});
test('cannot post another business’s expense or to a reconnected realm', async () => {
  const admin = fakeAdmin(makeRow()); verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin }); fakeQbo();
  expect((await handler(event({ action: 'post', id, company: 'methodic' }))).statusCode).toBe(404);
  getValidAccessToken.mockResolvedValue({ realm_id: '999' });
  expect((await handler(event({ action: 'post', id }))).statusCode).toBe(400);
  expect(qbRequest).not.toHaveBeenCalled();
});
test('posting twice creates one QBO expense and keeps the request ID stable', async () => {
  const admin = fakeAdmin(makeRow()); verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin }); fakeQbo();
  expect((await handler(event({ action: 'post', id }))).statusCode).toBe(200);
  expect((await handler(event({ action: 'post', id }))).statusCode).toBe(200);
  const writes = qbRequest.mock.calls.filter(c => c[0] === 'POST');
  expect(writes).toHaveLength(1); expect(writes[0][1]).toContain('requestid=' + id);
  expect(admin.row()).toMatchObject({ status: 'posted', qb_entity_id: '900', posted_by: owner });
});
test('recovers QBO success after a lost local acknowledgement without reposting', async () => {
  const admin = fakeAdmin(makeRow()); admin.failSave(); verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin }); fakeQbo();
  expect((await handler(event({ action: 'post', id }))).statusCode).toBe(500);
  expect(admin.row().status).toBe('error');
  expect((await handler(event({ action: 'post', id }))).statusCode).toBe(200);
  expect(qbRequest.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(1);
});
test('an active posting claim blocks a concurrent request', async () => {
  const admin = fakeAdmin({ ...makeRow(), status: 'posting' }); verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin }); fakeQbo();
  expect((await handler(event({ action: 'post', id }))).statusCode).toBe(409);
  expect(qbRequest).not.toHaveBeenCalled();
});
test('an expired posting claim can reconcile and complete', async () => {
  const admin = fakeAdmin({ ...makeRow(), status: 'posting', updated_at: '2020-01-01T00:00:00Z' }); verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin }); fakeQbo();
  expect((await handler(event({ action: 'post', id }))).statusCode).toBe(200);
});
test('cancellation prevents a later post and never changes QuickBooks', async () => {
  const admin = fakeAdmin(makeRow()); verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin }); fakeQbo();
  expect((await handler(event({ action: 'cancel', id }))).statusCode).toBe(200);
  expect(admin.row().status).toBe('cancelled');
  expect((await handler(event({ action: 'post', id }))).statusCode).toBe(400);
  expect(qbRequest).not.toHaveBeenCalled();
});
test.each(['posting', 'error', 'posted'])('cannot cancel a %s expense that may already exist in QBO', async status => {
  const admin = fakeAdmin({ ...makeRow(), status }); verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin });
  expect((await handler(event({ action: 'cancel', id }))).statusCode).toBe(409);
  expect(admin.row().status).toBe(status);
});
test('a remote collision or changed account is blocked rather than linked', async () => {
  const row = makeRow(); const admin = fakeAdmin(row); verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin });
  const remote = { ...row.qb_payload, Id: '55', TotalAmt: 124.95, AccountRef: { value: 'other' } };
  fakeQbo().setRemote(remote);
  expect(matchesPosting(remote, row.qb_payload)).toBe(false);
  expect((await handler(event({ action: 'post', id }))).statusCode).toBe(400);
  expect(qbRequest.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(0);
  expect(admin.row().status).toBe('error');
});
