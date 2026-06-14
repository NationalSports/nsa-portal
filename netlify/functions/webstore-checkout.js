// Server-side storefront checkout — the browser never decides a price again.
//
// Actions (POST, public by design — shoppers have no accounts):
//   place_order — re-prices the cart from webstore_products/webstore_bundle_items,
//     validates stock + coupon, then transactionally inserts the order, its items,
//     and jersey-number claims (full rollback on any failure). For card orders it
//     also creates the Stripe PaymentIntent — with the SERVER total — and returns
//     the clientSecret. For team-tab orders it sends the confirmation email.
//   finalize — after Stripe confirms in the browser: verifies the PaymentIntent
//     (succeeded + amount matches the order + metadata matches), flips the order
//     to paid, bumps the coupon counter, and sends the confirmation email (atomic
//     confirmation_sent claim — the stripe-webhook fallback uses the same claim,
//     so the buyer never gets two emails).
//
// This replaces the old client-side placeOrder() in src/storefront/Storefront.js,
// which trusted cart prices from localStorage, never checked the items insert,
// left paid orphan orders on number conflicts, and raced the coupon counter.
const stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { sendOrderConfirmation, bumpCouponUse } = require('./_webstoreEmail');

const HEADERS = { 'Content-Type': 'application/json' };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (status, error, extra) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify({ error, ...(extra || {}) }) });

