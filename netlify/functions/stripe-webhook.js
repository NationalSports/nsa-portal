// Stripe webhook — reconciles webstore orders so a charge can never end up
// without a matching order (e.g. the buyer closed the tab right after paying).
// On payment_intent.succeeded we flip the matching pending order to "paid".
//
// Setup:
//   1. Add STRIPE_WEBHOOK_SECRET (from the Stripe dashboard endpoint) to env.
//   2. In Stripe → Developers → Webhooks, add endpoint:
//        https://<your-site>/.netlify/functions/stripe-webhook
//      subscribed to: payment_intent.succeeded
//   Also requires STRIPE_SECRET_KEY, REACT_APP_SUPABASE_URL (or SUPABASE_URL),
//   and SUPABASE_SERVICE_ROLE_KEY.
const stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { sendOrderConfirmation, bumpCouponUse } = require('./_webstoreEmail');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const sk = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sk || !whSecret) return { statusCode: 500, body: 'Stripe webhook not configured' };

  const client = stripe(sk);
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  let evt;
  try {
    evt = client.webhooks.constructEvent(raw, sig, whSecret);
  } catch (e) {
    return { statusCode: 400, body: `Webhook signature verification failed: ${e.message}` };
  }

  try {
    if (evt.type === 'payment_intent.succeeded') {
      const pi = evt.data.object;
      const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key && pi && pi.id) {
        const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
        // Idempotent: only touches an order still awaiting payment for this intent.
        await sb.from('webstore_orders').update({ status: 'paid' }).eq('stripe_pi_id', pi.id).neq('status', 'paid');
        // Fallback confirmation — only if webstore-checkout's finalize hasn't already
        // claimed it (e.g. the buyer closed the tab right after paying). The flag
        // claim is atomic, so the buyer never gets two emails and the coupon-use
        // counter is bumped exactly once.
        const { data: claimed } = await sb.from('webstore_orders')
          .update({ confirmation_sent: true })
          .eq('stripe_pi_id', pi.id).neq('confirmation_sent', true)
          .select('id,store_id,buyer_email,buyer_name,total,shipping_fee,discount_amt,coupon_code,payment_mode,ship_method,ship_address').limit(1);
        const order = claimed && claimed[0];
        if (order) {
          if (order.coupon_code) await bumpCouponUse(sb, order.store_id, order.coupon_code);
          if (order.buyer_email) await sendOrderConfirmation(sb, order);
        }

        // Coach-portal invoice payments carry the invoice id(s) in metadata.invoice_id
        // (stripe-payment.js, source 'nsa_coach_portal'). The webstore reconciliation above
        // never matches these (no webstore_orders row for the intent), so without this block
        // an online invoice payment is only ever recorded by the buyer's in-page success
        // handler — which never runs if a 3-D Secure redirect took them off the page, or the
        // tab closed. Reconcile here so the invoice is marked paid regardless. Idempotent:
        // invoices already settled (or with no open balance) are skipped, so Stripe's webhook
        // retries — and a racing in-page save — can't double-apply the surcharge.
        const invIds = String((pi.metadata && pi.metadata.invoice_id) || '')
          .split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
        if (invIds.length) {
          const { data: invRows, error: invErr } = await sb.from('invoices')
            .select('id,total,paid,cc_fee,status').in('id', invIds);
          if (invErr) {
            console.error('[stripe-webhook] invoice lookup failed:', invErr.message);
          } else if (invRows && invRows.length) {
            // Only invoices that still owe money — this is what makes redelivery idempotent.
            const targets = invRows.filter((r) => r.status !== 'paid' && (Number(r.total) || 0) - (Number(r.paid) || 0) > 0.005);
            const balTotal = targets.reduce((a, r) => a + ((Number(r.total) || 0) - (Number(r.paid) || 0)), 0);
            // Surcharge actually collected = amount captured − sum of open balances, split per invoice.
            const collected = (pi.amount_received != null ? pi.amount_received : (pi.amount || 0)) / 100;
            const feeTotal = Math.max(0, Math.round((collected - balTotal) * 100) / 100);
            const nowIso = new Date().toISOString();
            const payDate = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
            for (const r of targets) {
              const bal = (Number(r.total) || 0) - (Number(r.paid) || 0);
              const fee = balTotal > 0 ? Math.round(feeTotal * (bal / balTotal) * 100) / 100 : 0;
              const newTotal = Math.round(((Number(r.total) || 0) + fee) * 100) / 100; // fold surcharge into total, mirroring the in-app handler
              const { error: updErr } = await sb.from('invoices')
                .update({ total: newTotal, paid: newTotal, cc_fee: Math.round(((Number(r.cc_fee) || 0) + fee) * 100) / 100, status: 'paid', updated_at: nowIso })
                .eq('id', r.id).neq('status', 'paid'); // guard so a racing in-page save can't be double-counted
              if (updErr) { console.error('[stripe-webhook] invoice', r.id, 'update failed:', updErr.message); continue; }
              // Best-effort audit row. invoice_payments has no cc_fee column, so it's omitted.
              // Same ref the app writes ('Stripe <intentId>') so its payment-preservation logic
              // dedupes against this row instead of duplicating it.
              try {
                const ref = 'Stripe ' + pi.id;
                const { data: existing } = await sb.from('invoice_payments').select('id').eq('invoice_id', r.id).eq('ref', ref).limit(1);
                if (!existing || !existing.length) {
                  await sb.from('invoice_payments').insert({ invoice_id: r.id, amount: Math.round((bal + fee) * 100) / 100, method: 'cc', ref, date: payDate });
                }
              } catch (e) { console.warn('[stripe-webhook] invoice_payments audit insert skipped:', e.message); }
            }
          }
        }
      }
    }
  } catch (e) {
    // Don't 500 on a downstream error — that would make Stripe retry forever.
    console.error('[stripe-webhook] reconcile error:', e.message);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
