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

async function plaidRequest(path, payload, env = process.env, timeoutMs = 18000) {
  const config = plaidConfig(env);
  if (!config.configured) throw new Error('Plaid is not configured for this portal.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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

// Fetch a complete Plaid update before committing any transaction changes. A
// pagination mutation restarts from the original cursor, never a partial cursor.
async function collectTransactions(accessToken, initialCursor, deadline) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let cursor = initialCursor || undefined;
    const changed = new Map(), removed = new Set();
    const totals = { added: 0, modified: 0, removed: 0 };
    try {
      for (let page = 0; page < 100; page++) {
        if (Date.now() > deadline) throw new Error('Card refresh is taking longer than expected. Retry refresh; no partial update was saved.');
        const response = await plaidRequest('/transactions/sync', { access_token: accessToken, cursor, count: 500,
          options: { include_personal_finance_category: true } }, process.env, Math.max(1, deadline - Date.now()));
        for (const transaction of [...(response.added || []), ...(response.modified || [])]) {
          changed.set(transaction.transaction_id, transaction); removed.delete(transaction.transaction_id);
        }
        for (const transaction of response.removed || []) {
          removed.add(transaction.transaction_id); changed.delete(transaction.transaction_id);
        }
        totals.added += (response.added || []).length;
        totals.modified += (response.modified || []).length;
        totals.removed += (response.removed || []).length;
        cursor = response.next_cursor;
        if (!response.has_more) return { changed: [...changed.values()], removed: [...removed], cursor, totals };
      }
      throw new Error('Card history exceeds the refresh limit; no partial update was saved.');
    } catch (error) {
      if (error.code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || attempt === 2) throw error;
    }
  }
}

async function syncConnection(admin, connection, deadline = Date.now() + 20000) {
  if (connection.status === 'disconnected' || !connection.access_token_ciphertext) return { skipped: true };
  const lockId = crypto.randomUUID();
  const now = new Date().toISOString();
  const claimed = db(await admin.from('financial_card_connections').update({ sync_lock_id: lockId,
    sync_locked_until: new Date(Date.now() + 120000).toISOString() }).eq('id', connection.id).neq('status', 'disconnected')
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now}`).select('*').maybeSingle());
  if (!claimed) return { skipped: true };
  try {
    const accessToken = decryptToken(claimed.access_token_ciphertext);
    if (Date.now() >= deadline) throw new Error('Refresh time limit reached. Retry refresh.');
    const accountResponse = await plaidRequest('/accounts/get', { access_token: accessToken }, process.env, Math.max(1, deadline - Date.now()));
    const accounts = (accountResponse.accounts || [])
      .filter(account => account.balances?.iso_currency_code === 'USD' && ['credit', 'depository'].includes(account.type))
      .map(account => ({ account_id: account.account_id, name: account.name || account.official_name || 'Card account',
        official_name: account.official_name || null, mask: account.mask || null, type: account.type, subtype: account.subtype || null,
        current_balance_cents: account.balances.current == null ? null : cents(account.balances.current),
        available_balance_cents: account.balances.available == null ? null : cents(account.balances.available) }));
    const update = await collectTransactions(accessToken, claimed.sync_cursor, deadline);
    const changes = update.changed.filter(transaction => cents(transaction.amount) !== 0).map(transaction => ({
      transaction_id: transaction.transaction_id, account_id: transaction.account_id, pending_transaction_id: transaction.pending_transaction_id || null,
      date: transaction.date, authorized_date: transaction.authorized_date || null, merchant_name: transaction.merchant_name || null,
      description: transaction.name || transaction.merchant_name || 'Card transaction', amount_cents: cents(transaction.amount),
      currency: transaction.iso_currency_code || 'UNKNOWN', pending: !!transaction.pending,
      category_primary: transaction.personal_finance_category?.primary || null, category_detailed: transaction.personal_finance_category?.detailed || null,
      merchant_key: merchantKey(transaction.merchant_name || transaction.name),
    }));
    db(await admin.rpc('financial_apply_card_sync', { p_connection_id: claimed.id, p_lock_id: lockId, p_accounts: accounts,
      p_changes: changes, p_removed: [...update.removed, ...update.changed.filter(transaction => cents(transaction.amount) === 0).map(transaction => transaction.transaction_id)],
      p_cursor: update.cursor || null }));
    return update.totals;
  } catch (error) {
    await admin.from('financial_card_connections').update({ status: 'error', last_error: String(error.message).slice(0, 1000),
      sync_lock_id: null, sync_locked_until: null, updated_at: new Date().toISOString() }).eq('id', claimed.id)
      .eq('sync_lock_id', lockId).neq('status', 'disconnected');
    throw error;
  }
}

module.exports = { plaidConfig, plaidRequest, encryptToken, decryptToken, merchantKey, syncConnection, collectTransactions };
