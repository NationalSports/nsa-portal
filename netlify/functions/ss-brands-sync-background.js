// Background function (15-min limit): syncs selected non-Adidas/UA brands
// from S&S Activewear into the portal so the public Team Catalog
// (/adidas, /livelook) shows these brands with images, sizes, and live
// warehouse inventory.
//
// Brands covered (S&S brand-name filtering):
//   Boxercraft. (The other apparel brands — Port Authority, Sport-Tek, District,
//   Bella+Canvas, Gildan, Jerzees — are now sourced from SanMar; see
//   sanmar-brands-sync. Old S&S rows for those are retired at cutover.)
//
// Writes:
//   products     — one row per style+color, id 'ssb-{styleName}-{colorCode}',
//                  brand = the S&S brandName, vendor_id = S&S vendor (v4),
//                  MAP as retail, piece/customer price as nsa_cost,
//                  catalog_sell_price = cost × 1.65 (same as ss-adidas-sync)
//   ss_inventory — per sku+size stock summed across S&S warehouses,
//                  source 'ss_activewear'
//
// Triggered by ss-brands-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/ss-brands-sync-background
//
// Env: SS_ACCOUNT_NUMBER, SS_API_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SS_CDN = 'https://cdn.ssactivewear.com/';

// Brands to pull from S&S (case-insensitive regex match against s.brandName).
// SanMar is now the source for the apparel brands we used to pull from S&S
// (Port Authority, Sport-Tek, District, Bella+Canvas, Gildan, Jerzees) — see
// sanmar-brands-sync. S&S only still owns Boxercraft, which SanMar doesn't carry.
const BRAND_PATTERNS = [
  { re: /^boxercraft$/i,        canonical: 'Boxercraft'      },
];
function canonicalBrand(name) {
  for (const { re, canonical } of BRAND_PATTERNS) if (re.test(name)) return canonical;
  return null;
}

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
function mapCategory(title, baseCategory) {
  for (const hay of [String(title || ''), String(baseCategory || '')]) {
    for (const [cat, re] of CATEGORY_RULES) if (re.test(hay)) return cat;
  }
  return 'Other';
}

exports.handler = async () => {
  const ssAccount = process.env.SS_ACCOUNT_NUMBER;
  const ssKey     = process.env.SS_API_KEY;
  const sbUrl     = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey     = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ssAccount || !ssKey || !sbUrl || !sbKey) {
    console.error('[ss-brands-sync] missing config');
    return { statusCode: 500, body: 'Not configured' };
  }
  const ssAuth = 'Basic ' + Buffer.from(ssAccount + ':' + ssKey).toString('base64');
  const ssGet = async (path) => {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch('https://api.ssactivewear.com/V2' + path + sep + 'mediatype=json', {
      headers: { Authorization: ssAuth, Accept: 'application/json', 'User-Agent': 'NSA-Portal/1.0 (nationalsportsapparel.com)' },
    });
    if (!res.ok) throw new Error('S&S ' + path + ' → ' + res.status);
    return res.json();
  };
  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    // S&S vendor id
    const vRes = await sb('vendors?api_provider=eq.ss_activewear&select=id&limit=1');
    const vendors = await vRes.json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No S&S vendor configured' };

    // All styles for the target brands
    const allStyles = await ssGet('/Styles');
    const styles = allStyles
      .map((s) => ({ ...s, _canonical: canonicalBrand(s.brandName || '') }))
      .filter((s) => s._canonical !== null);
    console.log('[ss-brands-sync] styles to sync:', styles.length,
      '(brands:', [...new Set(styles.map((s) => s._canonical))].join(', ') + ')');

    let productsUpserted = 0, invRows = 0;
    const errors = [];

    for (let i = 0; i < styles.length; i++) {
      const st = styles[i];
      try {
        if (i > 0) await sleep(1100); // ~54 req/min — S&S allows 60/min
        const records = await ssGet('/Products/?styleid=' + encodeURIComponent(st.styleID));
        if (!Array.isArray(records) || !records.length) continue;

        const byColor = {};
        for (const r of records) {
          const key = String(r.colorCode || r.colorName || 'NA').replace(/\s+/g, '');
          (byColor[key] = byColor[key] || []).push(r);
        }
        const prodRows = [];
        const invUpserts = [];
        for (const [colorCode, recs] of Object.entries(byColor)) {
          const r0   = recs[0];
          const sku  = (st.styleName || st.title || 'SS') + '-' + colorCode;
          const sizes = [...new Set(recs.map((r) => r.sizeName).filter(Boolean))];
          const cost  = Number(r0.customerPrice) || Number(r0.piecePrice) || 0;
          const map   = Number(r0.mapPrice) || 0;
          const img   = r0.colorFrontImage || r0.styleImage || '';
          const retail = map > 1 ? map : (cost > 0 ? Math.round(cost * 2) : 0);
          prodRows.push({
            id: 'ssb-' + sku,
            vendor_id: vendorId,
            sku,
            name: st._canonical + ' ' + (st.title || st.styleName || ''),
            brand: st._canonical,
            color: r0.colorName || colorCode,
            category: mapCategory(st.title, st.baseCategory),
            retail_price: retail,
            nsa_cost: cost,
            catalog_sell_price: cost > 0 ? Math.round(cost * 1.65 * 100) / 100 : null,
            is_active: true,
            available_sizes: sizes,
            image_front_url: img ? SS_CDN + img : null,
            description: st.description ? String(st.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) : null,
            inventory_source: 'ss_activewear',
          });
          for (const r of recs) {
            if (!r.sizeName) continue;
            const qty = Array.isArray(r.warehouses)
              ? r.warehouses.reduce((a, w) => a + (Number(w.qty) || 0), 0)
              : (Number(r.qty) || 0);
            invUpserts.push({ id: sku + '-' + r.sizeName, sku, size: r.sizeName, stock_qty: qty, last_synced: new Date().toISOString(), source: 'ss_activewear' });
          }
        }

        const pr = await sb('products?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(prodRows),
        });
        if (!pr.ok) throw new Error('products upsert ' + pr.status + ': ' + (await pr.text()).slice(0, 200));
        productsUpserted += prodRows.length;

        for (let j = 0; j < invUpserts.length; j += 500) {
          const ir = await sb('ss_inventory?on_conflict=sku,size', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(invUpserts.slice(j, j + 500)),
          });
          if (!ir.ok) throw new Error('ss_inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
        }
        invRows += invUpserts.length;
      } catch (e) {
        errors.push((st.styleName || st.styleID) + ': ' + e.message);
        if (errors.length > 30) break;
      }
    }

    console.log('[ss-brands-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', errors.length, 'errors');
    return { statusCode: 200, body: JSON.stringify({ styles: styles.length, products: productsUpserted, inventory_rows: invRows, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[ss-brands-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
