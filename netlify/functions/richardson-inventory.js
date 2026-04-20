// Netlify serverless function — fetches Richardson Sports StockInventory JSON feed
// and serves it grouped by Style (with per-color/per-size aggregation).
//
// Source feed example record:
//   { Style:'112', SKU:'112-B-A', Description:'112 Solid Black MD-LG',
//     UPC:'...', 'Oregon DC':86310, 'Texas DC':300541, 'Next Avail':'04/24/2026' }
//
// Env vars (all optional — sensible defaults):
//   RICHARDSON_FEED_URL — full URL to the StockInventory JSON endpoint
//   RICHARDSON_FEED_USER — feed user (default: CustFeed)
//   RICHARDSON_FEED_KEY  — feed apikey (default: bundled fallback)
//
// Query params:
//   style    — return only the matching style (case-insensitive)
//   format   — 'summary' returns just byColor map; default returns variants + byColor
//   refresh  — '1' to bypass the in-memory cache
//
// Response shape (with style):
//   { style, fetchedAt, variants:[{sku,color,size,oregon,texas,qty,nextAvail,upc}],
//     byColor:{ "Black":{ sizes:{OSFA:386851}, nextAvail:"04/24/2026", total:386851 } } }
//
// Without style: { fetchedAt, count, styles:['110','112',...] }

const DEFAULT_USER = 'CustFeed';
const DEFAULT_KEY = 'A9fK2Qm8ZxP7L4R3WcH6D';
const DEFAULT_URL = 'https://reports.richardsonsports.com/reportserver/reportserver/httpauthexport?key=StockInventory&format=JSON&download=false';
const CACHE_TTL_MS = 10 * 60 * 1000;

let _cache = null; // { fetchedAt:number, byStyle:{[style]:variant[]} }
let _inflight = null;

const buildFeedUrl = () => {
  if (process.env.RICHARDSON_FEED_URL) return process.env.RICHARDSON_FEED_URL;
  const user = process.env.RICHARDSON_FEED_USER || DEFAULT_USER;
  const key = process.env.RICHARDSON_FEED_KEY || DEFAULT_KEY;
  return `${DEFAULT_URL}&user=${encodeURIComponent(user)}&apikey=${encodeURIComponent(key)}`;
};

// Parse "112 Solid Black MD-LG" → { color:'Solid Black', size:'MD-LG' }
// Strategy: strip leading style token, last whitespace token = size, remainder = color.
const parseDescription = (description, style) => {
  if (!description) return { color: '', size: '' };
  let s = String(description).trim();
  if (style) {
    const re = new RegExp('^' + String(style).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i');
    s = s.replace(re, '');
  }
  const parts = s.split(/\s+/);
  if (parts.length === 0) return { color: '', size: '' };
  const size = parts.pop();
  const color = parts.join(' ').trim();
  return { color, size };
};

const fetchFeed = async () => {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const url = buildFeedUrl();
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`Richardson feed HTTP ${res.status}`);
    const text = await res.text();
    if (text.trimStart().startsWith('<')) throw new Error('Richardson feed returned HTML (auth/URL issue)');
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Richardson feed returned invalid JSON: ' + e.message); }
    if (!Array.isArray(data)) throw new Error('Richardson feed expected array, got ' + typeof data);

    const byStyle = {};
    for (const row of data) {
      const style = String(row.Style || '').trim();
      if (!style) continue;
      const { color, size } = parseDescription(row.Description, style);
      const oregon = parseInt(row['Oregon DC']) || 0;
      const texas = parseInt(row['Texas DC']) || 0;
      const variant = {
        sku: String(row.SKU || '').trim(),
        color,
        size,
        oregon,
        texas,
        qty: oregon + texas,
        nextAvail: String(row['Next Avail'] || '').trim(),
        upc: String(row.UPC || '').trim(),
      };
      if (!byStyle[style]) byStyle[style] = [];
      byStyle[style].push(variant);
    }
    _cache = { fetchedAt: Date.now(), byStyle };
    return _cache;
  })().finally(() => { _inflight = null; });
  return _inflight;
};

const getCachedFeed = async (forceRefresh) => {
  if (!forceRefresh && _cache && (Date.now() - _cache.fetchedAt) < CACHE_TTL_MS) return _cache;
  return await fetchFeed();
};

// Aggregate variants → byColor map: {color:{sizes:{S:qty}, nextAvail, total}}
const buildByColor = (variants) => {
  const byColor = {};
  for (const v of variants) {
    const c = v.color || 'Default';
    if (!byColor[c]) byColor[c] = { sizes: {}, nextAvail: '', total: 0 };
    byColor[c].sizes[v.size] = (byColor[c].sizes[v.size] || 0) + v.qty;
    byColor[c].total += v.qty;
    // Keep earliest non-empty restock date (skip "N/A"/"PHASEOUT")
    if (v.nextAvail && !/^(N\/A|PHASEOUT)$/i.test(v.nextAvail)) {
      if (!byColor[c].nextAvail || new Date(v.nextAvail) < new Date(byColor[c].nextAvail)) {
        byColor[c].nextAvail = v.nextAvail;
      }
    }
  }
  return byColor;
};

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const style = qs.style ? String(qs.style).trim() : '';
  const format = qs.format || 'full';
  const forceRefresh = qs.refresh === '1';
  const cors = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' };

  try {
    const cache = await getCachedFeed(forceRefresh);

    if (!style) {
      return {
        statusCode: 200, headers: cors,
        body: JSON.stringify({
          fetchedAt: new Date(cache.fetchedAt).toISOString(),
          count: Object.keys(cache.byStyle).length,
          styles: Object.keys(cache.byStyle).sort(),
        }),
      };
    }

    // Case-insensitive style lookup
    const styleKey = Object.keys(cache.byStyle).find(k => k.toLowerCase() === style.toLowerCase());
    const variants = styleKey ? cache.byStyle[styleKey] : [];
    const byColor = buildByColor(variants);

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        style: styleKey || style,
        fetchedAt: new Date(cache.fetchedAt).toISOString(),
        ...(format === 'summary' ? { byColor } : { variants, byColor }),
      }),
    };
  } catch (err) {
    return {
      statusCode: 502, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Richardson inventory feed failed: ${err.message}` }),
    };
  }
};
