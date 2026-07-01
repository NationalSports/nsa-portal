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

// Effective per-item fundraising. Mirrors webstore_storefront_products
// (migration 047) EXACTLY so the price charged equals the price the storefront
// shows. A per-item fundraise_amount > 0 is the override and always wins;
// otherwise the store-level rule applies when enabled — a percent of the item's
// price OR a flat $ per item, optionally rounded UP to the next whole dollar.
const effFund = (store, wp) => {
  const item = Number(wp.fundraise_amount) || 0;
  if (item > 0) return r2(item);
  if (!store || !store.fundraise_enabled) return 0;
  const pct = Number(store.fundraise_pct) || 0;
  const flat = Number(store.fundraise_flat) || 0;
  let amt;
  if (pct > 0) amt = (Number(wp.retail_price) || 0) * pct / 100;
  else if (flat > 0) amt = flat;
  else return 0;
  return store.fundraise_round ? Math.ceil(amt) : r2(amt);
};
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
  // Per-size upcharges (2XL/3XL+) are published by the storefront view; read them
  // server-side so the price the shopper saw is the price we charge. Resilient: if
  // the column isn't present yet, no upcharge is applied.
  const upMap = {};
  try {
    const { data: upRows } = await sb.from('webstore_storefront_products')
      .select('webstore_product_id,size_upcharges').eq('store_id', store.id).in('webstore_product_id', wids);
    (upRows || []).forEach((r) => { upMap[r.webstore_product_id] = r.size_upcharges || {}; });
  } catch (_) { /* pre-migration: no size upcharges */ }
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
    const fundAmt = effFund(store, wp);

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
      const size = (l.size || '').trim() || null;
      const sizeExtra = size ? r2(Number((upMap[wp.id] || {})[size]) || 0) : 0;
      const unit = r2(unitPrice + sizeExtra);
      subtotal += r2(unit * qty);
      fundraise += r2((fundAmt + nameExtra) * qty);
      lines.push({ kind: 'single', wp, qty, size, unit_price: unit, fundraise: fundAmt, name_extra: nameExtra, line_total: r2((unit + fundAmt + nameExtra) * qty), player_name: pname || null, player_number: pnum || null, name: wp.display_name, color: l.color ? String(l.color).slice(0, 60) : null, variant_label: wp.variant_label || null, image: wp.image_url });
    }
  }
  return { lines, subtotal: r2(subtotal), fundraise: r2(fundraise) };
}

// Tall sizes fulfill their regular twin (a shopper picks "L"; we ship "LT" if that's the
// stock), so a regular size's availability counts its tall twin too — mirrors the
// storefront's fold (src/lib/storeInventory.js).
const TALL_OF = { XS: 'XST', S: 'ST', M: 'MT', L: 'LT', XL: 'XLT', '2XL': '2XLT', '3XL': '3XLT', '4XL': '4XLT', '5XL': '5XLT' };
const _qOf = (m, k) => Number((m || {})[k]) || 0;
const _availForSize = (p, size) => {
  const tall = TALL_OF[String(size).toUpperCase()];
  return _qOf(p.size_stock, size) + _qOf(p.vendor_size_stock, size)
    + (tall ? _qOf(p.size_stock, tall) + _qOf(p.vendor_size_stock, tall) : 0);
};

