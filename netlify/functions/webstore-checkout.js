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
const { planShipmentLineUpdates } = require('./_webstoreShipment');
const { sendOrderConfirmation, bumpCouponUse } = require('./_webstoreEmail');
const { SO_DONE } = require('./backorder-ready-sweep'); // one definition of "SO finished"
const {
  staffRecipientIds,
  staffEmailRecipients,
  processNotificationByDedupe,
} = require('./_webstoreNotifications');

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

// Validate shopper-entered add-ons against the product's server-side definition.
// The browser sends only option ids + answers; labels and dollars are rebuilt here.
function priceAddOnSelections(definitions, submitted) {
  const defs = Array.isArray(definitions) ? definitions.filter((o) => o && String(o.label || '').trim()) : [];
  const picks = Array.isArray(submitted) ? submitted : [];
  if (!defs.length) return picks.length ? { error: 'This item no longer has those add-on options — please re-add it.' } : { selections: [], extra: 0 };
  const byId = new Map();
  for (const p of picks) {
    const id = String((p && p.id) || '');
    if (!id || byId.has(id)) return { error: 'An add-on answer is invalid — please re-add the item.' };
    byId.set(id, p && p.value);
  }
  const known = new Set(); const selections = []; let extra = 0;
  for (let i = 0; i < defs.length; i += 1) {
    const o = defs[i]; const id = String(o.id || `option-${i}`); known.add(id);
    const kind = ['number', 'text', 'choice', 'addon'].includes(o.kind) ? o.kind : 'text';
    const label = String(o.label).trim().slice(0, 120); const raw = byId.get(id);
    let value = null; let upcharge = 0;
    if (kind === 'addon') {
      if (raw === true) { value = true; upcharge = r2(o.upcharge); }
    } else if (kind === 'number') {
      const v = String(raw == null ? '' : raw).trim();
      if (v && !/^\d{1,12}$/.test(v)) return { error: `${label} must be a number.` };
      if (v) { value = v; upcharge = r2(o.upcharge); }
    } else if (kind === 'choice') {
      const v = String(raw == null ? '' : raw).trim();
      if (v) {
        const choice = (Array.isArray(o.choices) ? o.choices : []).find((c) => c && String(c.label || '').trim() === v);
        if (!choice) return { error: `${label} has an invalid selection — please choose it again.` };
        value = String(choice.label).trim().slice(0, 120); upcharge = r2(choice.upcharge);
      }
    } else {
      const v = String(raw == null ? '' : raw).trim();
      if (v) { value = v.slice(0, 120); upcharge = r2(o.upcharge); }
    }
    if (o.required && value == null) return { error: `Please complete ${label}.` };
    if (value != null) { extra = r2(extra + upcharge); selections.push({ id, label, kind, value, upcharge }); }
  }
  if ([...byId.keys()].some((id) => !known.has(id))) return { error: 'An add-on option changed — please re-add the item.' };
  return { selections, extra };
}

