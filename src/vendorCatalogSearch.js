// Live vendor-catalog search for the webstore builder.
//
// The webstore product picker searches the local `products` catalog (a curated subset).
// This module lets it ALSO look up any style live from the vendor APIs — SanMar/District,
// S&S Activewear, Richardson and Momentec — so a rep can pull a style (e.g. DM130, PC61)
// that isn't in the catalog yet. Picked colorways are then imported into `products` so they
// can be dropped into a store (webstore_products needs a real catalog product_id).
//
// Each vendor returns a differently-shaped payload; the parsers below mirror the proven
// normalisation the order editor uses and fold everything into ONE common style shape:
//   { source, vendorId, sku, name, brand, image, colors: [
//       { colorName, sku, image, cost, sizes: ['S','M',…], totalQty } ] }

import { sanmarGetProduct, sanmarGetInventory, sanmarGetPricing, ssApiCall, richardsonSearchStyles, momentecStyleV2 } from './vendorApis';
import { normSzName } from './pricing';

const SS_CDN = 'https://cdn.ssactivewear.com/';
const ssCdnImg = (u) => {
  const s = (u || '').toString().trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s.replace(/^http:\/\//i, 'https://');
  if (s.startsWith('//')) return 'https:' + s;
  return SS_CDN + s.replace(/^\/+/, '');
};

// Real vendor id comes from the DB vendors table (passed in as a {provider:id} map). We
// never guess an id — products.vendor_id has a FK to vendors, so an unknown provider maps
// to null (allowed) rather than a bogus id that would fail the import.
const vid = (provider, map) => (map && map[provider]) || null;

// ── SanMar ──────────────────────────────────────────────────────────────────
async function searchSanMar(query, vendorMap) {
  const q = query.toUpperCase().trim();
  const prodData = await sanmarGetProduct(q);
  const raw = prodData?.items || [];
  const items = raw.filter((r) => {
    const bi = r.productBasicInfo || r; const pi = r.productPriceInfo || r;
    return !!(bi.brandName) && parseFloat(pi.piecePrice || pi.casePrice || 0) > 0;
  });
  if (!items.length) return [];
  // Inventory + program pricing (best-effort).
  const invData = {}; const priceMap = {};
  try {
    const [invRes, priceRes] = await Promise.all([
      sanmarGetInventory(q, '', '').catch(() => null),
      sanmarGetPricing(q, '', '').catch(() => null),
    ]);
    let inv = invRes?.items || [];
    if (!inv.length && invRes?.listResponse) inv = Array.isArray(invRes.listResponse) ? invRes.listResponse : [invRes.listResponse];
    inv = inv.filter((it) => it.errorOccurred !== 'true' && it.errorOccured !== 'true');
    inv.forEach((it) => {
      const key = (it.color || it.colorName || '') + '|' + normSzName(it.size || it.labelSize || '');
      let qty = parseInt(it.totalQty || it.qty || it.quantity || 0) || 0;
      if (qty <= 0 && it.warehouseInfo) { const d = it.warehouseInfo.inventoryDetail || it.warehouseInfo; (Array.isArray(d) ? d : [d]).forEach((w) => { if (w && w.quantity) qty += parseInt(w.quantity) || 0; }); }
      invData[key] = qty;
    });
    (priceRes?.items || []).forEach((it) => {
      const color = it.catalogColor || it.color || it.colorName || '';
      const sz = normSzName(it.size || it.labelSize || '');
      const price = parseFloat(it.myPrice || 0) || parseFloat(it.salePrice || 0) || parseFloat(it.piecePrice || 0) || 0;
      if (price > 0) priceMap[color + '|' + sz] = price;
    });
  } catch (e) { /* inventory/pricing optional */ }
  const styleMap = {};
  items.forEach((r) => {
    const bi = r.productBasicInfo || {}; const ii = r.productImageInfo || {}; const pi = r.productPriceInfo || {};
    const it = { ...bi, ...ii, ...pi, ...r };
    const sid = it.style || it.styleNumber || q;
    const color = it.catalogColor || it.color || it.colorName || it.productColor || '';
    if (!styleMap[sid]) styleMap[sid] = { source: 'sm', vendorId: vid('sanmar', vendorMap), sku: sid, name: ((it.brandName || it.brand || '') + ' ' + (it.productTitle || it.styleName || it.description || sid)).trim(), brand: it.brandName || it.brand || '', image: it.colorProductImage || it.productImage || it.colorProductImageThumbnail || it.thumbnailImage || '', _colors: {} };
    const cKey = sid + '|' + color;
    if (!styleMap[sid]._colors[cKey]) styleMap[sid]._colors[cKey] = { colorName: color, sku: sid, image: it.colorProductImage || it.productImage || it.colorSwatchImage || '', cost: 0, _sizes: {}, totalQty: 0 };
    const cEntry = styleMap[sid]._colors[cKey];
    const sz = normSzName(it.size || it.labelSize || it.sizeCode || 'OSFA');
    const price = priceMap[color + '|' + sz] || parseFloat(it.piecePrice || 0) || 0;
    const qty = invData[color + '|' + sz] || parseInt(it.inventoryQty || it.qty || 0) || 0;
    if (sz) cEntry._sizes[sz] = (cEntry._sizes[sz] || 0) + qty;
    cEntry.totalQty += qty;
    if (price > 0 && (cEntry.cost === 0 || price < cEntry.cost)) cEntry.cost = price;
  });
  return Object.values(styleMap).map((s) => ({ ...s, colors: Object.values(s._colors).map((c) => ({ colorName: c.colorName, sku: c.sku, image: c.image, cost: c.cost, sizes: Object.keys(c._sizes), totalQty: c.totalQty })), _colors: undefined }));
}

// ── S&S Activewear ──────────────────────────────────────────────────────────
async function searchSS(query, vendorMap) {
  let styleMatches = [];
  try { const styles = await ssApiCall('/Styles?search=' + encodeURIComponent(query)); styleMatches = Array.isArray(styles) ? styles : styles ? [styles] : []; } catch (e) { return []; }
  if (!styleMatches.length) return [];
  const styleIDs = [...new Set(styleMatches.map((s) => s.styleID).filter(Boolean))].slice(0, 5);
  if (!styleIDs.length) return [];
  let items = [];
  try { const data = await ssApiCall('/Products/?style=' + encodeURIComponent(styleIDs.join(','))); items = Array.isArray(data) ? data : data ? [data] : []; } catch (e) { return []; }
  if (!items.length) return [];
  const styleMap = {};
  items.forEach((it) => {
    const sid = it.styleID || it.styleName || query;
    const img = ssCdnImg(it.colorFrontImage || it.colorSideImage || '');
    if (!styleMap[sid]) {
      const sInfo = styleMatches.find((s) => String(s.styleID) === String(sid)) || {};
      styleMap[sid] = { source: 'ss', vendorId: vid('ss_activewear', vendorMap), sku: (it.styleName || sInfo.partNumber || query).toUpperCase(), name: sInfo.title || (it.brandName ? (it.brandName + ' ' + (it.styleName || query)) : it.styleName || query), brand: it.brandName || sInfo.brandName || '', image: sInfo.styleImage || img || '', _colors: {}, _styleSku: (it.styleName || sInfo.partNumber || query).toUpperCase() };
    }
    const color = it.colorName || '';
    const cKey = sid + '|' + color;
    if (!styleMap[sid]._colors[cKey]) styleMap[sid]._colors[cKey] = { colorName: color, sku: styleMap[sid]._styleSku, image: img, cost: 0, _sizes: {}, totalQty: 0 };
    const cEntry = styleMap[sid]._colors[cKey];
    if (img && !cEntry.image) cEntry.image = img;
    const sz = it.sizeName || 'OSFA';
    const qty = typeof it.qty === 'number' ? it.qty : parseInt(it.qty) || 0;
    const p = parseFloat(it.customerPrice) || parseFloat(it.piecePrice) || 0;
    cEntry._sizes[sz] = (cEntry._sizes[sz] || 0) + qty;
    cEntry.totalQty += qty;
    if (p > 0 && (cEntry.cost === 0 || p < cEntry.cost)) cEntry.cost = p;
  });
  return Object.values(styleMap).map((s) => ({ source: s.source, vendorId: s.vendorId, sku: s.sku, name: s.name, brand: s.brand, image: s.image, colors: Object.values(s._colors).map((c) => ({ colorName: c.colorName, sku: c.sku, image: c.image, cost: c.cost, sizes: Object.keys(c._sizes), totalQty: c.totalQty })) }));
}

// ── Richardson ──────────────────────────────────────────────────────────────
async function searchRichardson(query, vendorMap) {
  const data = await richardsonSearchStyles(query);
  const matches = data?.results || [];
  if (!matches.length) return [];
  return matches.map((m) => ({
    source: 'rs', vendorId: vid('richardson', vendorMap), sku: m.style, name: 'Richardson ' + m.style, brand: 'Richardson', image: '',
    colors: Object.entries(m.byColor || {}).map(([colorName, info]) => {
      const sizes = Object.keys(info.sizes || {});
      const totalQty = Object.values(info.sizes || {}).reduce((a, v) => a + (parseInt(v) || 0), 0);
      return { colorName, sku: m.style, image: '', cost: 0, sizes, totalQty };
    }),
  }));
}

// ── Momentec ────────────────────────────────────────────────────────────────
async function searchMomentec(query, vendorMap) {
  const design = String(query || '').split('.')[0].trim();
  if (!design) return [];
  const s = await momentecStyleV2(design).catch(() => null);
  if (!s || !Array.isArray(s.colors) || !s.colors.length) return [];
  return [{ source: 'mt', vendorId: vid('momentec', vendorMap), sku: s.sku, name: s.styleName || s.sku, brand: 'Momentec', image: s.styleImage || '',
    colors: s.colors.map((c) => ({ colorName: c.colorName, sku: c.sku, image: c.colorFrontImage || '', cost: c.customerPrice || c.piecePrice || 0, sizes: (c.sizes || []).map((z) => z.sizeName).filter(Boolean), totalQty: c.totalQty || 0 })) }];
}

// Search every vendor in parallel; each failure is isolated. Returns { results, errors }.
export async function searchVendorCatalogs(query, { vendorMap = {} } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return { results: [], errors: {} };
  const runners = [
    ['SanMar', () => searchSanMar(q, vendorMap)],
    ['S&S Activewear', () => searchSS(q, vendorMap)],
    ['Richardson', () => searchRichardson(q, vendorMap)],
    ['Momentec', () => searchMomentec(q, vendorMap)],
  ];
  const settled = await Promise.allSettled(runners.map(([, fn]) => fn()));
  const results = []; const errors = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) results.push(...r.value.filter((s) => s && s.colors && s.colors.length));
    else if (r.status === 'rejected') errors[runners[i][0]] = String(r.reason?.message || r.reason || 'failed');
  });
  return { results, errors };
}

// A vendor style + one of its colorways → a `products`-row shaped object ready to upsert.
// Deterministic id keyed on source/style/color so re-importing the same colorway updates
// rather than duplicates. Sell price seeds at ~2× cost (a 50% margin baseline); the store
// price is editable afterwards.
export function vendorColorToProductRow(style, color) {
  const slug = String(color.colorName || 'default').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
  const cost = Number(color.cost) || 0;
  const retail = cost > 0 ? Math.ceil(cost / 0.5) : 0;
  return {
    id: `${style.source}-${String(style.sku).toLowerCase()}-${slug}`,
    vendor_id: style.vendorId || null,
    sku: `${style.sku}-${slug}`.toUpperCase(),
    name: style.name || style.sku,
    brand: style.brand || null,
    color: color.colorName || null,
    category: null,
    retail_price: retail,
    nsa_cost: cost || null,
    is_active: true,
    is_archived: false,
    available_sizes: Array.isArray(color.sizes) ? color.sizes : [],
    image_front_url: color.image || style.image || null,
    inventory_source: style.source === 'sm' ? 'sanmar' : style.source === 'ss' ? 'ss_activewear' : style.source === 'rs' ? 'richardson' : style.source === 'mt' ? 'momentec' : null,
  };
}
