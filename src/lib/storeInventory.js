// src/lib/storeInventory.js
// ─────────────────────────────────────────────────────────
// Live availability for catalog rows, shared by every store builder (the staff
// manual picker, the staff AI panel, and the coach portal builder) so they all
// agree on exactly what's orderable right now.
//
// Same source of truth as the catalog live-look (AdidasInventory): VENDOR stock
// (inventory_unified = adidas CLICK + Agron, keyed by SKU) merged with NSA's own
// IN-HOUSE warehouse stock (product_inventory, keyed by product_id). A size is
// "available now" when vendor qty + in-house qty > 0.
// ─────────────────────────────────────────────────────────
import { supabase } from './supabase';

export const SIZE_RANK_ORDER = ['3XS', '2XS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', '4XL', '5XL', '6XL', 'OSFA', 'OS', 'NS'];

export const sizeRank = (s) => {
  const up = String(s || '').trim().toUpperCase();
  const i = SIZE_RANK_ORDER.indexOf(up);
  if (i !== -1) return i;
  const n = parseFloat(up);
  return Number.isFinite(n) ? 500 + n : 999; // footwear numbers after lettered sizes
};

// ── Tall-size substitution (team stores) ─────────────────────────────
// For a team store a tall size fulfills its regular twin: a coach orders "L" and we
// ship "LT" if that's what's in stock ("if only LT is available it can sub for L"). So
// stores OFFER regular sizes only, never list a tall as its own option, and a regular
// size counts its tall twin's stock/ETA toward availability. Big-&-tall apparel tops
// out at 5XLT; the adidas feed's stray 6XL/7XL are a separate per-brand data mislabel,
// handled in the catalog data — not here (Port Authority/Sport-Tek/Port&Co carry real 6XL).
export const TALL_TO_REGULAR = { XST: 'XS', ST: 'S', MT: 'M', LT: 'L', XLT: 'XL', '2XLT': '2XL', '3XLT': '3XL', '4XLT': '4XL', '5XLT': '5XL' };
const _su = (s) => String(s == null ? '' : s).trim().toUpperCase();
// The regular size a label maps to (returns the label unchanged when it isn't a tall).
export const regularSize = (s) => TALL_TO_REGULAR[_su(s)] || s;
export const isTallSize = (s) => Object.prototype.hasOwnProperty.call(TALL_TO_REGULAR, _su(s));