// ── Server-side cart pricing ─────────────────────────────────────────
// Client lines carry only identity + personalization; every dollar figure is
// looked up fresh. Returns { lines, subtotal, fundraise, feeBase } or { error }.
//
// Money split (fundraising-accounting fix): a name-personalization upcharge is
// NSA revenue (it pays for the decoration), NOT club fundraising — so it lives
// in `subtotal` (and the item's unit_price), never in `fundraise` (or the
// item's unit_fundraise). Every payout surface (analytics fundPaid, batch
// fundraise_cost, club-SO conversion, store close-out, rep digest) sums
// fundraise_amt / unit_fundraise, so folding name fees in there paid the club
// for work NSA performed. `feeBase` (retail + size upcharge only) is what the
// processing fee and sales tax are computed on — the same base the storefront
// client's cartProcBase uses (src/storefront/Storefront.js), so the buyer's
// charge is unchanged by this split: subtotal + fundraise is invariant.
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
  let subtotal = 0, fundraise = 0, feeBase = 0;
  for (const l of cart) {
    const wp = byId[l && l.webstore_product_id];
    if (!wp || wp.active === false) return { error: 'An item in your cart is no longer available — please refresh the store.' };
    const unitPrice = r2(wp.retail_price);
    const fundAmt = effFund(store, wp);
    const addOns = priceAddOnSelections(wp.options, l && l.option_selections);
    if (addOns.error) return { error: addOns.error };

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
        // Component quantity is catalog-authoritative (webstore_bundle_items.qty, e.g.
        // a "2 jerseys" pack), NOT client-supplied — a package still checks out as one
        // unit at the parent's price, but each component line must carry its real qty so
        // batch demand, transfers, and the number/name roster don't undercount (they sum
        // order_item.qty). Money is unaffected: components are stored at $0 and the parent
        // holds the whole package price at qty 1.
        const cq = Math.max(1, parseInt(c.qty, 10) || 1);
        return { product_id: c.product_id, sku: c.sku, size: (cc.size || '').trim() || null, player_name: pname || null, player_number: pnum || null, name: cc.name || null, image: cc.image || null, qty: cq };
      });
      if (outComps.some((c) => c === null)) return { error: 'Package contents changed — please re-add it to your cart.' };
      if (outComps.some((c) => c === undefined)) return { error: 'A package in your cart is missing a size or number — please re-add it.' };
      const lineUnit = r2(unitPrice + fundAmt + nameExtra + addOns.extra);
      subtotal += r2(unitPrice + nameExtra + addOns.extra);
      fundraise += fundAmt;
      feeBase += r2(unitPrice + addOns.extra);
      lines.push({ kind: 'bundle', wp, qty: 1, unit_price: unitPrice, fundraise: fundAmt, name_extra: r2(nameExtra), option_extra: addOns.extra, option_selections: addOns.selections, line_total: lineUnit, components: outComps, name: wp.display_name, image: wp.image_url });
    } else {
      const qty = Math.min(100, Math.max(1, parseInt(l.qty, 10) || 1));
      const pname = wp.takes_name ? String(l.player_name || '').trim().slice(0, 40) : '';
      const pnum = wp.takes_number ? String(l.player_number || '').trim().slice(0, 4) : '';
      if (wp.takes_number && !pnum) return { error: 'An item in your cart is missing a jersey number — please re-add it.' };
      const nameExtra = pname ? r2(wp.name_upcharge) : 0;
      const size = (l.size || '').trim() || null;
      const sizeExtra = size ? r2(Number((upMap[wp.id] || {})[size]) || 0) : 0;
      const unit = r2(unitPrice + sizeExtra + addOns.extra);
      subtotal += r2((unit + nameExtra) * qty);
      fundraise += r2(fundAmt * qty);
      feeBase += r2(unit * qty);
      lines.push({ kind: 'single', wp, qty, size, unit_price: unit, fundraise: fundAmt, name_extra: nameExtra, option_extra: addOns.extra, option_selections: addOns.selections, line_total: r2((unit + fundAmt + nameExtra) * qty), player_name: pname || null, player_number: pnum || null, name: wp.display_name, color: l.color ? String(l.color).slice(0, 60) : null, variant_label: wp.variant_label || null, image: wp.image_url });
    }
  }
  return { lines, subtotal: r2(subtotal), fundraise: r2(fundraise), feeBase: r2(feeBase) };
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
// Returns { error, holds }: error blocks checkout; holds are the (product, size,
// qty, max_avail) lines the place_webstore_order transaction reserves for 30
// minutes (migration 00171), closing the read-then-insert oversell race. Only
// tracked, not-incoming lines get holds — the same lines this check can block on.
async function checkStock(sb, store, lines) {
  const singles = lines.filter((l) => l.kind === 'single' && l.size);
  if (!singles.length) return { error: null, holds: [] };
  const ids = [...new Set(singles.map((l) => l.wp.id))];
  const { data, error } = await sb.from('webstore_storefront_products')
    .select('webstore_product_id,product_id,name,size_stock,vendor_size_stock,vendor_on_hand,on_order_qty,earliest_eta,vendor_eta,track_inventory,inventory_source')
    .eq('store_id', store.id).in('webstore_product_id', ids);
  if (error) return { error: null, holds: [] }; // parity with the client: don't block checkout on a lookup failure
  const byId = {}; (data || []).forEach((p) => { byId[p.webstore_product_id] = p; });
  const need = {}; singles.forEach((l) => { const k = l.wp.id + '|' + l.size; need[k] = (need[k] || 0) + l.qty; });

  // Cumulative backorder claims: open needs-ledger rows (teamshop and club
  // alike, ANY store) already promise units of on-hand + incoming stock to
  // earlier orders — the sweep allocates FIFO by order date, so a new buyer
  // only truly gets what's left after those claims. Loaded once per checkout,
  // only for products this cart backorders against; fail-open on any error
  // (parity with the stock lookup above).
  const claimed = {}; // '<product_id>|<size>' -> promised qty on unfinished SOs
  const capPids = [...new Set((data || []).filter((p) => Number(p.on_order_qty) > 0 && p.product_id).map((p) => p.product_id))];
  if (capPids.length) {
    try {
      const nd = await sb.from('teamshop_auto_po_needs')
        .select('product_id,size,qty_needed,so_id').gt('qty_needed', 0).in('product_id', capPids).limit(2000);
      const rows = (!nd.error && nd.data) || [];
      const soIds = [...new Set(rows.map((n) => n.so_id).filter(Boolean))];
      const soRes = soIds.length ? await sb.from('sales_orders').select('id,status').in('id', soIds) : { data: [], error: null };
      if (!soRes.error) {
        // Statuses unreadable → count NO claims (fail-open, matching the stock
        // lookup) rather than counting finished SOs' settled claims and
        // over-blocking real buyers.
        const done = new Set((soRes.data || [])
          .filter((s) => SO_DONE.includes(String(s.status || '').toLowerCase())).map((s) => s.id));
        rows.forEach((n) => {
          if (done.has(n.so_id)) return; // finished SO — its claim is settled
          const k = n.product_id + '|' + (n.size || '');
          claimed[k] = (claimed[k] || 0) + (Number(n.qty_needed) || 0);
        });
      }
    } catch (_) { /* fail-open: an unreadable ledger must not block checkout */ }
  }
  const short = []; const holds = [];
  Object.entries(need).forEach(([k, q]) => {
    const [wid, size] = k.split('|'); const p = byId[wid]; if (!p) return;
    // Not inventory-tracked (custom / made-to-order, or the item opted out) → never blocked.
    const tracked = p.track_inventory !== false && !!p.inventory_source && p.inventory_source !== 'manual';
    if (!tracked) return;
    // Tracked drop-ship item whose stock has NEVER synced (both stock maps null, not
    // zero): don't block — the vendor backorders, and the storefront sells these sizes
    // (same rule as its hasStockData fallback). Synced-and-zero still blocks below.
    if (p.size_stock == null && p.vendor_size_stock == null) return;
    const incoming = (Number(p.on_order_qty) > 0) || !!p.earliest_eta || !!p.vendor_eta;
    if (incoming) {
      // Backorder allowed — but no longer unlimited. When the incoming QUANTITY
      // is known (on_order_qty), this line is capped at on-hand + on-order
      // MINUS what the open backorder ledger already promises to earlier
      // orders (loaded above), so a burst of orders can't all sell against the
      // same 20 incoming units. ETA-only signals (a vendor restock date with
      // no qty) keep the uncapped allowance — there is no number to cap
      // against. Remaining honest limit: an accepted order's claim appears in
      // the ledger only at conversion (club: instant; teamshop: store close),
      // so unconverted teamshop demand isn't counted yet.
      const onOrder = Number(p.on_order_qty) || 0;
      if (onOrder > 0) {
        const avail = _availForSize(p, size);
        const promised = claimed[(p.product_id || '') + '|' + size] || 0;
        if (avail + onOrder - promised < q) { short.push(`${p.name || 'item'} (size ${size})`); return; }
      }
      return;
    }
    const avail = _availForSize(p, size);
    if (avail < q) { short.push(`${p.name || 'item'} (size ${size})`); return; }
    holds.push({ webstore_product_id: wid, size, qty: q, max_avail: avail, label: `${p.name || 'item'} (size ${size})` });
  });
  if (short.length) return { error: `Sorry — these just sold out while you were shopping: ${short.join(', ')}. Please remove or change them and try again.`, holds: [] };
  return { error: null, holds };
}

