// On-demand vendor stock backfill for ONE style — POST { style: 'ST485', source: 'sanmar' }.
//
// The storefront reads synced vendor stock (sanmar_inventory via inventory_unified), which
// otherwise only the NIGHTLY brands-sync writes. A style imported from the live vendor
// search would read "sold out" (or sell blind via the storefront's unsynced fallback)
// until that sync ran. The webstore picker calls this right after importing a style so
// real per-size stock lands immediately.
//
// The SanMar block mirrors sanmar-brands-sync-background's per-style ingest (product info
// for the color→code map + PromoStandards getInventoryLevels → upsert sanmar_inventory,
// on_conflict sku,size) — keep the two in step. Inventory rows ONLY: the products rows
// already exist from the import, and the nightly sync remains the source of truth for
// pricing/images.
//
// Abuse surface is small (idempotent upsert of true vendor data; one style per call,
// style format validated) — same open-endpoint pattern as richardson-inventory.
//
// Env: URL, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_FUNCTION_SECRET.

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const arr = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const site  = (process.env.URL || '').replace(/\/+$/, '');
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!site || !sbUrl || !sbKey) return { statusCode: 500, body: 'Not configured' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* fall through */ }
  const style = String(body.style || '').trim().toUpperCase();
  const source = String(body.source || 'sanmar').trim().toLowerCase();
  if (!/^[A-Z0-9]{2,14}$/.test(style)) return { statusCode: 400, body: JSON.stringify({ error: 'Bad style' }) };
  if (source !== 'sanmar' && source !== 'sm') return { statusCode: 400, body: JSON.stringify({ error: 'Only sanmar supported' }) };

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });
  const sm = async (service, action, payload) => {
    const res = await fetch(site + '/.netlify/functions/sanmar-proxy?service=' + service + '&action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET || sbKey },
      body: JSON.stringify(payload || {}),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(service + '/' + action + ': ' + (j.error || res.status));
    return j;
  };

  try {
    // Color→code map + size list per colorway (same folding as the nightly sync).
    const prod = await sm('product', 'getProductInfoByStyleColorSize', { style, color: '', size: '' });
    const items = arr(prod.items).map((raw) => ({ ...(raw.productBasicInfo || {}), ...(raw.productImageInfo || {}), ...(raw.productPriceInfo || {}), ...raw }));
    if (!items.length) return { statusCode: 404, body: JSON.stringify({ error: 'Style not found', style }) };

    // Per-color+size stock from PromoStandards getInventoryLevels.
    const stockByCS = {};
    try {
      const inv = await sm('promostandards', 'getInventoryLevels', { productId: style });
      const variations = arr(
        inv?.Inventory?.ProductVariationInventoryArray?.ProductVariationInventory ||
        inv?.ProductVariationInventoryArray?.ProductVariationInventory ||
        inv?.inventory || inv?.items
      );
      variations.forEach((v) => {
        const color = String(v?.attributeColor || v?.color || '').toLowerCase();
        const size  = String(v?.attributeSize || v?.size || v?.labelSize || 'OSFA').trim();
        let qty = 0;
        const parts = arr(v?.partInventoryArray?.partInventory || v?.PartInventoryArray?.PartInventory);
        parts.forEach((p) => { qty += num(p?.quantityAvailable?.Quantity || p?.quantityAvailable?.quantity || p?.quantityAvailable); });
        if (qty <= 0) qty = num(v?.quantityAvailable || v?.totalQty || v?.qty);
        if (qty > 0) stockByCS[color + '|' + size] = (stockByCS[color + '|' + size] || 0) + qty;
      });
    } catch (e) { console.warn('[vendor-stock-backfill] inventory', style, e.message); }

    const byColor = {};
    for (const it of items) {
      const colorName = it.colorName || it.color || it.catalogColor || 'NA';
      const code = String(it.colorCode || colorName).replace(/\s+/g, '');
      (byColor[code] = byColor[code] || { colorName, recs: [] }).recs.push(it);
    }
    const invUpserts = [];
    for (const [colorCode, grp] of Object.entries(byColor)) {
      const sku = style + '-' + colorCode;
      const sizes = [...new Set(grp.recs.map((r) => String(r.size || r.labelSize || '').trim()).filter(Boolean))];
      for (const size of sizes) {
        const key = String(grp.colorName).toLowerCase() + '|' + size;
        invUpserts.push({
          id: sku + '-' + size, sku, size, stock_qty: stockByCS[key] || 0,
          last_synced: new Date().toISOString(), source: 'sanmar',
          style_number: style, color_code: colorCode,
        });
      }
    }
    for (let j = 0; j < invUpserts.length; j += 500) {
      const ir = await sb('sanmar_inventory?on_conflict=sku,size', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(invUpserts.slice(j, j + 500)),
      });
      if (!ir.ok) throw new Error('sanmar_inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
    }
    console.log('[vendor-stock-backfill]', style, invUpserts.length, 'inventory rows');
    return { statusCode: 200, body: JSON.stringify({ style, inventory_rows: invUpserts.length }) };
  } catch (e) {
    console.error('[vendor-stock-backfill]', style, e);
    return { statusCode: 502, body: JSON.stringify({ error: e.message, style }) };
  }
};
