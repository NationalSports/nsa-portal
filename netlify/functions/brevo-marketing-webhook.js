// Brevo transactional webhook receiver for marketing sends: keeps the suppression
// list and per-recipient send log honest.
//
//   POST /.netlify/functions/brevo-marketing-webhook?token=<MARKETING_WEBHOOK_TOKEN>
//
// Configure in Brevo → Transactional → Settings → Webhooks with the events:
// delivered, opened, hard_bounce, soft_bounce, blocked, spam, unsubscribed.
// Brevo doesn't sign webhooks, so the URL carries a shared token — FAIL-CLOSED:
// no configured token means every request is rejected (same posture as the
// shipstation-webhook fix).
//
// Reputation-critical mappings → marketing_suppressions (global, immediate):
//   hard_bounce / blocked → 'hard_bounce' | spam → 'complaint' | unsubscribed → 'unsubscribe'
// Nice-to-have mappings → marketing_sends only: delivered → sent, opened → opened_at.

const { getSupabaseAdmin } = require('./_shared');
const { suppressEmail } = require('./_marketingShared');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ok = (body) => ({ statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body) });

const SUPPRESS_REASON = { hard_bounce: 'hard_bounce', blocked: 'hard_bounce', spam: 'complaint', unsubscribed: 'unsubscribe' };
const SEND_STATUS = { hard_bounce: 'bounced', blocked: 'bounced', spam: 'complaint', unsubscribed: 'unsubscribed' };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: JSON_HEADERS, body: '{"error":"POST only"}' };

  const expected = process.env.MARKETING_WEBHOOK_TOKEN;
  const provided = (event.queryStringParameters || {}).token;
  if (!expected || provided !== expected) {
    return { statusCode: 401, headers: JSON_HEADERS, body: '{"error":"unauthorized"}' };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return ok({ ignored: 'bad json' }); }
  // Brevo posts single event objects; tolerate arrays too.
  const events = Array.isArray(payload) ? payload : [payload];

  const admin = getSupabaseAdmin();
  let processed = 0;

  for (const ev of events) {
    const type = String(ev && ev.event || '').toLowerCase();
    const email = String(ev && ev.email || '').trim().toLowerCase();
    const messageId = ev && (ev['message-id'] || ev.messageId) || null;
    if (!type || !email) continue;

    try {
      if (SUPPRESS_REASON[type]) {
        await suppressEmail(admin, email, SUPPRESS_REASON[type], null);
        await admin.from('marketing_sends')
          .update({ status: SEND_STATUS[type], error: ev.reason || null })
          .ilike('email', email)
          .in('status', ['queued', 'sent']);
      } else if (type === 'delivered') {
        let q = admin.from('marketing_sends')
          .update({ status: 'sent', sent_at: new Date().toISOString(), message_id: messageId })
          .ilike('email', email).eq('status', 'queued');
        await q;
      } else if (type === 'opened' || type === 'unique_opened') {
        await admin.from('marketing_sends')
          .update({ opened_at: new Date().toISOString() })
          .ilike('email', email)
          .is('opened_at', null);
      }
      processed++;
    } catch (e) {
      console.error('[brevo-marketing-webhook]', type, email, e.message);
    }
  }

  // Always 200 so Brevo doesn't disable the webhook over transient errors.
  return ok({ ok: true, processed });
};
