// Background function: backfills available_sizes on Champro catalog products (vendor
// ns_49) by parsing the size range embedded in each product NAME, e.g.
//   "...Jersey; A: S-2XL*"  → ["S","M","L","XL","2XL"]
//   "...Jersey; Y: XS-XL"   → ["XS","S","M","L","XL"]
//   "...Belt; Sizes: S-3XL" → ["S","M","L","XL","2XL","3XL"]
// Names with no size range (balls, bats, bags, boards) → ["OSFA"].
//
// Why the NAME and not the Champro API: ProductInfo is keyed by Champro's own
// ProductMaster, which our PDF price-list catalog SKUs do NOT match — it returns null
// SKUs even for apparel (e.g. BS25A), so it can't drive sizing. The size ranges, though,
// are already in the imported names.
//
// Default: only rows whose available_sizes is empty — a cheap daily cron that self-heals
// newly imported Champro rows. Pass ?all=1 to recompute the whole catalog. The 3 curated
// pre-existing SKUs (FV, HC7, WBCCV) are left untouched.
//
// Triggered by champro-catalog-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/champro-catalog-sync-background
//   curl -X POST 'https://<site>/.netlify/functions/champro-catalog-sync-background?all=1'
//
// Env: REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const TOK = '6XL|5XL|4XL|3XL|2XL|XXXL|XXL|XXS|XS|XL|S|M|L';
// Size range is always introduced by a colon in these names ("A: S-2XL", "Sizes: S-3XL"),
// which avoids matching incidental dashes elsewhere in the name.
const RANGE_RE = new RegExp(':\\s*(' + TOK + ')\\s*-{1,2}\\s*(' + TOK + ')', 'i');
const SKIP = new Set(['FV', 'HC7', 'WBCCV']);
const normTok = (t) => { const u = String(t || '').toUpperCase(); return u === 'XXL' ? '2XL' : u === 'XXXL' ? '3XL' : u; };

// Parse the size range out of a Champro product name → ordered size list, or OSFA.
function sizesFromName(name) {
  const m = RANGE_RE.exec(String(name || ''));
  if (!m) return ['OSFA'];
  const lo = SIZE_ORDER.indexOf(normTok(m[1]));
  const hi = SIZE_ORDER.indexOf(normTok(m[2]));
  if (lo < 0 || hi < 0 || hi < lo) return ['OSFA'];
  return SIZE_ORDER.slice(lo, hi + 1);
}

exports.handler = async (event) => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) { console.error('[champro-catalog-sync] missing config'); return { statusCode: 500, body: 'Not configured' }; }
  const all = event?.queryStringParameters?.all === '1' || /[?&]all=1/.test(event?.rawUrl || '');

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init, headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });

  try {
    const vendors = await (await sb('vendors?or=(api_provider.eq.champro,name.eq.Champro)&select=id&limit=1')).json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No Champro vendor configured' };

    const prods = await (await sb('products?vendor_id=eq.' + vendorId + '&is_active=eq.true&select=id,sku,name,available_sizes')).json();
    const list = Array.isArray(prods) ? prods : [];
    const targets = list.filter((p) => !SKIP.has(p.sku) && (all || !Array.isArray(p.available_sizes) || p.available_sizes.length === 0));
    console.log('[champro-catalog-sync] catalog', list.length, 'targets', targets.length, all ? '(all)' : '(empty-sizes only)');

    let updated = 0, unchanged = 0; const errors = [];
    for (const p of targets) {
      const sizes = sizesFromName(p.name);
      const cur = Array.isArray(p.available_sizes) ? p.available_sizes : [];
      if (JSON.stringify(cur) === JSON.stringify(sizes)) { unchanged++; continue; }
      try {
        const pr = await sb('products?id=eq.' + encodeURIComponent(p.id), {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ available_sizes: sizes }),
        });
        if (!pr.ok) throw new Error('patch ' + pr.status + ': ' + (await pr.text()).slice(0, 120));
        updated++;
      } catch (e) { errors.push(p.sku + ': ' + e.message); }
    }
    console.log('[champro-catalog-sync] done: updated', updated, 'unchanged', unchanged, 'errors', errors.length);
    return { statusCode: 200, body: JSON.stringify({ catalog: list.length, targets: targets.length, updated, unchanged, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[champro-catalog-sync]', e); return { statusCode: 500, body: e.message };
  }
};
