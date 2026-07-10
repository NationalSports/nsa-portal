// Team Shop checkout (Stage 6) — coach-facing order placement + card payment.
//
// Actions (POST, Authorization: Bearer <coach Supabase session JWT>):
//   quote_totals — re-prices the cart through quickorder-quote's buildQuote
//     (the SAME pricing path the cart quote used — this function never prices
//     anything itself), recomputes the v2 quote hash, verifies it against the
//     hash the client echoed (409 totals_changed + a fresh quote on drift),
//     then adds server-computed shipping + sales tax. Every dollar the client
//     sees comes from this recomputation; client-sent totals are never read.
//   place_order — same verification chain, then writes the order through the
//     place_webstore_order transaction (00171) against the SEEDED
//     'nationalteamshop' webstores row (plan decision D1: Team Shop orders ARE
//     webstore_orders), creates the Stripe PaymentIntent with the SERVER total
//     (idempotencyKey 'wsorder_'+order.id, same as webstore-checkout), and
//     returns the clientSecret. clientRef idempotency, replay, and rollback
//     compensation are webstore-checkout's own exported implementations.
//
// NO finalize action here — deliberately. After Stripe confirms in the
// browser, the client calls webstore-checkout's `finalize` with
// { orderId, stripePiId }: it matches the order by id + stripe_pi_id and
// verifies the PaymentIntent amount/metadata — it never filters by store, so
// Team Shop orders finalize identically to storefront orders, and the
// stripe-webhook fallback (matched by stripe_pi_id only) shares the same
// atomic confirmation_sent claim. `get_order` (by order UUID) and
// `track_order` (by status_token) are equally store-agnostic, so the existing
// /shop/order/<status_token> tracker works for Team Shop orders unchanged.
//
// Deliberately NOT mirrored from the storefront (made-to-order, coach-only):
// no coupons, no fundraising, no processing fee, no jersey-number claims, and
// no stock holds — p_claims/p_holds go to the RPC empty.
const stripe = require('stripe');
const { corsHeaders, getSupabaseAdmin } = require('./_shared');
const { verifyCoach, coachHasCustomerAccess } = require('./_coachAuth');
// The ONLY pricing + quote-hash implementation (see the normalizeAndHash
// contract in quickorder-quote.js) — never duplicated here.
const qq = require('./quickorder-quote');
// Tax, shipping, rollback, and clientRef idempotency come from the hardened
// storefront checkout — one implementation for both order sources.
const ws = require('./webstore-checkout');

const TEAMSHOP_SLUG = 'nationalteamshop';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (status, error, extra) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error, ...(extra || {}) }) });
const ok = (body) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) });

// The seeded Team Shop store row (migration 00191). Missing row = the
// migration hasn't been applied; checkout must fail loudly, never invent one.
async function loadStore(sb) {
  const { data, error } = await sb.from('webstores').select('*').eq('slug', TEAMSHOP_SLUG).limit(1);
  if (error) return { error: error.message };
  const store = data && data[0];
  if (!store) return { error: 'Team Shop store is not provisioned (migration 00191).' };
  return { store };
}

// Only identity + personalization travel from the client; every price field
// on an echoed quote line is ignored by buildQuote (cleanDeco/decoMeta
// whitelist), so echoing quote.lines back re-prices to the identical quote.
const requestLines = (lines) => (Array.isArray(lines) ? lines : []).map((l) => ({
  product_id: l && l.product_id, sku: l && l.sku, size: l && l.size,
  qty: l && l.qty, color: l && l.color, decorations: (l && l.decorations) || [],
}));

