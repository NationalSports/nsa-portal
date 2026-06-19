// Background function (15-min limit): syncs the full Momentec Brands catalog
// into the portal so the public Team Catalog (/adidas, /livelook) shows
// Momentec team apparel with images, sizes, and live inventory.
//
// Momentec uses HCL Commerce REST (catalog endpoints are public — no auth
// needed; dealer key unlocks tier pricing). This function:
//   products           — one row per style+color, id 'mt-{uniqueID}',
//                        brand 'Momentec', vendor_id = Momentec vendor (v8),
//                        15% dealer discount applied off list price,
//                        catalog_sell_price = cost×1.65 (same model as S&S)
//   momentec_inventory — per sku+size stock from /inventoryavailability
//
// Triggered by momentec-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/momentec-sync-background
//
// Env: MOMENTEC_STORE_ID (optional, default 10251),
//      REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const MOMENTEC_BASE = 'https://www.momentecbrands.com';

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

exports.handler = async () => {
  const storeId = process.env.MOMENTEC_STORE_ID || '10251';
  const sbUrl   = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    console.error('[momentec-sync] missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return { statusCode: 500, body: 'Not configured' };
  }

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });
  const mt = async (path) => {
    const url = `${MOMENTEC_BASE}/wcs/resources/store/${storeId}${path}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Momentec ' + path + ' → ' + res.status);
    const text = await res.text();
    if (text.trimStart().startsWith('<')) throw new Error('Momentec returned HTML for ' + path);
    return JSON.parse(text);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    // Momentec vendor id
    const vRes = await sb('vendors?api_provider=eq.momentec&select=id&limit=1');
    const vendors = await vRes.json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No Momentec vendor configured (api_provider=momentec)' };
    const discount = 0.15;

    // Paginate all products
    const pageSize = 50;
    let page = 1, total = 0;
    const allProducts = [];
    do {
      const data = await mt(`/productview/bySearchTerm/*?pageSize=${pageSize}&pageNumber=${page}`);
      const items = arr(data.CatalogEntryView);
      allProducts.push(...items);
      total = num(data.recordSetTotal) || items.length;
      page++;
    } while (allProducts.length < total && allProducts.length > 0 && page <= 200);
    console.log('[momentec-sync] fetched', allProducts.length, 'of', total, 'products');

    let productsUpserted = 0, invRows = 0;
    const errors = [];

    // Process in batches (keep memory low; rate-limit inventory calls)
    for (let i = 0; i < allProducts.length; i++) {
      const entry = allProducts[i];
      try {
        if (i > 0 && i % 10 === 0) await sleep(500);
        const uniqueID   = String(entry.uniqueID || '');
        const partNumber = String(entry.partNumber || entry.id || uniqueID);
        const name       = String(entry.name || entry.Title || partNumber);

        // Price: use the first "Offer" price; apply dealer discount
        const prices = arr(entry.price);
        const listPrice = prices.reduce((a, p) => {
          const v = num(p.value);
          return v > 0 && (a === 0 || v < a) ? v : a;
        }, 0);
        const cost    = listPrice > 0 ? Math.round(listPrice * (1 - discount) * 100) / 100 : 0;
        const retail  = listPrice;
        const sellPrice = cost > 0 ? Math.round(cost * 1.65 * 100) / 100 : null;

        // Image: prefer "ANGLETR" attachment, fall back to first
        const attaches = arr(entry.attachments || entry.attachment);
        const img = (() => {
          const pref = attaches.find((a) => /ANGLETR|FRONT/i.test(a.usage || '')) || attaches[0];
          if (!pref) return null;
          const uri = pref.resourceURI || pref.path || '';
          if (!uri) return null;
          return uri.startsWith('http') ? uri : MOMENTEC_BASE + '/wcsstore/' + uri;
        })();

        // Color from attributes (ASGSwatchColor or Color)
        const attrs = arr(entry.attributes || entry.Attributes);
        let color = '';
        for (const a of attrs) {
          const aid = String(a.identifier || a.name || '').toLowerCase();
          if (aid === 'asgswatchcolor' || aid === 'color') {
            const vals = arr(a.values || a.Values);
            if (vals[0]) { color = String(vals[0].value || vals[0].identifier || ''); break; }
          }
        }
        // Size variants: the entry itself might be a parent with sub-entries (sKUs)
        const subs = arr(entry.sKUs || entry.items || entry.subCatalogEntryView);
        const sizeSKUs = subs.length ? subs : [entry];

        // Live inventory for this product
        const ids = sizeSKUs.map((s) => String(s.uniqueID || uniqueID)).filter(Boolean).join(',');
        let stockByPart = {};
        try {
          const inv = await mt(`/inventoryavailability/${encodeURIComponent(ids)}`);
          const avail = arr(inv.InventoryAvailability || inv.inventoryavailability);
          for (const a of avail) {
            const pn = String(a.productId || a.partNumber || '');
            const qty = num(a.availableQuantity || a.quantity || 0);
            if (pn) stockByPart[pn] = (stockByPart[pn] || 0) + qty;
          }
        } catch (e) { console.warn('[momentec-sync] inventory', partNumber, e.message); }

        const productSku = partNumber;
        const sizes = [];
        for (const sub of sizeSKUs) {
          const subAttrs = arr(sub.attributes || sub.Attributes);
          let sizeLabel = '';
          for (const a of subAttrs) {
            if (/^size$/i.test(String(a.identifier || a.name || ''))) {
              const v = arr(a.values || a.Values)[0];
              if (v) sizeLabel = String(v.value || v.identifier || '');
              break;
            }
          }
          if (!sizeLabel) sizeLabel = String(sub.partNumber || sub.uniqueID || '').replace(productSku, '').replace(/^[-_]/, '') || 'OSFA';
          const subId = String(sub.uniqueID || uniqueID);
          sizes.push({ size: sizeLabel, qty: stockByPart[subId] || 0 });
        }
        if (!sizes.length) sizes.push({ size: 'OSFA', qty: 0 });

        const prodRow = {
          id: 'mt-' + uniqueID,
          vendor_id: vendorId,
          sku: productSku,
          name,
          brand: 'Momentec',
          color: color || '',
          category: mapCategory(name),
          retail_price: retail || null,
          nsa_cost: cost || null,
          catalog_sell_price: sellPrice,
          is_active: true,
          available_sizes: sizes.map((s) => s.size),
          image_front_url: img,
          inventory_source: 'momentec',
        };

        const pr = await sb('products?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([prodRow]),
        });
        if (!pr.ok) throw new Error('products upsert ' + pr.status + ': ' + (await pr.text()).slice(0, 200));
        productsUpserted++;

        const invUpserts = sizes.map((s) => ({
          id: productSku + '-' + s.size,
          sku: productSku,
          size: s.size,
          stock_qty: s.qty,
          future_delivery_date: null,
          future_delivery_qty: null,
          last_synced: new Date().toISOString(),
          source: 'momentec',
        }));
        if (invUpserts.length) {
          const ir = await sb('momentec_inventory?on_conflict=sku,size', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(invUpserts),
          });
          if (!ir.ok) throw new Error('inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
          invRows += invUpserts.length;
        }
      } catch (e) {
        errors.push((entry.partNumber || entry.uniqueID || i) + ': ' + e.message);
        if (errors.length > 30) break;
      }
    }

    console.log('[momentec-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', errors.length, 'errors');
    return { statusCode: 200, body: JSON.stringify({ total, products: productsUpserted, inventory_rows: invRows, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[momentec-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
