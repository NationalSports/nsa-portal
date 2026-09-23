const crypto = require('crypto');

const ENV_URLS = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

function plaidConfig(env = process.env) {
  const environment = String(env.PLAID_ENV || 'sandbox').toLowerCase();
  const key = parseKey(env.PLAID_TOKEN_ENCRYPTION_KEY);
  return {
    environment,
    baseUrl: ENV_URLS[environment],
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    key,
    configured: !!(ENV_URLS[environment] && env.PLAID_CLIENT_ID && env.PLAID_SECRET && key),
  };
}

function parseKey(value) {
  if (!value) return null;
  const text = String(value).trim();
  let key;
  if (/^[0-9a-f]{64}$/i.test(text)) key = Buffer.from(text, 'hex');
  else {
    try { key = Buffer.from(text, 'base64'); } catch (_) { return null; }
  }
  return key.length === 32 ? key : null;
}

function encryptToken(token, env = process.env) {
  const { key } = plaidConfig(env);
  if (!key) throw new Error('Plaid token encryption key is missing or invalid.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
}

function decryptToken(value, env = process.env) {
  const { key } = plaidConfig(env);
  if (!key) throw new Error('Plaid token encryption key is missing or invalid.');
  const [version, ivText, tagText, bodyText] = String(value || '').split(':');
  if (version !== 'v1' || !ivText || !tagText || !bodyText) throw new Error('Stored card connection token is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
}

async function plaidRequest(path, payload, env = process.env) {
  const config = plaidConfig(env);
  if (!config.configured) throw new Error('Plaid is not configured for this portal.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(config.baseUrl + path, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'PLAID-CLIENT-ID': config.clientId, 'PLAID-SECRET': config.secret },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error_code) {
      const error = new Error(data.error_message || data.display_message || `Card provider request failed (${response.status}).`);
      error.code = data.error_code || 'PLAID_ERROR';
      throw error;
    }
    return data;
  } finally { clearTimeout(timer); }
}

const merchantKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
const cents = value => Math.round(Number(value) * 100);
const db = result => { if (result.error) throw new Error(result.error.message); return result.data; };

async function upsertAccounts(admin, connection, accessToken) {
  const response = await plaidRequest('/accounts/get', { access_token: accessToken });
  const rows = (response.accounts || []).filter(account => !account.balances?.iso_currency_code || account.balances.iso_currency_code === 'USD').map(account => ({
    connection_id: connection.id, company_key: connection.company_key, provider_account_id: account.account_id,
    name: account.name || account.official_name || 'Card account', official_name: account.official_name || null, mask: account.mask || null,
    account_type: account.type, account_subtype: account.subtype || null, currency: account.balances?.iso_currency_code || 'USD',
    current_balance_cents: account.balances?.current == null ? null : cents(account.balances.current),
    available_balance_cents: account.balances?.available == null ? null : cents(account.balances.available), is_active: true,
    updated_at: new Date().toISOString(),
  }));
  db(await admin.from('financial_card_accounts').update({ is_active: false, updated_at: new Date().toISOString() }).eq('connection_id', connection.id));
  if (rows.length) db(await admin.from('financial_card_accounts').upsert(rows, { onConflict: 'provider_account_id' }));
  return db(await admin.from('financial_card_accounts').select('*').eq('connection_id', connection.id));
}

async function syncConnection(admin, connection) {
  if (connection.status === 'disconnected' || !connection.access_token_ciphertext) return { added: 0, modified: 0, removed: 0 };
  const accessToken = decryptToken(connection.access_token_ciphertext);
  try {
    const accounts = await upsertAccounts(admin, connection, accessToken);
    const accountByProvider = new Map(accounts.map(account => [account.provider_account_id, account]));
    const rules = db(await admin.from('financial_expense_rules').select('*').eq('company_key', connection.company_key));
    const ruleByMerchant = new Map(rules.map(rule => [rule.merchant_key, rule]));
    let cursor = connection.sync_cursor || undefined;
    let hasMore = true;
    const totals = { added: 0, modified: 0, removed: 0 };
    // Save the intermediate cursor after five pages so one connection cannot exhaust
    // the synchronous function timeout. A later manual or scheduled sync continues it.
    for (let page = 0; hasMore && page < 5; page++) {
      const response = await plaidRequest('/transactions/sync', { access_token: accessToken, cursor, count: 500, options: { include_personal_finance_category: true } });
      const changed = [...(response.added || []), ...(response.modified || [])];
      const ids = changed.map(transaction => transaction.transaction_id);
      let existing = [];
      if (ids.length) existing = db(await admin.from('financial_card_transactions').select('*').in('provider_transaction_id', ids));
      const existingById = new Map(existing.map(row => [row.provider_transaction_id, row]));
      const rows = changed.map(transaction => {
        const account = accountByProvider.get(transaction.account_id);
        if (!account) return null;
        const old = existingById.get(transaction.transaction_id);
        const label = transaction.merchant_name || transaction.name;
        const rule = !old ? ruleByMerchant.get(merchantKey(label)) : null;
        if (cents(transaction.amount) === 0) return null;
        return {
          id: old?.id || crypto.randomUUID(), connection_id: connection.id, account_id: account.id, company_key: connection.company_key,
          provider_transaction_id: transaction.transaction_id, pending_transaction_id: transaction.pending_transaction_id || null,
          transaction_date: transaction.date, authorized_date: transaction.authorized_date || null,
          merchant_name: transaction.merchant_name || null, description: transaction.name || transaction.merchant_name || 'Card transaction',
          amount_cents: cents(transaction.amount), currency: transaction.iso_currency_code || 'USD', pending: !!transaction.pending,
          provider_removed: false, category_primary: transaction.personal_finance_category?.primary || null,
          category_detailed: transaction.personal_finance_category?.detailed || null,
          status: old?.status || (rule ? 'ready' : 'new'), expense_account_id: old?.expense_account_id || rule?.expense_account_id || null,
          expense_account_number: old?.expense_account_number || rule?.expense_account_number || null,
          expense_account_name: old?.expense_account_name || rule?.expense_account_name || null,
          purpose: old?.purpose || rule?.purpose || null, receipt_required: old?.receipt_required ?? true,
          financial_expense_id: old?.financial_expense_id || null, created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString(),
        };
      }).filter(Boolean);
      if (rows.length) db(await admin.from('financial_card_transactions').upsert(rows, { onConflict: 'provider_transaction_id' }));
      for (const removed of response.removed || []) {
        const prior = db(await admin.from('financial_card_transactions').select('id,status').eq('provider_transaction_id', removed.transaction_id).maybeSingle());
        if (prior) db(await admin.from('financial_card_transactions').update({ provider_removed: true,
          status: ['submitted', 'posted'].includes(prior.status) ? prior.status : 'removed', updated_at: new Date().toISOString() }).eq('id', prior.id));
      }
      totals.added += (response.added || []).length; totals.modified += (response.modified || []).length; totals.removed += (response.removed || []).length;
      cursor = response.next_cursor; hasMore = !!response.has_more;
    }
    db(await admin.from('financial_card_connections').update({ sync_cursor: cursor || null, status: 'active', last_error: null,
      last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', connection.id));
    return totals;
  } catch (error) {
    await admin.from('financial_card_connections').update({ status: 'error', last_error: String(error.message).slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', connection.id);
    throw error;
  }
}

module.exports = { plaidConfig, plaidRequest, encryptToken, decryptToken, merchantKey, syncConnection };