// Re-run the quote and verify the client's hash. Returns { quote } or a
// ready-to-send 4xx response ({ resp }). A hash mismatch means prices/placement
// drifted since the coach saw the cart — bounce with the FRESH quote so the
// client can re-render and re-confirm, mirroring the storefront's
// totals_changed contract.
async function requoteAndVerify(sb, customerId, body) {
  const res = await qq.buildQuote(sb, { customerId, lines: requestLines(body.lines) });
  if (!res.quote) return { resp: bad(res.status, res.error) };
  const quote = res.quote;
  // Belt-and-braces: recompute the hash from the quote lines through the same
  // export the quote itself used — the two MUST agree by construction.
  const { quote_hash } = qq.normalizeAndHash(quote.lines, {
    customer_id: quote.customer_id, tier: quote.tier, subtotal: quote.subtotal,
  });
  if (quote_hash !== quote.quote_hash) return { resp: bad(500, 'Quote hash self-check failed.') };
  if (body.quote_hash && body.quote_hash !== quote.quote_hash) {
    return {
      resp: bad(409, 'Prices were updated while you were shopping — please review your new total and try again.', { code: 'totals_changed', quote }),
    };
  }
  return { quote };
}

// Server-computed money for a verified quote: shipping + sales tax through
// webstore-checkout's own helpers (shipFee/calcTax — seeded store is
// ship_home, so tax sources to the coach's ship-to address; an incomplete
// address quotes $0 tax until it's complete, same as the storefront).
async function computeTotals(store, quote, ship) {
  const shipping = ws.shipFee(store);
  const taxRes = await ws.calcTax(store, ship || {}, quote.subtotal, null);
  const total = r2(quote.subtotal + shipping + taxRes.tax);
  return { subtotal: quote.subtotal, shipping, tax: taxRes.tax, tax_state: taxRes.state || '', total };
}

// ── quote_totals ─────────────────────────────────────────────────────
async function quoteTotals(sb, body, coach) {
  const customerId = String(body.customer_id || '').trim();
  if (!customerId) return bad(400, 'customer_id required');
  const acc = await coachHasCustomerAccess(sb, coach, customerId);
  if (acc.error) return bad(500, acc.error);
  if (!acc.ok) return bad(403, 'Not authorized for this customer');

  const st = await loadStore(sb);
  if (st.error) return bad(500, st.error);

  const rq = await requoteAndVerify(sb, customerId, body);
  if (rq.resp) return rq.resp;

  const totals = await computeTotals(st.store, rq.quote, body.ship);
  return ok({ ok: true, quote: rq.quote, quote_hash: rq.quote.quote_hash, totals });
}