// Mirrors the storefront's verifyStock(): on-hand + vendor stock per size (incl. tall
// twin), with incoming/ETA items allowed as backorders. Read through the storefront
// view — whose vendor stock/ETA now span every synced vendor (inventory_unified, not
// just Adidas), so non-Adidas items are validated against real vendor availability.
async function checkStock(sb, store, lines) {
  const singles = lines.filter((l) => l.kind === 'single' && l.size);
  if (!singles.length) return null;
  const ids = [...new Set(singles.map((l) => l.wp.id))];
  const { data, error } = await sb.from('webstore_storefront_products')
    .select('webstore_product_id,name,size_stock,vendor_size_stock,vendor_on_hand,on_order_qty,earliest_eta,vendor_eta,track_inventory,inventory_source')
    .eq('store_id', store.id).in('webstore_product_id', ids);
  if (error) return null; // parity with the client: don't block checkout on a lookup failure
  const byId = {}; (data || []).forEach((p) => { byId[p.webstore_product_id] = p; });
  const need = {}; singles.forEach((l) => { const k = l.wp.id + '|' + l.size; need[k] = (need[k] || 0) + l.qty; });
  const short = [];
  Object.entries(need).forEach(([k, q]) => {
    const [wid, size] = k.split('|'); const p = byId[wid]; if (!p) return;
    // Not inventory-tracked (custom / made-to-order, or the item opted out) → never blocked.
    const tracked = p.track_inventory !== false && !!p.inventory_source && p.inventory_source !== 'manual';
    if (!tracked) return;
    const incoming = (Number(p.on_order_qty) > 0) || !!p.earliest_eta || !!p.vendor_eta;
    if (incoming) return; // backorder allowed
    const avail = _availForSize(p, size);
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
// Store processing fee: a flat percent of the item subtotal only (not shipping,
// tax, or fundraising). Standard 5%, configurable per store; 0 turns it off.
const procFee = (store, subtotal) => r2((Number(store.processing_pct) || 0) / 100 * (Number(subtotal) || 0));

function couponDiscount(coupon, cartTotal, shipping) {
  if (!coupon || coupon.kind !== 'percent') return 0;
  const base = cartTotal + (coupon.cover_shipping !== false ? (Number(shipping) || 0) : 0);
  return r2(base * (Number(coupon.value) || 0) / 100);
}

// ── Sales tax ────────────────────────────────────────────────────────
// CA orders use the free CDTFA address rate service; out-of-state orders use the
// (metered) TaxCloud edge function, which applies the apparel TIC + each state's
// exemptions. We only collect where NSA is registered — TAX_COLLECT_STATES (default
// "CA"); a destination state not on that list is taxed at $0 (we can't remit it).
// Pickup / team-delivery orders source to NSA's origin (possession happens there).
const taxCollectStates = () => (process.env.TAX_COLLECT_STATES || 'CA').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const TAX_ORIGIN = {
  street1: process.env.NSA_ORIGIN_ADDRESS || '',
  city: process.env.NSA_ORIGIN_CITY || '',
  state: (process.env.NSA_ORIGIN_STATE || 'CA').toUpperCase(),
  zip: (process.env.NSA_ORIGIN_ZIP || '').slice(0, 5),
};

// CDTFA free rate-by-address lookup (California only). Returns a decimal rate or null.
async function cdtfaRate({ street1, city, zip }) {
  try {
    const qs = new URLSearchParams({ address: street1 || '', city: city || '', zip: (zip || '').slice(0, 5) });
    const res = await fetch('https://services.maps.cdtfa.ca.gov/api/taxrate/GetRateByAddress?' + qs.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const info = data && Array.isArray(data.taxRateInfo) ? data.taxRateInfo[0] : null;
    const rate = info && Number(info.rate);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch (e) { console.warn('[webstore-checkout] CDTFA lookup failed:', e.message); return null; }
}

// TaxCloud rate via the deployed edge function (respects its monthly cap + apparel TIC).
async function taxcloudRate({ street1, city, state, zip }) {
  const url = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(url + '/functions/v1/taxcloud-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, apikey: key },
      body: JSON.stringify({ address1: street1 || '', city, state, zip5: (zip || '').slice(0, 5) }),
    });
    const data = await res.json().catch(() => ({}));
    const rate = data && data.ok ? Number(data.tax_rate) : NaN;
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch (e) { console.warn('[webstore-checkout] TaxCloud lookup failed:', e.message); return null; }
}

// Returns { tax, rate, state, source } for a taxable base (product subtotal).
async function calcTax(store, ship, taxableBase, billing) {
  const base = Math.max(0, Number(taxableBase) || 0);
  if (base <= 0) return { tax: 0, rate: 0, state: '', source: 'zero_base' };
  const isPickup = store.delivery_mode !== 'ship_home';
  let dest;
  if (isPickup) {
    // Club-delivery: tax at the BUYER's home ZIP (their address), not NSA's origin.
    // CA buyers pay their local rate; a ZIP outside CA's range is treated as out-of-state
    // (we only collect where registered). No ZIP → can't source tax, so $0.
    const zip = String((billing && billing.zip) || '').replace(/\D/g, '').slice(0, 5);
    if (!zip) return { tax: 0, rate: 0, state: '', source: 'no_buyer_zip' };
    const zn = Number(zip);
    const isCaZip = zn >= 90001 && zn <= 96162;
    dest = { street1: '', city: '', state: isCaZip ? 'CA' : String((billing && billing.state) || '').toUpperCase(), zip };
  } else {
    dest = { street1: ship.street1 || '', city: ship.city || '', state: String(ship.state || '').toUpperCase(), zip: String(ship.zip || '').slice(0, 5) };
  }
  if (!dest.state || !taxCollectStates().includes(dest.state)) return { tax: 0, rate: 0, state: dest.state, source: 'not_registered' };
  if (dest.state === 'CA') {
    let rate = await cdtfaRate(dest);
    let source = 'cdtfa';
    if (rate == null) { rate = Number(process.env.CA_DEFAULT_TAX_RATE) || 0.0775; source = 'cdtfa_fallback'; }
    return { tax: r2(base * rate), rate, state: 'CA', source };
  }
  const rate = await taxcloudRate(dest);
  if (rate == null) return { tax: 0, rate: 0, state: dest.state, source: 'taxcloud_unavailable' };
  return { tax: r2(base * rate), rate, state: dest.state, source: 'taxcloud' };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return bad(405, 'POST only');
  const sb = getSb();
  if (!sb) return bad(500, 'Supabase not configured');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

  try {
    if (body.action === 'place_order') return await placeOrder(sb, body);
    if (body.action === 'quote') return await quoteTotals(sb, body);
    if (body.action === 'finalize') return await finalize(sb, body);
    if (body.action === 'check_coupon') return await checkCoupon(sb, body);
    if (body.action === 'get_order') return await getOrder(sb, body);
    if (body.action === 'roster_lookup') return await rosterLookup(sb, body);
    if (body.action === 'track_order') return await trackOrder(sb, body);
    if (body.action === 'update_ship') return await updateShip(sb, body);
    if (body.action === 'post_message') return await postMessage(sb, body);
    return bad(400, 'Unknown action.');
  } catch (e) {
    console.error('[webstore-checkout] error:', e);
    return bad(500, e.message || 'Checkout failed');
  }
};

async function placeOrder(sb, body) {
  const { storeSlug, cart, buyer, ship, payMode, couponCode, expectedTotalCents, rosterToken } = body;

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
  const processing = procFee(store, priced.subtotal);
  const preTax = Math.max(0, r2(cartTotal + shipping + processing - discount));

  // The drift guard validates the PRE-TAX total — the number the shopper saw and
  // approved. Tax is computed server-side and added on top, so a stale price still
  // bounces but the (always server-authoritative) tax never trips this check.
  if (expectedTotalCents != null && Math.abs(Math.round(preTax * 100) - Math.round(Number(expectedTotalCents))) > 1) {
    return bad(409, 'Prices were updated while you were shopping — please review your total and try again.', { code: 'totals_changed', totals: { subtotal: priced.subtotal, fundraise: priced.fundraise, shipping, processing, discount, total: preTax } });
  }

  // Sales tax on the product subtotal (CA via CDTFA, registered out-of-state via TaxCloud).
  // When a coupon fully covers the pre-tax total the order is comped — charge no tax
  // either, so we never create an "unpaid" order carrying tax that is never collected
  // (and never email a buyer a total they weren't charged).
  const taxRes = preTax > 0 ? await calcTax(store, ship || {}, priced.subtotal, { zip: buyer.zip, state: buyer.state }) : { tax: 0 };
  const tax = taxRes.tax;
  const total = r2(preTax + tax);
  const totals = { subtotal: priced.subtotal, fundraise: priced.fundraise, shipping, processing, discount, tax, total };

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
    subtotal: priced.subtotal, fundraise_amt: priced.fundraise, shipping_fee: shipping, processing_fee: processing, tax, total,
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
      items.push({ order_id: order.id, product_id: l.wp.product_id, sku: l.wp.sku, size: l.size, qty: l.qty, unit_price: l.unit_price, unit_fundraise: r2(l.fundraise + l.name_extra), player_name: l.player_name, player_number: l.player_number, name: l.name || null, color: l.color, variant_label: l.variant_label || null, image_url: l.image || null, line_status: 'pending' });
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

  // If the shopper came in through a player's roster link, flag that player as
  // ordered and point their row at this order. Best-effort: the order is already
  // committed, so a roster-flag hiccup must never fail (or roll back) the sale.
  await markRosterOrdered(sb, store.id, rosterToken, order.id);

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

// ── Roster player links ──────────────────────────────────────────────
// A club sets up a roster (staff/coach side) and hands each player a private
// link — /shop/<slug>?player=<token>. These two helpers are the anon-safe
// gateway to the (locked-down) webstore_roster table: the storefront never
// reads or writes it directly.

// Resolve a player token to their name/number so the storefront can greet them
// and prefill personalization. Only browse-safe fields are returned — never the
// parent email or any other player's row.
async function rosterLookup(sb, body) {
  const { storeSlug, token } = body;
  const tok = String(token || '').trim();
  if (!tok) return bad(400, 'token required');
  const { data: stores, error: stErr } = await sb.from('webstores').select('id').eq('slug', String(storeSlug || '')).limit(1);
  if (stErr) return bad(500, stErr.message);
  const store = stores && stores[0];
  if (!store) return bad(404, 'Store not found');
  const { data: rows, error } = await sb.from('webstore_roster')
    .select('player_name,player_number,ordered').eq('store_id', store.id).eq('token', tok).limit(1);
  if (error) return bad(500, error.message);
  const p = rows && rows[0];
  if (!p) return bad(404, 'This player link is not valid for this store.', { code: 'roster_not_found' });
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ player: { player_name: p.player_name, player_number: p.player_number || null, ordered: !!p.ordered } }) };
}

// Mark the roster player behind `token` as ordered and link their order. Never
// throws — a failure here leaves the (already-placed) order untouched.
async function markRosterOrdered(sb, storeId, token, orderId) {
  const tok = String(token || '').trim();
  if (!tok) return;
  try {
    await sb.from('webstore_roster')
      .update({ ordered: true, ordered_at: new Date().toISOString(), order_id: orderId })
      .eq('store_id', storeId).eq('token', tok);
  } catch (e) {
    console.warn('[webstore-checkout] roster mark-ordered failed:', e.message);
  }
}

// Price + tax preview (no order written) so the storefront can show the tax line
// once it knows the ship-to address, before the shopper commits to paying.
async function quoteTotals(sb, body) {
  const { storeSlug, cart, ship, couponCode, billing } = body;
  const { data: stores } = await sb.from('webstores').select('*').eq('slug', String(storeSlug || '')).limit(1);
  const store = stores && stores[0];
  if (!store) return bad(404, 'Store not found');
  const priced = await priceCart(sb, store, cart);
  if (priced.error) return bad(409, priced.error);
  const coup = await loadCoupon(sb, store, couponCode);
  const coupon = coup.coupon;
  const cartTotal = r2(priced.subtotal + priced.fundraise);
  const shipping = coupon && coupon.kind === 'free_shipping' ? 0 : shipFee(store);
  const discount = couponDiscount(coupon, cartTotal, shipping);
  const processing = procFee(store, priced.subtotal);
  const preTax = Math.max(0, r2(cartTotal + shipping + processing - discount));
  const taxRes = await calcTax(store, ship || {}, priced.subtotal, billing);
  const total = r2(preTax + taxRes.tax);
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ totals: { subtotal: priced.subtotal, fundraise: priced.fundraise, shipping, processing, discount, tax: taxRes.tax, tax_state: taxRes.state, total } }) };
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
  const rows = items || [];
  // Enrich items that have no stored image_url with catalog fallback images.
  const needImg = rows.filter((i) => !i.image_url);
  if (needImg.length) {
    const imgByPid = {};
    const { data: cat } = await sb.from('webstore_products').select('id,product_id,image_url').eq('store_id', order.store_id);
    (cat || []).forEach((c) => { if (c.image_url) { if (c.product_id) imgByPid[c.product_id] = c.image_url; imgByPid['wp:' + c.id] = c.image_url; } });
    const pids = [...new Set(needImg.map((i) => i.product_id).filter((p) => p && !imgByPid[p]))];
    if (pids.length) { const { data: prods } = await sb.from('products').select('id,image_front_url').in('id', pids); (prods || []).forEach((p) => { if (p.image_front_url) imgByPid[p.id] = p.image_front_url; }); }
    rows.forEach((i) => { if (!i.image_url) i.image_url = imgByPid[i.product_id] || (i.bundle_product_id ? imgByPid['wp:' + i.bundle_product_id] : null) || null; });
  }
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order, items: rows }) };
}

