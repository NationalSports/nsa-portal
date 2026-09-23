const { verifyQBOUser } = require('./_shared');
const { getValidAccessToken, qbRequest } = require('./_qb');
const { OWNERS, UUID, check } = require('./_financialExpenses');
const { plaidConfig, plaidRequest, encryptToken, merchantKey, syncConnection } = require('./_plaid');

const db = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const monthRange = value => {
  check(/^\d{4}-\d{2}$/.test(value || ''), 'Choose a valid report month.');
  const start = `${value}-01`;
  const date = new Date(`${start}T12:00:00Z`);
  check(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 7) === value, 'Choose a valid report month.');
  date.setUTCMonth(date.getUTCMonth() + 1);
  return { start, end: date.toISOString().slice(0, 10) };
};

async function qboAccount(admin, company, id, allowedTypes) {
  check(/^\d+$/.test(String(id || '')), 'Choose a valid QuickBooks account.');
  const { access_token, realm_id } = await getValidAccessToken(admin, company);
  const result = await qbRequest('GET', `/v3/company/${realm_id}/account/${id}`, access_token);
  const account = result.data?.Account;
  const message = result.data?.Fault?.Error?.map(error => error.Detail || error.Message).join('; ');
  check(result.status >= 200 && result.status < 300 && account && account.Active !== false, message || 'QuickBooks account could not be verified.');
  check(allowedTypes.includes(account.AccountType) && (!account.CurrencyRef?.value || account.CurrencyRef.value === 'USD'), 'Choose an active USD QuickBooks account of the correct type.');
  return { id: String(account.Id), number: account.AcctNum || null, name: account.FullyQualifiedName || account.Name };
}

async function listFeed(admin, company, month) {
  const { start, end } = monthRange(month);
  const connections = db(await admin.from('financial_card_connections')
    .select('id,company_key,institution_id,institution_name,status,last_synced_at,last_error,created_at')
    .eq('company_key', company).neq('status', 'disconnected').order('created_at'));
  const connectionIds = connections.map(connection => connection.id);
  let accounts = [];
  if (connectionIds.length) accounts = db(await admin.from('financial_card_accounts').select('*').in('connection_id', connectionIds).eq('is_active', true).order('name'));
  const transactions = db(await admin.from('financial_card_transactions').select('*').eq('company_key', company)
    .gte('transaction_date', start).lt('transaction_date', end).order('transaction_date', { ascending: false }).order('id'));
  const rules = db(await admin.from('financial_expense_rules').select('id,merchant_label,merchant_key,expense_account_id,expense_account_number,expense_account_name,purpose').eq('company_key', company).order('merchant_label'));
  const expenseIds = transactions.map(row => row.financial_expense_id).filter(Boolean);
  let expenses = [];
  if (expenseIds.length) expenses = db(await admin.from('financial_expenses').select('id,status,receipt_name,qb_entity_id').in('id', expenseIds));
  const expenseById = new Map(expenses.map(expense => [expense.id, expense]));
  const accountById = new Map(accounts.map(account => [account.id, account]));
  const rows = transactions.map(transaction => ({ ...transaction, account: accountById.get(transaction.account_id) || null,
    expense: transaction.financial_expense_id ? expenseById.get(transaction.financial_expense_id) || null : null }));
  const spend = rows.filter(row => row.amount_cents > 0 && !row.pending && !row.provider_removed && row.status !== 'ignored');
  const grouped = new Map();
  for (const row of spend) {
    const key = row.expense_account_id || 'uncategorized';
    const current = grouped.get(key) || { expense_account_id: row.expense_account_id, expense_account_number: row.expense_account_number,
      expense_account_name: row.expense_account_name || 'Uncategorized', amount_cents: 0, count: 0 };
    current.amount_cents += row.amount_cents; current.count++; grouped.set(key, current);
  }
  return { configured: plaidConfig().configured, environment: plaidConfig().environment, connections, accounts, transactions: rows, rules,
    report: { total_cents: spend.reduce((sum, row) => sum + row.amount_cents, 0), count: spend.length,
      needs_review: spend.filter(row => row.status === 'new').length, ready: spend.filter(row => row.status === 'ready').length,
      submitted: spend.filter(row => row.status === 'submitted').length, posted: spend.filter(row => row.status === 'posted').length,
      missing_receipts: spend.filter(row => row.receipt_required && !row.expense?.receipt_name).length,
      by_account: [...grouped.values()].sort((a, b) => b.amount_cents - a.amount_cents) } };
}