// Reject a single line for a SIZED product that arrives with no size. The storefront
// only enables a no-size add for a genuinely one-size item; a sized item reaching here
// with size=null means it sold out in every size (the client used to still allow the
// add) or the cart was tampered — either way it's unfulfillable. Mirrors the client's
// `needSize` rule: a product with a non-empty size scale (available_sizes) or an explicit
// sizes_offered list requires a size. Read through the storefront view (base
// webstore_products has no available_sizes). Fail-open on a lookup error, matching
// checkStock — the drift/stock guards still apply.
async function checkSizesRequired(sb, store, lines) {
  const noSize = lines.filter((l) => l.kind === 'single' && !l.size);
  if (!noSize.length) return null;
  const ids = [...new Set(noSize.map((l) => l.wp.id))];
  const { data, error } = await sb.from('webstore_storefront_products')
    .select('webstore_product_id,name,available_sizes,sizes_offered,size_stock,vendor_size_stock,vendor_size_eta')
    .eq('store_id', store.id).in('webstore_product_id', ids);
  if (error) return null;
  const byId = {}; (data || []).forEach((p) => { byId[p.webstore_product_id] = p; });
  const nonEmpty = (a) => Array.isArray(a) && a.filter((x) => x != null && String(x).trim()).length > 0;
  // A product whose catalog scale is empty but which carries per-size stock is still a
  // SIZED product — the storefront now derives its size buttons from that stock (see
  // Storefront's scaleOf). Without this the guard read those items as one-size and let a
  // sizeless, unfulfillable line through.
  const hasSizeKeys = (p) => [p.size_stock, p.vendor_size_stock, p.vendor_size_eta]
    .some((m) => m && typeof m === 'object' && Object.keys(m).length > 0);
  for (const l of noSize) {
    const p = byId[l.wp.id];
    if (p && (nonEmpty(p.available_sizes) || nonEmpty(p.sizes_offered) || hasSizeKeys(p))) {
      return `Please choose a size for ${p.name || 'an item in your cart'} — it may have sold out in your size. Please re-add it and try again.`;
    }
  }
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

// Sales tax follows the amount actually billed: a store (retailer-funded) coupon
// reduces the taxable product subtotal proportionally, so a 99%-off code taxes
// ~1% of the subtotal, not the full price. Mirrors couponDiscount's base so the
// coupon's share of the subtotal is removed before tax is sourced.
function taxableBaseAfterDiscount(subtotal, discount, cartTotal, shipping, coupon) {
  const sub = Number(subtotal) || 0;
  const dBase = (Number(cartTotal) || 0) + (coupon && coupon.cover_shipping !== false ? (Number(shipping) || 0) : 0);
  if (!(discount > 0) || !(dBase > 0)) return sub;
  return Math.max(0, r2(sub * (1 - discount / dBase)));
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
    if (body.action === 'settings') return await publicSettings(sb);
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

// ── place_order idempotency (migration 00170) ───────────────────────
// The client sends a per-attempt clientRef; if an order already exists for it
// (double-click, network retry after a lost response), we return THAT order
// instead of creating a duplicate. Degrades gracefully pre-migration: a missing
// client_ref column just disables dedup, never blocks checkout.
const validClientRef = (v) => (typeof v === 'string' && /^[0-9a-zA-Z_-]{16,64}$/.test(v) ? v : null);
const isMissingColumnErr = (e) => !!e && /client_ref/.test(e.message || '') && /(column|schema)/i.test(e.message || '');

async function findOrderByClientRef(sb, clientRef) {
  if (!clientRef) return null;
  const { data, error } = await sb.from('webstore_orders').select('*').eq('client_ref', clientRef).limit(1);
  if (error) return null; // pre-migration (or transient) — treat as no match; the unique index still backstops the insert
  return (data && data[0]) || null;
}

// Rebuild the place_order response for an order that already exists. For a card
// order still awaiting payment, re-derive the clientSecret from its own
// PaymentIntent so the buyer can resume paying the SAME order.
async function replayOrder(order) {
  const totals = {
    subtotal: order.subtotal, fundraise: order.fundraise_amt, shipping: order.shipping_fee,
    processing: order.processing_fee, discount: order.discount_amt, tax: order.tax, total: order.total,
  };
  if (order.status === 'pending_payment' && order.stripe_pi_id) {
    const sk = process.env.STRIPE_SECRET_KEY;
    if (!sk) return bad(500, 'Card payment isn’t configured.');
    let pi;
    try { pi = await stripe(sk).paymentIntents.retrieve(order.stripe_pi_id); }
    catch (e) { return bad(502, 'Could not resume your payment — please try again: ' + e.message); }
    if (pi && pi.status === 'succeeded') {
      // Paid between the two submits — finalize/webhook will flip it; tell the client to skip the card form.
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order, totals, intentId: pi.id, replayed: true, alreadyPaid: true }) };
    }
    // ACH mid-settlement (or awaiting micro-deposit verification): the bank debit is
    // already underway — never hand back a payment form for it. The client lands on
    // the order page, which shows the processing / verify notice.
    const bankVerify = pi && pi.status === 'requires_action' && pi.next_action && pi.next_action.type === 'verify_with_microdeposits';
    if (pi && (pi.status === 'processing' || bankVerify)) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order, totals, intentId: pi.id, replayed: true, paymentProcessing: true, bankVerify: !!bankVerify }) };
    }
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order, totals, clientSecret: pi.client_secret, intentId: pi.id, replayed: true }) };
  }
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order, totals, replayed: true }) };
}

