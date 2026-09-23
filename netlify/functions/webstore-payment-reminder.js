// Hourly: one "finish your order" email to shoppers whose card checkout reached
// the payment screen but was never paid.
//
// OFF until WEBSTORE_PAYMENT_REMINDERS=on is set in Netlify's environment, so
// the wording can be approved before any parent receives it.
//
// Who gets it — every rule must hold:
//   * the order is still pending_payment, 3–48 hours old, and never reminded;
//   * its store is still open (no point nudging after close);
//   * the same buyer hasn't placed a live order in that store since (a retry
//     that went through), and hasn't already been reminded for that store;
//   * Stripe confirms the payment genuinely never happened. A bank (ACH) debit
//     stays pending_payment for days while it settles — those parents DID pay
//     and must never be told otherwise — so only an intent still waiting for a
//     payment method or confirmation qualifies.
// The reminder is claimed atomically (payment_reminder_sent_at) before sending,
// so overlapping runs can't double-send.

const stripe = require('stripe');
const { getSupabaseAdmin } = require('./_shared');
const { sendPaymentReminder } = require('./_webstoreEmail');

const MIN_AGE_H = 3;
const MAX_AGE_H = 48;
const REMINDABLE_PI = new Set(['requires_payment_method', 'requires_confirmation']);
const LIVE_EXCLUDE = new Set(['pending_payment', 'cancelled']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pure decision for one pending order, given its store and that store's other
// orders from the same buyer. Returns a skip reason, or null when it qualifies
// (the Stripe check happens after).
function skipReason(order, store, sameBuyerOrders, now) {
  if (order.status !== 'pending_payment' || order.payment_mode !== 'paid') return 'not-pending-card';
  if (order.payment_reminder_sent_at) return 'already-reminded';
  if (!order.buyer_email || !EMAIL_RE.test(order.buyer_email)) return 'no-email';
  if (!order.stripe_pi_id) return 'no-intent';
  const ageH = (now - new Date(order.created_at).getTime()) / 3600000;
  if (ageH < MIN_AGE_H || ageH > MAX_AGE_H) return 'age';
  if (!store || store.status !== 'open' || (store.close_at && new Date(store.close_at).getTime() <= now)) return 'store-closed';
  const since = new Date(order.created_at).getTime() - 3600000;
  for (const o of sameBuyerOrders) {
    if (o.id === order.id) continue;
    if (!LIVE_EXCLUDE.has(o.status) && new Date(o.created_at).getTime() >= since) return 'bought-since';
    if (o.payment_reminder_sent_at) return 'buyer-already-reminded';
  }
  return null;
}

exports.handler = async () => {
  if (String(process.env.WEBSTORE_PAYMENT_REMINDERS || '').toLowerCase() !== 'on') return { statusCode: 200, body: 'Disabled' };
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return { statusCode: 500, body: 'Stripe not configured' };
  let sb;
  try { sb = getSupabaseAdmin(); } catch (e) { return { statusCode: 500, body: e.message }; }
  const now = Date.now();
  const cols = 'id,store_id,status,payment_mode,buyer_email,buyer_name,created_at,stripe_pi_id,payment_reminder_sent_at';
  const { data: pending, error } = await sb.from('webstore_orders').select(cols)
    .eq('status', 'pending_payment').is('payment_reminder_sent_at', null)
    .gte('created_at', new Date(now - MAX_AGE_H * 3600000).toISOString())
    .lte('created_at', new Date(now - MIN_AGE_H * 3600000).toISOString())
    .order('created_at').limit(200);
  if (error) { console.error('[payment-reminder]', error.message); return { statusCode: 500, body: error.message }; }
  if (!pending || !pending.length) return { statusCode: 200, body: 'Nothing to send' };

  const storeIds = [...new Set(pending.map((o) => o.store_id))];
  const { data: stores } = await sb.from('webstores').select('id,name,slug,status,close_at,primary_color,accent_color,logo_url').in('id', storeIds);
  const storeById = {}; (stores || []).forEach((s) => { storeById[s.id] = s; });

  let sent = 0; const skipped = {};
  const handled = new Set(); // store|email already dealt with this run
  for (const order of pending) {
    const key = order.store_id + '|' + String(order.buyer_email || '').toLowerCase();
    if (handled.has(key)) { skipped['duplicate-in-run'] = (skipped['duplicate-in-run'] || 0) + 1; continue; }
    const { data: sameBuyer } = await sb.from('webstore_orders').select(cols)
      .eq('store_id', order.store_id).ilike('buyer_email', String(order.buyer_email || '').replace(/[%_\\]/g, '\\$&'));
    const reason = skipReason(order, storeById[order.store_id], sameBuyer || [], now);
    if (reason) { skipped[reason] = (skipped[reason] || 0) + 1; continue; }
    let pi;
    try { pi = await stripe(sk).paymentIntents.retrieve(order.stripe_pi_id); }
    catch (e) { skipped['stripe-error'] = (skipped['stripe-error'] || 0) + 1; continue; }
    if (!pi || !REMINDABLE_PI.has(pi.status)) { skipped['intent-' + (pi && pi.status)] = (skipped['intent-' + (pi && pi.status)] || 0) + 1; continue; }
    // Claim first; only the run that flips the stamp sends.
    const { data: claimed } = await sb.from('webstore_orders').update({ payment_reminder_sent_at: new Date().toISOString() })
      .eq('id', order.id).is('payment_reminder_sent_at', null).eq('status', 'pending_payment').select('id');
    if (!claimed || !claimed.length) continue;
    handled.add(key);
    const r = await sendPaymentReminder(sb, order, storeById[order.store_id]);
    if (r.ok) sent++; else console.error('[payment-reminder] send failed', order.id, r.error);
  }
  console.log(`[payment-reminder] sent ${sent}; skipped ${JSON.stringify(skipped)}`);
  return { statusCode: 200, body: `Sent ${sent}` };
};

exports._test = { skipReason };
