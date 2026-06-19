// Background function (15-min limit): syncs the Richardson Sports full stock
// catalog into the portal so the public Team Catalog (/adidas, /livelook)
// shows Richardson hats and headwear with images, sizes, and live per-DC
// inventory alongside the existing Adidas / UA / Nike / Agron feeds.
//
// Richardson's stock feed is a single JSON array (one row per SKU/size) from
// their report server. This function groups rows by style+color → one product
// per colorway, then writes:
//   products           — one row per style+color, id 'rich-{style}-{colorSlug}',
//                        brand 'Richardson', vendor_id = Richardson vendor (v5),
//                        category='Hats' for almost all styles, Level 4 pricing
//   richardson_inventory — per sku+size stock (Oregon DC + Texas DC), source
//                          'richardson'; next-avail date when qty=0
//
// Triggered by richardson-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/richardson-sync-background
//
// Env: RICHARDSON_FEED_URL (optional), RICHARDSON_FEED_USER (optional),
//      RICHARDSON_FEED_KEY (required), REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const DEFAULT_USER = 'CustFeed';
const DEFAULT_FEED_URL = 'https://reports.richardsonsports.com/reportserver/reportserver/httpauthexport?key=StockInventory&format=JSON&download=false';

// Level 4 wholesale pricing: style prefix → dealer price ($ each).
// Source: Richardson dealer price list, last updated 2026-04-21.
// Prefix matching — "PTS20" matches "PTS20M" and "PTS20S".
const LEVEL4_PRICES = {
  'PTS20': 7.44, 'PTS30': 8.08, 'PTS50': 8.50, 'PTS65': 9.14,
  'R15': 2.51, 'R18': 3.40, 'R20': 3.83, 'R22': 3.61,
  'R45': 3.83, 'R55': 3.83, 'R65': 3.40, 'R75': 3.61,
  '110': 6.66,
  '111': 5.87, '112': 5.66,
  '113': 5.66, '115': 5.66,
  '121': 5.22, '126': 8.27, '130': 5.00, '134': 6.74, '135': 6.74,
  '137': 3.92, '141': 8.27, '143': 7.61, '145': 6.09,
  '146': 4.57, '147': 5.22, '148': 7.18, '149': 5.22, '154': 10.44, '157': 8.27,
  '160': 7.61, '163': 7.61, '168': 6.31, '169': 8.27,
  '172': 8.05, '173': 8.05, '176': 7.83, '185': 7.18,
  '203': 6.09, '212': 5.00, '213': 5.66, '214': 4.79, '217': 6.09,
  '220': 6.53, '222': 6.74, '225': 6.53,
  '252': 6.09, '253': 8.27, '255': 5.87, '256': 7.83, '257': 6.74, '258': 6.31, '262': 6.09,
  '309': 6.53, '312': 5.87, '324': 5.44, '326': 5.44, '336': 6.74,
  '356': 5.66, '380': 7.40, '382': 6.53,
  '414': 6.96, '420': 8.05, '435': 9.35, '436': 6.96,
  '485': 8.48, '495': 7.61,
  '525': 7.83, '535': 7.40, '555': 6.96,
  '626': 8.48, '655': 8.27,
  '790': 10.87,
};
function getLevel4Price(style) {
  const s = String(style || '').toUpperCase();
  // Exact match first
  if (LEVEL4_PRICES[s] !== undefined) return LEVEL4_PRICES[s];
  // Prefix match: longest prefix wins
  let best = null, bestLen = 0;
  for (const [pfx, price] of Object.entries(LEVEL4_PRICES)) {
    if (s.startsWith(pfx) && pfx.length > bestLen) { best = price; bestLen = pfx.length; }
  }
  return best;
}

const CATEGORY_RULES = [
  ['Beanies', /BEANIE|KNIT|TOQUE/i],
  ['Visors', /VISOR/i],
  ['Hats', /.*/],
];
function mapCategory(style, description) {
  const text = String(style || '') + ' ' + String(description || '');
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'Hats';
}

