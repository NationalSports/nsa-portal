// Background function (15-min limit): syncs the Nike catalog SanMar carries into
// the portal so the public Team Catalog (/adidas, /livelook) shows SanMar-sourced
// Nike gear with images, sizes, and live inventory — the Nike analog of
// ss-adidas-sync-background. Writes:
//   products       — one row per style+color, id 'smnike-<style>-<colorCode>',
//                    brand 'Nike', inventory_source 'nike', vendor = the SanMar
//                    vendor (api_provider='sanmar'); image from SanMar, MAP/MSRP as
//                    retail, piece/customer price as nsa_cost, sell = cost×1.65
//   nike_inventory — per sku+size stock, source 'sanmar'
//
// It reuses the PROVEN sanmar-proxy (SanMar SOAP, same envelopes the order screen
// uses) over HTTP instead of re-implementing SOAP here.
//
// ── Style enumeration ──
// SanMar has no "list styles by brand" API, so the Nike style set is SEEDED from:
//   1. products already on the SanMar vendor with brand ~ 'nike' (refresh), AND
//   2. the SANMAR_NIKE_STYLES env var (comma-separated style numbers) for new
//      styles — drop SanMar's Nike style list here to grow the catalog.
// On the FIRST live run, spot-check one style's parsed colors/sizes/stock against
// SanMar's site and adjust the parsers if a field name differs (the adidas/agron
// syncs were validated the same way).
//
// Triggered by sanmar-nike-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/sanmar-nike-sync-background
//
// Env: SANMAR_USERNAME, SANMAR_PASSWORD (used by sanmar-proxy), URL,
//      REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const CATEGORY_RULES = [
  ['1/4 Zips', /QUARTER[- ]ZIP|1\/4[- ]ZIP/i],
  ['Outerwear', /FULL[- ]ZIP|JACKET|VEST|WINDBREAKER|OUTERWEAR|RAIN/i],
  ['Polos', /POLO/i],
  ['Hats', /HEADWEAR|\bCAP\b|BEANIE|VISOR/i],
  ['Crew', /CREW/i],
  ['Hoods', /HOOD|FLEECE|SWEATSHIRT|PULLOVER/i],
  ['Shorts', /SHORT/i],
  ['Pants', /PANT|LEGGING|BOTTOM|JOGGER|TIGHT/i],
  ['Tees', /T-SHIRT|\bTEE\b|ACTIVEWEAR/i],
  ['Bags', /\bBAG\b|BACKPACK|DUFFEL|SACKPACK/i],
  ['Socks', /\bSOCK\b/i],
  ['Accessories', /ACCESSOR|GLOVE|SCARF|TOWEL|SLEEVE/i],
];
function mapCategory(title) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(String(title || ''))) return cat;
  return 'Other';
}
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const arr = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);