function getSb() {
  const url = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── Server-side cart pricing ─────────────────────────────────────────
// Client lines carry only identity + personalization; every dollar figure is
// looked up fresh. Returns { lines, subtotal, fundraise } or { error }.
async function priceCart(sb, store, cart) {
  if (!Array.isArray(cart) || !cart.length) return { error: 'Cart is empty' };
  if (cart.length > 60) return { error: 'Cart too large' };
  const wids = [...new Set(cart.map((l) => l && l.webstore_product_id).filter(Boolean))];
  if (!wids.length) return { error: 'Cart is empty' };
  const { data: wprods, error: wpErr } = await sb.from('webstore_products').select('*').eq('store_id', store.id).in('id', wids);
  if (wpErr) return { error: 'Could not load products: ' + wpErr.message };
  const byId = {}; (wprods || []).forEach((p) => { byId[p.id] = p; });
  const bundleIds = (wprods || []).filter((p) => p.kind === 'bundle').map((p) => p.id);
  let bundleItems = [];
  if (bundleIds.length) {
    const { data: bi, error: biErr } = await sb.from('webstore_bundle_items').select('*').in('bundle_id', bundleIds).order('sort_order');
    if (biErr) return { error: 'Could not load bundle items: ' + biErr.message };
    bundleItems = bi || [];
  }

  const lines = [];
  let subtotal = 0, fundraise = 0;
  for (const l of cart) {
    const wp = byId[l && l.webstore_product_id];
    if (!wp || wp.active === false) return { error: 'An item in your cart is no longer available — please refresh the store.' };
    const unitPrice = r2(wp.retail_price);
    const fundAmt = r2(wp.fundraise_amount);

    if (wp.kind === 'bundle') {
      const comps = bundleItems.filter((b) => b.bundle_id === wp.id);
      const clientComps = Array.isArray(l.components) ? l.components : [];
      // Components were built in sort_order — match by position, verify identity.
      if (clientComps.length !== comps.length) return { error: 'Package contents changed — please re-add it to your cart.' };
      let nameExtra = 0;
      const outComps = comps.map((c, i) => {
        const cc = clientComps[i] || {};
        if ((cc.product_id || null) !== (c.product_id || null)) return null;
        if (c.size_required !== false && !(cc.size || '').trim()) return undefined;
        const pname = c.takes_name ? String(cc.player_name || '').trim().slice(0, 40) : '';
        const pnum = c.takes_number ? String(cc.player_number || '').trim().slice(0, 4) : '';
        if (c.takes_number && !pnum) return undefined;
        if (c.takes_name && pname) nameExtra += r2(c.name_upcharge);
        return { product_id: c.product_id, sku: c.sku, size: (cc.size || '').trim() || null, player_name: pname || null, player_number: pnum || null, name: cc.name || null, image: cc.image || null };
      });
      if (outComps.some((c) => c === null)) return { error: 'Package contents changed — please re-add it to your cart.' };
      if (outComps.some((c) => c === undefined)) return { error: 'A package in your cart is missing a size or number — please re-add it.' };
      const lineUnit = r2(unitPrice + fundAmt + nameExtra);
      subtotal += unitPrice;
      fundraise += r2(fundAmt + nameExtra);
      lines.push({ kind: 'bundle', wp, qty: 1, unit_price: unitPrice, fundraise: fundAmt, name_extra: r2(nameExtra), line_total: lineUnit, components: outComps, name: wp.display_name, image: wp.image_url });
    } else {
      const qty = Math.min(100, Math.max(1, parseInt(l.qty, 10) || 1));
      const pname = wp.takes_name ? String(l.player_name || '').trim().slice(0, 40) : '';
      const pnum = wp.takes_number ? String(l.player_number || '').trim().slice(0, 4) : '';
      if (wp.takes_number && !pnum) return { error: 'An item in your cart is missing a jersey number — please re-add it.' };
      const nameExtra = pname ? r2(wp.name_upcharge) : 0;
      subtotal += r2(unitPrice * qty);
      fundraise += r2((fundAmt + nameExtra) * qty);
      lines.push({ kind: 'single', wp, qty, size: (l.size || '').trim() || null, unit_price: unitPrice, fundraise: fundAmt, name_extra: nameExtra, line_total: r2((unitPrice + fundAmt + nameExtra) * qty), player_name: pname || null, player_number: pnum || null, name: wp.display_name, color: l.color ? String(l.color).slice(0, 60) : null, image: wp.image_url });
    }
  }
  return { lines, subtotal: r2(subtotal), fundraise: r2(fundraise) };
}

// Mirrors the storefront's verifyStock(): on-hand + vendor stock per size, with
// incoming/ETA items allowed as backorders. Read through the storefront view.
async function checkStock(sb, store, lines) {
  const singles = lines.filter((l) => l.kind === 'single' && l.size);
  if (!singles.length) return null;
  const ids = [...new Set(singles.map((l) => l.wp.id))];
  const { data, error } = await sb.from('webstore_storefront_products')
    .select('webstore_product_id,name,size_stock,vendor_size_stock,vendor_on_hand,on_order_qty,earliest_eta,vendor_eta')
    .eq('store_id', store.id).in('webstore_product_id', ids);
  if (error) return null; // parity with the client: don't block checkout on a lookup failure
  const byId = {}; (data || []).forEach((p) => { byId[p.webstore_product_id] = p; });
  const need = {}; singles.forEach((l) => { const k = l.wp.id + '|' + l.size; need[k] = (need[k] || 0) + l.qty; });
  const short = [];
  Object.entries(need).forEach(([k, q]) => {
    const [wid, size] = k.split('|'); const p = byId[wid]; if (!p) return;
    const incoming = (Number(p.on_order_qty) > 0) || !!p.earliest_eta || !!p.vendor_eta;
    if (incoming) return; // backorder allowed
    const avail = (Number((p.size_stock || {})[size]) || 0) + (Number((p.vendor_size_stock || {})[size]) || 0);
    if (avail < q) short.push(`${p.name || 'item'} (size ${size})`);
  });
  if (short.length) return `Sorry — these just sold out while you were shopping: ${short.join(', ')}. Please remove or change them and try again.`;
  return null;
}

// Enforce the store's allowed jersey-number range (configured per store but
// previously unchecked — a tampered or stale cart could submit any number).
function checkNumberRange(store, lines) {
  const min = Number.isFinite(+store.number_min) ? +store.number_min : 0;
  const max = Number.isFinite(+store.number_max) ? +store.number_max : 99;
  const nums = [];
  lines.forEach((l) => {
    if (l.kind === 'bundle') (l.components || []).forEach((c) => { if (c.player_number) nums.push(c.player_number); });
    else if (l.player_number) nums.push(l.player_number);
  });
  for (const raw of nums) {
    const v = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(v) || v < min || v > max) return `Number ${raw} is outside this store's allowed range (${min}–${max}). Please choose a number in range.`;
  }
  return null;
}

