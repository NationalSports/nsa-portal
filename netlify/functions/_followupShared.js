// Shared bits for the follow-up automation pair (followup-sweep.js sends, followup-unsubscribe.js
// opts recipients out). Lives in its own module so the HMAC token math can never drift between
// the link the sweep embeds and the signature the endpoint verifies.
const crypto = require('crypto');

// Tables the automation touches — the unsubscribe endpoint refuses anything else.
const FOLLOWUP_TABLES = new Set(['estimates', 'invoices', 'so_jobs']);

function unsubSecret() {
  // Dedicated secret when configured; the service-role key otherwise (already required to run).
  return process.env.FOLLOWUP_UNSUB_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

// Unguessable per-document token: recipients can only switch off the doc their email points at.
function unsubToken(table, id) {
  return crypto.createHmac('sha256', unsubSecret()).update(`${table}:${id}`).digest('hex').slice(0, 32);
}

function unsubUrl(table, id) {
  const base = process.env.URL || 'https://nsa-portal.netlify.app';
  return `${base}/.netlify/functions/followup-unsubscribe?t=${encodeURIComponent(table)}&id=${encodeURIComponent(id)}&sig=${unsubToken(table, id)}`;
}

module.exports = { FOLLOWUP_TABLES, unsubToken, unsubUrl };