// Compensation delete for failures AFTER the order exists (e.g. PaymentIntent
// creation fails). Items, claims, and stock holds all cascade from the order row;
// the explicit deletes are belt-and-braces parity with the pre-transaction code.
async function rollbackOrder(sb, orderId) {
  try {
    await sb.from('webstore_number_claims').delete().eq('order_id', orderId);
    await sb.from('webstore_order_items').delete().eq('order_id', orderId);
    await sb.from('webstore_orders').delete().eq('id', orderId);
  } catch (e) { console.error('[webstore-checkout] rollback failed for order', orderId, e.message); }
}

async function placeOrder(sb, body) {
  const { storeSlug, cart, buyer, ship, payMode, couponCode, expectedTotalCents, rosterToken } = body;
  const clientRef = validClientRef(body.clientRef);

  const { data: stores, error: stErr } = await sb.from('webstores').select('*').eq('slug', String(storeSlug || '')).limit(1);
  if (stErr) return bad(500, stErr.message);
  const store = stores && stores[0];
  if (!store) return bad(404, 'Store not found');

  // Same attempt already produced an order? Return it — even if the store has
  // since closed, the buyer's original submit was accepted.
  const dup = await findOrderByClientRef(sb, clientRef);
  if (dup) return replayOrder(dup);

  if (store.status !== 'open') return bad(409, 'This store isn’t open for orders right now.');

  if (!buyer || !String(buyer.name || '').trim() || !/.+@.+\..+/.test(String(buyer.email || ''))) return bad(400, 'Please provide your name and a valid email.');
  const needAddr = store.delivery_mode === 'ship_home';
  if (needAddr && !(ship && ship.street1 && ship.city && ship.state && ship.zip)) return bad(400, 'Please complete your shipping address.');

  const priced = await priceCart(sb, store, cart);
  if (priced.error) return bad(409, priced.error);

  const numErr = checkNumberRange(store, priced.lines);
  if (numErr) return bad(409, numErr);

  const sizeErr = await checkSizesRequired(sb, store, priced.lines);
  if (sizeErr) return bad(409, sizeErr, { code: 'size_required' });

  const stock = await checkStock(sb, store, priced.lines);
  if (stock.error) return bad(409, stock.error);

  const coup = await loadCoupon(sb, store, couponCode);
  if (coup.error) return bad(409, coup.error);
  const coupon = coup.coupon;

  const cartTotal = r2(priced.subtotal + priced.fundraise);
  const shipping = coupon && coupon.kind === 'free_shipping' ? 0 : shipFee(store);
  const discount = couponDiscount(coupon, cartTotal, shipping);
  const processing = procFee(store, priced.feeBase);
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
  const taxRes = preTax > 0 ? await calcTax(store, ship || {}, taxableBaseAfterDiscount(priced.feeBase, discount, cartTotal, shipping, coupon), { zip: buyer.zip, state: buyer.state }) : { tax: 0 };
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

  // ── Build every row up front; nothing is written until all checks pass ──
  // Club stores (org_type 'club'): each order converts into its own Sales Order the
  // moment it's paid (create_club_sales_order, migration 00204) — same identity
  // stamp teamshop-checkout.js writes for its own conversion RPC (order_source +
  // customer_id), read by the RPC's org_type join back to webstores. Team stores
  // (org_type 'team'/null) get neither field — batchOrders' `.is('so_id', null)`
  // query is untouched, so nothing here can affect the staff batch flow.
  const isClubStore = store.org_type === 'club';
  const orderRow = {
    store_id: store.id, status: mode === 'paid' ? 'pending_payment' : 'unpaid', payment_mode: mode, order_kind: 'individual',
    buyer_name: String(buyer.name).trim().slice(0, 120), buyer_email: String(buyer.email).trim().slice(0, 160), buyer_phone: buyer.phone ? String(buyer.phone).slice(0, 40) : null,
    ship_address: needAddr ? { name: (ship.name || buyer.name || '').slice(0, 120), street1: ship.street1, street2: ship.street2 || '', city: ship.city, state: ship.state, zip: ship.zip } : null,
    ship_method: store.delivery_mode,
    subtotal: priced.subtotal, fundraise_amt: priced.fundraise, shipping_fee: shipping, processing_fee: processing, tax, total,
    coupon_code: coupon ? coupon.code : null, discount_amt: discount,
    ...(isClubStore ? { order_source: 'club', customer_id: store.customer_id || null } : {}),
  };

  // Order-level "who this is for" name (checkout's Player name field). Used as the
  // player_name for any line that doesn't already carry a garment-personalized
  // name, so the player report + packing lists group parent-placed orders under
  // the actual player. It never drives decoration — that's the item's takes_name.
  const orderPlayer = String((buyer && buyer.player_name) || '').trim().slice(0, 60) || null;
  const items = []; // no order_id yet — the transaction (or legacy path) injects it
  for (const l of priced.lines) {
    if (l.kind === 'bundle') {
      const bref = require('crypto').randomUUID();
      // Name fee rides on unit_price (NSA revenue); unit_fundraise is club raise only —
      // batching/conversion sum unit_price + unit_fundraise, so the SO total is unchanged.
      items.push({ product_id: null, sku: null, size: null, qty: 1, unit_price: r2(l.unit_price + l.name_extra), unit_fundraise: r2(l.fundraise), player_name: null, player_number: null, add_on_selections: l.option_selections || [], bundle_ref: bref, bundle_product_id: l.wp.id, is_bundle_parent: true, name: l.name || null, image_url: l.image || null, line_status: 'pending' });
      l.components.forEach((c) => items.push({ product_id: c.product_id, sku: c.sku, size: c.size, qty: Math.max(1, parseInt(c.qty, 10) || 1), unit_price: 0, unit_fundraise: 0, player_name: c.player_name || orderPlayer, player_number: c.player_number, bundle_ref: bref, bundle_product_id: l.wp.id, is_bundle_parent: false, name: c.name, image_url: c.image, line_status: 'pending' }));
    } else {
      items.push({ product_id: l.wp.product_id, sku: l.wp.sku, size: l.size, qty: l.qty, unit_price: r2(l.unit_price + l.name_extra), unit_fundraise: r2(l.fundraise), player_name: l.player_name || orderPlayer, player_number: l.player_number, add_on_selections: l.option_selections || [], name: l.name || null, color: l.color, variant_label: l.variant_label || null, image_url: l.image || null, line_status: 'pending' });
    }
  }

  // A number is one-per-player across the store. Within one checkout the same
  // number legitimately repeats across a single player's bundle components
  // (jersey + shorts share #10), so group by player identity — but assigning
  // one number to two DIFFERENT players violates the unique rule. Pure check on
  // the built rows, so it runs BEFORE anything is written (it used to insert the
  // order + items first and compensate). Claims record the player's name, not the buyer's.
  let claims = [];
  if (store.number_unique) {
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
    if (conflict) return bad(409, `Number ${conflict[0]} can't go to two different players — each number in this store is unique. Please give each player a different number.`, { code: 'number_conflict', number: conflict[0] });
    claims = Object.entries(nameByNum).map(([n, pname]) => ({ player_number: n, player_name: pname }));
  }

  // ── Preferred path: ONE transaction — order + items + number claims + 30-minute
  // stock holds via place_webstore_order (migration 00171). Everything commits or
  // nothing does, and the per-(product,size) holds close the read-then-insert
  // oversell race. Falls back to the legacy sequential writes until the migration
  // is applied (missing-function detection), so deploy order doesn't matter.
  let order = null;
  const rpc = await sb.rpc('place_webstore_order', {
    p_order: clientRef ? { ...orderRow, client_ref: clientRef } : orderRow,
    p_items: items, p_claims: claims, p_holds: stock.holds, p_hold_minutes: 30,
  });
  if (!rpc.error) {
    order = rpc.data && rpc.data.order;
    if (!order) return bad(502, 'Could not create the order.');
  } else {
    const msg = rpc.error.message || '';
    const taken = msg.match(/NSA_NUMBER_TAKEN:([^\s]+)/);
    if (taken) return bad(409, `Number ${taken[1]} was just taken by someone else — please pick a different number.`, { code: 'number_taken', number: taken[1] });
    const sold = msg.match(/NSA_SOLD_OUT:(.+)/);
    if (sold) return bad(409, `Sorry — these just sold out while you were shopping: ${sold[1].trim()}. Please remove or change them and try again.`);
    if (clientRef && /duplicate|unique/i.test(msg) && /client_ref/.test(msg)) {
      // Concurrent double-submit lost the transaction race — return the winner's order.
      const winner = await findOrderByClientRef(sb, clientRef);
      if (winner) return replayOrder(winner);
      return bad(502, 'Could not create the order: ' + msg);
    }
    const missingFn = /place_webstore_order/.test(msg) && /(function|schema cache)/i.test(msg);
    if (!missingFn) return bad(502, 'Could not create the order: ' + msg);
  }

  // ── Legacy sequential writes (pre-00171 DBs): insert order → items → claims,
  // compensating on failure. Identical behavior to the pre-transaction code.
  if (!order) {
    let ins = await sb.from('webstore_orders').insert(clientRef ? { ...orderRow, client_ref: clientRef } : orderRow).select().single();
    if (ins.error && clientRef) {
      if (isMissingColumnErr(ins.error)) {
        // Migration 00170 not applied yet — place the order without the token.
        ins = await sb.from('webstore_orders').insert(orderRow).select().single();
      } else if (/duplicate|unique/i.test(ins.error.message || '')) {
        const winner = await findOrderByClientRef(sb, clientRef);
        if (winner) return replayOrder(winner);
        return bad(502, 'Could not create the order: ' + ins.error.message);
      }
    }
    if (ins.error) return bad(502, 'Could not create the order: ' + ins.error.message);
    order = ins.data;

    const { error: itemErr } = await sb.from('webstore_order_items').insert(items.map((r) => ({ ...r, order_id: order.id })));
    if (itemErr) { await rollbackOrder(sb, order.id); return bad(502, 'Could not save your order items: ' + itemErr.message); }

    for (const c of claims) {
      const { error: ce } = await sb.from('webstore_number_claims').insert({ store_id: store.id, player_number: c.player_number, order_id: order.id, player_name: c.player_name });
      if (ce) {
        await rollbackOrder(sb, order.id);
        if (/duplicate|unique/i.test(ce.message || '')) return bad(409, `Number ${c.player_number} was just taken by someone else — please pick a different number.`, { code: 'number_taken', number: c.player_number });
        return bad(502, 'Could not reserve your number: ' + ce.message);
      }
    }
  }

  const rollback = () => rollbackOrder(sb, order.id);

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
        // NO receipt_email — deliberately. Setting it makes Stripe send its own receipt
        // on top of our confirmation (sendOrderConfirmation), so every card buyer got two
        // emails for one order: ours, and one titled by Stripe's internal receipt number
        // with no order number the buyer or a rep could act on. Stripe's receipt subject
        // isn't customizable, so the fix is to send one email — ours, which carries the
        // order number, the line items with sizes/numbers, the totals, the ship-to
        // address, and the tracking link. Adding this key back re-enables the duplicate.
        metadata: { webstore_order_id: order.id, webstore_order_number: order.order_number != null ? String(order.order_number) : '', store_slug: store.slug, source: 'nsa_webstore' },
        // The description is what Stripe prints on the card statement and in the
        // Dashboard, so it has to be the human order number staff see everywhere else
        // (portal, confirmation email, support). The raw UUID meant nobody — buyer or
        // rep — could match a charge to an order. order_number is a sequence default,
        // so it's on the row the insert/RPC just returned.
        description: `${store.name} webstore — order ${order.order_number != null ? '#' + order.order_number : order.id}`,
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
    .select('id,player_name,player_number,position,ordered,open_count,first_opened_at').eq('store_id', store.id).eq('token', tok).limit(1);
  if (error) return bad(500, error.message);
  const p = rows && rows[0];
  if (!p) return bad(404, 'This player link is not valid for this store.', { code: 'roster_not_found' });
  // Record the open — first + last seen, and a running count. Best-effort: a
  // tracking hiccup must not break the shopper's page load.
  try {
    const now = new Date().toISOString();
    await sb.from('webstore_roster')
      .update({ last_opened_at: now, first_opened_at: p.first_opened_at || now, open_count: (Number(p.open_count) || 0) + 1 })
      .eq('id', p.id);
  } catch (e) { console.warn('[webstore-checkout] roster open-tracking failed:', e.message); }
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ player: { player_name: p.player_name, player_number: p.player_number || null, position: p.position || null, ordered: !!p.ordered } }) };
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
  const processing = procFee(store, priced.feeBase);
  const preTax = Math.max(0, r2(cartTotal + shipping + processing - discount));
  const taxRes = await calcTax(store, ship || {}, taxableBaseAfterDiscount(priced.feeBase, discount, cartTotal, shipping, coupon), billing);
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

  // Never resurrect a terminated order. A buyer re-opening the checkout return
  // URL (or a retried finalize) on a refunded/cancelled order must NOT flip it
  // back to 'paid' or trigger conversion — the money was already returned. The
  // PaymentIntent still reads 'succeeded' (a refund is a separate Stripe object),
  // so the guard must be on our order status, not the PI (audit HIGH).
  if (['refunded', 'cancelled', 'void', 'disputed', 'deleted', 'archived'].includes(order.status)) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, orderId: order.id, status: order.status, skipped: 'terminal' }) };
  }

  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return bad(500, 'Stripe not configured');
  const pi = await stripe(sk).paymentIntents.retrieve(stripePiId);
  if (!pi || pi.status !== 'succeeded') return bad(409, 'Payment has not completed.');
  if (pi.amount !== Math.round((Number(order.total) || 0) * 100)) return bad(409, 'Payment amount does not match the order.');
  if (pi.metadata && pi.metadata.webstore_order_id && pi.metadata.webstore_order_id !== order.id) return bad(409, 'Payment does not belong to this order.');

  // Promote ONLY from a genuine pre-paid state — never from a post-paid status
  // (e.g. 'batched'), so a re-called finalize can't regress a downstream order.
  await sb.from('webstore_orders').update({ status: 'paid' }).eq('id', order.id).in('status', ['pending_payment', 'unpaid']);

  // Club store order -> production conversion (migration 00204), the same
  // post-payment trigger point as stripe-webhook's teamshop conversion fallback.
  // Best-effort and STRICTLY guarded: this call must never fail the checkout
  // response — the RPC is idempotent (so_id replay + paid re-guard), and the
  // stripe-webhook fallback below picks it up if this never lands.
  if (order.order_source === 'club' && !order.so_id) {
    try {
      const { data: convData, error: convErr } = await sb.rpc('create_club_sales_order', { p_order_id: order.id });
      if (convErr) console.error('[webstore-checkout] club conversion failed (order stays paid; stripe-webhook will retry):', convErr.message);
      else if (convData && convData.so_id) {
        // Best-effort auto-PO generation (00202, club-enabled) — idempotent
        // (client_ref + needs-row marker); a failure never fails the checkout,
        // and the Auto POs tab sweep catches it up.
        await require('./teamshop-auto-po').generateForSoSafe(sb, convData.so_id, 'webstore-checkout', 'webstore-checkout');
      }
    } catch (e) {
      console.error('[webstore-checkout] club conversion error:', e.message);
    }
  }

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