// ── Order tracking (by emailed status_token) ─────────────────────────
async function trackOrder(sb, body) {
  const { token } = body;
  if (!token) return bad(400, 'token required');
  const { data: orders, error } = await sb.from('webstore_orders').select('*').eq('status_token', token).limit(1);
  if (error) return bad(500, error.message);
  const order = orders && orders[0];
  if (!order) return bad(404, 'Order not found');
  const [{ data: sRows }, { data: items }, { data: shipments }, messages] = await Promise.all([
    sb.from('webstores').select('name,slug,logo_url,primary_color,accent_color').eq('id', order.store_id).limit(1),
    sb.from('webstore_order_items').select('*').eq('order_id', order.id),
    sb.from('webstore_shipments').select('*').eq('order_id', order.id).order('created_at', { ascending: true }),
    loadThread(sb, order.id),
  ]);
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order, store: (sRows && sRows[0]) || null, items: items || [], shipments: shipments || [], messages }) };
}

// Load one order's customer↔staff thread, sanitized for the public portal. Only
// the order's own webstore_order messages are returned (no SO/internal notes).
async function loadThread(sb, orderId) {
  const { data } = await sb.from('messages').select('id,text,ts,created_at,from_customer,author')
    .eq('entity_type', 'webstore_order').eq('entity_id', String(orderId));
  return (data || [])
    .map((m) => ({ id: m.id, from_customer: !!m.from_customer, author: m.author || (m.from_customer ? 'You' : 'NSA Team'), text: m.text || '', ts: m.created_at || m.ts }))
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
}

