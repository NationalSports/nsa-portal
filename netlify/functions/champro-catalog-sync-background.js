// Background function (15-min budget): backfills correct available_sizes on Champro
// catalog products (vendor ns_49) from the live Champro ProductInfo API.
//   • Apparel / configurable goods → the real size range from ProductInfo.ProductSKUs.
//   • Hard goods / single-size stock (ProductInfo returns no SKUs) → OSFA.
// The catalog import left every Champro available_sizes empty, and the app defaults empty
// → apparel S-2XL; ~64% of Champro is hard goods, so e.g. a basketball wrongly showed
// S/M/L/XL/2XL and its single-size stock could never display.
//
// Default: processes only products whose available_sizes is still empty, so the daily cron
// is cheap after the initial backfill and naturally resumes if a run hits the 15-min limit
// (each fixed row is no longer empty on the next run). Pass ?all=1 to reprocess everything.
//
// Triggered by champro-catalog-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/champro-catalog-sync-background
//   curl -X POST 'https://<site>/.netlify/functions/champro-catalog-sync-background?all=1'
//
// Env: CHAMPRO_API_KEY (used by champro-proxy), URL, REACT_APP_SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY, INTERNAL_FUNCTION_SECRET (optional)

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'OSFA'];
const SIZE_ALIAS = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL', XXXXXL: '5XL', 'X-LARGE': 'XL', SMALL: 'S', MEDIUM: 'M', LARGE: 'L', 'ONE SIZE': 'OSFA', OS: 'OSFA', 'O/S': 'OSFA' };

// Normalize a Champro Size token to the app's canonical size vocabulary. Strips an
// adult marker and maps the common spelled-out / XXL-style variants.
function normSize(raw) {
  let s = String(raw || '').toUpperCase().trim().replace(/\s+/g, ' ');
  if (!s) return '';
  s = s.replace(/^ADULT\s+/, '').replace(/^YOUTH\s+/, 'Y');
  return SIZE_ALIAS[s] || s;
}
function orderSizes(set) {
  return [...set].filter(Boolean).sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

exports.handler = async (event) => {
  const site = (process.env.URL || '').replace(/\/+$/, '');
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!site || !sbUrl || !sbKey) { console.error('[champro-catalog-sync] missing config'); return { statusCode: 500, body: 'Not configured' }; }
  const secret = process.env.INTERNAL_FUNCTION_SECRET || sbKey;
  const all = event?.queryStringParameters?.all === '1' || /[?&]all=1/.test(event?.rawUrl || '');

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Champro ProductInfo via the proxy (injects APICustomerKey + runs from the allowlisted egress).
  const productInfo = async (master, tries = 3) => {
    const path = '/api/Order/ProductInfo?ProductMaster=' + encodeURIComponent(master);
    let lastErr;
    for (let t = 0; t < tries; t++) {
      try {
        const res = await fetch(site + '/.netlify/functions/champro-proxy?path=' + encodeURIComponent(path), {
          method: 'GET', headers: { 'x-internal-secret': secret },
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('ProductInfo ' + res.status + (j && j.error ? ': ' + j.error : ''));
        return j;
      } catch (e) { lastErr = e; if (t < tries - 1) await sleep(500 * (t + 1)); }
    }
    throw lastErr;
  };

  // Resolve a product's sizes (mirrors vendorInventory._cp): try the SKU as master, then an
  // A/Y suffix-stripped base (keeping only SKUs that still start with our SKU). No SKUs back
  // ⇒ hard good / single-size stock ⇒ OSFA.
  const sizesFor = async (sku) => {
    const rowsFor = async (pm, keepPrefix) => {
      const info = await productInfo(pm);
      const list = Array.isArray(info?.ProductSKUs) ? info.ProductSKUs : [];
      return keepPrefix ? list.filter((r) => String(r.SKU || '').toUpperCase().startsWith(keepPrefix.toUpperCase())) : list;
    };
    let rows = await rowsFor(sku);
    if (!rows.length) { const m = sku.match(/^(.*[A-Za-z0-9])([AY])$/); if (m) rows = await rowsFor(m[1], sku); }
    if (!rows.length) return ['OSFA'];
    const set = new Set();
    rows.forEach((r) => { const s = normSize(r.Size); if (s) set.add(s); });
    return set.size ? orderSizes(set) : ['OSFA'];
  };

  try {
    const vendors = await (await sb('vendors?or=(api_provider.eq.champro,name.eq.Champro)&select=id&limit=1')).json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No Champro vendor configured' };

    const prods = await (await sb('products?vendor_id=eq.' + vendorId + '&is_active=eq.true&select=id,sku,available_sizes&order=sku')).json();
    const list = Array.isArray(prods) ? prods : [];
    const targets = all ? list : list.filter((p) => !Array.isArray(p.available_sizes) || p.available_sizes.length === 0);
    console.log('[champro-catalog-sync] catalog', list.length, 'targets', targets.length, all ? '(all)' : '(empty-sizes only)');
    if (!targets.length) return { statusCode: 200, body: JSON.stringify({ catalog: list.length, targets: 0, updated: 0 }) };

    let updated = 0, unchanged = 0; const errors = [];
    let idx = 0;
    const worker = async () => {
      while (idx < targets.length) {
        const p = targets[idx++]; // single-threaded: each worker claims a distinct index
        const sku = String(p.sku || '').trim();
        if (!sku) continue;
        try {
          const sizes = await sizesFor(sku);
          const cur = Array.isArray(p.available_sizes) ? p.available_sizes : [];
          if (JSON.stringify(cur) === JSON.stringify(sizes)) { unchanged++; continue; }
          const pr = await sb('products?id=eq.' + encodeURIComponent(p.id), {
            method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ available_sizes: sizes }),
          });
          if (!pr.ok) throw new Error('patch ' + pr.status + ': ' + (await pr.text()).slice(0, 120));
          updated++;
        } catch (e) { errors.push(sku + ': ' + e.message); } // leave row empty so it retries next run
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker)); // modest concurrency vs the Champro API

    console.log('[champro-catalog-sync] done: updated', updated, 'unchanged', unchanged, 'errors', errors.length);
    return { statusCode: 200, body: JSON.stringify({ catalog: list.length, targets: targets.length, updated, unchanged, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[champro-catalog-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