async function loadCoupon(sb, store, code) {
  if (!code || !String(code).trim()) return { coupon: null };
  const { data } = await sb.from('webstore_coupons').select('*').eq('store_id', store.id).ilike('code', String(code).trim()).limit(1);
  const c = data && data[0];
  if (!c || !c.active) return { error: 'That code isn’t valid for this store.' };
  if (c.expires_at && new Date(c.expires_at) < new Date(new Date().toDateString())) return { error: 'That code has expired.' };
  if (c.max_uses != null && (c.used_count || 0) >= c.max_uses) return { error: 'That code has already been used.' };
  return { coupon: c };
}

const shipFee = (store) => store.delivery_mode === 'ship_home' ? r2(store.flat_shipping) : 0;

function couponDiscount(coupon, cartTotal, shipping) {
  if (!coupon || coupon.kind !== 'percent') return 0;
  const base = cartTotal + (coupon.cover_shipping !== false ? (Number(shipping) || 0) : 0);
  return r2(base * (Number(coupon.value) || 0) / 100);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return bad(405, 'POST only');
  const sb = getSb();
  if (!sb) return bad(500, 'Supabase not configured');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

  try {
    if (body.action === 'place_order') return await placeOrder(sb, body);
    if (body.action === 'finalize') return await finalize(sb, body);
    if (body.action === 'check_coupon') return await checkCoupon(sb, body);
    if (body.action === 'get_order') return await getOrder(sb, body);
    if (body.action === 'track_order') return await trackOrder(sb, body);
    if (body.action === 'update_ship') return await updateShip(sb, body);
    return bad(400, 'Unknown action.');
  } catch (e) {
    console.error('[webstore-checkout] error:', e);
    return bad(500, e.message || 'Checkout failed');
  }
};

