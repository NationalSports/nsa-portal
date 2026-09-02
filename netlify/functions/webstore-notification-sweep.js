// Retry worker for durable webstore customer-message and shipment emails.
// Scheduled by Netlify every five minutes. Manual runs require the shared
// internal secret; neither path accepts recipients or message content.

const { createClient } = require('@supabase/supabase-js');
const { drainNotifications } = require('./_webstoreNotifications');

const HEADERS = { 'Content-Type': 'application/json' };

function isScheduled(event) {
  if (String(event && event.headers && event.headers['x-nf-event'] || '').toLowerCase() === 'schedule') return true;
  try { return Boolean(JSON.parse((event && event.body) || '{}').next_run); } catch (_) { return false; }
}

exports.handler = async (event) => {
  if (!isScheduled(event)) {
    const expected = process.env.INTERNAL_FUNCTION_SECRET || '';
    const supplied = String(event && event.headers && event.headers['x-internal-secret'] || '');
    if (!expected || supplied !== expected) {
      return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  const url = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Supabase not configured' }) };
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const result = await drainNotifications(admin, 20);
    if (result.failed) console.error('[webstore-notification-sweep] delivery failures:', result.failed);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(result) };
  } catch (error) {
    console.error('[webstore-notification-sweep] failed:', error.message || error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message || String(error) }) };
  }
};

module.exports.isScheduled = isScheduled;