// "112 Solid Black MD-LG" → { color: "Solid Black", size: "MD-LG" }
function parseDescription(description, style) {
  if (!description) return { color: '', size: '' };
  let s = String(description).trim();
  if (style) {
    const re = new RegExp('^' + String(style).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i');
    s = s.replace(re, '');
  }
  const parts = s.split(/\s+/);
  if (!parts.length) return { color: '', size: '' };
  const size = parts.pop();
  return { color: parts.join(' ').trim(), size };
}

// MM/DD/YYYY → YYYY-MM-DD (null if invalid/N/A)
function toISODate(str) {
  if (!str || /^(N\/A|PHASEOUT)$/i.test(str)) return null;
  const m = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

exports.handler = async () => {
  const feedKey = process.env.RICHARDSON_FEED_KEY;
  const sbUrl   = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!feedKey || !sbUrl || !sbKey) {
    console.error('[richardson-sync] missing config — need RICHARDSON_FEED_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    return { statusCode: 500, body: 'Not configured' };
  }

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });

  try {
    // 1. Richardson vendor id
    const vRes = await sb('vendors?api_provider=eq.richardson&select=id&limit=1');
    const vendors = await vRes.json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No Richardson vendor configured (api_provider=richardson)' };

    // 2. Fetch Richardson stock feed
    const feedUser = process.env.RICHARDSON_FEED_USER || DEFAULT_USER;
    const feedUrl  = process.env.RICHARDSON_FEED_URL ||
      `${DEFAULT_FEED_URL}&user=${encodeURIComponent(feedUser)}&apikey=${encodeURIComponent(feedKey)}`;
    console.log('[richardson-sync] fetching stock feed…');
    const feedRes = await fetch(feedUrl, { headers: { Accept: 'application/json' } });
    if (!feedRes.ok) throw new Error('Richardson feed HTTP ' + feedRes.status);
    const feedText = await feedRes.text();
    if (feedText.trimStart().startsWith('<')) throw new Error('Richardson feed returned HTML — check RICHARDSON_FEED_KEY');
    const rawRows = JSON.parse(feedText);
    if (!Array.isArray(rawRows)) throw new Error('Richardson feed expected array');
    console.log('[richardson-sync] feed rows:', rawRows.length);

    // 3. Group by style → color → sizes
    const byStyle = {};
    for (const row of rawRows) {
      const style = String(row.Style || '').trim();
      if (!style) continue;
      const { color, size } = parseDescription(row.Description, style);
      if (!color || !size) continue;
      const qty = (parseInt(row['Oregon DC']) || 0) + (parseInt(row['Texas DC']) || 0);
      const nextAvail = toISODate(String(row['Next Avail'] || ''));
      const sku = String(row.SKU || '').trim();
      const upc = String(row.UPC || '').trim();
      if (!byStyle[style]) byStyle[style] = {};
      const byColor = byStyle[style];
      if (!byColor[color]) byColor[color] = { variants: [], firstSku: sku };
      byColor[color].variants.push({ size, qty, nextAvail, sku, upc });
    }

    const styles = Object.keys(byStyle);
    console.log('[richardson-sync] styles:', styles.length);

    let productsUpserted = 0, invRows = 0;
    const errors = [];

    // 4. Build product + inventory upserts
    const prodRows = [];
    const invUpserts = [];
    for (const style of styles) {
      try {
        const cost = getLevel4Price(style);
        const retail = cost ? Math.round(cost * 2 * 100) / 100 : null;
        for (const [color, grp] of Object.entries(byStyle[style])) {
          const colorSlug = color.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 20) || 'NA';
          const productSku = style + '-' + colorSlug;
          const productId = 'rich-' + productSku;
          const category = mapCategory(style, color);
          const sizes = [...new Set(grp.variants.map((v) => v.size))];
          prodRows.push({
            id: productId,
            vendor_id: vendorId,
            sku: productSku,
            name: 'Richardson ' + style + ' ' + color,
            brand: 'Richardson',
            color,
            category,
            retail_price: retail,
            nsa_cost: cost,
            catalog_sell_price: cost ? Math.round(cost * 1.65 * 100) / 100 : null,
            is_active: true,
            available_sizes: sizes,
            inventory_source: 'richardson',
          });
          for (const v of grp.variants) {
            const invId = productSku + '-' + v.size;
            invUpserts.push({
              id: invId,
              sku: productSku,
              size: v.size,
              stock_qty: v.qty,
              future_delivery_date: v.qty === 0 ? v.nextAvail : null,
              future_delivery_qty: null,
              last_synced: new Date().toISOString(),
              source: 'richardson',
              style_number: style,
              color_code: colorSlug,
              upc: v.upc || null,
            });
          }
        }
      } catch (e) {
        errors.push(style + ': ' + e.message);
        if (errors.length > 30) break;
      }
    }

    // 5. Upsert in batches of 500
    for (let i = 0; i < prodRows.length; i += 500) {
      const pr = await sb('products?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(prodRows.slice(i, i + 500)),
      });
      if (!pr.ok) throw new Error('products upsert ' + pr.status + ': ' + (await pr.text()).slice(0, 200));
      productsUpserted += prodRows.slice(i, i + 500).length;
    }
    for (let i = 0; i < invUpserts.length; i += 500) {
      const ir = await sb('richardson_inventory?on_conflict=sku,size', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(invUpserts.slice(i, i + 500)),
      });
      if (!ir.ok) throw new Error('inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
      invRows += invUpserts.slice(i, i + 500).length;
    }

    console.log('[richardson-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', errors.length, 'errors');
    return { statusCode: 200, body: JSON.stringify({ styles: styles.length, products: productsUpserted, inventory_rows: invRows, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[richardson-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