async function placeOrder(sb, body) {
  const { storeSlug, cart, buyer, ship, payMode, couponCode, expectedTotalCents } = body;

  const { data: stores, error: stErr } = await sb.from('webstores').select('*').eq('slug', String(storeSlug || '')).limit(1);
  if (stErr) return bad(500, stErr.message);
  const store = stores && stores[0];
  if (!store) return bad(404, 'Store not found');
  if (store.status !== 'open') return bad(409, 'This store isn’t open for orders right now.');

  if (!buyer || !String(buyer.name || '').trim() || !/.+@.+\..+/.test(String(buyer.email || ''))) return bad(400, 'Please provide your name and a valid email.');
  const needAddr = store.delivery_mode === 'ship_home';
  if (needAddr && !(ship && ship.street1 && ship.city && ship.state && ship.zip)) return bad(400, 'Please complete your shipping address.');

  const priced = await priceCart(sb, store, cart);
  if (priced.error) return bad(409, priced.error);

  const numErr = checkNumberRange(store, priced.lines);
  if (numErr) return bad(409, numErr);

  const stockErr = await checkStock(sb, store, priced.lines);
  if (stockErr) return bad(409, stockErr);

  const coup = await loadCoupon(sb, store, couponCode);
  if (coup.error) return bad(409, coup.error);
  const coupon = coup.coupon;

  const cartTotal = r2(priced.subtotal + priced.fundraise);
  const shipping = coupon && coupon.kind === 'free_shipping' ? 0 : shipFee(store);
  const discount = couponDiscount(coupon, cartTotal, shipping);
  const total = Math.max(0, r2(cartTotal + shipping - discount));
  const totals = { subtotal: priced.subtotal, fundraise: priced.fundraise, shipping, discount, total };

  // If the client's displayed total drifted from the server's (stale price,
  // tampered cart), bounce with the real numbers instead of silently charging
  // a different amount than the shopper saw.
  if (expectedTotalCents != null && Math.abs(Math.round(total * 100) - Math.round(Number(expectedTotalCents))) > 1) {
    return bad(409, 'Prices were updated while you were shopping — please review your total and try again.', { code: 'totals_changed', totals });
  }

  let mode = payMode === 'paid' ? 'paid' : 'unpaid';
  if (total <= 0) mode = 'unpaid'; // fully covered by a code → no card
  const allowPaid = store.payment_mode === 'paid' || store.payment_mode === 'either';
  const allowUnpaid = store.payment_mode === 'unpaid' || store.payment_mode === 'either';
  if (mode === 'paid' && !allowPaid) return bad(409, 'Card payment isn’t enabled for this store.');
  if (mode === 'unpaid' && total > 0 && !allowUnpaid) return bad(409, 'This store requires card payment.');
  if (mode === 'paid' && Math.round(total * 100) < 50) return bad(409, 'Card payments must be at least $0.50 — use the team tab for this order.');

  // ── Insert order + items + number claims, rolling back everything on failure ──
  const { data: order, error: ordErr } = await sb.from('webstore_orders').insert({
    store_id: store.id, status: mode === 'paid' ? 'pending_payment' : 'unpaid', payment_mode: mode, order_kind: 'individual',
    buyer_name: String(buyer.name).trim().slice(0, 120), buyer_email: String(buyer.email).trim().slice(0, 160), buyer_phone: buyer.phone ? String(buyer.phone).slice(0, 40) : null,
    ship_address: needAddr ? { name: (ship.name || buyer.name || '').slice(0, 120), street1: ship.street1, street2: ship.street2 || '', city: ship.city, state: ship.state, zip: ship.zip } : null,
    ship_method: store.delivery_mode,
    subtotal: priced.subtotal, fundraise_amt: priced.fundraise, shipping_fee: shipping, total,
    coupon_code: coupon ? coupon.code : null, discount_amt: discount,
  }).select().single();
  if (ordErr) return bad(502, 'Could not create the order: ' + ordErr.message);

  const rollback = async () => {
    try {
      await sb.from('webstore_number_claims').delete().eq('order_id', order.id);
      await sb.from('webstore_order_items').delete().eq('order_id', order.id);
      await sb.from('webstore_orders').delete().eq('id', order.id);
    } catch (e) { console.error('[webstore-checkout] rollback failed for order', order.id, e.message); }
  };

  const items = [];
  for (const l of priced.lines) {
    if (l.kind === 'bundle') {
      const bref = require('crypto').randomUUID();
      items.push({ order_id: order.id, product_id: null, sku: null, size: null, qty: 1, unit_price: l.unit_price, unit_fundraise: r2(l.fundraise + l.name_extra), player_name: null, player_number: null, bundle_ref: bref, bundle_product_id: l.wp.id, is_bundle_parent: true, name: l.name || null, image_url: l.image || null, line_status: 'pending' });
      l.components.forEach((c) => items.push({ order_id: order.id, product_id: c.product_id, sku: c.sku, size: c.size, qty: 1, unit_price: 0, unit_fundraise: 0, player_name: c.player_name, player_number: c.player_number, bundle_ref: bref, bundle_product_id: l.wp.id, is_bundle_parent: false, name: c.name, image_url: c.image, line_status: 'pending' }));
    } else {
      items.push({ order_id: order.id, product_id: l.wp.product_id, sku: l.wp.sku, size: l.size, qty: l.qty, unit_price: l.unit_price, unit_fundraise: r2(l.fundraise + l.name_extra), player_name: l.player_name, player_number: l.player_number, name: l.name || null, color: l.color, image_url: l.image || null, line_status: 'pending' });
    }
  }
  const { error: itemErr } = await sb.from('webstore_order_items').insert(items);
  if (itemErr) { await rollback(); return bad(502, 'Could not save your order items: ' + itemErr.message); }

  if (store.number_unique) {
    // A number is one-per-player across the store. Within one checkout the same
    // number legitimately repeats across a single player's bundle components
    // (jersey + shorts share #10), so group by player identity — but assigning
    // one number to two DIFFERENT players violates the unique rule and is caught
    // here rather than silently collapsing to a single claim (which used to let
    // two kids share #10). Claims record the player's name, not the buyer's.
    const numbered = items.filter((i) => !i.is_bundle_parent && i.player_number);
    const identsByNum = {}; // number -> Set(player identity)
    const nameByNum = {};   // number -> player name to record on the claim
    numbered.forEach((i) => {
      const num = String(i.player_number);
      const ident = (i.player_name && i.player_name.trim().toLowerCase()) || ('grp:' + (i.bundle_ref || i.product_id || i.sku || num));
      (identsByNum[num] = identsByNum[num] || new Set()).add(ident);
      if (!nameByNum[num]) nameByNum[num] = (i.player_name && i.player_name.trim()) || String(buyer.name).trim();
    });
    const conflict = Object.entries(identsByNum).find(([, set]) => set.size > 1);
    if (conflict) { await rollback(); return bad(409, `Number ${conflict[0]} can't go to two different players — each number in this store is unique. Please give each player a different number.`, { code: 'number_conflict', number: conflict[0] }); }
    for (const [n, pname] of Object.entries(nameByNum)) {
      const { error: ce } = await sb.from('webstore_number_claims').insert({ store_id: store.id, player_number: n, order_id: order.id, player_name: pname });
      if (ce) {
        await rollback();
        if (/duplicate|unique/i.test(ce.message || '')) return bad(409, `Number ${n} was just taken by someone else — please pick a different number.`, { code: 'number_taken', number: n });
        return bad(502, 'Could not reserve your number: ' + ce.message);
      }
    }
  }

  if (mode === 'paid') {
    const sk = process.env.STRIPE_SECRET_KEY;
    if (!sk) { await rollback(); return bad(500, 'Card payment isn’t configured.'); }
    let intent;
    try {
      intent = await stripe(sk).paymentIntents.create({
        amount: Math.round(total * 100),
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        receipt_email: order.buyer_email || undefined,
        metadata: { webstore_order_id: order.id, store_slug: store.slug, source: 'nsa_webstore' },
        description: `${store.name} webstore — order ${order.id}`,
      }, { idempotencyKey: 'wsorder_' + order.id });
    } catch (e) {
      await rollback();
      return bad(502, 'Could not start the card payment: ' + e.message);
    }
    const { error: piErr } = await sb.from('webstore_orders').update({ stripe_pi_id: intent.id }).eq('id', order.id);
    if (piErr) { await rollback(); return bad(502, 'Could not link the payment: ' + piErr.message); }
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order: { ...order, stripe_pi_id: intent.id }, totals, clientSecret: intent.client_secret, intentId: intent.id }) };
  }

  // Team-tab / comped order: count the coupon use and send the confirmation now.
  if (coupon) await bumpCouponUse(sb, store.id, coupon.code);
  if (order.buyer_email) {
    const { data: won } = await sb.from('webstore_orders').update({ confirmation_sent: true }).eq('id', order.id).neq('confirmation_sent', true).select('id').limit(1);
    if (won && won.length) { try { await sendOrderConfirmation(sb, order); } catch (e) { console.warn('[webstore-checkout] confirmation email failed:', e.message); } }
  }
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order, totals }) };
}

