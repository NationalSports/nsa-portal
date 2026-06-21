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
  const skus = [...new Set(rows.map((r) => r.sku).filter(Boolean))];
  const map = new Map();
  if (!ids.length && !skus.length) return map;
  const [vend, inhouse] = await Promise.all([
    skus.length
      ? supabase.from('inventory_unified').select('sku,size,stock_qty,future_delivery_date,future_delivery_qty').in('sku', skus).or('stock_qty.gt.0,future_delivery_qty.gt.0')
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from('product_inventory').select('product_id,size,quantity').in('product_id', ids).gt('quantity', 0)
      : Promise.resolve({ data: [] }),
  ]);
  const bySku = {};
  for (const r of vend.data || []) (bySku[r.sku] = bySku[r.sku] || []).push({ size: r.size, q: r.stock_qty || 0, fd: r.future_delivery_date, fq: r.future_delivery_qty });
  const byPid = {};
  for (const r of inhouse.data || []) { byPid[r.product_id] = byPid[r.product_id] || {}; byPid[r.product_id][r.size] = (byPid[r.product_id][r.size] || 0) + (r.quantity || 0); }
  for (const row of rows) {
    const sizes = (bySku[row.sku] || []).map((s) => ({ ...s }));
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
