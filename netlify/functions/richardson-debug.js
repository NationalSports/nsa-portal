// Temporary diagnostic — DELETE after Richardson sync is fixed.
// Returns env var status, vendor lookup result, first 3 feed rows, AND
// a duplicate-product-ID check using the corrected parseDescription.
const DEFAULT_USER = 'CustFeed';
const DEFAULT_FEED_URL = 'https://reports.richardsonsports.com/reportserver/reportserver/httpauthexport?key=StockInventory&format=JSON&download=false';

function parseDescription(description, style) {
  if (!description) return { color: '', size: '' };
  let s = String(description).trim();
  const sizeMatch = s.match(/\s+Size\s+(\S+)\s*$/i);
  if (sizeMatch) {
    const size = sizeMatch[1];
    const beforeSize = s.slice(0, sizeMatch.index).trim();
    const words = beforeSize.split(/\s+/);
    const color = words.pop() || '';
    return { color, size };
  }
  if (style) {
    const re = new RegExp('^' + String(style).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i');
    s = s.replace(re, '');
  }
  const parts = s.split(/\s+/);
  if (!parts.length) return { color: '', size: '' };
  const size = parts.pop();
  return { color: parts.join(' ').trim(), size };
}

exports.handler = async () => {
  const feedKey = process.env.RICHARDSON_FEED_KEY;
  const sbUrl   = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const cfg = { hasFeedKey: !!feedKey, hasSbUrl: !!sbUrl, hasSbKey: !!sbKey };
  if (!feedKey || !sbUrl || !sbKey) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cfg, error: 'Missing env vars' }) };
  }

  // Vendor lookup
  let vendorId = null, vendorErr = null;
  try {
    const vRes = await fetch(sbUrl + '/rest/v1/vendors?api_provider=eq.richardson&select=id&limit=1', {
      headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey },
    });
    const vendors = await vRes.json();
    vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
  } catch (e) { vendorErr = e.message; }

  // Feed fetch + duplicate ID check
  let feedStatus = null, feedRows = 0, feedPreview = null, feedErr = null, firstRowKeys = null;
  let totalStyles = 0, totalProducts = 0, dupIds = [], skippedNoStyle = 0, skippedNoColorSize = 0;
  try {
    const feedUser = process.env.RICHARDSON_FEED_USER || DEFAULT_USER;
    const feedUrl  = process.env.RICHARDSON_FEED_URL || `${DEFAULT_FEED_URL}&user=${encodeURIComponent(feedUser)}&apikey=${encodeURIComponent(feedKey)}`;
    const feedRes  = await fetch(feedUrl, { headers: { Accept: 'application/json' }, redirect: 'follow' });
    feedStatus = feedRes.status;
    const text = await feedRes.text();
    feedPreview = text.trimStart().slice(0, 200);
    if (!text.trimStart().startsWith('<')) {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        feedRows = parsed.length;
        if (parsed[0]) {
          firstRowKeys = Object.keys(parsed[0]);
          feedPreview = JSON.stringify(parsed.slice(0, 3));
        }

        // Build byStyle and check for duplicate product IDs
        const byStyle = {};
        for (const row of parsed) {
          const style = String(row.Style || row.style || '').trim();
          if (!style) { skippedNoStyle++; continue; }
          const desc = row.Description || row.description || '';
          const { color, size } = parseDescription(desc, style);
          if (!color || !size) { skippedNoColorSize++; continue; }
          if (!byStyle[style]) byStyle[style] = {};
          if (!byStyle[style][color]) byStyle[style][color] = [];
          byStyle[style][color].push(size);
        }

        totalStyles = Object.keys(byStyle).length;
        const seenIds = new Set();
        for (const [style, byColor] of Object.entries(byStyle)) {
          for (const color of Object.keys(byColor)) {
            const colorSlug = color.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 20) || 'NA';
            const productId = 'rich-' + style + '-' + colorSlug;
            if (seenIds.has(productId)) dupIds.push({ productId, color });
            else seenIds.add(productId);
          }
        }
        totalProducts = seenIds.size;
      }
    }
  } catch (e) { feedErr = e.message; }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cfg, vendorId, vendorErr,
      feedStatus, feedRows, firstRowKeys, feedPreview,
      feedErr, skippedNoStyle, skippedNoColorSize,
      totalStyles, totalProducts, dupCount: dupIds.length, dupIds: dupIds.slice(0, 5),
    }),
  };
};
