// Netlify serverless function for Stripe payment processing
// Creates PaymentIntents for the coach portal checkout
const stripe = require('stripe');
const crypto = require('crypto');
const { verifyUser, verifyAdmin, getSupabaseAdmin, reconcileInvoiceFromIntent } = require('./_shared');
const { sendRefundNotice } = require('./_webstoreEmail');

// Dollar formatting for the refund message posted into the order thread — the
// email builds its own via _webstoreEmail's `money`.
const usd = (n) => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Validate requested item links against the DB rows and split the exact refund
// cents across them. The last line receives the rounding remainder, so allocation
// cents always sum exactly to the Stripe refund amount.
const buildRefundItemAllocations = (amountCents, requested, itemRows) => {
  const req = Array.isArray(requested) ? requested.slice(0, 100) : [];
  if (!req.length) return [];
  const byId = new Map((itemRows || []).map((i) => [String(i.id), i]));
  const combined = new Map();
  for (const a of req) {
    const id = String((a && a.item_id) || '').trim();
    const qty = Math.floor(Number(a && a.qty));
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !Number.isFinite(qty) || qty <= 0) {
      throw new Error('Choose a valid item quantity for the refund.');
    }
    combined.set(id, (combined.get(id) || 0) + qty);
  }
  const rows = [...combined.entries()].map(([item_id, qty]) => {
    const item = byId.get(item_id);
    if (!item) throw new Error('A selected refund item is not on this order.');
    const available = Math.max(0, (Number(item.cancelled_qty) || 0) - (Number(item.refunded_qty) || 0));
    if (qty > available) throw new Error(`${item.name || item.sku || 'That item'} only has ${available} cancelled unit${available === 1 ? '' : 's'} awaiting refund.`);
    const unit = Math.max(0, (Number(item.unit_price) || 0) + (Number(item.unit_fundraise) || 0));
    return { item_id, qty, item, weight: unit > 0 ? unit * qty : qty };
  });
  const weightTotal = rows.reduce((n, r) => n + r.weight, 0) || rows.length;
  let assigned = 0;
  return rows.map((r, idx) => {
    const cents = idx === rows.length - 1 ? amountCents - assigned : Math.floor(amountCents * r.weight / weightTotal);
    assigned += cents;
    return { item_id: r.item_id, qty: r.qty, amount: cents / 100 };
  });
};
exports.buildRefundItemAllocations = buildRefundItemAllocations;

