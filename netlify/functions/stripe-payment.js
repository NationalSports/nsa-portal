// Netlify serverless function for Stripe payment processing
// Creates PaymentIntents for the coach portal checkout
const stripe = require('stripe');
const crypto = require('crypto');
const { verifyUser, getSupabaseAdmin } = require('./_shared');

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
      // (Stripe replays the original response for ~24h on a matching key).
      const idemKey = body.idempotency_key || crypto.createHash('sha256')
        .update(['nsa_pi', invoice_id || '', Math.round(amount_cents), (customer_email || '').toLowerCase(), new Date().toISOString().slice(0, 10)].join('|'))
        .digest('hex');

      const intent = await client.paymentIntents.create({
        amount: Math.round(amount_cents),
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
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

    if (action === 'refund') {
      // Refund a PaymentIntent — full when amount_cents omitted, else partial.
      // Staff-only: refunds are issued from the admin UIs, never by public payers.
      // This action was previously open to any caller who knew a PaymentIntent id.
      const v = await verifyUser(event);
      if (!v.ok) {
        return { statusCode: v.status, headers: corsHeaders(), body: JSON.stringify({ error: v.error }) };
      }
      const { payment_intent_id, amount_cents } = body;
      if (!payment_intent_id) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'payment_intent_id required' }) };
      }
      const refund = await client.refunds.create({
        payment_intent: payment_intent_id,
        ...(amount_cents ? { amount: Math.round(amount_cents) } : {}),
      });
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
