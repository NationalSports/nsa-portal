// Vendor stock for the phone's quote builder. Reads the synced vendor feeds
// (inventory_unified: adidas, UA, Agron, Nike, Richardson, Momentec, SanMar,
// S&S) through the same public endpoint the desktop editor uses for B2B stock.
// SanMar rows are keyed STYLE-Color, so a line is looked up by its style and
// by style + color; the color-specific match wins when both exist.
import { fetchPublicInventory } from './webstorePublicData';

const SIZE_ALIAS = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL', '2X': '2XL', '3X': '3XL', '4X': '4XL', 'ONE SIZE': 'OSFA', OS: 'OSFA' };
export const normStockSize = (s) => { const v = String(s || '').trim().toUpperCase(); return SIZE_ALIAS[v] || v; };

export function stockKeys(item) {
  const sku = String(item?.sku || '').trim();
  if (!sku) return [];
  const color = String(item?.color || '').replace(/[^A-Za-z0-9]/g, '');
  return color && !sku.includes('-') ? [sku, sku + '-' + color] : [sku];
}
export const stockCacheKey = (item) => stockKeys(item).join('|');

// rows from inventory_unified → { sizes: {M: {qty, futureDate, futureQty}}, lastSynced, source } or null.
export function stockFromRows(rows, keys) {
  const has = (k) => (rows || []).some((r) => r.sku === k);
  const pick = [...keys].reverse().find(has);
  if (!pick) return null;
  const sizes = {};
  let lastSynced = null;
  let source = null;
  rows.filter((r) => r.sku === pick).forEach((r) => {
    const sz = normStockSize(r.size);
    if (!sz) return;
    const s = sizes[sz] || (sizes[sz] = { qty: 0, futureDate: null, futureQty: 0 });
    s.qty += Number(r.stock_qty) || 0;
    if (r.future_delivery_date && (!s.futureDate || r.future_delivery_date < s.futureDate)) s.futureDate = r.future_delivery_date;
    s.futureQty += Number(r.future_delivery_qty) || 0;
    if (r.last_synced && (!lastSynced || r.last_synced > lastSynced)) lastSynced = r.last_synced;
    source = source || r.source || null;
  });
  return { sizes, lastSynced, source };
}

// Sizes on the line asking for more than the vendor has.
export function shortSizes(item, stock) {
  if (!stock) return [];
  return Object.entries(item?.sizes || {}).filter(([sz, q]) => {
    const n = Number(q) || 0;
    const s = stock.sizes[normStockSize(sz)];
    return n > 0 && s && n > s.qty;
  }).map(([sz]) => sz);
}

export const SOURCE_LABEL = { click: 'adidas', agron: 'Agron', ua: 'Under Armour', nike: 'Nike', richardson: 'Richardson', momentec: 'Momentec', sanmar: 'SanMar', ss_activewear: 'S&S' };

// One request for every line not already looked up. Returns {cacheKey: stock|null}.
export async function fetchStockForItems(items, fetcher = fetchPublicInventory) {
  const lines = (items || []).filter((it) => stockKeys(it).length);
  if (!lines.length) return {};
  const rows = await fetcher([...new Set(lines.flatMap(stockKeys))]);
  const out = {};
  lines.forEach((it) => { out[stockCacheKey(it)] = stockFromRows(rows, stockKeys(it)); });
  return out;
}
