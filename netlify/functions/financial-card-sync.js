const { getSupabaseAdmin } = require('./_shared');
const { syncConnection, plaidConfig } = require('./_plaid');

exports.handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  try {
    if (!plaidConfig().configured) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Plaid is not configured.' }) };
    const admin = getSupabaseAdmin();
    const cutoff = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const { data: connections, error } = await admin.from('financial_card_connections').select('*').in('status', ['active', 'error'])
      .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`);
    if (error) throw new Error(error.message);
    let synced = 0, failed = 0;
    for (const connection of connections || []) {
      try { await syncConnection(admin, connection); synced++; }
      catch (_) { failed++; }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ synced, failed }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Card sync failed.' }) };
  }
};
