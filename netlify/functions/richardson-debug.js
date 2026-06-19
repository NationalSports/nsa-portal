// Temporary diagnostic — DELETE after Richardson sync is fixed.
// Returns env var status, vendor lookup result, and first 3 feed rows synchronously.
const DEFAULT_USER = 'CustFeed';
const DEFAULT_FEED_URL = 'https://reports.richardsonsports.com/reportserver/reportserver/httpauthexport?key=StockInventory&format=JSON&download=false';

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

  // Feed fetch — first 3 rows only
  let feedStatus = null, feedRows = 0, feedPreview = null, feedErr = null, firstRowKeys = null;
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
      }
    }
  } catch (e) { feedErr = e.message; }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cfg, vendorId, vendorErr, feedStatus, feedRows, firstRowKeys, feedPreview, feedErr }),
  };
};