// Allow-list the one public storefront setting through the service endpoint so
// internal placement memory does not require anonymous table access.
async function publicSettings(sb) {
  const { data, error } = await sb.from('webstore_settings').select('checkout_message').eq('id', 1).maybeSingle();
  if (error) return bad(500, error.message);
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ checkout_message: (data && data.checkout_message) || '' }) };
}

const PUBLIC_ORDER_FIELDS = [
  'id', 'store_id', 'status', 'buyer_name', 'ship_method', 'ship_address',
  'subtotal', 'fundraise_amt', 'shipping_fee', 'processing_fee',
  'discount_amt', 'tax', 'total', 'payment_mode', 'coupon_code', 'created_at',
  'shipped_at', 'tracking_number', 'carrier',
  'omg_order_number', 'order_number', 'status_token',
].join(',');
const PUBLIC_ORDER_ITEM_FIELDS = [
  'id', 'order_id', 'product_id', 'bundle_product_id', 'bundle_ref',
  'is_bundle_parent', 'sku', 'name', 'size', 'color', 'variant_label', 'qty',
  'unit_price', 'line_status', 'shipped_qty', 'missing_qty', 'image_url',
  'player_name', 'player_number',
].join(',');

async function enrichOrderImages(sb, order, rows) {
  const needImage = (rows || []).filter((item) => !item.image_url);
  if (!needImage.length) return rows;
  const imageByProduct = {};
  const { data: catalog } = await sb.from('webstore_products')
    .select('id,product_id,image_url').eq('store_id', order.store_id);
  (catalog || []).forEach((item) => {
    if (!item.image_url) return;
    if (item.product_id) imageByProduct[item.product_id] = item.image_url;
    imageByProduct[`wp:${item.id}`] = item.image_url;
  });
  const missingProductIds = [...new Set(needImage.map((item) => item.product_id)
    .filter((id) => id && !imageByProduct[id]))];
  if (missingProductIds.length) {
    const { data: products } = await sb.from('products').select('id,image_front_url').in('id', missingProductIds);
    (products || []).forEach((product) => {
      if (product.image_front_url) imageByProduct[product.id] = product.image_front_url;
    });
  }
  (rows || []).forEach((item) => {
    if (!item.image_url) item.image_url = imageByProduct[item.product_id]
      || (item.bundle_product_id ? imageByProduct[`wp:${item.bundle_product_id}`] : null) || null;
  });
  return rows;
}

