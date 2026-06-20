// Background function (15-min limit): syncs the full Momentec Brands catalog
// into the portal so the public Team Catalog (/adidas, /livelook) shows
// Momentec team apparel with images, sizes, and live inventory.
//
// Data source: Momentec /v2/Style (api.momentecbrands.com). Catalog reads are
// public — no credentials needed (the "Basic" variant returns MSRP, images,
// colors, sizes and live stock; dealer creds only add customer cart pricing).
// We keep using the HCL storefront purely to *enumerate* design numbers, then
// enrich each design from /v2/Style.
//
// One design (e.g. "790") fans out into many color/size SKUs ("790.029.2XL").
// We materialise:
//   products           — one row per design+color, id 'mt-{design}-{color}',
//                        sku '{design}.{color}', brand 'Momentec',
//                        15% dealer discount off MSRP, sell = cost×1.65,
//                        per-color images from the static CDN pattern.
//   momentec_inventory — one row per colorway sku + size with live stock,
//                        unioned into inventory_unified so LiveLook sees it.
//
// Triggered by momentec-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/momentec-sync-background
// Optional query params (manual runs / testing):
//   ?design=790   — sync a single design only
//   ?limit=50     — sync only the first N designs
//   ?concurrency=6 — parallel /v2/Style calls (default 6)
//
// Env: MOMENTEC_STORE_ID (optional, default 10251),
//      MOMENTEC_V2_ENV ('prod' default | 'stage'),
//      REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const MOMENTEC_BASE = 'https://www.momentecbrands.com';
const V2_HOSTS = {
  stage: 'https://stage-api.momentecbrands.com',
  prod:  'https://api.momentecbrands.com',
};
const IMG_BASE = 'https://static.momentecbrands.com/product';

const CATEGORY_RULES = [
  ['1/4 Zips', /QUARTER[- ]ZIP|1\/4[- ]ZIP/i],
  ['Outerwear', /FULL[- ]ZIP|JACKET|VEST|WINDBREAKER|OUTERWEAR|RAIN/i],
  ['Polos', /POLO/i],
  ['Hats', /HEADWEAR|\bCAP\b|BEANIE|VISOR/i],
  ['Hoods', /HOOD|FLEECE|SWEATSHIRT|PULLOVER/i],
  ['Crew', /CREW/i],
  ['Shorts', /SHORT/i],
  ['Pants', /PANT|LEGGING|BOTTOM|JOGGER|TIGHT/i],
  ['Tees', /T-SHIRT|\bTEE\b|ACTIVE/i],
  ['Jersey', /JERSEY|UNIFORM/i],
  ['Bags', /\bBAG\b|BACKPACK|DUFFEL/i],
  ['Socks', /\bSOCK\b/i],
];
function mapCategory(name) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(String(name || ''))) return cat;
  return 'Other';
}
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const arr = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);
// Strip HTML tags + decode the handful of entities Momentec descriptions use.
function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#44;/g, ',').replace(/&nbsp;/g, ' ')
    .replace(/&trade;/g, '™').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

