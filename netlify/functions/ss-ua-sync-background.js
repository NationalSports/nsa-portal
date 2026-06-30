// Background function (15-min limit): syncs the Under Armour brand catalog from
// S&S Activewear into the portal so the public Team Catalog (/adidas, /livelook)
// shows S&S-sourced UA gear with images, sizes, and live inventory alongside the
// Armour House (UA direct B2B) + in-house stock.
//
// Mirrors ss-adidas-sync-background exactly, but for brandName ~ "Under Armour":
//   products      — one row per style+color, id 'ssua-<styleName>-<colorCode>',
//                   brand 'Under Armour', inventory_source 'ua', vendor = the S&S
//                   vendor (api_provider='ss_activewear'), image from the S&S CDN,
//                   MAP as retail, customer/piece price as nsa_cost, sell = cost×1.65
//   ua_inventory  — per sku+size stock summed across S&S warehouses, source 'ss_activewear'
//
// NOTE: UA *direct* (Armour House) items are priced retail×0.5×0.85 by the COWORK
// sync's promote; S&S-sourced UA (here) keeps the distributor model — coaches pay
// cost×1.65 flat (catalog_sell_price), no adidas/UA tier discount — same as the
// S&S adidas catalog. The two are disjoint SKU spaces, so they never collide.
//
// Triggered by ss-ua-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/ss-ua-sync-background
//
// Env: SS_ACCOUNT_NUMBER, SS_API_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SS_CDN = 'https://cdn.ssactivewear.com/';
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
  const ssKey = process.env.SS_API_KEY;
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ssAccount || !ssKey || !sbUrl || !sbKey) {
    console.error('[ss-ua-sync] missing config');
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
    // S&S vendor id (api_provider='ss_activewear')
    const vRes = await sb('vendors?api_provider=eq.ss_activewear&select=id&limit=1');
    const vendors = await vRes.json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No S&S vendor configured' };

    // 1. All Under Armour styles on S&S
    const styles = (await ssGet('/Styles')).filter((s) => /under\s*armour/i.test(s.brandName || ''));
    console.log('[ss-ua-sync] UA styles on S&S:', styles.length);

    let productsUpserted = 0, invRows = 0;
    const errors = [];
    for (let i = 0; i < styles.length; i++) {
      const st = styles[i];
      try {
        if (i > 0) await sleep(1100); // 60 req/min rate limit
        const records = await ssGet('/Products/?styleid=' + encodeURIComponent(st.styleID));
        if (!Array.isArray(records) || !records.length) continue;

        // Group size-level records into one product per style+color
        const byColor = {};
        for (const r of records) {
          const key = String(r.colorCode || r.colorName || 'NA').replace(/\s+/g, '');
          (byColor[key] = byColor[key] || []).push(r);
        }
        const prodRows = [];
        const invUpserts = [];
        for (const [colorCode, recs] of Object.entries(byColor)) {
          const r0 = recs[0];
          const sku = (st.styleName || st.title || 'SS') + '-' + colorCode;
          const sizes = [...new Set(recs.map((r) => r.sizeName).filter(Boolean))];
          const cost = Number(r0.customerPrice) || Number(r0.piecePrice) || 0;
          const map = Number(r0.mapPrice) || 0;
          const img = r0.colorFrontImage || r0.styleImage || '';
          const retail = map > 1 ? map : (cost > 0 ? Math.round(cost * 2) : 0);
          prodRows.push({
            id: 'ssua-' + sku,
            vendor_id: vendorId,
            sku,
            name: 'Under Armour ' + (st.title || st.styleName) + (st.styleName && st.title && !String(st.title).includes(st.styleName) ? ' (' + st.styleName + ')' : ''),
            brand: 'Under Armour',
            color: r0.colorName || colorCode,
            category: mapCategory(st.title, st.baseCategory),
            retail_price: retail,
            nsa_cost: cost,
            // S&S coaches pay cost x 1.65 (flat markup, no UA tier discount)
            catalog_sell_price: cost > 0 ? Math.round(cost * 1.65 * 100) / 100 : null,
            is_active: true,
            available_sizes: sizes,
            image_front_url: img ? SS_CDN + img : null,
            description: st.description ? String(st.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) : null,
            inventory_source: 'ua',
          });
          for (const r of recs) {
            if (!r.sizeName) continue;
            const qty = Array.isArray(r.warehouses)
              ? r.warehouses.reduce((a, w) => a + (Number(w.qty) || 0), 0)
              : (Number(r.qty) || 0);
            invUpserts.push({
              id: sku + '-' + r.sizeName, sku, size: r.sizeName, stock_qty: qty,
              last_synced: new Date().toISOString(), source: 'ss_activewear',
              style_number: st.styleName || null, color_code: colorCode, upc: r.gtin || r.upc || null,
            });
          }
        }

        // Upsert products (id-keyed; refreshes price/image/stock-driven fields)
        const pr = await sb('products?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(prodRows),
        });
        if (!pr.ok) throw new Error('products upsert ' + pr.status + ': ' + (await pr.text()).slice(0, 200));
        productsUpserted += prodRows.length;

        for (let j = 0; j < invUpserts.length; j += 500) {
          const ir = await sb('ua_inventory?on_conflict=sku,size', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(invUpserts.slice(j, j + 500)),
          });
          if (!ir.ok) throw new Error('inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
        }
        invRows += invUpserts.length;
      } catch (e) {
        errors.push((st.styleName || st.styleID) + ': ' + e.message);
        if (errors.length > 25) break;
      }
    }

    console.log('[ss-ua-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', errors.length, 'errors', errors.slice(0, 5));
    return { statusCode: 200, body: JSON.stringify({ styles: styles.length, products: productsUpserted, inventory_rows: invRows, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[ss-ua-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