// Refunds are normally few, but this guard is money-facing: paginate instead
// of assuming the first 100 rows contain every prior refund on the intent.
const listIntentRefunds = async (client, paymentIntentId, maxPages = 20) => {
  const all = [];
  let startingAfter;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await client.refunds.list({
      payment_intent: paymentIntentId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const rows = (result && result.data) || [];
    all.push(...rows);
    if (!result || !result.has_more || !rows.length) return all;
    startingAfter = rows[rows.length - 1].id;
  }
  throw new Error('Too many prior refunds to verify safely');
};
exports.listIntentRefunds = listIntentRefunds;

// Hard ceiling on a single PaymentIntent — override with STRIPE_MAX_AMOUNT_CENTS.
const MAX_AMOUNT_CENTS = parseInt(process.env.STRIPE_MAX_AMOUNT_CENTS || '', 10) || 5000000; // $50,000

// Find a still-'processing' PaymentIntent overlapping any of realIds within the last
// `days`. Stripe lists newest-first at up to 100/page, so this PAGINATES (bounded)
// instead of trusting page one: an ACH debit settles over 1–4 business days, and on a
// busy week the older in-flight intent — exactly the one the double-debit guard exists
// to find — is the first thing pushed off page 1 by newer volume from every channel
// sharing the Stripe account. maxPages bounds serverless runtime; exported for tests.
const findInFlightIntent = async (client, realIds, { days = 7, maxPages = 20 } = {}) => {
  const gte = Math.floor(Date.now() / 1000) - days * 86400;
  let startingAfter;
  for (let page = 0; page < maxPages; page++) {
    const res = await client.paymentIntents.list({ created: { gte }, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    const data = (res && res.data) || [];
    const hit = data.find((p) => p.status === 'processing' && p.metadata && p.metadata.invoice_id
      && String(p.metadata.invoice_id).split(/[\s,]+/).some((v) => realIds.includes(v)));
    if (hit) return hit;
    if (!res || !res.has_more || !data.length) return null;
    startingAfter = data[data.length - 1].id;
  }
  return null;
};
exports.findInFlightIntent = findInFlightIntent;

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
            // In-flight ACH guard — REAL invoices only (ids that resolved to rows). A
            // bank debit settles in 1–4 business days, and nothing marks the invoice
            // "pending" while it does — the balance still shows open, so a payer
            // returning the next day could start a SECOND real debit for the same
            // invoice. Refuse (any method) while a 'processing' intent overlaps these
            // invoice ids. Scoped inside the invRows branch so a non-invoice
            // identifier (e.g. a legacy webstore slug shared across buyers) can never
            // block one buyer on another's in-flight payment. Paginated 7-day scan
            // (see findInFlightIntent); fail-open on Stripe errors (outer catch) so
            // the check can never block payments outright.
            const realIds = invRows.map((r) => String(r.id));
            const inFlight = await findInFlightIntent(client, realIds);
            if (inFlight) {
              return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'A bank payment for this invoice is already processing (submitted ' + new Date(inFlight.created * 1000).toLocaleDateString('en-US') + '). Bank payments take 1–4 business days to clear, so please don’t pay again — contact NSA if you believe this is an error.' }) };
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
      // Staff-written note for the buyer's email (the compose step in the Manage panel).
      // Bounded and escaped downstream — it is rendered into HTML.
      const customerMessage = String(body.customer_message || '').slice(0, 2000).trim() || null;
      if (!webstore_order_id) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'webstore_order_id required' }) };
      if (!attempt_id) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'attempt_id required' }) };

      const admin = getSupabaseAdmin();
      const { data: orders, error: oErr } = await admin.from('webstore_orders')
        .select('id,total,original_total,refunded_amt,status,stripe_pi_id,payment_mode').eq('id', webstore_order_id).limit(1);
      if (oErr) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: oErr.message }) };
      const order = orders && orders[0];
      if (!order) return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ error: 'Order not found' }) };

      const total = Number(order.original_total != null ? order.original_total : order.total) || 0;
      const already = Number(order.refunded_amt) || 0;
      const remainingCents = Math.round((total - already) * 100);
      let cents = amount_cents != null ? Math.round(Number(amount_cents)) : remainingCents; // default: full remaining
      if (!Number.isFinite(cents) || cents <= 0) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Enter a valid amount.' }) };

      // Detect Stripe money that exists but has not reached our ledger before
      // allowing another refund. New refunds carry their attempt id in Stripe
      // metadata, so the SAME attempt can resume the DB write; a different
      // attempt is blocked until the webhook/retry records the first one.
      let resumedStripeRefund = null;
      if (order.stripe_pi_id) {
        let allStripeRefunds;
        try { allStripeRefunds = await listIntentRefunds(client, order.stripe_pi_id); }
        catch (e) { return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Could not verify prior refunds: ' + e.message }) }; }
        const { data: recorded, error: recordedErr } = await admin.from('webstore_order_refunds')
          .select('stripe_refund_id').eq('order_id', order.id);
        if (recordedErr) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Could not verify the refund ledger: ' + recordedErr.message }) };
        const recordedIds = new Set((recorded || []).map((row) => row.stripe_refund_id).filter(Boolean));
        resumedStripeRefund = allStripeRefunds.find((refund) => refund.metadata
          && refund.metadata.webstore_refund_attempt_id === String(attempt_id)) || null;
        if (resumedStripeRefund && Number(resumedStripeRefund.amount) !== cents) {
          return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'This refund attempt was already used for a different amount.' }) };
        }
        if (resumedStripeRefund && recordedIds.has(resumedStripeRefund.id)) {
          return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({
            ok: true, kind: 'card', stripe_refund_id: resumedStripeRefund.id,
            replayed: true, notified: null,
          }) };
        }
        const anotherUnrecorded = allStripeRefunds.find((refund) => !recordedIds.has(refund.id)
          && (!resumedStripeRefund || refund.id !== resumedStripeRefund.id));
        if (anotherUnrecorded) {
          return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({
            error: 'A prior Stripe refund is still being recorded. Refresh this order before issuing another refund.',
          }) };
        }
      }

      if (!resumedStripeRefund) {
        const expectedCents = Math.round(Number(body.expected_refunded_cents));
        if (!Number.isFinite(expectedCents) || expectedCents < 0) {
          return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'expected_refunded_cents required' }) };
        }
        if (expectedCents !== Math.round(already * 100)) {
          return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'Refund totals changed. Refresh the order before issuing another refund.' }) };
        }
        if (remainingCents <= 0) return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'This order is already fully refunded.' }) };
        if (cents > remainingCents) return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'Amount exceeds the refundable balance.' }) };
      }

      // Item links are optional for a genuine order-level adjustment. When present,
      // each selected quantity must already be cancelled by the transactional item
      // editor; this is what makes report removal and money movement auditable as one
      // chain without letting a browser attach a refund to an unrelated row.
      let refundItems = [];
      const requestedItems = Array.isArray(body.item_allocations) ? body.item_allocations.slice(0, 100) : [];
      if (requestedItems.length) {
        const requestedIds = [...new Set(requestedItems.map((a) => String((a && a.item_id) || '').trim()))];
        if (requestedIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
          return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Choose a valid item for the refund.' }) };
        }
        const { data: itemRows, error: itemErr } = await admin.from('webstore_order_items')
          .select('id,order_id,sku,name,size,color,player_name,player_number,unit_price,unit_fundraise,cancelled_qty,refunded_qty')
          .eq('order_id', order.id).in('id', requestedIds);
        if (itemErr) return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: itemErr.message }) };
        try { refundItems = buildRefundItemAllocations(cents, requestedItems, itemRows || []); }
        catch (e) { return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: e.message }) }; }
      }
      const itemReason = refundItems.length
        ? `Item refund: ${refundItems.reduce((n, a) => n + a.qty, 0)} unit${refundItems.reduce((n, a) => n + a.qty, 0) === 1 ? '' : 's'} across ${refundItems.length} linked line${refundItems.length === 1 ? '' : 's'}`
        : null;
      const refundReason = reason || itemReason;

      let stripeRefundId, kind;
      if (order.stripe_pi_id) {
        kind = 'card';
        if (resumedStripeRefund) stripeRefundId = resumedStripeRefund.id;
        else {
          try {
            const refund = await client.refunds.create(
              {
                payment_intent: order.stripe_pi_id,
                amount: cents,
                metadata: {
                  webstore_order_id: String(order.id),
                  webstore_refund_attempt_id: String(attempt_id),
                },
              },
              { idempotencyKey: 'wsrefund_' + attempt_id }, // same click retried → same Stripe refund
            );
            stripeRefundId = refund.id;
          } catch (e) {
            return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Stripe refund failed: ' + e.message }) };
          }
        }
      } else {
        kind = 'credit'; // team-tab: stable synthetic id so a retried click dedupes
        stripeRefundId = 'credit_' + attempt_id;
      }

      const { data: rpc, error: rErr } = await admin.rpc('apply_webstore_refund', {
        p_order_id: order.id, p_amount: cents / 100, p_kind: kind,
        p_stripe_refund_id: stripeRefundId, p_actor: v.teamMemberId || null, p_reason: refundReason || null,
        p_items: refundItems,
      });
      if (rErr) {
        console.error('[stripe-payment] refund recorded-FAILED for order', order.id, 'stripe_refund', stripeRefundId, '-', rErr.message);
        return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Refund was issued but recording it failed — contact an admin. Ref: ' + stripeRefundId, stripe_refund_id: stripeRefundId }) };
      }
      if (rpc && rpc.ok === false) {
        return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: rpc.error === 'exceeds_total' ? 'Amount exceeds the refundable balance.' : (rpc.error || 'Refund rejected.'), ...rpc }) };
      }

      if (rpc && rpc.duplicate) {
        return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({
          ok: true, kind, stripe_refund_id: stripeRefundId, replayed: true,
          notified: null, item_allocations: refundItems.length, ...rpc,
        }) };
      }

      // Tell the family. Money moved and it's recorded, so from here everything is
      // best-effort: a Brevo or message-insert failure must never turn a completed
      // refund into an error response, or staff would retry it and refund twice.
      // Re-read the order so the notice quotes the post-refund refunded_amt the RPC
      // just wrote, not the stale pre-refund value read above.
      let notified = false;
      let notifyError = null;
      try {
        const { data: fresh } = await admin.from('webstore_orders')
          .select('id,store_id,order_number,buyer_name,buyer_email,total,refunded_amt,payment_mode').eq('id', order.id).limit(1);
        const row = (fresh && fresh[0]) || order;
        // Report what actually happened, not whether an address existed. `notified` used
        // to be `!!row.buyer_email`, which claimed success for an email that may never
        // have left the building — the one thing this notice must not do quietly.
        const notice = await sendRefundNotice(admin, row, { amount: cents / 100, kind, reason: refundReason, message: customerMessage });
        notified = !!(notice && notice.sent);
        if (!notified) {
          notifyError = (notice && notice.reason) || 'unknown';
          console.error('[stripe-payment] refund EMAIL NOT SENT for order', order.id, 'refund', stripeRefundId, '-', notifyError);
        }
        // Mirror it into the order's message thread — the same `messages` rows the
        // Manage-orders panel and the buyer's order page already render — so staff
        // can see at a glance that the family was told, and the family has it in
        // the thread as well as their inbox. No message-notify email here: the
        // refund email above is the notification.
        await admin.from('messages').insert({
          id: 'm' + Date.now() + Math.random().toString(36).slice(2, 7),
          entity_type: 'webstore_order', entity_id: String(order.id),
          author: 'NSA Team', author_id: v.teamMemberId || null,
          // Record what the buyer was actually told, not just that something was sent —
          // the next person on this order needs to read the same words the family did.
          text: `Refund issued: ${usd(cents / 100)}${kind === 'credit' ? ' (credited to the team account)' : ' back to the card on file'}${refundReason ? ` — ${refundReason}` : ''}.`
            + (customerMessage ? `\n\n${notified ? 'Emailed' : 'Message (NOT emailed)'}: ${customerMessage}` : '')
            + (notified ? '' : `\n⚠️ Confirmation email did not send${notifyError ? ` (${notifyError})` : ''}.`),
          ts: new Date().toLocaleString(), dept: 'store', from_customer: false, read_by_staff: true,
        });
      } catch (e) {
        console.error('[stripe-payment] refund notice failed for order', order.id, 'refund', stripeRefundId, '-', e.message);
      }
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, kind, stripe_refund_id: stripeRefundId, notified, notify_error: notifyError, item_allocations: refundItems.length, ...(rpc || {}) }) };
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
          // Pacific, not the function's UTC clock — same reason as reconcileInvoiceFromIntent
          // in _shared.js: an evening refund stamped with tomorrow's date can cross a month end.
          const payDate = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', year: 'numeric' });
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