// ── Legacy order status action ───────────────────────────────────────
// Old storefront builds used a bare order UUID as a bearer credential. UUIDs
// are identifiers, not authorization. Keep the action name during rollout, but
// require the order's dedicated status token and verify both values agree.
async function getOrder(sb, body) {
  const orderId = String(body.orderId || '').trim();
  const token = String(body.token || '').trim();
  if (!orderId || !token) return bad(403, 'Order token required');
  const tracked = await trackOrder(sb, { token });
  if (tracked.statusCode !== 200) return tracked;
  const payload = JSON.parse(tracked.body || '{}');
  if (!payload.order || String(payload.order.id) !== orderId) return bad(404, 'Order not found');
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ order: payload.order, items: payload.items || [] }) };
}

// ── Order tracking (by emailed status_token) ─────────────────────────
async function trackOrder(sb, body) {
  const { token } = body;
  if (!token) return bad(400, 'token required');
  const { data: orders, error } = await sb.from('webstore_orders').select(PUBLIC_ORDER_FIELDS).eq('status_token', token).limit(1);
  if (error) return bad(500, error.message);
  const order = orders && orders[0];
  if (!order) return bad(404, 'Order not found');
  const [{ data: sRows }, { data: itemRows }, { data: shipmentRows }, messages] = await Promise.all([
    sb.from('webstores').select('name,slug,logo_url,primary_color,accent_color').eq('id', order.store_id).limit(1),
    sb.from('webstore_order_items').select(PUBLIC_ORDER_ITEM_FIELDS).eq('order_id', order.id),
    sb.from('webstore_shipments').select('id,tracking_number,carrier,service,ship_date,items,created_at').eq('order_id', order.id).order('created_at', { ascending: true }),
    loadThread(sb, order.id),
  ]);
  const items = itemRows || [];
  const shipments = shipmentRows || [];
  await enrichOrderImages(sb, order, items);

  // Self-heal shipments recorded by an older webhook run whose item updates
  // failed or could not be matched. Opening the tracker should never continue
  // showing "On order" when its own shipment ledger says those units shipped.
  const repairs = planShipmentLineUpdates(items, shipments);
  for (const repair of repairs) {
    const item = items.find((i) => String(i.id) === String(repair.id));
    if (!item) continue;
    const alreadyCorrect = Number(item.shipped_qty || 0) === repair.shipped_qty && item.line_status === repair.line_status;
    if (!alreadyCorrect) {
      const patch = { shipped_qty: repair.shipped_qty, ...(repair.line_status === 'shipped' ? { line_status: 'shipped' } : {}) };
      const { error: repairError } = await sb.from('webstore_order_items').update(patch).eq('id', repair.id);
      if (!repairError) Object.assign(item, patch);
      else console.error('[webstore-checkout] shipment tracker repair failed:', repair.id, repairError.message);
    }
  }
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
// the secret status_token is the only credential. The message and its outbox
// obligation are inserted in one database transaction; email delivery can fail
// without losing the notification and is retried by the scheduled worker.
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
  // routes to the right person's inbox (tagged_members). The durable worker
  // reloads those tagged profiles immediately before sending email.
  const tagged = [];
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
    // Customer replies are high priority: route to BOTH the assigned CSR and
    // rep. The former CSR-only behavior created a single point of failure and
    // left the rep's Messages inbox empty even though the order was theirs.
    tagged.push(...staffRecipientIds(csrId, repId));
    // The webstore response team opts in through the existing notify_depts
    // preference. Tag every active `store` subscriber in the in-app Messages
    // inbox as a redundant safety net, independent of per-store assignments.
    const { data: storeTeam } = await sb.from('user_profiles')
      .select('id').eq('is_active', true).contains('notify_depts', ['store']);
    for (const person of storeTeam || []) {
      const sid = String(person.id);
      if (!tagged.includes(sid)) tagged.push(sid);
    }
  } catch (e) {
    // The shared webstore mailbox remains a recipient even when assignment
    // lookup is unavailable; do not reject the customer's message for routing.
    console.error('[webstore-checkout] customer reply routing lookup failed:', e.message);
  }

  const now = new Date();
  const msg = {
    id: 'm' + now.getTime() + Math.random().toString(36).slice(2, 7),
    entity_type: 'webstore_order', entity_id: String(order.id),
    so_id: order.so_id || null, author_id: null, author: order.buyer_name || 'Customer',
    text, ts: now.toLocaleString(), dept: 'store',
    tagged_members: tagged, from_customer: true, read_by_staff: false,
  };
  const { error: insErr } = await sb.rpc('post_webstore_customer_message', {
    p_order_id: order.id,
    p_message: msg,
  });
  if (insErr) return bad(502, 'Could not post your message: ' + insErr.message);

  // Try now for fast delivery. Failure leaves a pending outbox row for the
  // scheduled retry worker; the customer message itself is already durable.
  let delivery = { ok: true, claimed: false };
  try {
    delivery = await processNotificationByDedupe(sb, `customer_staff_reply:${msg.id}`);
  } catch (e) {
    delivery = { ok: false, queued: true, error: e.message };
    console.error('[webstore-checkout] customer reply immediate delivery failed:', e.message);
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      ok: true,
      notification: delivery.ok ? (delivery.claimed ? 'sent' : 'already_processing') : 'queued_for_retry',
      messages: await loadThread(sb, order.id),
    }),
  };
}

