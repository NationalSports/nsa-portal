jest.mock('../../netlify/functions/_shared', () => ({ verifyQBOUser: jest.fn() }));
jest.mock('../../netlify/functions/_qb', () => ({ getValidAccessToken: jest.fn(), qbRequest: jest.fn() }));
jest.mock('../../netlify/functions/_plaid', () => ({ plaidConfig: jest.fn(() => ({ configured: true, environment: 'sandbox' })),
  plaidRequest: jest.fn(), encryptToken: jest.fn(value => `encrypted:${value}`), merchantKey: value => String(value || '').toLowerCase(), syncConnection: jest.fn(async () => ({ added: 1, modified: 0, removed: 0 })) }));
const { verifyQBOUser } = require('../../netlify/functions/_shared');
const { getValidAccessToken, qbRequest } = require('../../netlify/functions/_qb');
const { plaidConfig, plaidRequest } = require('../../netlify/functions/_plaid');
const { handler } = require('../../netlify/functions/financial-card-feed');

const owner = '00000000-0000-0000-0000-000000000001';
const txnId = '22222222-2222-4222-8222-222222222222';
const event = body => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ company: 'national', month: '2026-09', ...body }) });

function fakeAdmin(seed = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
  return {
    tables,
    from(table) {
      if (!tables[table]) tables[table] = [];
      let op = 'select', values, filters = [], from = 0, to = Infinity;
      const query = {
        select: () => query, order: () => query, limit: () => query,
        range: (first, last) => { from = first; to = last; return query; },
        eq: (key, value) => { filters.push(row => row[key] === value); return query; },
        neq: (key, value) => { filters.push(row => row[key] !== value); return query; },
        gte: (key, value) => { filters.push(row => row[key] >= value); return query; },
        lt: (key, value) => { filters.push(row => row[key] < value); return query; },
        in: (key, valuesToMatch) => { filters.push(row => valuesToMatch.includes(row[key])); return query; },
        update: patch => { op = 'update'; values = patch; return query; },
        insert: row => { op = 'insert'; values = row; return query; },
        upsert: row => { op = 'upsert'; values = row; return query; },
        maybeSingle: () => execute(true), single: () => execute(true),
        then: (resolve, reject) => execute(false).then(resolve, reject),
      };
      async function execute(single) {
        let rows = tables[table].filter(row => filters.every(filter => filter(row)));
        if (op === 'update') { rows.forEach(row => Object.assign(row, values)); }
        if (op === 'insert') { const row = { id: values.id || '99999999-9999-4999-8999-999999999999', ...values }; tables[table].push(row); rows = [row]; }
        if (op === 'upsert') { const source = Array.isArray(values) ? values : [values]; for (const value of source) tables[table].push({ ...value }); rows = source; }
        return { data: single ? rows[0] || null : rows.slice(from, to + 1).map(row => ({ ...row })) };
      }
      return query;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks(); plaidConfig.mockReturnValue({ configured: true, environment: 'sandbox' });
  getValidAccessToken.mockResolvedValue({ access_token: 'qbo-secret', realm_id: '123' });
});

test('blocks non-owners before card or QuickBooks access', async () => {
  verifyQBOUser.mockResolvedValue({ ok: false, status: 401, error: 'Sign in' });
  expect((await handler(event({ action: 'list' }))).statusCode).toBe(401);
  verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: 'other', admin: fakeAdmin() });
  expect((await handler(event({ action: 'list' }))).statusCode).toBe(403);
  expect(plaidRequest).not.toHaveBeenCalled(); expect(qbRequest).not.toHaveBeenCalled();
});

test('creates a temporary Link token without returning provider credentials', async () => {
  verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin: fakeAdmin() });
  plaidRequest.mockResolvedValue({ link_token: 'link-sandbox', expiration: '2026-09-22T12:00:00Z' });
  const response = await handler(event({ action: 'link_token' }));
  expect(response).toEqual(expect.objectContaining({ statusCode: 200 }));
  expect(JSON.parse(response.body)).toEqual({ link_token: 'link-sandbox', expiration: '2026-09-22T12:00:00Z' });
  expect(JSON.stringify(JSON.parse(response.body))).not.toContain('secret');
});

