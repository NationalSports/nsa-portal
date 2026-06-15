/* eslint-disable */
// Shared, state-free vendor stock lookup. Given a style/SKU it returns the
// supplier's live per-size on-hand (and next-available date for backorders).
//
// The parsing here mirrors OrderEditor.js → fetchVendorInventory, which is the
// version proven against each vendor's real (and quirky) response shapes. It is
// duplicated rather than imported because that one is wired into React state
// inside the order editor; this module is the state-free version the OMG store
// pull (App.js) calls per item. If you touch a parser, change both — and ideally
// fold the order editor onto this module in a follow-up.
//
// A module-level cache (10 min TTL) + in-flight de-dupe keep repeat lookups
// cheap, e.g. reopening an OMG store or the same SKU appearing on several rows.
import { normSzName } from './pricing';
import {
  richardsonGetStockInventory, ssApiCall,
  sanmarGetPromoInventory, sanmarGetInventory, sanmarGetPricing, sanmarGetProduct,
  momentecApiCall, momentecGetProductById, momentecGetProductByPartNumber, momentecSearchProducts,
} from './vendorApis';

const TTL = 10 * 60 * 1000;
const _cache = {};     // key -> { value, fetchedAt }
const _inflight = {};  // key -> Promise

// Map a vendor record (vendors table row) to a live-inventory source code.
// 'adidas' stock comes from the synced inventory_unified view, not an API, so the
// caller handles it separately; this still tags it so the caller can branch.
export function vendorInvSource(vendorRec, { brand } = {}) {
  const b = String(brand || '').toLowerCase();
  if (b === 'richardson') return 'rs';
  const ap = String(vendorRec?.api_provider || '').toLowerCase();
  const nm = String(vendorRec?.name || '').toLowerCase();
  if (ap === 'ss_activewear' || nm === 's&s activewear') return 'ss';
  if (ap === 'sanmar' || nm === 'sanmar') return 'sm';
  if (ap === 'momentec' || nm === 'momentec') return 'mt';
  if (ap === 'richardson' || nm === 'richardson') return 'rs';
  if (nm === 'adidas' || b === 'adidas') return 'adidas';
  return '';
}

// Fetch live per-size on-hand for one style from a supplier API.
//   source : 'ss' | 'sm' | 'mt' | 'rs'  (adidas/in-house handled by the caller)
//   item   : { sku, color, sizes:{}, available_sizes:[], _mtId? }
// Returns { sizes:{NORMSIZE:qty}, sizeNextAvail:{NORMSIZE:date}, nextAvail, source }.
// Momentec only publishes a binary in-stock flag, so its quantities come back as
// 999 ("in stock") or absent — treat any value > 0 as "available", not a count.
export async function fetchVendorSizeInventory(source, item) {
  const sku = String(item?.sku || '').trim();
  const empty = { sizes: {}, sizeNextAvail: {}, nextAvail: '', source };
  if (!sku || !['ss', 'sm', 'mt', 'rs'].includes(source)) return empty;
  const key = source + ':' + sku.toUpperCase() + ':' + String(item?.color || '').toLowerCase();
  const c = _cache[key];
  if (c && Date.now() - c.fetchedAt < TTL) return c.value;
  if (_inflight[key]) return _inflight[key];
  const run = (async () => {
    let value;
    if (source === 'rs') value = await _rs(sku, item);
    else if (source === 'mt') value = await _mt(sku, item);
    else if (source === 'sm') value = await _sm(sku, item);
    else value = await _ss(sku, item);
    _cache[key] = { value, fetchedAt: Date.now() };
    return value;
  })();
  _inflight[key] = run;
  try { return await run; } finally { delete _inflight[key]; }
}

// Fuzzy color token match (drop punctuation/filler, compare overlap).
const _tokenize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 /-]/g, '').split(/[\s/-]+/).filter((t) => t && !['solid', 'heather', 'dark', 'light'].includes(t));
const _colorHead = (s) => String(s || '').toLowerCase().split('/')[0].split(' ')[0];