async function finalize(sb, body) {
  const { orderId, stripePiId } = body;
  if (!orderId || !stripePiId) return bad(400, 'orderId and stripePiId required');
  const { data: orders, error: oErr } = await sb.from('webstore_orders').select('*').eq('id', orderId).limit(1);
  if (oErr) return bad(500, oErr.message);
  const order = orders && orders[0];
  if (!order) return bad(404, 'Order not found');
  if (order.stripe_pi_id !== stripePiId) return bad(409, 'Payment reference does not match this order.');

  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return bad(500, 'Stripe not configured');
  const pi = await stripe(sk).paymentIntents.retrieve(stripePiId);
  if (!pi || pi.status !== 'succeeded') return bad(409, 'Payment has not completed.');
  if (pi.amount !== Math.round((Number(order.total) || 0) * 100)) return bad(409, 'Payment amount does not match the order.');
  if (pi.metadata && pi.metadata.webstore_order_id && pi.metadata.webstore_order_id !== order.id) return bad(409, 'Payment does not belong to this order.');

  await sb.from('webstore_orders').update({ status: 'paid' }).eq('id', order.id).neq('status', 'paid');

  // Atomic claim — whoever flips confirmation_sent (this call or the Stripe
  // webhook fallback) owns the coupon bump + the one confirmation email.
  const { data: won } = await sb.from('webstore_orders').update({ confirmation_sent: true }).eq('id', order.id).neq('confirmation_sent', true).select('id').limit(1);
  if (won && won.length) {
    if (order.coupon_code) await bumpCouponUse(sb, order.store_id, order.coupon_code);
    if (order.buyer_email) { try { await sendOrderConfirmation(sb, { ...order, status: 'paid' }); } catch (e) { console.warn('[webstore-checkout] confirmation email failed:', e.message); } }
  }
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, orderId: order.id }) };
}