exports.handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  try {
    const auth = await verifyQBOUser(event);
    if (!auth.ok) return reply(auth.status, { error: auth.error });
    if (!OWNERS.has(String(auth.teamMemberId))) return reply(403, { error: 'Financials owner access required.' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Invalid JSON.' }); }
    const company = body.company;
    check(['national', 'methodic'].includes(company), 'Choose a business.');
    const admin = auth.admin;

    if (body.action === 'list') return reply(200, await listFeed(admin, company, body.month));
    if (body.action === 'link_token') {
      check(plaidConfig().configured, 'Plaid credentials and the token-encryption key must be configured before connecting a card.');
      const payload = { user: { client_user_id: `${company}:${auth.teamMemberId}` }, client_name: 'National Sports Connect',
        products: ['transactions'], country_codes: ['US'], language: 'en' };
      if (process.env.PLAID_REDIRECT_URI) payload.redirect_uri = process.env.PLAID_REDIRECT_URI;
      const result = await plaidRequest('/link/token/create', payload);
      return reply(200, { link_token: result.link_token, expiration: result.expiration });
    }
    if (body.action === 'exchange') {
      check(typeof body.public_token === 'string' && body.public_token.length <= 500, 'Card connection token is missing.');
      const exchanged = await plaidRequest('/item/public_token/exchange', { public_token: body.public_token });
      const institution = body.institution || {};
      const row = db(await admin.from('financial_card_connections').insert({ company_key: company, provider_item_id: exchanged.item_id,
        access_token_ciphertext: encryptToken(exchanged.access_token), institution_id: String(institution.institution_id || '').slice(0, 100) || null,
        institution_name: String(institution.name || 'Connected card').slice(0, 200), created_by: auth.teamMemberId }).select('*').single());
      await syncConnection(admin, row);
      return reply(200, await listFeed(admin, company, body.month));
    }
    if (body.action === 'sync') {
      const connections = db(await admin.from('financial_card_connections').select('*').eq('company_key', company).neq('status', 'disconnected'));
      const results = [];
      for (const connection of connections) results.push({ connection_id: connection.id, ...(await syncConnection(admin, connection)) });
      return reply(200, { ...(await listFeed(admin, company, body.month)), sync: results });
    }
    if (body.action === 'map_account') {
      check(UUID.test(body.account_id || ''), 'Choose a connected card account.');
      const account = db(await admin.from('financial_card_accounts').select('*').eq('id', body.account_id).eq('company_key', company).maybeSingle());
      check(account, 'Connected card account was not found.');
      const qbo = await qboAccount(admin, company, body.qbo_payment_account_id, ['Credit Card', 'Bank']);
      db(await admin.from('financial_card_accounts').update({ qbo_payment_account_id: qbo.id, qbo_payment_account_number: qbo.number,
        qbo_payment_account_name: qbo.name, updated_at: new Date().toISOString() }).eq('id', account.id));
      return reply(200, await listFeed(admin, company, body.month));
    }
    if (body.action === 'categorize') {
      check(UUID.test(body.transaction_id || ''), 'Choose a card transaction.');
      const transaction = db(await admin.from('financial_card_transactions').select('*').eq('id', body.transaction_id).eq('company_key', company).maybeSingle());
      check(transaction && !transaction.pending && !transaction.provider_removed && transaction.amount_cents > 0
        && !['submitted', 'posted'].includes(transaction.status), 'Only cleared, positive transactions can be categorized.');
      const qbo = await qboAccount(admin, company, body.expense_account_id, ['Expense', 'Other Expense', 'Cost of Goods Sold']);
      const purpose = String(body.purpose || '').trim();
      check(purpose && purpose.length <= 1000, 'Enter a business purpose.');
      const patch = { status: 'ready', expense_account_id: qbo.id, expense_account_number: qbo.number, expense_account_name: qbo.name,
        purpose, receipt_required: body.receipt_required !== false, updated_at: new Date().toISOString() };
      db(await admin.from('financial_card_transactions').update(patch).eq('id', transaction.id));
      if (body.remember) {
        const label = transaction.merchant_name || transaction.description;
        const key = merchantKey(label);
        check(key, 'Merchant is unavailable for this rule.');
        db(await admin.from('financial_expense_rules').upsert({ company_key: company, merchant_key: key, merchant_label: label.slice(0, 200),
          expense_account_id: qbo.id, expense_account_number: qbo.number, expense_account_name: qbo.name,
          purpose, created_by: auth.teamMemberId, updated_at: new Date().toISOString() }, { onConflict: 'company_key,merchant_key' }));
      }
      return reply(200, await listFeed(admin, company, body.month));
    }
    if (body.action === 'ignore') {
      check(UUID.test(body.transaction_id || ''), 'Choose a card transaction.');
      const ignored = db(await admin.from('financial_card_transactions').update({ status: 'ignored', updated_at: new Date().toISOString() })
        .eq('id', body.transaction_id).eq('company_key', company).in('status', ['new', 'ready']).select('id').maybeSingle());
      check(ignored, 'Only unsubmitted transactions can be ignored.');
      return reply(200, await listFeed(admin, company, body.month));
    }
    if (body.action === 'disconnect') {
      check(UUID.test(body.connection_id || ''), 'Choose a card connection.');
      const connection = db(await admin.from('financial_card_connections').select('*').eq('id', body.connection_id).eq('company_key', company).maybeSingle());
      check(connection, 'Card connection was not found.');
      if (connection.access_token_ciphertext) {
        const { decryptToken } = require('./_plaid');
        await plaidRequest('/item/remove', { access_token: decryptToken(connection.access_token_ciphertext) });
      }
      db(await admin.from('financial_card_connections').update({ status: 'disconnected', access_token_ciphertext: null,
        sync_cursor: null, updated_at: new Date().toISOString() }).eq('id', connection.id));
      return reply(200, await listFeed(admin, company, body.month));
    }
    check(false, 'Unknown card-feed action.');
  } catch (error) {
    return reply(error.status || 500, { error: error.message || 'Card-feed request failed.' });
  }
};
