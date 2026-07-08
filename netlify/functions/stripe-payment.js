// Netlify serverless function for Stripe payment processing
// Creates PaymentIntents for the coach portal checkout
const stripe = require('stripe');
const crypto = require('crypto');
const { verifyUser, verifyAdmin, getSupabaseAdmin, reconcileInvoiceFromIntent } = require('./_shared');

// Hard ceiling on a single PaymentIntent — override with STRIPE_MAX_AMOUNT_CENTS.
const MAX_AMOUNT_CENTS = parseInt(process.env.STRIPE_MAX_AMOUNT_CENTS || '', 10) || 5000000; // $50,000

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const STRIPE_SK = process.env.STRIPE_SECRET_KEY;
  // Publishable key is non-secret and read at runtime so a stale build can't
  // silently disable payments (build-time REACT_APP_* vars freeze into the bundle).
  const STRIPE_PK = process.env.STRIPE_PUBLISHABLE_KEY || process.env.REACT_APP_STRIPE_PK || '';

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* leave body empty */ }

  // Config probe — safe to call without the secret key so the client can report
  // exactly which piece is missing (publishable vs secret) and pull the live key.
  if (body.action === 'config') {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ publishableKey: STRIPE_PK, hasSecretKey: !!STRIPE_SK, configured: !!STRIPE_PK && !!STRIPE_SK }),
    };
  }

  if (!STRIPE_SK) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Stripe secret key not configured. Add STRIPE_SECRET_KEY to Netlify env vars.' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const client = stripe(STRIPE_SK);

  try {
    const { action } = body;

    if (action === 'create_intent') {
      // Create a PaymentIntent for invoice payment.
      // Public by necessity (coach portal + storefront pay without accounts), so the
      // guardrails live here: floor + ceiling, an idempotency key so client retries
      // can't mint duplicate intents, and — when the ids resolve to real invoices —
      // a server-side cap at the open balance so a tampered client can't set the price.
      const { amount_cents, customer_name, customer_email, invoice_id, invoice_memo, alpha_tag } = body;

      if (!amount_cents || amount_cents < 50) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Amount must be at least $0.50' }) };
      }
      if (amount_cents > MAX_AMOUNT_CENTS) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: `Amount exceeds the $${Math.floor(MAX_AMOUNT_CENTS / 100).toLocaleString()} per-payment limit — please contact NSA to pay this invoice.` }) };
      }

      // Best-effort invoice-balance validation. invoice_id may be a comma-joined list
      // (multi-invoice portal payments) or a webstore slug (no invoice rows — skipped;
      // webstore carts get verified when checkout moves server-side). Fail-open on DB
      // errors so a Supabase blip can't take payments down — the ceiling still applies.
      try {
        const ids = String(invoice_id || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
        if (ids.length) {
          const admin = getSupabaseAdmin();
          const { data: invRows, error: invErr } = await admin.from('invoices').select('id,total,paid').in('id', ids);
          if (invErr) {
            console.warn('[stripe-payment] invoice lookup failed, skipping balance check:', invErr.message);
          } else if (invRows && invRows.length) {
            const balanceCents = Math.round(invRows.reduce((a, r) => a + Math.max(0, (Number(r.total) || 0) - (Number(r.paid) || 0)), 0) * 100);
            // Headroom for the CC surcharge the portal adds on top (3%) + rounding.
            const maxCents = Math.ceil(balanceCents * 1.05) + 100;
            if (balanceCents <= 0 || amount_cents > maxCents) {
              return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Payment amount does not match the open balance for this invoice. Please reload the page and try again.' }) };
            }
          }
        }
      } catch (e) {
        console.warn('[stripe-payment] balance check skipped:', e.message);
      }

      // Same payer + same invoice(s) + same amount on the same day → same intent
      // (Stripe replays the original response for ~24h on a matching key). The leading version token
      // scopes the key to the current create-params; bump it whenever those params change (e.g.
      // payment_method_types) so a same-day retry can't reuse a key whose parameters now differ —
      // Stripe rejects that with "idempotent requests can only be used with the same parameters."
      const idemKey = body.idempotency_key || crypto.createHash('sha256')
        .update(['nsa_pi_v2', body.method || '', invoice_id || '', Math.round(amount_cents), (customer_email || '').toLowerCase(), new Date().toISOString().slice(0, 10)].join('|'))
        .digest('hex');

      const intent = await client.paymentIntents.create({
        amount: Math.round(amount_cents),
        currency: 'usd',
        // The buyer picked card or bank up front (body.method), so restrict the intent to that one
        // method. This hard-disables Link and guarantees the method charged matches the chosen price
        // (card carries the surcharge, bank/ACH does not). Falls back to both if method is unspecified.
        payment_method_types: body.method === 'bank' ? ['us_bank_account'] : body.method === 'card' ? ['card'] : ['card', 'us_bank_account'],
        metadata: {
          invoice_id: invoice_id || '',
          invoice_memo: invoice_memo || '',
          customer_name: customer_name || '',
          alpha_tag: alpha_tag || '',
          source: 'nsa_coach_portal',
        },
        ...(customer_email ? { receipt_email: customer_email } : {}),
        description: `NSA Invoice ${invoice_id || ''} — ${customer_name || 'Customer'}`,
      }, { idempotencyKey: idemKey });

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ clientSecret: intent.client_secret, intentId: intent.id }),
      };
    }

    if (action === 'update_intent') {
      // Re-price an existing (not-yet-confirmed) PaymentIntent — used to drop the 2.9% card surcharge
      // when the buyer selects bank/ACH, which NSA does not surcharge. PUBLIC (the portal is anonymous);
      // safe because the new amount is re-validated against the invoice's open balance + ceiling using
      // the invoice id stored in the intent's OWN metadata (never client-supplied), so it can't be
      // abused to set an arbitrary amount.
      const { intent_id, amount_cents } = body;
      if (!intent_id || !amount_cents || amount_cents < 50) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'intent_id and amount_cents (>= $0.50) required' }) };
      }
      if (amount_cents > MAX_AMOUNT_CENTS) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Amount exceeds the per-payment limit.' }) };
      }
      let intent0;
      try {
        intent0 = await client.paymentIntents.retrieve(intent_id);
      } catch (e) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Payment intent not found' }) };
      }
      // Only adjust before the buyer has confirmed/paid.
      if (!intent0 || (intent0.status !== 'requires_payment_method' && intent0.status !== 'requires_confirmation')) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Payment can no longer be modified.' }) };
      }
      // SECURITY (audit #1): re-pricing is only legitimate for INVOICE PaymentIntents (the ACH
      // surcharge-drop flow), where the new amount is validated against the invoice's open
      // balance using the invoice id in the intent's OWN metadata. A PI with no invoice_id —
      // notably a webstore PI (metadata.webstore_order_id) — has no server-side balance to
      // validate against, so re-pricing it would let a buyer set an arbitrary amount (e.g. $0.50
      // for a $500 order). Refuse. And fail CLOSED: if the balance can't be confirmed, reject
      // rather than accept the client-supplied amount.
      const ids = String((intent0.metadata && intent0.metadata.invoice_id) || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      if (!ids.length || (intent0.metadata && intent0.metadata.webstore_order_id)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'This payment cannot be re-priced.' }) };
      }
      let balanceCents = null;
      try {
        const admin = getSupabaseAdmin();
        const { data: invRows, error: invErr } = await admin.from('invoices').select('id,total,paid').in('id', ids);
        if (!invErr && invRows && invRows.length) {
          balanceCents = Math.round(invRows.reduce((a, r) => a + Math.max(0, (Number(r.total) || 0) - (Number(r.paid) || 0)), 0) * 100);
        }
      } catch (e) { /* balanceCents stays null -> reject below */ }
      const maxCents = balanceCents == null ? 0 : Math.ceil(balanceCents * 1.05) + 100; // headroom for CC surcharge + rounding
      if (balanceCents == null || balanceCents <= 0 || amount_cents > maxCents) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Payment amount does not match the open balance for this invoice.' }) };
      }
      const updated = await client.paymentIntents.update(intent_id, { amount: Math.round(amount_cents) });
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, amount: updated.amount }) };
    }

    if (action === 'finalize_invoice') {
      // Mark the invoice(s) for a just-succeeded payment as paid. PUBLIC by necessity — the coach
      // portal pays without an account and (being anonymous) is RLS-blocked from writing `invoices`
      // itself, so this server-side step is the reliable reconciliation path. It's safe because it
      // trusts only Stripe + our own metadata: it re-fetches the intent, requires status 'succeeded',
      // and only ever settles invoices named in that intent's metadata. Idempotent (see _shared).
      const { payment_intent_id } = body;
      if (!payment_intent_id) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'payment_intent_id required' }) };
      }
      let intent;
      try {
        intent = await client.paymentIntents.retrieve(payment_intent_id);
      } catch (e) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'Payment intent not found' }) };
      }
      if (!intent || intent.status !== 'succeeded') {
        return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: false, status: intent ? intent.status : 'not_found' }) };
      }
      let result = { reconciled: [] };
      try {
        result = await reconcileInvoiceFromIntent(getSupabaseAdmin(), intent);
      } catch (e) {
        console.error('[stripe-payment] finalize_invoice reconcile error:', e.message);
        return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'Reconcile failed' }) };
      }
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, ...result }) };
    }

    if (action === 'refund_webstore_order') {
      // Order-scoped, recorded, atomic refund for a webstore order. Staff-only.
      // Resolves the PaymentIntent from the order (never client-supplied), caps at the
      // remaining balance, issues the Stripe refund with an idempotency key, then records
      // it + increments refunded_amt atomically via apply_webstore_refund (which re-checks
      // the cap under a row lock and dedupes on the refund id). Team-tab orders (no PI)
      // record a credit only.
      const v = await verifyUser(event);
      if (!v.ok) return { statusCode: v.status, headers: corsHeaders(), body: JSON.stringify({ error: v.error }) };
      const { webstore_order_id, amount_cents, reason, attempt_id } = body;
      if (!webstore_order_id) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'webstore_order_id required' }) };
      if (!attempt_id) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'attempt_id required' }) };

      const admin = getSupabaseAdmin();
      const { data: orders, error: oErr } = await admin.from('webstore_orders')
        .select('id,total,refunded_amt,status,stripe_pi_id,payment_mode').eq('id', webstore_order_id).limit(1);
      if (oErr) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: oErr.message }) };
      const order = orders && orders[0];
      if (!order) return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ error: 'Order not found' }) };

      const total = Number(order.total) || 0;
      const already = Number(order.refunded_amt) || 0;
      const remainingCents = Math.round((total - already) * 100);
      if (remainingCents <= 0) return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'This order is already fully refunded.' }) };
      let cents = amount_cents != null ? Math.round(Number(amount_cents)) : remainingCents; // default: full remaining
      if (!Number.isFinite(cents) || cents <= 0) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Enter a valid amount.' }) };
      if (cents > remainingCents) return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'Amount exceeds the refundable balance.' }) };

      let stripeRefundId, kind;
      if (order.stripe_pi_id) {
        kind = 'card';
        try {
          const refund = await client.refunds.create(
            { payment_intent: order.stripe_pi_id, amount: cents },
            { idempotencyKey: 'wsrefund_' + attempt_id }, // same click retried → same Stripe refund
          );
          stripeRefundId = refund.id;
        } catch (e) {
          return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Stripe refund failed: ' + e.message }) };
        }
      } else {
        kind = 'credit'; // team-tab: stable synthetic id so a retried click dedupes
        stripeRefundId = 'credit_' + attempt_id;
      }

      const { data: rpc, error: rErr } = await admin.rpc('apply_webstore_refund', {
        p_order_id: order.id, p_amount: cents / 100, p_kind: kind,
        p_stripe_refund_id: stripeRefundId, p_actor: v.teamMemberId || null, p_reason: reason || null,
      });
      if (rErr) {
        console.error('[stripe-payment] refund recorded-FAILED for order', order.id, 'stripe_refund', stripeRefundId, '-', rErr.message);
        return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Refund was issued but recording it failed — contact an admin. Ref: ' + stripeRefundId, stripe_refund_id: stripeRefundId }) };
      }
      if (rpc && rpc.ok === false) {
        return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: rpc.error === 'exceeds_total' ? 'Amount exceeds the refundable balance.' : (rpc.error || 'Refund rejected.'), ...rpc }) };
      }
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, kind, stripe_refund_id: stripeRefundId, ...(rpc || {}) }) };
    }

    if (action === 'refund') {
      // Low-level manual refund by PaymentIntent id (e.g. coach-portal invoice payments).
      // ADMIN-ONLY now: it's unscoped and unrecorded, so it's an escape hatch, not the
      // normal path. Webstore-order refunds must use refund_webstore_order (recorded + capped).
      const v = await verifyAdmin(event);
      if (!v.ok) {
        return { statusCode: v.status, headers: corsHeaders(), body: JSON.stringify({ error: v.error }) };
      }
      const { payment_intent_id, amount_cents, attempt_id, invoice_id } = body;
      if (!payment_intent_id) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'payment_intent_id required' }) };
      }
      // Idempotency (same pattern as refund_webstore_order above): without a key, a retried or
      // double-clicked request double-refunds — Stripe treats each refunds.create as new money out.
      if (!attempt_id) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'attempt_id required' }) };
      }
      const refund = await client.refunds.create(
        {
          payment_intent: payment_intent_id,
          ...(amount_cents ? { amount: Math.round(amount_cents) } : {}),
        },
        { idempotencyKey: 'adminrefund_' + attempt_id }, // same attempt retried → same Stripe refund
      );
      // Best-effort audit row so the refund shows on the invoice's payment history instead of
      // being invisible ("unrecorded escape hatch"). Negative amount, deduped by ref — mirrors
      // reconcileInvoiceFromIntent's invoice_payments insert in _shared.js.
      if (invoice_id) {
        try {
          const admin = getSupabaseAdmin();
          const ref = 'Refund ' + refund.id;
          const payDate = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
          const { data: existing } = await admin.from('invoice_payments').select('id').eq('invoice_id', invoice_id).eq('ref', ref).limit(1);
          if (!existing || !existing.length) {
            await admin.from('invoice_payments').insert({ invoice_id, amount: -(refund.amount / 100), method: 'cc', ref, date: payDate });
          }
        } catch (e) { /* audit row is best-effort — the refund itself already succeeded */ }
      }
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ id: refund.id, status: refund.status, amount: refund.amount }) };
    }

    if (action === 'get_intent') {
      // Retrieve intent status (for verification after payment). Staff-only — exposes
      // payer metadata and card last4; no public flow uses it.
      const v = await verifyUser(event);
      if (!v.ok) {
        return { statusCode: v.status, headers: corsHeaders(), body: JSON.stringify({ error: v.error }) };
      }
      const { intent_id } = body;
      if (!intent_id) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'intent_id required' }) };
      }
      const intent = await client.paymentIntents.retrieve(intent_id);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          status: intent.status,
          amount: intent.amount,
          metadata: intent.metadata,
          payment_method: intent.payment_method_types,
          last4: intent.charges?.data?.[0]?.payment_method_details?.card?.last4 || null,
          brand: intent.charges?.data?.[0]?.payment_method_details?.card?.brand || null,
        }),
      };
    }

    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Unknown action. Use create_intent or get_intent.' }) };
  } catch (error) {
    console.error('Stripe error:', error.message);
    return { statusCode: error.statusCode || 500, headers: corsHeaders(), body: JSON.stringify({ error: error.message }) };
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}
