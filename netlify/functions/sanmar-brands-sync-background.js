// Background function (15-min limit): syncs SanMar styles into the portal so the
// public Team Catalog (/adidas, /livelook) shows SanMar-sourced styles with
// images, sizes, and live inventory. Ingests ALL SanMar brands EXCEPT Nike
// (its own sanmar-nike-sync) and Richardson (its own richardson-sync). On
// LiveLook these all surface under the "Non Branded" filter while each card
// keeps its real brand.
//
// SanMar's API is style-number-gated (no "list by brand" endpoint), so the
// style set is seeded from:
//   1. The sanmar_style_seeds table (pulled from sanmarsports.com/products.json)
//   2. Products already SanMar-sourced in the DB (refresh runs on every sync)
//   3. The SANMAR_BRAND_STYLES env var — a comma-separated list of style
//      numbers to add (e.g. "K500,PC61,DT6000,3001C")
// New (not-yet-synced) styles are processed first so the 15-min budget always
// makes forward progress; large seed sets converge over a couple of runs.
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

// SanMar carries many brands and we ingest ALL of them from the style seeds,
// EXCEPT two that have their own dedicated feed (excluding them avoids dup cards):
//   • Nike       — its own SanMar sync (sanmar-nike-sync); kept branded "Nike"
//   • Richardson — its own live feed (richardson-sync)
// Everything else (Port Authority, Sport-Tek, District, Bella+Canvas, Gildan,
// New Era, OGIO, Eddie Bauer, North Face, Carhartt, …) is pulled in here.
const EXCLUDE_BRAND_RE = /nike|richardson/i;

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
  // Match the S&S canonical name exactly so the S&S→SanMar cutover finds the
  // old rows to retire (S&S maps Gildan + Jerzees → "Gildan").
  if (/gildan/i.test(n)) return 'Gildan';
  return (n || 'Other').trim();
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

    // Style list: existing SanMar-sourced products (refresh) + DB seeds + env seed
    const existing = await (await sb('products?vendor_id=eq.' + vendorId + '&inventory_source=eq.sanmar&select=sku')).json();
    const dbSeeds = await (await sb('sanmar_style_seeds?select=style,brand')).json();
    const styleOf = (sku) => String(sku || '').split('-')[0].trim();
    const seed = (process.env.SANMAR_BRAND_STYLES || '').split(',').map((s) => s.trim()).filter(Boolean);
    // Skip seeds for the dedicated-feed brands (Nike/Richardson); seeds with no
    // brand recorded are always tried.
    const seedStyles = arr(dbSeeds).filter((r) => !EXCLUDE_BRAND_RE.test(r.brand || '')).map((r) => r.style);
    const existingStyles = arr(existing).map((p) => styleOf(p.sku)).filter(Boolean);
    const existingSet = new Set(existingStyles);
    // New (not-yet-synced) styles go first so first-time ingest wins the 15-min
    // budget; already-synced styles refresh afterward and roll forward run to run.
    const newStyles = [...seedStyles, ...seed].filter((s) => s && !existingSet.has(s));
    const styles = [...new Set([...newStyles, ...existingStyles])];
    console.log('[sanmar-brands-sync] styles to sync:', styles.length, seed.length ? '(seed: ' + seed.length + ')' : '');
    if (!styles.length) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No brand styles to sync. Add SanMar style numbers to SANMAR_BRAND_STYLES env var (e.g. "K500,PC61,DT6000,3001C") to seed the catalog.', styles: 0 }) };
    }

    let productsUpserted = 0, invRows = 0;
    const errors = [];
    const syncedBrands = new Set(); // brands actually ingested this run (drives the S&S cutover)

    for (let i = 0; i < styles.length; i++) {
      const style = styles[i];
      try {
        if (i > 0) await sleep(900);
        const prod = await sm('product', 'getProductInfoByStyleColorSize', { style, color: '', size: '' });
        const items = arr(prod.items).map((raw) => ({ ...(raw.productBasicInfo || {}), ...(raw.productImageInfo || {}), ...(raw.productPriceInfo || {}), ...raw }));
        if (!items.length) continue;

        // Skip brands that have their own dedicated feed (Nike, Richardson).
        const brandText = String(items[0].brandName || items[0].brand || '');
        if (EXCLUDE_BRAND_RE.test(brandText)) {
          console.warn('[sanmar-brands-sync] style', style, 'is dedicated-feed brand "' + brandText + '" — skip');
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
        if (prodRows.length) syncedBrands.add(brand);

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

    // Cutover: now that SanMar is the source for these brands, retire the old
    // S&S rows for any brand we actually ingested this run (e.g. Gildan moves
    // from S&S → SanMar). Scoped to synced brands only, so a brand we didn't
    // reach this run keeps its existing rows — no empty gap. Boxercraft stays on
    // S&S because SanMar doesn't carry it (never enters syncedBrands).
    let ssRetired = 0;
    if (syncedBrands.size) {
      const inList = [...syncedBrands].map((b) => '"' + String(b).replace(/"/g, '') + '"').join(',');
      const cr = await sb('products?inventory_source=eq.ss_activewear&is_active=eq.true&brand=in.(' + inList + ')', {
        method: 'PATCH', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      if (cr.ok) { const rows = await cr.json().catch(() => []); ssRetired = Array.isArray(rows) ? rows.length : 0; }
      else console.warn('[sanmar-brands-sync] S&S cutover failed', cr.status, (await cr.text()).slice(0, 200));
    }

    console.log('[sanmar-brands-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', ssRetired, 'S&S rows retired,', errors.length, 'errors');
    return { statusCode: 200, body: JSON.stringify({ styles: styles.length, products: productsUpserted, inventory_rows: invRows, ss_retired: ssRetired, synced_brands: [...syncedBrands], errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[sanmar-brands-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