// ── Coupon preview ───────────────────────────────────────────────────
// Replaces the storefront's direct anon read of webstore_coupons (which exposed
// every code, including 100%-off). Returns only what the cart math needs.
async function checkCoupon(sb, body) {
  const { storeSlug, code } = body;
  const { data: stores, error } = await sb.from('webstores').select('id,slug').eq('slug', String(storeSlug || '')).limit(1);
  if (error) return bad(500, error.message);
  const store = stores && stores[0];
  if (!store) return bad(404, 'Store not found');
  const coup = await loadCoupon(sb, store, code);
  if (coup.error) return bad(409, coup.error);
  if (!coup.coupon) return bad(400, 'Enter a code.');
  const c = coup.coupon;
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ coupon: { code: c.code, kind: c.kind, value: c.value, cover_shipping: c.cover_shipping } }) };
}

// ── Order status (tokenless, by order id) ────────────────────────────
// The post-checkout status page knows the order's UUID (122 bits of entropy,
// the same bearer model the emailed status_token uses). Returns the buyer their
// own order + line items — no anon access to the tables themselves.
async function getOrder(sb, body) {
  const { orderId } = body;
  if (!orderId) return bad(400, 'orderId required');
  const { data: orders, error } = await sb.from('webstore_orders').select('*').eq('id', orderId).limit(1);
  if (error) return bad(500, error.message);
  const order = orders && orders[0];
  if (!order) return bad(404, 'Order not found');
  const { data: items } = await sb.from('webstore_order_items').select('*').eq('order_id', order.id);
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order, items: items || [] }) };
}

// ── Order tracking (by emailed status_token) ─────────────────────────
async function trackOrder(sb, body) {
  const { token } = body;
  if (!token) return bad(400, 'token required');
  const { data: orders, error } = await sb.from('webstore_orders').select('*').eq('status_token', token).limit(1);
  if (error) return bad(500, error.message);
  const order = orders && orders[0];
  if (!order) return bad(404, 'Order not found');
  const [{ data: sRows }, { data: items }, { data: shipments }] = await Promise.all([
    sb.from('webstores').select('name,slug,logo_url,primary_color,accent_color').eq('id', order.store_id).limit(1),
    sb.from('webstore_order_items').select('*').eq('order_id', order.id),
    sb.from('webstore_shipments').select('*').eq('order_id', order.id).order('created_at', { ascending: true }),
  ]);
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order, store: (sRows && sRows[0]) || null, items: items || [], shipments: shipments || [] }) };
}

// ── Buyer self-service shipping-address edit (before the order ships) ──
async function updateShip(sb, body) {
  const { orderId, ship } = body;
  if (!orderId || !ship) return bad(400, 'orderId and ship required');
  if (!ship.street1 || !ship.city || !ship.state || !ship.zip) return bad(400, 'Please complete street, city, state and ZIP.');
  const { data: orders, error } = await sb.from('webstore_orders').select('id,ship_address,shipped_at,status').eq('id', orderId).limit(1);
  if (error) return bad(500, error.message);
  const order = orders && orders[0];
  if (!order) return bad(404, 'Order not found');
  if (order.shipped_at || order.status === 'shipped' || order.status === 'complete') return bad(409, 'This order has already shipped — contact us to change the address.');
  const addr = {
    name: String(ship.name || '').slice(0, 120),
    street1: String(ship.street1).slice(0, 200), street2: String(ship.street2 || '').slice(0, 200),
    city: String(ship.city).slice(0, 120), state: String(ship.state).slice(0, 40), zip: String(ship.zip).slice(0, 20),
  };
  const { error: upErr } = await sb.from('webstore_orders').update({ ship_address: addr }).eq('id', order.id);
  if (upErr) return bad(502, 'Could not save the address: ' + upErr.message);
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, ship_address: addr }) };
}