// ── place_order ──────────────────────────────────────────────────────
async function placeOrder(sb, body, coach) {
  const customerId = String(body.customer_id || '').trim();
  if (!customerId) return bad(400, 'customer_id required');
  const acc = await coachHasCustomerAccess(sb, coach, customerId);
  if (acc.error) return bad(500, acc.error);
  if (!acc.ok) return bad(403, 'Not authorized for this customer');

  const st = await loadStore(sb);
  if (st.error) return bad(500, st.error);
  const store = st.store;

  // Same-attempt replay FIRST (double-click / retry after a lost response):
  // webstore-checkout's clientRef machinery, verbatim — a resumed card order
  // gets its own PaymentIntent's clientSecret back, never a duplicate order.
  const clientRef = ws.validClientRef(body.client_ref);
  const dup = await ws.findOrderByClientRef(sb, clientRef);
  if (dup) return ws.replayOrder(dup);

  if (store.status !== 'open') return bad(409, 'The Team Shop isn’t open for orders right now.');

  const contact = body.contact || {};
  if (!String(contact.name || '').trim() || !/.+@.+\..+/.test(String(contact.email || ''))) {
    return bad(400, 'Please provide your name and a valid email.');
  }
  const ship = body.ship || {};
  if (!(ship.street1 && ship.city && ship.state && ship.zip)) {
    return bad(400, 'Please complete your shipping address.');
  }
  if (!body.quote_hash) return bad(400, 'quote_hash required — get a quote first.');

  // Re-price + re-verify the hash. The coach pays exactly the server's
  // recomputation of the quote they approved — nothing the client sent
  // (totals, unit prices, deco prices) is ever used as money.
  const rq = await requoteAndVerify(sb, customerId, body);
  if (rq.resp) return rq.resp;
  const quote = rq.quote;

  const totals = await computeTotals(store, quote, ship);
  if (Math.round(totals.total * 100) < 50) return bad(409, 'Card payments must be at least $0.50.');

  // Order row — webstore-checkout's field set (so every downstream reader:
  // finalize, stripe-webhook, refunds, OrderTrack, emails, reports sees a
  // normal webstore order) plus the Team Shop identity columns from 00191.
  // Storefront-only money fields are explicit zeros, not omissions, so the
  // order row always sums: subtotal + shipping_fee + tax = total.
  const orderRow = {
    store_id: store.id,
    status: 'pending_payment',
    payment_mode: 'paid',
    order_kind: 'individual',
    buyer_name: String(contact.name).trim().slice(0, 120),
    buyer_email: String(contact.email).trim().slice(0, 160),
    buyer_phone: contact.phone ? String(contact.phone).slice(0, 40) : null,
    ship_address: {
      name: String(ship.name || contact.name || '').slice(0, 120),
      street1: ship.street1, street2: ship.street2 || '', city: ship.city, state: ship.state, zip: ship.zip,
    },
    ship_method: store.delivery_mode,
    subtotal: totals.subtotal,
    fundraise_amt: 0,
    shipping_fee: totals.shipping,
    processing_fee: 0,
    tax: totals.tax,
    total: totals.total,
    coupon_code: null,
    discount_amt: 0,
    // Team Shop identity (00191)
    order_source: 'teamshop',
    coach_id: coach.id,
    customer_id: customerId,
    quote_hash: quote.quote_hash,
  };

  // Items: unit_price is the GARMENT sell only; unit_deco_price is the summed
  // per-unit decoration sell; decorations persists the server-priced spec array
  // (type/pricing fields + placement identity + per-deco unit_sell) verbatim
  // from the quote — production reads it to know exactly what to decorate.
  const items = quote.lines.map((l) => ({
    product_id: l.product_id,
    sku: l.sku,
    size: l.size,
    qty: l.qty,
    unit_price: l.unit_sell,
    unit_fundraise: 0,
    unit_deco_price: r2((Array.isArray(l.decorations) ? l.decorations : []).reduce((s, d) => s + (Number(d.unit_sell) || 0), 0)),
    decorations: Array.isArray(l.decorations) ? l.decorations : [],
    name: l.name || null,
    color: l.color || null,
    line_status: 'pending',
  }));

  // ONE transaction (00171): order + items commit together or not at all.
  // Made-to-order: NO number claims, NO stock holds — both arrays empty.
  // No legacy sequential-write fallback here (unlike webstore-checkout):
  // Team Shop launches after 00171/00191, so a missing RPC or column is a
  // provisioning error to surface, not a path to paper over.
  let order = null;
  const rpc = await sb.rpc('place_webstore_order', {
    p_order: clientRef ? { ...orderRow, client_ref: clientRef } : orderRow,
    p_items: items, p_claims: [], p_holds: [], p_hold_minutes: 30,
  });
  if (rpc.error) {
    const msg = rpc.error.message || '';
    if (clientRef && /duplicate|unique/i.test(msg) && /client_ref/.test(msg)) {
      // Concurrent double-submit lost the transaction race — return the winner.
      const winner = await ws.findOrderByClientRef(sb, clientRef);
      if (winner) return ws.replayOrder(winner);
    }
    return bad(502, 'Could not create the order: ' + msg);
  }
  order = rpc.data && rpc.data.order;
  if (!order) return bad(502, 'Could not create the order.');

  // Stripe PaymentIntent with the SERVER total — exactly webstore-checkout's
  // creation (idempotencyKey 'wsorder_'+order.id so a retried create for the
  // same order returns the same intent). Any failure past this point rolls the
  // committed order back via webstore-checkout's own compensation delete.
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) { await ws.rollbackOrder(sb, order.id); return bad(500, 'Card payment isn’t configured.'); }
  let intent;
  try {
    intent = await stripe(sk).paymentIntents.create({
      amount: Math.round(totals.total * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      receipt_email: order.buyer_email || undefined,
      metadata: { webstore_order_id: order.id, store_slug: store.slug, source: 'nsa_teamshop' },
      description: `National Team Shop — order ${order.id}`,
    }, { idempotencyKey: 'wsorder_' + order.id });
  } catch (e) {
    await ws.rollbackOrder(sb, order.id);
    return bad(502, 'Could not start the card payment: ' + e.message);
  }
  const { error: piErr } = await sb.from('webstore_orders').update({ stripe_pi_id: intent.id }).eq('id', order.id);
  if (piErr) { await ws.rollbackOrder(sb, order.id); return bad(502, 'Could not link the payment: ' + piErr.message); }

  return ok({ order: { ...order, stripe_pi_id: intent.id }, totals, clientSecret: intent.client_secret, intentId: intent.id });
}

