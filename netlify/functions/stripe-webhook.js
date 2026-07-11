// Stripe webhook — reconciles webstore orders so a charge can never end up
// without a matching order (e.g. the buyer closed the tab right after paying).
// On payment_intent.succeeded we flip the matching pending order to "paid".
//
// Setup:
//   1. Add STRIPE_WEBHOOK_SECRET (from the Stripe dashboard endpoint) to env.
//   2. In Stripe → Developers → Webhooks, add endpoint:
//        https://<your-site>/.netlify/functions/stripe-webhook
//      subscribed to: payment_intent.succeeded, payment_intent.payment_failed,
//      charge.refunded, charge.dispute.created (payment_failed drives the
//      Team Shop ACH failure path below — without it a bounced ACH order
//      sits in 'pending_payment' forever)
//   Also requires STRIPE_SECRET_KEY, REACT_APP_SUPABASE_URL (or SUPABASE_URL),
//   and SUPABASE_SERVICE_ROLE_KEY.
const stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { sendOrderConfirmation, bumpCouponUse } = require('./_webstoreEmail');
const { reconcileInvoiceFromIntent } = require('./_shared');

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

  const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = (url && key) ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

  try {
    if (evt.type === 'payment_intent.succeeded') {
      const pi = evt.data.object;
      if (sb && pi && pi.id) {
        // Idempotent, and never resurrect a terminal order: only a pending_payment order
        // for this intent flips to paid (a delayed retry must not undo a refund/cancel).
        // SECURITY (audit #1): flip to paid ONLY when the succeeded PI amount matches the order
        // total — the same check webstore-checkout's finalize enforces. Without it, a PI that
        // succeeded for less than the order total would silently auto-flip to paid here.
        const { data: _pend } = await sb.from('webstore_orders')
          .select('id,total').eq('stripe_pi_id', pi.id).eq('status', 'pending_payment').limit(1);
        const _po = _pend && _pend[0];
        if (_po) {
          if (Number(pi.amount) === Math.round((Number(_po.total) || 0) * 100)) {
            await sb.from('webstore_orders').update({ status: 'paid' }).eq('id', _po.id).eq('status', 'pending_payment');
          } else {
            console.error('[stripe-webhook] PI amount != order total — NOT marking paid:', JSON.stringify({ order: _po.id, pi: pi.id, pi_amount: pi.amount, expected_cents: Math.round((Number(_po.total) || 0) * 100) }));
          }
        }
        // Fallback confirmation — only if webstore-checkout's finalize hasn't already
        // claimed it (e.g. the buyer closed the tab right after paying). The flag
        // claim is atomic, so the buyer never gets two emails and the coupon-use
        // counter is bumped exactly once.
        // Only confirm a PAID order — never one whose paid-flip was refused above for an
        // amount mismatch (audit #1). finalize may already have flipped it to paid; this is the
        // backstop for when its own confirmation didn't land.
        const { data: claimed } = await sb.from('webstore_orders')
          .update({ confirmation_sent: true })
          .eq('stripe_pi_id', pi.id).eq('status', 'paid').neq('confirmation_sent', true)
          .select('id,store_id,buyer_email,buyer_name,total,shipping_fee,discount_amt,coupon_code,payment_mode,ship_method,ship_address').limit(1);
        const order = claimed && claimed[0];
        if (order) {
          if (order.coupon_code) await bumpCouponUse(sb, order.store_id, order.coupon_code);
          if (order.buyer_email) await sendOrderConfirmation(sb, order);
        }

        // Team Shop order → production conversion (Stage 7, migration 00196).
        // Best-effort and STRICTLY guarded: webhook processing must never fail
        // because of conversion — the RPC is idempotent (so_id replay + paid
        // re-guard), and CheckoutPage's convert_order call / a staff batch can
        // pick it up later. Only fires for paid, unconverted teamshop orders.
        try {
          const { data: _ts } = await sb.from('webstore_orders')
            .select('id,order_source,so_id,status').eq('stripe_pi_id', pi.id).limit(1);
          const _tso = _ts && _ts[0];
          if (_tso && _tso.order_source === 'teamshop' && !_tso.so_id && _tso.status === 'paid') {
            const { error: convErr } = await sb.rpc('create_teamshop_sales_order', { p_webstore_order_id: _tso.id });
            if (convErr) console.error('[stripe-webhook] teamshop conversion failed (order stays paid; convert_order/staff batch will retry):', convErr.message);
          }
        } catch (e) {
          console.error('[stripe-webhook] teamshop conversion error:', e.message);
        }

        // Coach-portal invoice payments: mark the referenced invoice(s) paid. The portal also calls
        // this server-side right after paying (stripe-payment → finalize_invoice); this webhook is the
        // backstop for when that call never lands (tab closed, or a 3-D Secure redirect). Shared helper,
        // idempotent — the portal call, this one, and Stripe retries can't double-apply the surcharge.
        await reconcileInvoiceFromIntent(sb, pi);
      }
    } else if (evt.type === 'payment_intent.payment_failed') {
      // Team Shop ACH (settle-then-produce): an ACH debit can fail days after
      // the coach confirmed (insufficient funds, closed account, dispute of the
      // debit). The order sat in 'pending_payment' the whole time — it was
      // never converted to a Sales Order (00196/00199 only convert paid /
      // po_verified) — so failing it is pure bookkeeping, not a production
      // recall. Scope guards, in order:
      //   * intents we created with payment_method_types EXACTLY
      //     ['us_bank_account'] (teamshop-checkout place_order_ach). A card
      //     intent (automatic_payment_methods) also fires payment_failed on
      //     every declined attempt while the buyer retries in the open
      //     Payment Element — those must never cancel the order, and their
      //     payment_method_types list is never exactly this one.
      //   * order_source 'teamshop' + status 'pending_payment' only, via a
      //     compare-and-set — a paid/refunded/cancelled order is never touched,
      //     and a redelivered event no-ops (so the reason message below is
      //     written at most once).
      // 'cancelled' is the stack's existing "no money collected" terminal (the
      // exact transition teamshop-po-review's reject uses): excluded from
      // revenue/batching (Webstores.js), refused by the convert guard, labeled
      // 'Cancelled' for the coach, and never resurrected — the succeeded
      // handler above only flips pending_payment orders.
      const pi = evt.data.object;
      const isAchOnly = pi && Array.isArray(pi.payment_method_types)
        && pi.payment_method_types.length === 1 && pi.payment_method_types[0] === 'us_bank_account';
      if (sb && pi && pi.id && isAchOnly) {
        const { data: _rows } = await sb.from('webstore_orders')
          .select('id,order_source,status,buyer_name,so_id').eq('stripe_pi_id', pi.id).limit(1);
        const _ord = _rows && _rows[0];
        if (_ord && _ord.order_source === 'teamshop' && _ord.status === 'pending_payment') {
          const failMsg = (pi.last_payment_error && pi.last_payment_error.message) || 'The bank payment could not be completed.';
          const { data: _claimed } = await sb.from('webstore_orders')
            .update({ status: 'cancelled' })
            .eq('id', _ord.id).eq('status', 'pending_payment')
            .select('id').limit(1);
          if (_claimed && _claimed.length) {
            // Failure reason where staff (Messages center) and the coach (the
            // order's tracker thread) already look — the same messages thread
            // webstore-checkout's loadThread/postMessage use. Best-effort: the
            // cancel above is the money-state fix; a lost message only costs
            // the note, and the Stripe dashboard still has the full story.
            try {
              const now = new Date();
              await sb.from('messages').insert({
                id: 'm' + now.getTime() + Math.random().toString(36).slice(2, 7),
                entity_type: 'webstore_order', entity_id: String(_ord.id),
                so_id: null, author_id: null, author: 'NSA Payments',
                text: 'Bank transfer (ACH) payment failed — the order was cancelled before production. Stripe reason: ' + failMsg + ' The coach can place the order again with another payment method.',
                ts: now.toLocaleString(), dept: 'store',
                tagged_members: [], from_customer: false, read_by_staff: false,
              });
            } catch (e) {
              console.error('[stripe-webhook] ACH failure note failed (order already cancelled):', e.message);
            }
            console.error('[stripe-webhook] teamshop ACH payment failed — order cancelled:', JSON.stringify({ order: _ord.id, pi: pi.id, reason: failMsg }));
          }
        }
      }
    } else if (evt.type === 'charge.refunded') {
      // A refund issued from the Stripe dashboard (or the app). Record each refund
      // against the matching webstore order; apply_webstore_refund dedupes on the
      // Stripe refund id, so app-issued refunds already recorded are no-ops and
      // dashboard-only refunds get captured (keeping refunded_amt/status correct).
      const charge = evt.data.object;
      const piId = charge && charge.payment_intent;
      if (sb && piId) {
        const { data: orders } = await sb.from('webstore_orders').select('id').eq('stripe_pi_id', piId).limit(1);
        const order = orders && orders[0];
        if (order) {
          const refunds = (charge.refunds && charge.refunds.data) || [];
          for (const rf of refunds) {
            await sb.rpc('apply_webstore_refund', {
              p_order_id: order.id, p_amount: (Number(rf.amount) || 0) / 100, p_kind: 'card',
              p_stripe_refund_id: rf.id, p_actor: null, p_reason: rf.reason || 'Stripe refund',
            });
          }
        }
      }
    } else if (evt.type === 'charge.dispute.created') {
      // Chargeback opened. Flag it in the refund ledger (amount 0 — no money math change)
      // and alert staff to halt fulfillment. Idempotent via the 'dispute_<id>' key.
      const dispute = evt.data.object;
      const piId = dispute && dispute.payment_intent;
      if (sb && piId) {
        const { data: orders } = await sb.from('webstore_orders')
          .select('id,store_id,buyer_name,buyer_email,total').eq('stripe_pi_id', piId).limit(1);
        const order = orders && orders[0];
        if (order) {
          await sb.rpc('apply_webstore_refund', {
            p_order_id: order.id, p_amount: 0, p_kind: 'dispute',
            p_stripe_refund_id: 'dispute_' + dispute.id, p_actor: null,
            p_reason: 'Chargeback opened: ' + (dispute.reason || 'unknown'),
          });
          try { await alertStaffOfDispute(order, dispute); } catch (e) { console.warn('[stripe-webhook] dispute alert failed:', e.message); }
        }
      }
    }
  } catch (e) {
    // Don't 500 on a downstream error — that would make Stripe retry forever.
    console.error('[stripe-webhook] reconcile error:', e.message);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

// Best-effort staff alert when a chargeback is opened, so fulfillment can be halted.
async function alertStaffOfDispute(order, dispute) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey) return;
  const to = process.env.STORES_ALERT_EMAIL || 'stores@nationalsportsapparel.com';
  const amt = ((Number(dispute.amount) || 0) / 100).toLocaleString(undefined, { style: 'currency', currency: 'usd' });
  const safe = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const html = `<div style="font-family:Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    <div style="background:#7f1d1d;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;font-size:18px;font-weight:800">⚠️ Chargeback opened</div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:20px">
      <p>A payment dispute was opened for a webstore order — <b>do not ship</b> until resolved.</p>
      <ul style="font-size:14px;line-height:1.6">
        <li>Order: ${safe(order.id)}</li>
        <li>Buyer: ${safe(order.buyer_name)} ${order.buyer_email ? '(' + safe(order.buyer_email) + ')' : ''}</li>
        <li>Order total: ${(Number(order.total) || 0).toLocaleString(undefined, { style: 'currency', currency: 'usd' })}</li>
        <li>Disputed amount: ${amt}</li>
        <li>Reason: ${safe(dispute.reason || 'unknown')}</li>
      </ul>
      <p style="font-size:13px;color:#64748b">Respond in the Stripe dashboard before the evidence deadline.</p>
    </div></div>`;
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Order Portal', email: 'stores@nationalsportsapparel.com' },
      to: [{ email: to }],
      subject: `⚠️ Chargeback opened — webstore order ${order.id}`,
      htmlContent: html,
    }),
  });
}
