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

// Partial pay link (invoice_pay_requests). Looked up with the service role by its unguessable
// token; only an OPEN request on an invoice that still owes at least the requested amount counts.
async function loadOpenPayRequest(admin, token) {
  const id = String(token || '').trim();
  if (id.length < 24) return { error: 'This payment link is not valid.' };
  const { data: req, error } = await admin.from('invoice_pay_requests').select('id,invoice_id,amount,status,note').eq('id', id).maybeSingle();
  if (error) return { error: 'Payment link could not be checked. Please try again.' };
  if (!req) return { error: 'This payment link is not valid.' };
  if (req.status !== 'open') return { error: req.status === 'paid' ? 'This payment has already been made — thank you!' : 'This payment link is no longer active. Please contact NSA.', status: req.status };
  const { data: inv } = await admin.from('invoices').select('id,total,paid,status,customer_id').eq('id', req.invoice_id).maybeSingle();
  const balance = inv ? Math.round(((Number(inv.total) || 0) - (Number(inv.paid) || 0)) * 100) / 100 : 0;
  if (!inv || balance + 0.01 < Number(req.amount)) return { error: 'This invoice no longer has that much open — please contact NSA for an updated link.' };
  return { req, inv, balance };
}

// Hard ceiling on a single PaymentIntent — override with STRIPE_MAX_AMOUNT_CENTS.
const MAX_AMOUNT_CENTS = parseInt(process.env.STRIPE_MAX_AMOUNT_CENTS || '', 10) || 5000000; // $50,000
const DEFAULT_CARD_FEE_PCT = 0.029;
const REUSABLE_INTENT_STATUSES = new Set([
  'requires_payment_method', 'requires_confirmation', 'requires_action',
  'requires_capture', 'processing', 'succeeded',
]);

const sortedUnique = (values) => [...new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean))].sort();

async function loadCardFeePct(admin) {
  const { data, error } = await admin.from('app_state').select('value').eq('id', 'portal_settings').maybeSingle();
  if (error) throw new Error('Payment settings verification is unavailable');
  const configured = data && data.value && data.value.ccFeePct;
  const raw = typeof configured === 'number' ? configured : Number.NaN;
  return Number.isFinite(raw) && raw >= 0 && raw <= 0.1 ? raw : DEFAULT_CARD_FEE_PCT;
}

function paymentAttemptKey({ customerIds, invoiceIds, salesOrderIds, payRequestId, amountCents, currency, method }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    version: 1,
    payable_type: 'invoice',
    customer_ids: sortedUnique(customerIds),
    invoice_ids: sortedUnique(invoiceIds),
    sales_order_ids: sortedUnique(salesOrderIds),
    pay_request_id: payRequestId || null,
    amount_cents: amountCents,
    currency,
    method,
  })).digest('hex');
}
exports.paymentAttemptKey = paymentAttemptKey;

function paymentScopeKey({ customerIds, invoiceIds, salesOrderIds, payRequestId, currency }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    version: 1,
    payable_type: 'invoice',
    customer_ids: sortedUnique(customerIds),
    invoice_ids: sortedUnique(invoiceIds),
    sales_order_ids: sortedUnique(salesOrderIds),
    pay_request_id: payRequestId || null,
    currency,
  })).digest('hex');
}
exports.paymentScopeKey = paymentScopeKey;

const rpcRow = (data) => Array.isArray(data) ? data[0] : data;

async function claimPaymentAttempt(admin, facts) {
  const payableKey = paymentAttemptKey(facts);
  const payableScopeKey = paymentScopeKey(facts);
  const { data, error } = await admin.rpc('claim_stripe_payment_attempt', {
    p_payable_scope_key: payableScopeKey,
    p_payable_key: payableKey,
    p_payable_type: 'invoice',
    p_customer_ids: sortedUnique(facts.customerIds),
    p_invoice_ids: sortedUnique(facts.invoiceIds),
    p_sales_order_ids: sortedUnique(facts.salesOrderIds),
    p_pay_request_id: facts.payRequestId || null,
    p_amount_cents: facts.amountCents,
    p_currency: facts.currency,
    p_method: facts.method,
  });
  if (error) throw new Error('Payment attempt could not be reserved: ' + error.message);
  const row = rpcRow(data);
  if (!row || !row.idempotency_key) throw new Error('Payment attempt reservation returned no claim');
  return row;
}

