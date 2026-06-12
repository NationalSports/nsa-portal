// Background function (15-min limit): syncs the full adidas brand catalog
// from S&S Activewear into the portal so the public /adidas catalog shows
// S&S-sourced adidas gear (golf/corporate styles) with images, sizes, and
// live inventory alongside Cowork + in-house stock.
//
//   products         — one row per style+color, id 'ssa-<styleName>-<colorCode>',
//                      vendor = the S&S vendor (api_provider='ss_activewear'),
//                      image from the S&S CDN, MAP price as retail,
//                      customer/piece price as nsa_cost (fill-empty for desc)
//   adidas_inventory — per sku+size stock summed across S&S warehouses,
//                      source 'ss_activewear'
//
// Triggered by ss-adidas-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/ss-adidas-sync-background
//
// Env: SS_ACCOUNT_NUMBER, SS_API_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SS_CDN = 'https://cdn.ssactivewear.com/';
const CATEGORY_MAP = {
  'T-Shirts': 'Tees', 'Polos': 'Polos', 'Knits & Polos': 'Polos',
  Fleece: 'Hoods', Sweatshirts: 'Hoods', Outerwear: 'Outerwear',
  Headwear: 'Hats', Caps: 'Hats', Pants: 'Pants', Shorts: 'Shorts',
  Bags: 'Bags', Accessories: 'Accessories', Wovens: 'Polos', 'Activewear': 'Tees',
};

exports.handler = async () => {
  const ssAccount = process.env.SS_ACCOUNT_NUMBER;
  const ssKey = process.env.SS_API_KEY;
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ssAccount || !ssKey || !sbUrl || !sbKey) {
    console.error('[ss-adidas-sync] missing config');
    return { statusCode: 500, body: 'Not configured' };
  }
  const ssAuth = 'Basic ' + Buffer.from(ssAccount + ':' + ssKey).toString('base64');
  const ssGet = async (path) => {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch('https://api.ssactivewear.com/V2' + path + sep + 'mediatype=json', {
      headers: { Authorization: ssAuth, Accept: 'application/json' },
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

    // 1. All adidas styles on S&S
    const styles = (await ssGet('/Styles')).filter((s) => /adidas/i.test(s.brandName || ''));
    console.log('[ss-adidas-sync] adidas styles on S&S:', styles.length);

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
          prodRows.push({
            id: 'ssa-' + sku,
            vendor_id: vendorId,
            sku,
            name: 'Adidas ' + (st.title || st.styleName) + (st.styleName && st.title && !String(st.title).includes(st.styleName) ? ' (' + st.styleName + ')' : ''),
            brand: 'Adidas',
            color: r0.colorName || colorCode,
            category: CATEGORY_MAP[st.baseCategory] || CATEGORY_MAP[(st.categories || '').split(',')[0]] || 'Other',
            retail_price: map > 0 ? map : Math.round(cost * 2),
            nsa_cost: cost,
            is_active: true,
            available_sizes: sizes,
            image_front_url: img ? SS_CDN + img : null,
            description: st.description ? String(st.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) : null,
          });
          for (const r of recs) {
            if (!r.sizeName) continue;
            const qty = Array.isArray(r.warehouses)
              ? r.warehouses.reduce((a, w) => a + (Number(w.qty) || 0), 0)
              : (Number(r.qty) || 0);
            invUpserts.push({ sku, size: r.sizeName, stock_qty: qty, last_synced: new Date().toISOString(), source: 'ss_activewear' });
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
          const ir = await sb('adidas_inventory?on_conflict=sku,size', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(invUpserts.slice(j, j + 500)),
          });
          if (!ir.ok) throw new Error('inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
        }
        invRows += invUpserts.length;
      } catch (e) {
        errors.push((st.styleName || st.styleID) + ': ' + e.message);
        if (errors.length > 25) break; // bail if S&S is having a bad day
      }
    }

    console.log('[ss-adidas-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', errors.length, 'errors', errors.slice(0, 5));
    return { statusCode: 200, body: JSON.stringify({ styles: styles.length, products: productsUpserted, inventory_rows: invRows, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[ss-adidas-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