// A shopper posts a reply from their portal page. Token-gated (no account):
// the secret status_token is the only credential. Inserts a customer message
// into the shared thread and notifies the store's CSR (→ rep → fallback).
async function postMessage(sb, body) {
  const { token } = body;
  const text = String(body.text || '').trim().slice(0, 4000);
  if (!token) return bad(400, 'token required');
  if (!text) return bad(400, 'Message is empty.');
  const { data: orders, error } = await sb.from('webstore_orders').select('*').eq('status_token', token).limit(1);
  if (error) return bad(500, error.message);
  const order = orders && orders[0];
  if (!order) return bad(404, 'Order not found');

  // Resolve the store, its owning rep, and the rep's primary CSR so the reply
  // routes to the right person's inbox (tagged_members) and email.
  const tagged = [];
  let notifyEmail = null, notifyName = '';
  try {
    const { data: store } = await sb.from('webstores').select('id,name,rep_id,csr_id,omg_sale_code').eq('id', order.store_id).maybeSingle();
    let repId = store && store.rep_id;
    let csrId = store && store.csr_id;
    // OMG stores carry their CSR/rep on omg_stores; the webstore is just a
    // mirror, so resolve through the shared sale code.
    if (store && store.omg_sale_code) {
      const { data: omg } = await sb.from('omg_stores').select('rep_id,csr_id').eq('_omg_sale_code', store.omg_sale_code).maybeSingle();
      if (omg) { if (omg.rep_id) repId = omg.rep_id; if (omg.csr_id) csrId = omg.csr_id; }
    }
    // No direct CSR? Fall back to the rep's primary CSR assignment.
    if (!csrId && repId) {
      const { data: asn } = await sb.from('rep_csr_assignments').select('csr_id,is_primary,is_active').eq('rep_id', repId);
      const active = (asn || []).filter((a) => a.is_active !== false);
      csrId = (active.find((a) => a.is_primary) || active[0] || {}).csr_id || null;
    }
    // Route to the CSR if there is one, else the rep.
    if (csrId) tagged.push(String(csrId));
    else if (repId) tagged.push(String(repId));
    // Notify email: prefer the CSR's, else the rep's.
    const ids = [csrId, repId].filter(Boolean).map(String);
    if (ids.length) {
      const { data: people } = await sb.from('user_profiles').select('id,email,full_name').in('id', ids);
      const pick = (people || []).find((p) => String(p.id) === String(csrId)) || (people || []).find((p) => String(p.id) === String(repId));
      if (pick && pick.email) { notifyEmail = pick.email; notifyName = pick.full_name || ''; }
    }
    var storeName = (store && store.name) || 'your store';
  } catch (e) { var storeName = 'your store'; }

  const now = new Date();
  const msg = {
    id: 'm' + now.getTime() + Math.random().toString(36).slice(2, 7),
    entity_type: 'webstore_order', entity_id: String(order.id),
    so_id: order.so_id || null, author_id: null, author: order.buyer_name || 'Customer',
    text, ts: now.toLocaleString(), dept: 'store',
    tagged_members: tagged, from_customer: true, read_by_staff: false,
  };
  const { error: insErr } = await sb.from('messages').insert(msg);
  if (insErr) return bad(502, 'Could not post your message: ' + insErr.message);

  // Email the assigned CSR/rep (best-effort — never blocks the post).
  try { await notifyStaffOfReply({ to: notifyEmail || 'stores@nationalsportsapparel.com', toName: notifyName, order, storeName, text }); } catch (e) { /* logged below */ }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, messages: await loadThread(sb, order.id) }) };
}

