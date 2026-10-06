// Web push to staff devices (the installed NSA Connect app, or any browser a rep
// turned notifications on in). Subscriptions live in push_subscriptions, written
// by push-subscribe. Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (+ optional
// VAPID_SUBJECT). Every caller uses safePush: a push must never fail or slow down
// the thing that triggered it (a payment, an art approval), so errors are logged
// and swallowed.
const webpush = require('web-push');

const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || '';

function configured() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@nationalsportsapparel.com', pub, priv);
  return true;
}

const clip = (s, n) => { const t = String(s == null ? '' : s).trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// payload: { title, body, url, tag }. Returns { sent, removed } (never throws on a bad device).
async function pushToMembers(admin, memberIds, payload, { sender = null, timeoutMs = 8000 } = {}) {
  const ids = [...new Set((memberIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { sent: 0, removed: 0 };
  if (!sender && !configured()) return { sent: 0, removed: 0, skipped: 'push not configured' };
  const send = sender || webpush;
  const { data: subs, error } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth,failures').in('team_member_id', ids);
  if (error) return { sent: 0, removed: 0, skipped: error.message };
  const body = JSON.stringify({
    title: clip(payload.title || 'NSA Connect', 80),
    body: clip(payload.body, 240),
    url: String(payload.url || '/').startsWith('/') ? String(payload.url || '/') : '/',
    tag: payload.tag ? clip(payload.tag, 64) : undefined,
  });
  let sent = 0;
  let removed = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await send.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 24 * 3600, timeout: timeoutMs, urgency: 'high' });
      sent += 1;
      await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), failures: 0 }).eq('id', s.id);
    } catch (e) {
      // 404/410: the device unsubscribed or the app was removed. Anything else: count it
      // and drop the device after repeated failures.
      const gone = e && (e.statusCode === 404 || e.statusCode === 410);
      if (gone || (Number(s.failures) || 0) >= 9) {
        removed += 1;
        await admin.from('push_subscriptions').delete().eq('id', s.id);
      } else {
        await admin.from('push_subscriptions').update({ failures: (Number(s.failures) || 0) + 1 }).eq('id', s.id);
      }
      if (!gone) console.warn('[push] send failed', e && (e.statusCode || e.message));
    }
  }));
  return { sent, removed };
}

// Claim an event key; false when it was already pushed (or the claim failed).
async function claimOnce(admin, key) {
  const { error } = await admin.from('push_sent').insert({ key: String(key).slice(0, 200) });
  return !error;
}

async function safePush(admin, memberIds, payload, opts = {}) {
  try {
    if (!opts.sender && !(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)) return { sent: 0, removed: 0, skipped: 'push not configured' };
    if (opts.onceKey && !(await claimOnce(admin, opts.onceKey))) return { sent: 0, removed: 0, skipped: 'already sent' };
    return await pushToMembers(admin, memberIds, payload, opts);
  }
  catch (e) { console.warn('[push] skipped:', e && e.message); return { sent: 0, removed: 0, skipped: e && e.message }; }
}

// The rep to tell about a customer's activity: the customer's primary rep, else
// its parent account's, else the document creator.
async function repForCustomer(admin, customerId, fallbackId) {
  if (!customerId) return fallbackId || null;
  const { data: c } = await admin.from('customers').select('id,primary_rep_id,parent_id').eq('id', customerId).maybeSingle();
  if (c && c.primary_rep_id) return c.primary_rep_id;
  if (c && c.parent_id) {
    const { data: p } = await admin.from('customers').select('primary_rep_id').eq('id', c.parent_id).maybeSingle();
    if (p && p.primary_rep_id) return p.primary_rep_id;
  }
  return fallbackId || null;
}

module.exports = { vapidPublicKey, pushToMembers, safePush, claimOnce, repForCustomer };