async function attachPaymentIntent(admin, attempt, intent) {
  const { data, error } = await admin.rpc('attach_stripe_payment_intent', {
    p_payable_key: attempt.payable_key,
    p_attempt_version: attempt.attempt_version,
    p_stripe_intent_id: intent.id,
    p_stripe_status: intent.status,
  });
  if (error) throw new Error('Payment intent could not be recorded: ' + error.message);
  return rpcRow(data);
}

function isFullyRefunded(intent) {
  const received = Number(intent && intent.amount_received) || 0;
  const refunded = Number(intent && intent.latest_charge && intent.latest_charge.amount_refunded) || 0;
  return received > 0 && refunded >= received;
}

async function supersedePaymentAttempt(admin, attempt, intent, terminalStatus, facts) {
  const desiredPayableKey = paymentAttemptKey(facts);
  const { data, error } = await admin.rpc('supersede_stripe_payment_attempt', {
    p_payable_scope_key: attempt.payable_scope_key,
    p_prior_intent_id: intent.id,
    p_terminal_status: terminalStatus,
    p_payable_key: desiredPayableKey,
    p_payable_type: 'invoice',
    p_customer_ids: sortedUnique(facts.customerIds),
    p_invoice_ids: sortedUnique(facts.invoiceIds),
    p_sales_order_ids: sortedUnique(facts.salesOrderIds),
    p_pay_request_id: facts.payRequestId || null,
    p_amount_cents: facts.amountCents,
    p_currency: facts.currency,
    p_method: facts.method,
  });
  if (error) throw new Error('Payment attempt could not be advanced: ' + error.message);
  const row = rpcRow(data);
  if (!row || !row.idempotency_key) throw new Error('Payment attempt advancement returned no claim');
  if (row.payable_key !== desiredPayableKey) {
    throw new Error('Another payment replacement won the race; reload before trying again');
  }
  return row;
}

function intentMatchesAttempt(intent, attempt) {
  return !!intent
    && intent.currency === attempt.currency
    && Number(intent.amount) === Number(attempt.amount_cents)
    && String((intent.metadata && intent.metadata.payment_attempt_key) || attempt.payable_key) === attempt.payable_key;
}