// Simple fixed-size concurrency pool over `items`.
async function mapPool(items, concurrency, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const storeId = process.env.MOMENTEC_STORE_ID || '10251';
  const v2Env = (qs.env || process.env.MOMENTEC_V2_ENV || 'prod').toLowerCase();
  const v2Host = V2_HOSTS[v2Env] || V2_HOSTS.prod;
  const concurrency = Math.min(12, Math.max(1, parseInt(qs.concurrency, 10) || 6));
  const onlyDesign = qs.design ? String(qs.design).trim() : null;
  const designLimit = qs.limit ? parseInt(qs.limit, 10) : null;

  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    console.error('[momentec-sync] missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return { statusCode: 500, body: 'Not configured' };
  }

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });
  // HCL storefront GET (used only to enumerate design numbers).
  const store = async (path) => {
    const url = `${MOMENTEC_BASE}/wcs/resources/store/${storeId}${path}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Momentec ' + path + ' → ' + res.status);
    const text = await res.text();
    if (text.trimStart().startsWith('<')) throw new Error('Momentec returned HTML for ' + path);
    return JSON.parse(text);
  };
  // /v2/Style — POST { productOrDesignNumber }. Basic (no creds) is enough.
  const style = async (design) => {
    const res = await fetch(`${v2Host}/v2/Style`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productOrDesignNumber: design }),
    });
    if (!res.ok) throw new Error('Style ' + design + ' → ' + res.status);
    return res.json();
  };
  const upsertBatched = async (table, conflict, rows) => {
    for (let i = 0; i < rows.length; i += 500) {
      const r = await sb(`${table}?on_conflict=${conflict}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 500)),
      });
      if (!r.ok) throw new Error(`${table} upsert ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  };

  try {
    // Momentec vendor id
    const vRes = await sb('vendors?api_provider=eq.momentec&select=id&limit=1');
    const vendors = await vRes.json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No Momentec vendor configured (api_provider=momentec)' };
    const discount = 0.15;

    // 1) Enumerate design numbers.
    let designs;
    if (onlyDesign) {
      designs = [onlyDesign];
    } else {
      const seen = new Set();
      const pageSize = 50;
      let page = 1, total = 0, fetched = 0;
      do {
        const data = await store(`/productview/bySearchTerm/*?pageSize=${pageSize}&pageNumber=${page}`);
        const items = arr(data.CatalogEntryView);
        for (const e of items) {
          const pn = String(e.partNumber || e.id || e.uniqueID || '').trim();
          if (pn) seen.add(pn);
        }
        fetched += items.length;
        total = num(data.recordSetTotal) || fetched;
        page++;
      } while (fetched < total && page <= 200);
      designs = [...seen];
      if (designLimit && designs.length > designLimit) designs = designs.slice(0, designLimit);
    }
    console.log('[momentec-sync] designs to enrich:', designs.length, `(v2: ${v2Env}, conc: ${concurrency})`);

    // 2) Enrich each design from /v2/Style → per-color products + per-size stock.
    const productRows = [];
    const invRows = [];
    const errors = [];
    let designsOk = 0, customSkipped = 0;
    const stamp = new Date().toISOString();

    await mapPool(designs, concurrency, async (design) => {
      try {
        const data = await style(design);
        for (const pi of arr(data.productInfo)) {
          const name = String(pi.Name || design);
          // Skip Momentec "Custom" programs (made-to-order, not blank stock) so they
          // never enter the catalog / live-look. Mirrors AdidasInventory's display guard.
          if (/custom/i.test(name)) { customSkipped++; continue; }
          const desc = stripHtml(pi.longDescription).slice(0, 1000) || null;
          const msrp = arr(pi.MSRP).find((m) => String(m.currency).toUpperCase() === 'USD');
          const msrpVal = msrp ? num(msrp.value) : 0;
          const cat = mapCategory(name);

          // Group this style's items by colorway sku (design.color).
          const colors = new Map();
          for (const it of arr(pi.items)) {
            const parts = String(it.SKU || '').split('.');
            if (parts.length < 3) continue; // need design.color.size
            const dz = parts[0], colorCode = parts[1], size = parts.slice(2).join('.') || 'OSFA';
            const cwSku = `${dz}.${colorCode}`;
            let g = colors.get(cwSku);
            if (!g) { g = { dz, colorCode, colorName: String(it.colorName || ''), price: 0, sizes: [] }; colors.set(cwSku, g); }
            const qty = Math.round(num(it.quantity));
            const price = num(it.list_price);
            if (price > g.price) g.price = price;
            g.sizes.push({ size, qty });
          }

          for (const [cwSku, g] of colors) {
            const retail = msrpVal > 0 ? msrpVal : g.price;
            const cost = retail > 0 ? Math.round(retail * (1 - discount) * 100) / 100 : 0;
            const sell = cost > 0 ? Math.round(cost * 1.65 * 100) / 100 : null;
            productRows.push({
              id: `mt-${g.dz}-${g.colorCode}`,
              vendor_id: vendorId,
              sku: cwSku,
              name,
              description: desc,
              brand: 'Momentec',
              color: g.colorName,
              category: cat,
              retail_price: retail || null,
              nsa_cost: cost || null,
              catalog_sell_price: sell,
              is_active: true,
              available_sizes: g.sizes.map((s) => s.size),
              image_front_url: `${IMG_BASE}/${g.dz}_${g.colorCode}_front.jpg`,
              image_back_url: `${IMG_BASE}/${g.dz}_${g.colorCode}_back.jpg`,
              inventory_source: 'momentec',
            });
            for (const s of g.sizes) {
              invRows.push({
                id: `${cwSku}-${s.size}`,
                sku: cwSku,
                size: s.size,
                stock_qty: s.qty,
                future_delivery_date: null,
                future_delivery_qty: null,
                last_synced: stamp,
                source: 'momentec',
              });
            }
          }
        }
        designsOk++;
      } catch (e) {
        if (errors.length < 50) errors.push(design + ': ' + e.message);
      }
    });

    console.log('[momentec-sync] built', productRows.length, 'products,', invRows.length, 'inventory rows from', designsOk, 'designs');

    // 3) Upsert.
    await upsertBatched('products', 'id', productRows);
    await upsertBatched('momentec_inventory', 'sku,size', invRows);

    console.log('[momentec-sync] done:', productRows.length, 'products,', invRows.length, 'inventory rows,', customSkipped, 'custom skipped,', errors.length, 'errors');
    return {
      statusCode: 200,
      body: JSON.stringify({
        designs: designs.length, designsOk, products: productRows.length,
        inventory_rows: invRows.length, customSkipped, errors: errors.slice(0, 10),
      }),
    };
  } catch (e) {
    console.error('[momentec-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