async function notifyStaffOfReply({ to, toName, order, storeName, text }) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY;
  if (!brevoKey || !to) return;
  const portal = (process.env.PORTAL_PUBLIC_URL || process.env.URL || '').replace(/\/+$/, '');
  const adminLink = `${portal}/?omg=1`;
  const safe = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const html = `<div style="font-family:'Source Sans 3',-apple-system,Segoe UI,Roboto,sans-serif;color:#2A2F3E;max-width:560px;margin:0 auto">
    <div style="background:#0b1f3a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">${safe(storeName)}</div>
      <div style="font-size:21px;font-weight:800;margin-top:4px">💬 New customer reply</div>
    </div>
    <div style="border:1px solid #eef1f5;border-top:none;border-radius:0 0 10px 10px;padding:22px">
      <p style="margin:0 0 6px"><b>${safe(order.buyer_name || 'A customer')}</b> replied on order ${order.omg_order_number ? '#' + safe(order.omg_order_number) : ''}:</p>
      <blockquote style="margin:8px 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #e11d2a;border-radius:6px;font-size:15px">${safe(text)}</blockquote>
      <p style="font-size:13px;color:#64748b">Open the order in OMG Stores to reply — your reply emails the customer their portal link.</p>
      <div style="margin:18px 0"><a href="${adminLink}" style="display:inline-block;background:#e11d2a;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:700">Open OMG Stores →</a></div>
    </div></div>`;
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'NSA Order Portal', email: 'stores@nationalsportsapparel.com' },
      to: [{ email: to, name: toName || '' }],
      replyTo: order.buyer_email ? { email: order.buyer_email, name: order.buyer_name || '' } : undefined,
      subject: `💬 ${order.buyer_name || 'Customer'} replied — ${storeName} order${order.omg_order_number ? ' #' + order.omg_order_number : ''}`,
      htmlContent: html,
    }),
  });
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

// ── Test surface ─────────────────────────────────────────────────────
// Exported only so the unit tests can exercise the pricing/stock math in
// isolation. Netlify invokes `handler`; these extra exports are inert in prod.
module.exports.priceCart = priceCart;
module.exports.checkStock = checkStock;
module.exports.checkNumberRange = checkNumberRange;
module.exports.couponDiscount = couponDiscount;
module.exports._availForSize = _availForSize;
module.exports.effFund = effFund;
module.exports.shipFee = shipFee;
module.exports.r2 = r2;