// ── Buyer self-service shipping-address edit (before the order ships) ──
async function updateShip(sb, body) {
  const token = String(body.token || '').trim();
  const { ship } = body;
  if (!token || !ship) return bad(400, 'token and ship required');
  if (!ship.street1 || !ship.city || !ship.state || !ship.zip) return bad(400, 'Please complete street, city, state and ZIP.');
  const { data: orders, error } = await sb.from('webstore_orders')
    .select('id,ship_address,shipped_at,status').eq('status_token', token).limit(1);
  if (error) return bad(500, error.message);
  const order = orders && orders[0];
  if (!order) return bad(404, 'Order not found');
  if (order.shipped_at || order.status === 'shipped' || order.status === 'complete') return bad(409, 'This order has already shipped — contact us to change the address.');
  const addr = {
    name: String(ship.name || '').slice(0, 120),
    street1: String(ship.street1).slice(0, 200), street2: String(ship.street2 || '').slice(0, 200),
    city: String(ship.city).slice(0, 120), state: String(ship.state).slice(0, 40), zip: String(ship.zip).slice(0, 20),
  };
  const { data: updated, error: upErr } = await sb.from('webstore_orders').update({ ship_address: addr })
    .eq('id', order.id)
    .eq('status_token', token)
    .is('shipped_at', null)
    .not('status', 'in', '("shipped","complete")')
    .select('id');
  if (upErr) return bad(502, 'Could not save the address: ' + upErr.message);
  if (!updated || !updated.length) return bad(409, 'This order is already shipping — contact us to change the address.');
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, ship_address: addr }) };
}

