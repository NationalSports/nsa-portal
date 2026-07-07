// Shared bits for the marketing send pipeline (campaign-send enqueues, the public
// unsubscribe endpoint opts recipients out, the Brevo webhook suppresses bounces).
// Lives in one module so the HMAC token math can never drift between the link the
// sender embeds and the signature the endpoint verifies — same pattern as
// _followupShared.js.
const crypto = require('crypto');

function unsubSecret() {
  return process.env.MARKETING_UNSUB_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

// Unguessable per-address token: a recipient can only unsubscribe the address
// their own email points at. Keyed on the lowercase address only (not campaign),
// so one click suppresses them from ALL future marketing — that's the intent.
function unsubToken(email) {
  return crypto.createHmac('sha256', unsubSecret())
    .update(String(email || '').trim().toLowerCase())
    .digest('hex').slice(0, 32);
}

function unsubUrl(email, campaignId) {
  const base = process.env.URL || 'https://nsa-portal.netlify.app';
  return `${base}/.netlify/functions/marketing-unsubscribe`
    + `?e=${encodeURIComponent(String(email || '').trim().toLowerCase())}`
    + `&c=${encodeURIComponent(campaignId || '')}`
    + `&sig=${unsubToken(email)}`;
}

// Add an address to the global suppression list (idempotent) and mark any queued
// marketing sends + pending scheduled_emails for it as dead, so a suppression takes
// effect immediately — not just on the next campaign.
async function suppressEmail(admin, email, reason, campaignId) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return { ok: false, error: 'no email' };

  const { error: insErr } = await admin.from('marketing_suppressions')
    .upsert({ email: addr, reason, campaign_id: campaignId || null }, { onConflict: 'email', ignoreDuplicates: true });
  if (insErr) return { ok: false, error: insErr.message };

  // Kill queued (not-yet-sent) marketing emails to this address.
  const { data: queued } = await admin.from('marketing_sends')
    .select('id, scheduled_email_id')
    .eq('status', 'queued')
    .ilike('email', addr);
  const schedIds = (queued || []).map((r) => r.scheduled_email_id).filter(Boolean);
  if (schedIds.length) {
    await admin.from('scheduled_emails').update({ status: 'cancelled' })
      .in('id', schedIds).eq('status', 'pending');
  }
  if ((queued || []).length) {
    await admin.from('marketing_sends')
      .update({ status: reason === 'unsubscribe' ? 'unsubscribed' : 'suppressed' })
      .in('id', queued.map((r) => r.id));
  }
  return { ok: true, cancelled: schedIds.length };
}

module.exports = { unsubToken, unsubUrl, suppressEmail };