// Find every still-actionable PaymentIntent overlapping any of realIds within the last
// `days`. Stripe lists newest-first at up to 100/page, so this PAGINATES (bounded)
// instead of trusting page one: an ACH debit settles over 1–4 business days, and on a
// busy week the older in-flight intent — exactly the one the double-debit guard exists
// to find — is the first thing pushed off page 1 by newer volume from every channel
// sharing the Stripe account. maxPages bounds serverless runtime; exported for tests.
const findInFlightIntents = async (client, realIds, { days = 14, maxPages = 20, admin } = {}) => {
  const found = new Map();
  if (admin) {
    const { data, error } = await admin.from('invoice_payment_intents').select('id').overlaps('invoice_ids', realIds)
      .is('applied_at', null).in('status', ['processing','succeeded']);
    if (error) throw error;
    for (const row of data || []) {
      const current = await client.paymentIntents.retrieve(row.id, { expand: ['latest_charge'] });
      if (REUSABLE_INTENT_STATUSES.has(current.status)) found.set(current.id, current);
    }
  }
  const gte = Math.floor(Date.now() / 1000) - days * 86400;
  let startingAfter;
  for (let page = 0; page < maxPages; page++) {
    const res = await client.paymentIntents.list({ created: { gte }, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    const data = (res && res.data) || [];
    for (const candidate of data) {
      if (REUSABLE_INTENT_STATUSES.has(candidate.status) && candidate.metadata && candidate.metadata.invoice_id
          && String(candidate.metadata.invoice_id).split(/[\s,]+/).some((v) => realIds.includes(v))) {
        found.set(candidate.id, candidate);
      }
    }
    if (!res || !res.has_more || !data.length) return [...found.values()];
    startingAfter = data[data.length - 1].id;
  }
  throw new Error('Bank payment verification exceeded its scan limit');
};
const findInFlightIntent = async (...args) => (await findInFlightIntents(...args))[0] || null;
exports.findInFlightIntent = findInFlightIntent;
exports.findInFlightIntents = findInFlightIntents;

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

    if (action === 'get_pay_request') {
      // PUBLIC: the portal shows "NSA requested $X toward INV-…". Returns only what the payer needs.
      const r = await loadOpenPayRequest(getSupabaseAdmin(), body.pay_request_id);
      if (r.error) return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: r.error, status: r.status || null }) };
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true, pay_request_id: r.req.id, invoice_id: r.req.invoice_id, amount: Number(r.req.amount), balance: r.balance, note: r.req.note || '' }) };
    }

    if (action === 'create_intent') {
      // Public by necessity (coach portal pays without an account), so every
      // identity and dollar used below is reloaded from the database. The caller's
      // idempotency key is deliberately ignored.
      const { amount_cents, customer_name, customer_email, invoice_id, invoice_memo, alpha_tag } = body;
      const method = body.method === 'bank' ? 'bank' : body.method === 'card' ? 'card' : null;
      if (!method) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Choose card or bank payment.' }) };
      const requestedCents = Number(amount_cents);
      if (!Number.isSafeInteger(requestedCents)) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Payment amount must be whole cents.' }) };
      }

      // Partial pay link: the REQUEST sets the price. Fail closed — a request that can't be verified
      // never falls back to the balance checks below.
      const admin = getSupabaseAdmin();
      let payRequest = null;
      let invoiceBaseCents;
      if (body.pay_request_id) {
        const r = await loadOpenPayRequest(admin, body.pay_request_id);
        if (r.error) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: r.error }) };
        invoiceBaseCents = Math.round(Number(r.req.amount) * 100);
        if (String(invoice_id || '').trim() !== String(r.req.invoice_id)) {
          return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Payment amount does not match this payment link. Please reload the page and try again.' }) };
        }
        payRequest = r.req;
      }

      const invoiceIds = sortedUnique(String(invoice_id || '').split(/[\s,]+/));
      if (!invoiceIds.length) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'A valid invoice is required.' }) };
      }
      let invRows;
      let feePct;
      try {
        const [{ data, error }, loadedFeePct] = await Promise.all([
          admin.from('invoices').select('id,total,paid,status,deleted_at,customer_id,so_id').in('id', invoiceIds),
          loadCardFeePct(admin),
        ]);
        if (error) throw error;
        invRows = data || [];
        feePct = loadedFeePct;
      } catch (e) {
        return { statusCode: 503, headers: corsHeaders(), body: JSON.stringify({ error: 'Payment verification is temporarily unavailable. Please try again later; no new payment was started.' }) };
      }
      if (invRows.length !== invoiceIds.length || sortedUnique(invRows.map((r) => r.id)).join('|') !== invoiceIds.join('|')) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'One or more invoices could not be verified.' }) };
      }
      if (invRows.some((row) => row.status === 'void' || row.deleted_at != null)) {
        return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'A void or deleted invoice cannot be paid.' }) };
      }
      const customerIds = sortedUnique(invRows.map((r) => r.customer_id));
      if (!customerIds.length || customerIds.length !== 1) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invoices must belong to one verified customer.' }) };
      }
      if (!payRequest) {
        invoiceBaseCents = Math.round(invRows.reduce(
          (sum, row) => sum + Math.max(0, (Number(row.total) || 0) - (Number(row.paid) || 0)), 0,
        ) * 100);
      }
      if (!Number.isSafeInteger(invoiceBaseCents) || invoiceBaseCents < 50) {
        return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'This invoice no longer has an open payable balance.' }) };
      }
      const feeCents = method === 'card' ? Math.round(invoiceBaseCents * feePct) : 0;
      const serverAmountCents = invoiceBaseCents + feeCents;
      if (serverAmountCents > MAX_AMOUNT_CENTS) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: `Amount exceeds the $${Math.floor(MAX_AMOUNT_CENTS / 100).toLocaleString()} per-payment limit — please contact NSA to pay this invoice.` }) };
      }
      if (requestedCents !== serverAmountCents) {
        return {
          statusCode: 409,
          headers: corsHeaders(),
          body: JSON.stringify({
            error: 'Payment amount changed. Please reload and review the updated total.',
            subtotal: invoiceBaseCents / 100,
            fee: feeCents / 100,
          }),
        };
      }

      const facts = {
        customerIds,
        invoiceIds,
        salesOrderIds: sortedUnique(invRows.map((r) => r.so_id)),
        payRequestId: payRequest ? payRequest.id : null,
        amountCents: serverAmountCents,
        currency: 'usd',
        method,
      };
      let attempt;
      try {
        attempt = await claimPaymentAttempt(admin, facts);
      } catch (e) {
        return { statusCode: 503, headers: corsHeaders(), body: JSON.stringify({ error: e.message + '. No new payment was started.' }) };
      }

      let intent = null;
      const desiredPayableKey = paymentAttemptKey(facts);
      if (!attempt.stripe_intent_id && attempt.payable_key !== desiredPayableKey) {
        return {
          statusCode: 409,
          headers: corsHeaders(),
          body: JSON.stringify({ error: 'Another payment setup for this invoice is still starting. Please wait a moment and try again; no new payment was started.' }),
        };
      }
      if (attempt.stripe_intent_id) {
        intent = await client.paymentIntents.retrieve(attempt.stripe_intent_id, { expand: ['latest_charge'] });
        if (!intentMatchesAttempt(intent, attempt)) throw new Error('Recorded payment intent no longer matches its payable item');
        if (attempt.payable_key !== desiredPayableKey) {
          let terminalStatus;
          if (isFullyRefunded(intent)) terminalStatus = 'refunded';
          else if (intent.status === 'succeeded') terminalStatus = 'succeeded';
          else if (intent.status === 'canceled') terminalStatus = 'canceled';
          else if (['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'].includes(intent.status)) {
            intent = await client.paymentIntents.cancel(intent.id);
            terminalStatus = 'canceled';
          } else {
            throw new Error('A payment for the prior amount is already processing; contact NSA before paying again');
          }
          attempt = await supersedePaymentAttempt(admin, attempt, intent, terminalStatus, facts);
          intent = attempt.stripe_intent_id
            ? await client.paymentIntents.retrieve(attempt.stripe_intent_id, { expand: ['latest_charge'] })
            : null;
        } else if (isFullyRefunded(intent) || intent.status === 'canceled') {
          attempt = await supersedePaymentAttempt(
            admin, attempt, intent, isFullyRefunded(intent) ? 'refunded' : 'canceled', facts,
          );
          intent = attempt.stripe_intent_id
            ? await client.paymentIntents.retrieve(attempt.stripe_intent_id, { expand: ['latest_charge'] })
            : null;
        } else if (!REUSABLE_INTENT_STATUSES.has(intent.status)) {
          throw new Error('The existing payment attempt is not reusable; contact NSA before paying again');
        }
      }

      // Backfill an open/succeeded pre-migration intent when it exactly matches
      // this payable. This prevents a migration rollout from orphaning a debit
      // that Stripe already knows about.
      if (!intent) {
        const listedIntents = await findInFlightIntents(client, invoiceIds, { admin });
        const legacyIntents = await Promise.all(listedIntents.map((listed) => listed.latest_charge === undefined
          ? client.paymentIntents.retrieve(listed.id, { expand: ['latest_charge'] })
          : listed));
        const exactLegacy = [];
        for (const legacy of legacyIntents) {
          const legacyIds = sortedUnique(String(legacy.metadata?.invoice_id || '').split(/[\s,]+/));
          const legacyMethod = legacy.payment_method_types?.length === 1
            ? (legacy.payment_method_types[0] === 'us_bank_account' ? 'bank' : legacy.payment_method_types[0] === 'card' ? 'card' : null)
            : null;
          const exact = Number(legacy.amount) === serverAmountCents && legacy.currency === 'usd'
            && legacyIds.join('|') === invoiceIds.join('|') && legacyMethod === method
            && String(legacy.metadata?.pay_request_id || '') === String(facts.payRequestId || '');
          if (exact) {
            if (!isFullyRefunded(legacy)) exactLegacy.push(legacy);
            continue;
          }
          if (isFullyRefunded(legacy)) continue;
          if (['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'].includes(legacy.status)) {
            await client.paymentIntents.cancel(legacy.id);
            continue;
          }
          throw new Error('An earlier payment for this invoice is still processing or succeeded; contact NSA before paying again');
        }
        if (exactLegacy.length) {
          const rank = (candidate) => candidate.status === 'succeeded' ? 4
            : candidate.status === 'processing' ? 3
              : candidate.status === 'requires_action' ? 2 : 1;
          exactLegacy.sort((a, b) => rank(b) - rank(a));
          intent = exactLegacy[0];
          for (const duplicate of exactLegacy.slice(1)) {
            if (duplicate.status === 'succeeded') {
              throw new Error('Multiple succeeded payments already exist for this invoice; contact NSA for reconciliation');
            }
            try {
              await client.paymentIntents.cancel(duplicate.id);
            } catch (cancelError) {
              throw new Error('An earlier payment intent could not be retired safely; contact NSA before paying again');
            }
          }
          attempt = await attachPaymentIntent(admin, attempt, intent);
        }
      }

      if (!intent) {
        intent = await client.paymentIntents.create({
          amount: serverAmountCents,
          currency: 'usd',
          payment_method_types: method === 'bank' ? ['us_bank_account'] : ['card'],
          metadata: {
            invoice_id: invoiceIds.join(','),
            invoice_memo: invoice_memo || '',
            customer_name: customer_name || '',
            customer_ids: customerIds.join(','),
            alpha_tag: alpha_tag || '',
            source: 'nsa_coach_portal',
            invoice_base_cents: String(invoiceBaseCents),
            payment_attempt_key: attempt.payable_key,
            payment_attempt_version: String(attempt.attempt_version),
            ...(payRequest ? { pay_request_id: payRequest.id } : {}),
          },
          ...(customer_email ? { receipt_email: customer_email } : {}),
          description: `NSA Invoice ${invoiceIds.join(', ')} — ${customer_name || 'Customer'}`,
        }, { idempotencyKey: attempt.idempotency_key });
        attempt = await attachPaymentIntent(admin, attempt, intent);
      }

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          clientSecret: intent.client_secret,
          intentId: intent.id,
          subtotal: invoiceBaseCents / 100,
          fee: feeCents / 100,
          alreadyPaid: intent.status === 'succeeded',
          status: intent.status,
        }),
      };
    }

    if (action === 'update_intent') {
      // No current client calls this legacy action. Mutating an existing intent
      // would invalidate the authoritative amount and durable attempt fingerprint.
      // Method/amount changes must start through create_intent, which retires the
      // prior open intent under the invoice lease before creating a replacement.
      return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: 'Payment details cannot be changed in place. Start a new payment setup.' }) };
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
        intent = await client.paymentIntents.retrieve(payment_intent_id, { expand: ['latest_charge'] });
      } catch (e) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'Payment intent not found' }) };
      }
      if (!intent) {
        return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: false, status: intent ? intent.status : 'not_found' }) };
      }
      let result = { reconciled: [] };
      try {
        result = await reconcileInvoiceFromIntent(getSupabaseAdmin(), intent);
      } catch (e) {
        console.error('[stripe-payment] finalize_invoice reconcile error:', e.message);
        return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ ok: false, error: 'Reconcile failed' }) };
      }
      let invoices = [];
      if (result.reconciled?.length && !result.error) {
        const { data, error } = await getSupabaseAdmin().from('invoices').select('id,total,paid,status,cc_fee').in('id',result.reconciled);
        if (error) throw error;
        invoices = data || [];
      }
      return { statusCode: result.error ? 409 : 200, headers: corsHeaders(), body: JSON.stringify({ ok: intent.status === 'succeeded' && !result.error, status: intent.status, ...result, invoices }) };
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

    if (action === 'invoice_status') {
      const v = await verifyUser(event);
      if (!v.ok) return { statusCode: v.status, headers: corsHeaders(), body: JSON.stringify({ error: v.error }) };
      const id = String(body.invoice_id || '');
      if (!/^INV-[A-Za-z0-9-]+$/.test(id)) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid invoice ID' }) };
      const admin = getSupabaseAdmin();
      const { data: known, error } = await admin.from('invoice_payment_intents').select('id').contains('invoice_ids', [id]);
      if (error) throw error;
      const intents = new Map();
      // Bounded pagination also discovers pre-hotfix and multi-invoice payments.
      let cursor;
      let complete = false;
      const observedAt = new Date().toISOString();
      for (let n = 0; n < 20; n++) {
        const page = await client.paymentIntents.list({ limit: 100, created: { gte: Math.floor(Date.now()/1000)-14*86400 }, ...(cursor ? { starting_after: cursor } : {}) });
        for (const pi of page.data) if (String(pi.metadata?.invoice_id || '').split(/[\s,]+/).includes(id)) intents.set(pi.id, pi);
        if (!page.has_more) { complete = true; break; }
        cursor = page.data[page.data.length-1]?.id;
        if (!cursor) break;
      }
      if (!complete) throw new Error('Payment status scan incomplete; use Stripe verification');
      for (const row of known || []) if (!intents.has(row.id)) intents.set(row.id, await client.paymentIntents.retrieve(row.id));
      for (const pi of intents.values()) await reconcileInvoiceFromIntent(admin, pi, { apply: false, observedAt });
      const { data: payments, error: readError } = await admin.from('invoice_payment_intents')
        .select('id,status,amount_cents,method,submitted_at,applied_at,review_reason').contains('invoice_ids',[id]).order('submitted_at',{ascending:false});
      if (readError) throw readError;
      return { statusCode: 200, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' }, body: JSON.stringify({ payments: payments || [] }) };
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
