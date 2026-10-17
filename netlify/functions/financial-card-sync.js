const { getSupabaseAdmin } = require('./_shared');
const { syncConnection, plaidConfig } = require('./_plaid');

exports.handler = async event => {
  const deadline = Date.now() + 21000;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  try {
    if (!plaidConfig().configured) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Plaid is not configured.' }) };
    const admin = getSupabaseAdmin();
    const cutoff = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const { data: connections, error } = await admin.from('financial_card_connections').select('*').in('status', ['active', 'error'])
      .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`).order('last_synced_at', { nullsFirst: true }).limit(3);
    if (error) throw new Error(error.message);
    const results = await Promise.allSettled((connections || []).map(connection => syncConnection(admin, connection, deadline)));
    const synced = results.filter(result => result.status === 'fulfilled' && !result.value.skipped).length;
    const failed = results.filter(result => result.status === 'rejected').length;
    return { statusCode: 200, headers, body: JSON.stringify({ synced, failed }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Card sync failed.' }) };
  }
};