// ─── Richardson: StockInventory feed, grouped byColor; pick the row's color ───
async function _rs(sku, item) {
  const sizes = {}; const sizeNextAvail = {}; let nextAvail = '';
  const data = await richardsonGetStockInventory(sku);
  const byColor = data?.byColor || {};
  const itemColor = String(item?.color || '').toLowerCase().trim();
  const itemTokens = new Set(_tokenize(itemColor));
  let picked = null;
  if (itemColor) {
    const colors = Object.keys(byColor);
    picked = colors.find((c) => c.toLowerCase() === itemColor);
    if (!picked && itemTokens.size) {
      let best = 0;
      colors.forEach((c) => { const ct = new Set(_tokenize(c)); let s = 0; ct.forEach((t) => { if (itemTokens.has(t)) s++; }); if (s > best) { best = s; picked = c; } });
    }
  }
  const itemSizes = (item?.available_sizes || Object.keys(item?.sizes || {}));
  const productIsOSFA = itemSizes.length === 1 && normSzName(itemSizes[0]) === 'OSFA';
  const normSize = (raw) => productIsOSFA ? 'OSFA' : String(raw || '').trim();
  const aggregate = (entry) => {
    if (!entry) return;
    Object.entries(entry.sizes || {}).forEach(([sz, q]) => { const n = normSize(sz); sizes[n] = (sizes[n] || 0) + (parseInt(q) || 0); });
    Object.entries(entry.sizeNextAvail || {}).forEach(([sz, d]) => { const n = normSize(sz); if (d && (!sizeNextAvail[n] || new Date(d) < new Date(sizeNextAvail[n]))) sizeNextAvail[n] = d; });
    if (entry.nextAvail && (!nextAvail || new Date(entry.nextAvail) < new Date(nextAvail))) nextAvail = entry.nextAvail;
  };
  if (picked) aggregate(byColor[picked]);
  else Object.values(byColor).forEach(aggregate); // no color match → style-level
  return { sizes, sizeNextAvail, nextAvail, source: 'rs' };
}

// ─── S&S Activewear: REST /Products, per-warehouse qty rolled up by size ───
async function _ss(sku, item) {
  let data;
  try {
    let sid = null;
    try {
      const st = await ssApiCall('/Styles?search=' + encodeURIComponent(sku));
      const sa = Array.isArray(st) ? st : st ? [st] : [];
      const exact = sa.find((s) => String(s.partNumber || s.styleName || '').toLowerCase() === String(sku).toLowerCase());
      sid = exact ? exact.styleID : (sa[0] && sa[0].styleID);
    } catch {}
    data = sid ? await ssApiCall('/Products/?style=' + encodeURIComponent(sid)) : await ssApiCall('/Products?style=' + encodeURIComponent(sku));
  } catch (e) {
    const padded = sku.length < 5 && /^\d+$/.test(sku) ? sku.padStart(5, '0') : sku;
    data = await ssApiCall('/Products?style=' + encodeURIComponent(padded));
  }
  const items = Array.isArray(data) ? data : data ? [data] : [];
  const sizes = {};
  const prodColor = String(item?.color || '').toLowerCase();
  const pc = _colorHead(prodColor);
  items.forEach((it) => {
    const itColor = String(it.colorName || '').toLowerCase();
    const ic = _colorHead(itColor);
    if (prodColor && itColor && ic && pc && !ic.includes(pc) && !pc.includes(ic)) return;
    const sz = normSzName(it.sizeName || 'OSFA');
    const qty = typeof it.qty === 'number' ? it.qty : parseInt(it.qty) || 0;
    sizes[sz] = (sizes[sz] || 0) + qty;
  });
  return { sizes, sizeNextAvail: {}, nextAvail: '', source: 'ss' };
}