// Product imports and vendor feeds do not always spell the same SKU identically.
// Example: the catalog stores `ST650-TRUE-NAVY`, while SanMar inventory stores
// `ST650-TrueNavy`. Keep the query bounded by generating the vendor-style alias,
// then join returned rows with a punctuation/case-insensitive key.
export const stockSkuKey = (sku) => String(sku || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

export const stockSkuAliases = (sku) => {
  const raw = String(sku || '').trim();
  if (!raw) return [];
  const aliases = new Set([raw]);
  const dash = raw.indexOf('-');
  if (dash > 0 && dash < raw.length - 1) {
    const style = raw.slice(0, dash);
    const colorWords = raw.slice(dash + 1).split(/[^a-z0-9]+/i).filter(Boolean);
    if (colorWords.length) {
      const vendorColor = colorWords
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
      aliases.add(`${style}-${vendorColor}`);
    }
  }
  return [...aliases];
};

// Collapse a product's size scale to the regular sizes a store offers: fold each tall
// into its regular twin, drop duplicates, keep the original order. Returns regular labels.
export const foldScale = (sizes) => {
  const out = [];
  for (const s of (Array.isArray(sizes) ? sizes : [])) {
    const r = regularSize(s);
    if (!out.some((x) => _su(x) === _su(r))) out.push(r);
  }
  return out;
};

// ── A product's size scale ───────────────────────────────────────────
// Normally the catalog's available_sizes. But ~1,100 catalog rows (mostly the
// bulk-imported adidas CLICK styles) carry an EMPTY scale while holding real
// per-size stock, and available_sizes was the storefront's ONLY source of size
// buttons — so those items rendered with no sizes at all, and reps patched them
// store-by-store with sizes_offered. Worse, an empty scale also made the
// storefront's `needSize` false, so the item could be added to the cart with
// size=null and the resulting order line was unfulfillable.
//
// When the catalog scale is empty, derive it from the stock already on the row:
// warehouse sizes + vendor sizes + sizes with a dated restock. That is the very
// data the size buttons are graded against, so a derived scale can only contain
// sizes we can actually speak to. `maps` are the storefront view's size→qty /
// size→date objects (size_stock, vendor_size_stock, vendor_size_eta).
// Placeholder "sizes" the vendor feeds use for an unsized style — inventory_unified
// spells it `_na`. They must never become a size button. (The storefront view already
// filters vendor rows against the catalog scale, so today these can't reach an
// empty-scale product; this keeps that from depending on the view's filter.)
const _PLACEHOLDER_SIZE = /^(_?na|n\/a|null|none|-+)$/i;
export const stockScale = (...maps) => {
  const keys = new Set();
  for (const m of maps) {
    if (!m || typeof m !== 'object') continue;
    for (const k of Object.keys(m)) if (String(k).trim() && !_PLACEHOLDER_SIZE.test(String(k).trim())) keys.add(k);
  }
  return foldScale([...keys].sort((a, b) => sizeRank(a) - sizeRank(b)));
};
// The scale to sell from: the catalog's own, else the one implied by stock.
export const scaleOf = (available, ...maps) => {
  const cat = foldScale(available);
  return cat.length ? cat : stockScale(...maps);
};

// Stock for a regular size = the size itself + its tall twin(s). stockOf(rawLabel) supplies
// the per-raw-size quantity (warehouse + vendor) from the caller's stock maps.
export const foldedQty = (regSize, stockOf) => {
  let q = Number(stockOf(regSize)) || 0;
  for (const [tall, reg] of Object.entries(TALL_TO_REGULAR)) if (_su(reg) === _su(regSize)) q += Number(stockOf(tall)) || 0;
  return q;
};
// Restocking-soon for a regular size = the size itself OR its tall twin arriving soon.
// soonOf(rawLabel) → boolean (the caller's ~2-week ETA test).
export const foldedSoon = (regSize, soonOf) => {
  if (soonOf(regSize)) return true;
  for (const [tall, reg] of Object.entries(TALL_TO_REGULAR)) if (_su(reg) === _su(regSize) && soonOf(tall)) return true;
  return false;
};

// Annotate a set of catalog rows ({ id, sku }) with live availability.
// Returns a Map keyed by product id → { units, sizes[], sizeStock{}, incoming }.
export async function fetchStockMap(rows) {
  const ids = [...new Set(rows.map((r) => r.id).filter(Boolean))];
  const skus = [...new Set(rows.flatMap((r) => stockSkuAliases(r.sku)))];
  const map = new Map();
  if (!ids.length && !skus.length) return map;
  // Chunked (URL-safe .in() lists) and paged per chunk: the gateway hard-caps
  // every response at 1,000 rows, so one unchunked query silently truncated a
  // big store's stock. .order('id') keeps the pages stable. Errors degrade to
  // whatever loaded (same soft behavior as before).
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
  const drain = async (buildReq) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await buildReq().order('id').range(from, from + 999);
      if (error) { console.warn('[storeInventory] stock fetch failed:', error.message); return out; }
      out.push(...(data || []));
      if (!data || data.length < 1000) return out;
    }
  };
  const all = async (items, buildReq) =>
    (await Promise.all(chunk(items, 400).map((b) => drain(() => buildReq(b))))).flat();
  const [vendRows, inhouseRows] = await Promise.all([
    skus.length
      ? all(skus, (b) => supabase.from('inventory_unified').select('sku,size,stock_qty,future_delivery_date,future_delivery_qty').in('sku', b).or('stock_qty.gt.0,future_delivery_qty.gt.0'))
      : [],
    ids.length
      ? all(ids, (b) => supabase.from('product_inventory').select('product_id,size,quantity').in('product_id', b).gt('quantity', 0))
      : [],
  ]);
  const bySku = {};
  const byExactSku = {};
  for (const r of vendRows) {
    const stockRow = { size: r.size, q: r.stock_qty || 0, fd: r.future_delivery_date, fq: r.future_delivery_qty };
    const key = stockSkuKey(r.sku);
    (bySku[key] = bySku[key] || []).push(stockRow);
    (byExactSku[r.sku] = byExactSku[r.sku] || []).push(stockRow);
  }
  const byPid = {};
  for (const r of inhouseRows) { byPid[r.product_id] = byPid[r.product_id] || {}; byPid[r.product_id][r.size] = (byPid[r.product_id][r.size] || 0) + (r.quantity || 0); }
  for (const row of rows) {
    // Prefer an exact feed match when both legacy and normalized spellings happen
    // to exist, so aliases cannot double-count the same vendor inventory.
    const sizes = (byExactSku[row.sku] || bySku[stockSkuKey(row.sku)] || []).map((s) => ({ ...s }));
    const ih = byPid[row.id];
    if (ih) for (const [size, qty] of Object.entries(ih)) { const ex = sizes.find((s) => s.size === size); if (ex) ex.ih = qty; else sizes.push({ size, q: 0, fd: null, fq: null, ih: qty }); }
    const availNow = (s) => (s.q || 0) + (s.ih || 0);
    const sizeStock = {};
    for (const s of sizes) { const n = availNow(s); if (n > 0) sizeStock[s.size] = n; }
    map.set(row.id, {
      units: sizes.reduce((a, s) => a + availNow(s), 0),
      sizes: Object.keys(sizeStock).sort((a, b) => sizeRank(a) - sizeRank(b)),
      sizeStock,
      incoming: sizes.some((s) => !availNow(s) && s.fd && s.fq), // nothing now, but inbound dated
    });
  }
  return map;
}
