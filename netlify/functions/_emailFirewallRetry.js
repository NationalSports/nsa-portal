const crypto = require('crypto');
const { failureKind, isConsumerEmail } = require('../../src/lib/emailRouting');
const TABLE = 'email_firewall_retries';
const enabled = () => process.env.EMAIL_AUTO_FIREWALL_RETRY_ENABLED === 'true';
const normalize = (v) => String(v || '').trim().toLowerCase();
function recipients(payload) {
  return [...new Set(['to', 'cc', 'bcc'].flatMap((key) => {
    const value = payload[key];
    return (Array.isArray(value) ? value : value ? [value] : []).map((r) => normalize(typeof r === 'object' ? r.email : r));
  }).filter(Boolean))];
}
function fingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify([normalize(payload.sender?.email), recipients(payload).sort(), payload.subject])).digest('hex');
}
async function update(admin, id, values) {
  const { error } = await admin.from(TABLE).update({ ...values, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error('Could not save automatic email retry state');
}
async function trackedSend(admin, payload, send) {
  if (!enabled()) return send();
  const now = Date.now();
  const { data, error } = await admin.from(TABLE).insert({
    payload, fingerprint: fingerprint(payload), status: 'prepared',
    expires_at: new Date(now + 48 * 3600000).toISOString(),
    next_check_at: new Date(now + 5 * 60000).toISOString(),
  }).select('id').single();
  if (error || !data) return { status: 503, error: 'Could not prepare delivery monitoring. Nothing was sent; try again.' };
  let result;
  try { result = await send(); }
  catch (e) { result = { status: 502, uncertain: true, error: 'Send outcome unknown. Check provider history before retrying.' }; }
  try {
    const accepted = result.status >= 200 && result.status < 300 && result.messageId;
    await update(admin, data.id, {
      original_message_id: result.messageId || null,
      status: accepted ? String(result.messageId).startsWith('gmail:') ? 'done' : 'pending' : 'review',
      error: accepted ? null : result.error || 'Send outcome unknown',
    });
    return { ...result, automaticRetryAvailable: !!accepted && !String(result.messageId).startsWith('gmail:') };
  } catch (e) {
    // The provider may already have sent it. A bookkeeping failure is NOT a
    // failed send and must never cause an automatic second submission.
    console.error('[email-retry] recording send result failed:', data.id);
    return { ...result, automaticRetryAvailable: false };
  }
}
function retryPlan(payload, events) {
  const allowed = recipients(payload);
  const retry = [], manual = [], delivered = [];
  for (const email of allowed) {
    const own = events.filter((e) => normalize(e.email) === email);
    if (own.some((e) => /delivered|opened|click|proxy_open/i.test(e.event || ''))) { delivered.push(email); continue; }
    // Complaints and opt-outs take precedence over any older firewall event.
    if (own.some((e) => failureKind({ delivery_event: e.event, delivery_reason: e.reason }) === 'suppressed')) { manual.push(email); continue; }
    const permanent = own.filter((e) => /hard.?bounce|blocked|invalid|error/i.test(e.event || ''));
    if (!permanent.length) continue;
    // Require an actual permanent SMTP rejection. Brevo's bare suppression
    // event is insufficient, and temporary/unknown failures never auto-resend.
    const firewall = permanent.find((e) => /hard.?bounce/i.test(e.event || '')
      && failureKind({ delivery_event: e.event, delivery_reason: e.reason }) === 'blocked'
      && /550|5\.7\./i.test(e.reason || ''));
    if (firewall && !isConsumerEmail(email) && email.split('@')[1] !== normalize(payload.sender?.email).split('@')[1] && !own.some((e) => failureKind({ delivery_event: e.event, delivery_reason: e.reason }) === 'dead')) retry.push(email);
    else manual.push(email);
  }
  return { retry, manual, delivered };
}
function retryPayload(payload, emails) {
  // Never resend to successful TO/CC/BCC recipients. Send each failed recipient
  // separately so originally hidden BCC addresses cannot be exposed to others.
  return { ...payload, to: emails.map((email) => ({ email })), cc: [], bcc: [] };
}
async function retryStatus(admin, messageId) {
  if (!enabled()) return null;
  const { data, error } = await admin.from(TABLE).select('id,status,retry_results,retry_recipients,manual_recipients,rejection_events,error,updated_at')
    .eq('original_message_id', messageId).maybeSingle();
  if (error || !data) return null;
  return data;
}
module.exports = { TABLE, enabled, recipients, fingerprint, update, trackedSend, retryPlan, retryPayload, retryStatus };
