// Background function (15-min limit): syncs selected non-Nike brands from
// SanMar into the portal so the public Team Catalog (/adidas, /livelook)
// shows SanMar-sourced styles for Port Authority, Sport-Tek, District, and
// Bella+Canvas with images, sizes, and live inventory.
//
// SanMar's API is style-number-gated (no "list by brand" endpoint), so the
// style set is seeded from:
//   1. Products already in the DB with these brands on the SanMar vendor
//      (refresh runs on every sync)
//   2. The SANMAR_BRAND_STYLES env var — a comma-separated list of style
//      numbers to add (e.g. "K500,PC61,DT6000,3001C")
// On the FIRST live run, add your style list via SANMAR_BRAND_STYLES; the
// sync will persist them and future runs refresh automatically from the DB.
//
// Writes:
//   products        — one row per style+color, id 'smb-{style}-{colorCode}',
//                     brand = SanMar brandName, vendor_id = SanMar vendor,
//                     MAP/MSRP as retail, piece price as nsa_cost,
//                     catalog_sell_price = cost × 1.65
//   sanmar_inventory — per sku+size stock from PromoStandards getInventoryLevels
//
// Triggered by sanmar-brands-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/sanmar-brands-sync-background
//
// Env: SANMAR_BRAND_STYLES (optional seed), URL,
//      REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      (SANMAR_USERNAME + SANMAR_PASSWORD are used inside sanmar-proxy)

const TARGET_BRANDS = ['Port Authority', 'Sport-Tek', 'District', 'Bella+Canvas'];
const TARGET_BRAND_RE = /port\s*authority|sport-?tek|^district$|bella\+?canvas/i;

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
  ['Accessories', /ACCESSOR|GLOVE|SCARF|TOWEL/i],
];
function mapCategory(title) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(String(title || ''))) return cat;
  return 'Other';
}
function canonicalBrand(name) {
  const n = String(name || '');
  if (/port\s*authority/i.test(n)) return 'Port Authority';
  if (/sport-?tek/i.test(n)) return 'Sport-Tek';
  if (/^district$/i.test(n)) return 'District';
  if (/bella\+?canvas/i.test(n)) return 'Bella+Canvas';
  return n || 'Other';
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const arr = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);

exports.handler = async () => {
  const site  = (process.env.URL || '').replace(/\/+$/, '');
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!site || !sbUrl || !sbKey) {
    console.error('[sanmar-brands-sync] missing config');
    return { statusCode: 500, body: 'Not configured' };
  }

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sm = async (service, action, body, tries = 3) => {
    let lastErr;
    for (let t = 0; t < tries; t++) {
      try {
        const res = await fetch(site + '/.netlify/functions/sanmar-proxy?service=' + service + '&action=' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_FUNCTION_SECRET || sbKey },
          body: JSON.stringify(body || {}),
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

    // Style list: existing target-brand SanMar products + env seed
    const existing = await (await sb('products?vendor_id=eq.' + vendorId + '&select=sku&brand=in.(' + TARGET_BRANDS.map((b) => '"' + b + '"').join(',') + ')')).json();
    const styleOf = (sku) => String(sku || '').split('-')[0].trim();
    const seed = (process.env.SANMAR_BRAND_STYLES || '').split(',').map((s) => s.trim()).filter(Boolean);
    const styles = [...new Set([...arr(existing).map((p) => styleOf(p.sku)), ...seed].filter(Boolean))];
    console.log('[sanmar-brands-sync] styles to sync:', styles.length, seed.length ? '(seed: ' + seed.length + ')' : '');
    if (!styles.length) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No brand styles to sync. Add SanMar style numbers to SANMAR_BRAND_STYLES env var (e.g. "K500,PC61,DT6000,3001C") to seed the catalog.', styles: 0 }) };
    }

    let productsUpserted = 0, invRows = 0;
    const errors = [];

    for (let i = 0; i < styles.length; i++) {
      const style = styles[i];
      try {
        if (i > 0) await sleep(900);
        const prod = await sm('product', 'getProductInfoByStyleColorSize', { style, color: '', size: '' });
        const items = arr(prod.items).map((raw) => ({ ...(raw.productBasicInfo || {}), ...(raw.productImageInfo || {}), ...(raw.productPriceInfo || {}), ...raw }));
        if (!items.length) continue;

        // Only process if it's actually a target brand
        const brandText = String(items[0].brandName || items[0].brand || '');
        if (!TARGET_BRAND_RE.test(brandText)) {
          console.warn('[sanmar-brands-sync] style', style, 'is brand "' + brandText + '" — skip');
          continue;
        }
        const brand = canonicalBrand(brandText);

        // Inventory
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
        } catch (e) { console.warn('[sanmar-brands-sync] inventory', style, e.message); }

        const byColor = {};
        for (const it of items) {
          const colorName = it.colorName || it.color || it.catalogColor || 'NA';
          const code = String(it.colorCode || colorName).replace(/\s+/g, '');
          (byColor[code] = byColor[code] || { colorName, recs: [] }).recs.push(it);
        }
        const prodRows = [], invUpserts = [];
        for (const [colorCode, grp] of Object.entries(byColor)) {
          const recs = grp.recs, r0 = recs[0];
          const sku = style + '-' + colorCode;
          const sizes = [...new Set(recs.map((r) => String(r.size || r.labelSize || '').trim()).filter(Boolean))];
          const cost   = num(r0.piecePrice || r0.customerPrice || r0.casePrice);
          const retail = num(r0.msrp || r0.mapPrice || r0.piecePrice) || (cost > 0 ? Math.round(cost * 2) : 0);
          const img    = r0.colorProductImage || r0.productImage || r0.colorProductImageThumbnail || r0.thumbnailImage || '';
          // SanMar prefixes retired styles with "DISCONTINUED" — strip it (still sells from stock).
          const title  = (r0.productTitle || r0.productDescription || (style + ' ' + grp.colorName)).replace(/DISCONTINUED/ig, '').replace(/\s{2,}/g, ' ').trim();
          prodRows.push({
            id: 'smb-' + sku,
            vendor_id: vendorId,
            sku,
            name: brand + ' ' + title,
            brand,
            color: grp.colorName,
            category: mapCategory(title),
            retail_price: retail,
            nsa_cost: cost,
            catalog_sell_price: cost > 0 ? Math.round(cost * 1.65 * 100) / 100 : null,
            is_active: true,
            available_sizes: sizes,
            image_front_url: img || null,
            inventory_source: 'sanmar',
          });
          for (const size of sizes) {
            const key = String(grp.colorName).toLowerCase() + '|' + size;
            invUpserts.push({
              id: sku + '-' + size, sku, size, stock_qty: stockByCS[key] || 0,
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
          const ir = await sb('sanmar_inventory?on_conflict=sku,size', {
            method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(invUpserts.slice(j, j + 500)),
          });
          if (!ir.ok) throw new Error('sanmar_inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
        }
        invRows += invUpserts.length;
      } catch (e) {
        errors.push(style + ': ' + e.message);
        if (errors.length > 90) break;
      }
    }

    console.log('[sanmar-brands-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', errors.length, 'errors');
    return { statusCode: 200, body: JSON.stringify({ styles: styles.length, products: productsUpserted, inventory_rows: invRows, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[sanmar-brands-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