// ─── SanMar: PromoStandards getInventoryLevels first, legacy SOAP fallbacks ───
async function _sm(sku, item) {
  const prodColor = String(item?.color || '');
  const sizes = {};
  let ok = false;
  // Primary: PromoStandards (one call, per-variation inventory).
  try {
    const promo = await sanmarGetPromoInventory(sku);
    const invArr = promo?.ProductVariationInventoryArray?.ProductVariationInventory
      || promo?.productVariationInventoryArray?.productVariationInventory
      || promo?.Inventory?.ProductVariationInventoryArray?.ProductVariationInventory
      || promo?.inventory?.productVariationInventoryArray?.productVariationInventory
      || promo?.items || promo?.Inventory || promo?.inventory || [];
    const variations = Array.isArray(invArr) ? invArr : [invArr];
    variations.forEach((v) => {
      const sz = normSzName(v?.attributeSize || v?.size || v?.labelSize || 'OSFA');
      const color = v?.attributeColor || v?.color || '';
      if (prodColor && color) {
        const pc = _colorHead(prodColor), vc = _colorHead(color);
        if (pc && vc && !vc.includes(pc) && !pc.includes(vc)) return;
      }
      let qty = 0;
      const partArr = v?.partInventoryArray?.partInventory || v?.PartInventoryArray?.PartInventory;
      if (partArr) (Array.isArray(partArr) ? partArr : [partArr]).forEach((p) => {
        const q = parseInt(p?.quantityAvailable?.Quantity || p?.quantityAvailable?.quantity || p?.quantityAvailable || 0) || 0;
        if (q > 0) qty += q;
      });
      if (qty <= 0) qty = parseInt(v?.quantityAvailable || v?.totalQty || v?.qty || 0) || 0;
      if (qty > 0) { sizes[sz] = (sizes[sz] || 0) + qty; ok = true; }
    });
  } catch (e) { /* fall through to legacy */ }
  // Fallback A: legacy getInventoryQtyForStyleColorSize, per known size.
  if (!ok) {
    const known = Object.keys(item?.sizes || {}).filter(Boolean);
    const sizesToTry = known.length ? known : ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
    for (const tryColor of [prodColor, '']) {
      const before = Object.keys(sizes).length;
      await Promise.all(sizesToTry.map(async (sz) => {
        try {
          const inv = await sanmarGetInventory(sku, tryColor, sz);
          let rows = inv?.items || [];
          if (!rows.length && inv?.listResponse) rows = Array.isArray(inv.listResponse) ? inv.listResponse : [inv.listResponse];
          if (!rows.length && inv?.return) rows = Array.isArray(inv.return) ? inv.return : [inv.return];
          if (!rows.length && inv && (inv.size || inv.totalQty || inv.qty || inv.warehouseInfo)) rows = [inv];
          rows = rows.filter((it) => it && it.errorOccurred !== 'true' && it.errorOccured !== 'true');
          let qty = 0;
          rows.forEach((it) => {
            let q = parseInt(it.totalQty || it.qty || it.quantity || 0) || 0;
            if (q <= 0 && it.warehouseInfo) {
              const det = it.warehouseInfo.inventoryDetail || it.warehouseInfo;
              (Array.isArray(det) ? det : [det]).forEach((d) => { if (d && d.quantity) q += parseInt(d.quantity) || 0; });
            }
            qty += q;
          });
          if (qty > 0) { const n = normSzName(sz); sizes[n] = (sizes[n] || 0) + qty; ok = true; }
        } catch {}
      }));
      if (Object.keys(sizes).length > before) break; // don't double-count across color passes
    }
  }
  // Fallback B: aggregate call (last resort, e.g. OSFA-only spelling mismatches).
  if (!ok) {
    for (const tryColor of [prodColor, '']) {
      if (ok) break;
      try {
        const inv = await sanmarGetInventory(sku, tryColor, '');
        let rows = inv?.items || [];
        if (!rows.length && inv?.listResponse) rows = Array.isArray(inv.listResponse) ? inv.listResponse : [inv.listResponse];
        if (!rows.length && inv?.return) rows = Array.isArray(inv.return) ? inv.return : [inv.return];
        if (!rows.length && (inv?.size || inv?.totalQty || inv?.warehouseInfo)) rows = [inv];
        rows.forEach((it) => {
          if (it.errorOccurred === 'true' || it.errorOccured === 'true') return;
          const sz = normSzName(it.size || it.labelSize || 'OSFA');
          let qty = parseInt(it.totalQty || it.qty || it.quantity || 0) || 0;
          if (qty <= 0 && it.warehouseInfo) {
            const det = it.warehouseInfo.inventoryDetail || it.warehouseInfo;
            (Array.isArray(det) ? det : [det]).forEach((d) => { if (d && d.quantity) qty += parseInt(d.quantity) || 0; });
          }
          if (qty > 0) { sizes[sz] = (sizes[sz] || 0) + qty; ok = true; }
        });
      } catch {}
    }
  }
  // Last resort: product info carries an inventoryQty on some styles.
  if (!Object.keys(sizes).length) {
    try {
      const pd = await sanmarGetProduct(sku, prodColor, '');
      (pd?.items || []).forEach((raw) => {
        const it = { ...(raw.productBasicInfo || {}), ...(raw.productPriceInfo || {}), ...raw };
        const sz = normSzName(it.size || it.labelSize || 'OSFA');
        const qty = parseInt(it.inventoryQty || it.qty || 0) || 0;
        if (qty > 0) sizes[sz] = (sizes[sz] || 0) + qty;
      });
    } catch {}
  }
  return { sizes, sizeNextAvail: {}, nextAvail: '', source: 'sm' };
}