// ── convert_order (Stage 7) ──────────────────────────────────────────
// Best-effort post-payment trigger for the create_teamshop_sales_order RPC
// (migration 00192): CheckoutPage calls this right after webstore-checkout's
// finalize succeeds. Coach JWT is sufficient here because nothing is trusted
// from the client beyond the order id — this function re-reads the order and
// verifies it is a PAID Team Shop order before invoking the RPC, and the RPC
// re-guards both (plus so_id replay) inside its own transaction, so a replay,
// a race with the stripe-webhook caller, or a hostile order_id is a no-op.
// A failure here is recoverable: the order is already paid, and the webhook
// (or a staff batch) converts it later — hence 502, never data loss.
async function convertOrder(sb, body) {
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return bad(400, 'order_id required');
  const { data, error } = await sb.from('webstore_orders')
    .select('id,status,order_source,so_id').eq('id', orderId).limit(1);
  if (error) return bad(500, error.message);
  const order = data && data[0];
  if (!order) return bad(404, 'Order not found');
  if (order.order_source !== 'teamshop') return bad(409, 'Not a Team Shop order.');
  if (order.so_id) return ok({ ok: true, so_id: order.so_id, replayed: true });
  if (order.status !== 'paid') return bad(409, 'Order is not paid yet.');
  const rpc = await sb.rpc('create_teamshop_sales_order', { p_webstore_order_id: order.id });
  if (rpc.error) {
    // Idempotent by RPC design: the caller may simply retry (or leave it to the
    // stripe-webhook / staff fallback) — a replay returns the existing so_id.
    console.error('[teamshop-checkout] convert_order failed:', rpc.error.message);
    return bad(502, 'Could not create the production order: ' + rpc.error.message);
  }
  return ok({ ok: true, ...(rpc.data || {}) });
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return bad(405, 'Method not allowed');
  try {
    let admin;
    try { admin = getSupabaseAdmin(); } catch (e) { return bad(500, 'Service not configured'); }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

    const v = await verifyCoach(admin, event);
    if (!v.coach) return bad(v.status, v.error);

    if (body.action === 'quote_totals') return await quoteTotals(admin, body, v.coach);
    if (body.action === 'place_order') return await placeOrder(admin, body, v.coach);
    if (body.action === 'convert_order') return await convertOrder(admin, body);
    return bad(400, 'Unknown action.');
  } catch (e) {
    console.error('[teamshop-checkout] error:', e);
    return bad(500, e.message || 'Checkout failed');
  }
};

// ── Test surface ─────────────────────────────────────────────────────
// Exported only for src/__tests__/teamshopCheckout.test.js (same pattern as
// webstore-checkout / quickorder-quote). Netlify invokes `handler`.
module.exports.quoteTotals = quoteTotals;
module.exports.placeOrder = placeOrder;
module.exports.convertOrder = convertOrder;
module.exports.TEAMSHOP_SLUG = TEAMSHOP_SLUG;