// ── Test surface ─────────────────────────────────────────────────────
// Exported only so the unit tests can exercise the pricing/stock math in
// isolation. Netlify invokes `handler`; these extra exports are inert in prod.
module.exports.priceCart = priceCart;
module.exports.priceAddOnSelections = priceAddOnSelections;
module.exports.placeOrder = placeOrder;
module.exports.finalize = finalize;
module.exports.checkStock = checkStock;
module.exports.checkSizesRequired = checkSizesRequired;
module.exports.checkNumberRange = checkNumberRange;
module.exports.couponDiscount = couponDiscount;
module.exports._availForSize = _availForSize;
module.exports.effFund = effFund;
module.exports.shipFee = shipFee;
module.exports.r2 = r2;
module.exports.staffRecipientIds = staffRecipientIds;
module.exports.staffEmailRecipients = staffEmailRecipients;
module.exports.getOrder = getOrder;
module.exports.trackOrder = trackOrder;
module.exports.updateShip = updateShip;
module.exports.publicSettings = publicSettings;
module.exports.PUBLIC_ORDER_FIELDS = PUBLIC_ORDER_FIELDS;
module.exports.PUBLIC_ORDER_ITEM_FIELDS = PUBLIC_ORDER_ITEM_FIELDS;

// ── Team Shop checkout reuse (Stage 6) ───────────────────────────────
// teamshop-checkout.js REQUIRES these instead of forking the tax math,
// rollback compensation, or clientRef idempotency — one implementation for
// both order sources. Export-only additions: no behavior change here.
module.exports.calcTax = calcTax;
module.exports.rollbackOrder = rollbackOrder;
module.exports.validClientRef = validClientRef;
module.exports.findOrderByClientRef = findOrderByClientRef;
module.exports.replayOrder = replayOrder;