// ─── Momentec: HCL Commerce — child SKUs → binary inventoryavailability ───
async function _mt(sku, item) {
  const sizes = {};
  const getSkSize = (e) => { const attrs = e.Attributes || e.attributes || e.definingAttributes || []; if (Array.isArray(attrs)) for (const a of attrs) { const id = (a.identifier || '').toLowerCase(); const n = (a.name || '').toLowerCase(); if (id === 'asgswatchsize' || n === 'available sizes' || n === 'size') { const vals = a.values || a.Values || []; if (vals.length) return (vals[0].values || vals[0].value || vals[0].identifier || '').trim(); } } return ''; };
  const getSkColor = (e) => { const attrs = e.Attributes || e.attributes || e.definingAttributes || []; if (Array.isArray(attrs)) for (const a of attrs) { const n = (a.name || a.identifier || '').toLowerCase(); if (n === 'color' || n === 'colour' || n === 'clr' || n === 'asgswatchcolor') { const vals = a.values || a.Values || []; if (vals.length) return vals.map((v) => v.values || v.value || v.Value || v.identifier || v).join('/'); } } return ''; };
  try {
    let entry = null;
    if (item?._mtId) { try { const d = await momentecGetProductById(item._mtId); entry = d?.CatalogEntryView?.[0]; } catch {} }
    if (!entry) { try { const d = await momentecGetProductByPartNumber(sku); entry = d?.CatalogEntryView?.[0]; } catch {} }
    if (!entry) {
      try {
        const sr = await momentecSearchProducts(sku, 5, 1);
        const entries = sr?.CatalogEntryView || sr?.catalogEntryView || [];
        const match = entries.find((e) => (e.partNumber || '') === sku) || entries[0];
        if (match) { const uid = match.uniqueID; if (uid) { try { const d2 = await momentecGetProductById(uid); entry = d2?.CatalogEntryView?.[0]; } catch {} } if (!entry) entry = match; }
      } catch {}
    }
    if (entry) {
      const skus = entry.SKUs || entry.sKUs || [];
      const itemColor = String(item?.color || '').toLowerCase();
      const childParts = [];
      for (const sk of skus) {
        const skColor = (getSkColor(sk) || '').toLowerCase();
        if (itemColor && skColor && !skColor.includes(_colorHead(itemColor)) && !itemColor.includes(_colorHead(skColor))) continue;
        const sz = normSzName(getSkSize(sk)); if (!sz) continue;
        const qty = parseInt(sk.buyQuantity || sk.inventoryQuantity || sk.quantity || 0) || 0;
        if (qty > 0) sizes[sz] = (sizes[sz] || 0) + qty;
        const skuUid = sk.SKUUniqueID || sk.skuUniqueID || sk.uniqueID || '';
        if (skuUid) childParts.push({ skuUid, sz });
      }
      if (!Object.keys(sizes).length && childParts.length) {
        const ids = childParts.map((x) => x.skuUid).filter(Boolean);
        if (ids.length) {
          try {
            const invData = await momentecApiCall(`/inventoryavailability/${ids.join(',')}`);
            (invData?.InventoryAvailability || []).forEach((inv) => {
              const pid = inv.productId || inv.inventoryAvailabilityByProductId || '';
              const status = String(inv.inventoryStatus || '').toLowerCase();
              const isAvail = status === 'available' || status === 'instock' || status === 'in stock';
              const raw = parseFloat(inv.availableQuantity || 0);
              const qty = (raw > 999999 || isAvail) ? 999 : parseInt(raw) || 0; // binary flag, not a count
              const m = childParts.find((x) => x.skuUid === pid);
              if (m) sizes[m.sz] = Math.max(sizes[m.sz] || 0, qty);
            });
          } catch {}
        }
      }
    }
  } catch {}
  // Fallback: direct style-level availability flag → mark ordered sizes available.
  if (!Object.keys(sizes).length) {
    try {
      const invData = await momentecApiCall(`/inventoryavailability/${encodeURIComponent(sku)}`);
      const any = (invData?.InventoryAvailability || []).some((inv) => {
        const status = String(inv.inventoryStatus || '').toLowerCase();
        return status === 'available' || status === 'instock' || status === 'in stock' || parseFloat(inv.availableQuantity || 0) > 0;
      });
      if (any) {
        const ds = Object.keys(item?.sizes || {}).filter(Boolean);
        (ds.length ? ds : (item?.available_sizes || ['S', 'M', 'L', 'XL', '2XL'])).forEach((sz) => { sizes[normSzName(sz)] = 999; });
      }
    } catch {}
  }
  return { sizes, sizeNextAvail: {}, nextAvail: '', source: 'mt' };
}
