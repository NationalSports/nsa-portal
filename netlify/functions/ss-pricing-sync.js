// Netlify scheduled function to sync S&S Activewear pricing into Supabase products
// Schedule: daily at 5:00 AM CT (11:00 UTC)
//
// This function:
// 1. Fetches all products from Supabase that belong to S&S Activewear vendor
// 2. For each product, calls S&S API to get current pricing (customerPrice or piecePrice)
// 3. Updates nsa_cost in Supabase if the price has changed
//
// Environment variables required:
//   SS_ACCOUNT_NUMBER, SS_API_KEY — S&S API credentials
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — Supabase access
//
// Can also be triggered manually via: GET /.netlify/functions/ss-pricing-sync

const https = require('https');

// Simple HTTPS JSON request helper (works on all Node versions)
const httpJson = (url, options = {}) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const opts = {
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path: parsed.pathname + parsed.search,
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}),
    },
  };
  const req = https.request(opts, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: JSON.parse(data), raw: data });
      } catch {
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: null, raw: data });
      }
    });
  });
  req.on('error', reject);
  if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
  req.end();
});

exports.handler = async (event) => {
  const ssAccount = process.env.SS_ACCOUNT_NUMBER;
  const ssKey = process.env.SS_API_KEY;
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

  if (!ssAccount || !ssKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SS_ACCOUNT_NUMBER and SS_API_KEY not configured' }) };
  }
  if (!sbUrl || !sbKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'REACT_APP_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not configured. sbUrl=' + (sbUrl ? 'set' : 'missing') + ', sbKey=' + (sbKey ? 'set' : 'missing') }) };
  }

  const ssAuth = Buffer.from(`${ssAccount}:${ssKey}`).toString('base64');

  const sbHeaders = {
    'apikey': sbKey,
    'Authorization': `Bearer ${sbKey}`,
  };

  try {
    // 1. Get all S&S vendor IDs
    const vRes = await httpJson(`${sbUrl}/rest/v1/vendors?api_provider=eq.ss_activewear&select=id`, { headers: sbHeaders });
    if (!vRes.ok) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to query vendors: ' + vRes.raw }) };
    }
    const vendors = vRes.data;
    if (!vendors?.length) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'No S&S Activewear vendors found in database', updated: 0 }) };
    }

    const vendorIds = vendors.map(v => v.id);

    // 2. Get all products for these vendors
    const pRes = await httpJson(
      `${sbUrl}/rest/v1/products?vendor_id=in.(${vendorIds.map(id => `"${id}"`).join(',')})&select=id,sku,nsa_cost,vendor_id`,
      { headers: sbHeaders }
    );
    if (!pRes.ok) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to query products: ' + pRes.raw }) };
    }
    const products = pRes.data;

    if (!products?.length) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'No S&S products found in database (vendors found: ' + vendorIds.join(', ') + ')', updated: 0 }) };
    }

    // 3. Fetch pricing from S&S for each unique SKU
    const uniqueSkus = [...new Set(products.map(p => p.sku))];
    let updated = 0;
    const errors = [];
    const changes = [];

    for (let i = 0; i < uniqueSkus.length; i++) {
      const sku = uniqueSkus[i];
      try {
        // Rate limit: 60 req/min
        if (i > 0) await new Promise(r => setTimeout(r, 1100));

        const ssRes = await httpJson(
          `https://api.ssactivewear.com/V2/Products?style=${encodeURIComponent(sku)}`,
          { headers: { 'Authorization': `Basic ${ssAuth}` } }
        );

        if (!ssRes.ok) {
          errors.push({ sku, error: `HTTP ${ssRes.status}` });
          continue;
        }

        const items = Array.isArray(ssRes.data) ? ssRes.data : ssRes.data ? [ssRes.data] : [];
        if (!items.length) continue;

        const prices = items
          .map(it => parseFloat(it.customerPrice) || parseFloat(it.piecePrice) || 0)
          .filter(p => p > 0);

        if (!prices.length) continue;

        const newCost = Math.min(...prices);
        const matchingProducts = products.filter(p => p.sku === sku);

        for (const prod of matchingProducts) {
          if (Math.abs((prod.nsa_cost || 0) - newCost) > 0.005) {
            const uRes = await httpJson(
              `${sbUrl}/rest/v1/products?id=eq.${prod.id}`,
              {
                method: 'PATCH',
                headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                body: { nsa_cost: newCost },
              }
            );

            if (!uRes.ok) {
              errors.push({ sku, error: uRes.raw });
            } else {
              updated++;
              changes.push({ sku, old: prod.nsa_cost, new: newCost });
            }
          }
        }
      } catch (err) {
        errors.push({ sku, error: err.message });
      }
    }

    const result = {
      message: 'S&S pricing sync complete',
      total_skus: uniqueSkus.length,
      updated,
      changes,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };

    console.log('[SS-Pricing-Sync]', JSON.stringify(result));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Sync failed: ' + err.message, stack: err.stack }),
    };
  }
};