exports.handler = async () => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!site || !sbUrl || !sbKey) { console.error('[sanmar-nike-sync] missing config'); return { statusCode: 500, body: 'Not configured' }; }

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Proven SanMar SOAP path — call the deployed proxy (creds live there).
  // Retry transient failures (SanMar rate-limits / proxy hiccups) with backoff so
  // one flaky call doesn't drop a whole style from the run.
  const sm = async (service, action, body, tries = 3) => {
    let lastErr;
    for (let t = 0; t < tries; t++) {
      try {
        const res = await fetch(site + '/.netlify/functions/sanmar-proxy?service=' + service + '&action=' + action, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error(service + '/' + action + ': ' + (j.error || res.status));
        return j;
      } catch (e) { lastErr = e; if (t < tries - 1) await sleep(600 * (t + 1)); }
    }
    throw lastErr;
  };

  try {
    // SanMar vendor id
    const vRes = await sb('vendors?api_provider=eq.sanmar&select=id&limit=1');
    const vendors = await vRes.json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No SanMar vendor configured' };

    // Nike style list: existing Nike SanMar products + env seed list.
    const existing = await (await sb('products?vendor_id=eq.' + vendorId + '&brand=ilike.nike&select=sku')).json();
    const styleOf = (sku) => String(sku || '').split('-')[0].trim(); // 'NKDC1990-Black' → 'NKDC1990'
    const seed = (process.env.SANMAR_NIKE_STYLES || '').split(',').map((s) => s.trim()).filter(Boolean);
    const styles = [...new Set([...arr(existing).map((p) => styleOf(p.sku)), ...seed].filter(Boolean))];
    console.log('[sanmar-nike-sync] Nike styles to sync:', styles.length);
    if (!styles.length) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No Nike styles. Seed SANMAR_NIKE_STYLES or add Nike products to the SanMar vendor.', styles: 0 }) };
    }

    let productsUpserted = 0, invRows = 0;
    const errors = [];
    for (let i = 0; i < styles.length; i++) {
      const style = styles[i];
      try {
        if (i > 0) await sleep(900); // pace SanMar to avoid rate-limit errors
        // 1) Product info (basic + image + price), one record per style/color/size.
        const prod = await sm('product', 'getProductInfoByStyleColorSize', { style, color: '', size: '' });
        const items = arr(prod.items).map((raw) => ({ ...(raw.productBasicInfo || {}), ...(raw.productImageInfo || {}), ...(raw.productPriceInfo || {}), ...raw }));
        if (!items.length) continue;
        // Skip non-Nike (defensive — the style list should already be Nike-only).
        const brandText = String(items[0].brandName || items[0].brand || 'Nike');
        if (!/nike/i.test(brandText) && !/^NK/i.test(style)) { /* still proceed, style was explicitly seeded */ }

        // 2) Live inventory for the whole style (PromoStandards getInventoryLevels),
        //    keyed by color+size. productID = style with the default productIDtype
        //    ('Supplier'); SanMar rejects productIDtype 'Style' ("125: Not Supported").
        const stockByCS = {}; // `${colorLower}|${sizeLabel}` -> qty
        try {
          const inv = await sm('promostandards', 'getInventoryLevels', { productId: style });
          const variations = arr(inv?.Inventory?.ProductVariationInventoryArray?.ProductVariationInventory
            || inv?.ProductVariationInventoryArray?.ProductVariationInventory
            || inv?.inventory || inv?.items);
          variations.forEach((v) => {
            const color = String(v?.attributeColor || v?.color || '').toLowerCase();
            const size = String(v?.attributeSize || v?.size || v?.labelSize || 'OSFA').trim();
            let qty = 0;
            const parts = arr(v?.partInventoryArray?.partInventory || v?.PartInventoryArray?.PartInventory);
            parts.forEach((p) => { qty += num(p?.quantityAvailable?.Quantity || p?.quantityAvailable?.quantity || p?.quantityAvailable); });
            if (qty <= 0) qty = num(v?.quantityAvailable || v?.totalQty || v?.qty);
            if (qty > 0) stockByCS[color + '|' + size] = (stockByCS[color + '|' + size] || 0) + qty;
          });
        } catch (e) { console.warn('[sanmar-nike-sync] inventory', style, e.message); }

        // Group product records by color
        const byColor = {};
        for (const it of items) {
          const colorName = it.colorName || it.color || it.catalogColor || 'NA';
          const code = String(it.colorCode || colorName).replace(/\s+/g, '');
          (byColor[code] = byColor[code] || { colorName, recs: [] }).recs.push(it);
        }
        const prodRows = []; const invUpserts = [];
        for (const [colorCode, grp] of Object.entries(byColor)) {
          const recs = grp.recs; const r0 = recs[0];
          const sku = style + '-' + colorCode;
          const sizes = [...new Set(recs.map((r) => String(r.size || r.labelSize || '').trim()).filter(Boolean))];
          const cost = num(r0.piecePrice || r0.customerPrice || r0.casePrice);
          const retail = num(r0.msrp || r0.mapPrice || r0.piecePrice) || (cost > 0 ? Math.round(cost * 2) : 0);
          const img = r0.colorProductImage || r0.productImage || r0.colorProductImageThumbnail || r0.thumbnailImage || '';
          const title = r0.productTitle || r0.productDescription || (style + ' ' + grp.colorName);
          prodRows.push({
            id: 'smnike-' + sku,
            vendor_id: vendorId,
            sku,
            name: /nike/i.test(title) ? title : 'Nike ' + title,
            brand: 'Nike',
            color: grp.colorName,
            category: mapCategory(title),
            retail_price: retail,
            nsa_cost: cost,
            // Nike shows RETAIL (MSRP) to coaches — no markup, no tier discount.
            catalog_sell_price: retail > 0 ? retail : null,
            is_active: true,
            available_sizes: sizes,
            image_front_url: img || null,
            inventory_source: 'nike',
          });
          for (const size of sizes) {
            const key = String(grp.colorName).toLowerCase() + '|' + size;
            const qty = stockByCS[key] || 0;
            invUpserts.push({
              id: sku + '-' + size, sku, size, stock_qty: qty,
              last_synced: new Date().toISOString(), source: 'sanmar',
              style_number: style, color_code: colorCode,
            });
          }
        }

        const pr = await sb('products?on_conflict=id', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(prodRows),
        });
        if (!pr.ok) throw new Error('products upsert ' + pr.status + ': ' + (await pr.text()).slice(0, 200));
        productsUpserted += prodRows.length;

        for (let j = 0; j < invUpserts.length; j += 500) {
          const ir = await sb('nike_inventory?on_conflict=sku,size', {
            method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(invUpserts.slice(j, j + 500)),
          });
          if (!ir.ok) throw new Error('inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
        }
        invRows += invUpserts.length;
      } catch (e) {
        errors.push(style + ': ' + e.message);
        // Don't abort the whole 108-style run on a few transient errors; only bail
        // if almost everything is failing (auth/outage). sm() already retries each call.
        if (errors.length > 90) break;
      }
    }

    console.log('[sanmar-nike-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', errors.length, 'errors', errors.slice(0, 5));
    return { statusCode: 200, body: JSON.stringify({ styles: styles.length, products: productsUpserted, inventory_rows: invRows, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[sanmar-nike-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