test('categorizes a cleared charge using the server-verified QBO account snapshot', async () => {
  const admin = fakeAdmin({
    financial_card_connections: [{ id: 'c1', company_key: 'national', institution_name: 'Bank', status: 'active' }],
    financial_card_accounts: [{ id: '11111111-1111-4111-8111-111111111111', connection_id: 'c1', company_key: 'national', name: 'Card', is_active: true }],
    financial_card_transactions: [{ id: txnId, connection_id: 'c1', account_id: '11111111-1111-4111-8111-111111111111', company_key: 'national',
      transaction_date: '2026-09-20', description: 'Carrier', merchant_name: 'Carrier', currency: 'USD', amount_cents: 4852, status: 'new', pending: false, provider_removed: false, receipt_required: true }],
    financial_expense_rules: [], financial_expenses: [],
  });
  verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin });
  qbRequest.mockResolvedValue({ status: 200, data: { Account: { Id: '44', AcctNum: '64200', Name: 'Telephone', AccountType: 'Expense', Active: true } } });
  const response = await handler(event({ action: 'categorize', transaction_id: txnId, expense_account_id: '44', purpose: 'Monthly service', remember: true }));
  expect(response).toEqual(expect.objectContaining({ statusCode: 200 }));
  expect(admin.tables.financial_card_transactions[0]).toMatchObject({ status: 'ready', expense_account_id: '44', expense_account_number: '64200', expense_account_name: 'Telephone', purpose: 'Monthly service' });
  expect(admin.tables.financial_expense_rules[0]).toMatchObject({ company_key: 'national', expense_account_id: '44', expense_account_number: '64200' });
  expect(qbRequest).toHaveBeenCalledWith('GET', '/v3/company/123/account/44', 'qbo-secret');
  expect(JSON.parse(response.body).report).toMatchObject({ total_cents: 4852, ready: 1, missing_receipts: 1 });
});

test('excludes pending authorizations from monthly spend and refuses to categorize them', async () => {
  const admin = fakeAdmin({
    financial_card_connections: [{ id: 'c1', company_key: 'national', institution_name: 'Bank', status: 'active' }],
    financial_card_accounts: [{ id: '11111111-1111-4111-8111-111111111111', connection_id: 'c1', company_key: 'national', name: 'Card', is_active: true }],
    financial_card_transactions: [{ id: txnId, connection_id: 'c1', account_id: '11111111-1111-4111-8111-111111111111', company_key: 'national',
      transaction_date: '2026-09-20', description: 'Pending charge', amount_cents: 9800, status: 'new', pending: true, provider_removed: false, receipt_required: true }],
    financial_expense_rules: [], financial_expenses: [],
  });
  verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin });
  const listed = await handler(event({ action: 'list' }));
  expect(JSON.parse(listed.body).report).toMatchObject({ total_cents: 0, count: 0, needs_review: 0 });
  const categorized = await handler(event({ action: 'categorize', transaction_id: txnId, expense_account_id: '44', purpose: 'Pending' }));
  expect(categorized.statusCode).toBe(400);
  expect(qbRequest).not.toHaveBeenCalled();
});

test('monthly report and CSV source include transactions beyond the default 1,000 row cap', async () => {
  const admin = fakeAdmin({ financial_card_transactions: Array.from({ length: 1201 }, (_, index) => ({ id: String(index), company_key: 'national',
    transaction_date: '2026-09-20', description: 'Charge', currency: 'USD', amount_cents: 100, status: 'new' })) });
  verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin });
  const response = await handler(event({ action: 'list' }));
  expect(JSON.parse(response.body).transactions).toHaveLength(1201);
  expect(JSON.parse(response.body).report).toMatchObject({ count: 1201, total_cents: 120100 });
});

test('surfaces provider changes to submitted or posted charges for reconciliation', async () => {
  const admin = fakeAdmin({
    financial_card_transactions: [{ id: txnId, company_key: 'national', transaction_date: '2026-09-20', description: 'Carrier',
      currency: 'USD', amount_cents: 5000, status: 'posted', financial_expense_id: 'expense1' }],
    financial_expenses: [{ id: 'expense1', status: 'posted', expense_date: '2026-09-20', merchant: 'Carrier', amount_cents: 4852, qb_entity_id: '900' }],
  });
  verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin });
  const response = JSON.parse((await handler(event({ action: 'list' }))).body);
  expect(response.transactions[0].requires_reconciliation).toBe(true);
  expect(response.report.reconciliation_count).toBe(1);
  expect(qbRequest).not.toHaveBeenCalled();
});

test('an ignored charge can return to review without altering submitted expenses', async () => {
  const admin = fakeAdmin({ financial_card_transactions: [{ id: txnId, company_key: 'national', currency: 'USD',
    transaction_date: '2026-09-20', amount_cents: 100, status: 'ignored', provider_removed: false }] });
  verifyQBOUser.mockResolvedValue({ ok: true, teamMemberId: owner, admin });
  expect((await handler(event({ action: 'restore', transaction_id: txnId }))).statusCode).toBe(200);
  expect(admin.tables.financial_card_transactions[0].status).toBe('new');
  admin.tables.financial_card_transactions[0].status = 'submitted';
  expect((await handler(event({ action: 'restore', transaction_id: txnId }))).statusCode).toBe(400);
  expect(admin.tables.financial_card_transactions[0].status).toBe('submitted');
});
