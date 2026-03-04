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

// Helper: Supabase REST calls via fetch (no SDK needed)
const sbFetch = async (path, { method = 'GET', body, sbUrl, sbKey } = {}) => {
  const r = await fetch(`${sbUrl}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': sbKey,
      'Authorization': `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'PATCH' ? 'return=minimal' : 'return=representation',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (method === 'PATCH') return { ok: r.ok, status: r.status, error: r.ok ? null : await r.text() };
  return r.json();
};

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
      body: JSON.stringify({ error: 'REACT_APP_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not configured' }) };
  }

  const ssAuth = Buffer.from(`${ssAccount}:${ssKey}`).toString('base64');
  const sb = { sbUrl, sbKey };

  try {
    // 1. Get all S&S vendor IDs
    const vendors = await sbFetch('vendors?api_provider=eq.ss_activewear&select=id', sb);
    if (!vendors?.length) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'No S&S Activewear vendors found', updated: 0 }) };
    }

    const vendorIds = vendors.map(v => v.id);

    // 2. Get all products for these vendors
    const products = await sbFetch(
      `products?vendor_id=in.(${vendorIds.map(id => `"${id}"`).join(',')})&select=id,sku,nsa_cost,vendor_id`,
      sb
    );

    if (!products?.length) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'No S&S products found', updated: 0 }) };
    }

    // 3. Fetch pricing from S&S for each unique SKU
    const uniqueSkus = [...new Set(products.map(p => p.sku))];
    let updated = 0;
    const errors = [];
    const changes = [];

    for (let i = 0; i < uniqueSkus.length; i++) {
      const sku = uniqueSkus[i];
      try {
        // Rate limit: 60 req/min — add delay between calls
        if (i > 0) await new Promise(r => setTimeout(r, 1100));

        const url = `https://api.ssactivewear.com/V2/Products?style=${encodeURIComponent(sku)}`;
        const response = await fetch(url, {
          headers: {
            'Authorization': `Basic ${ssAuth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          errors.push({ sku, error: `HTTP ${response.status}` });
          continue;
        }

        const data = await response.json();
        const items = Array.isArray(data) ? data : [data];
        if (!items.length) continue;

        // Use the lowest customerPrice or piecePrice as nsa_cost
        const prices = items
          .map(it => parseFloat(it.customerPrice) || parseFloat(it.piecePrice) || 0)
          .filter(p => p > 0);

        if (!prices.length) continue;

        const newCost = Math.min(...prices);
        const matchingProducts = products.filter(p => p.sku === sku);

        for (const prod of matchingProducts) {
          if (Math.abs((prod.nsa_cost || 0) - newCost) > 0.005) {
            const result = await sbFetch(
              `products?id=eq.${prod.id}`,
              { method: 'PATCH', body: { nsa_cost: newCost }, ...sb }
            );

            if (result.error) {
              errors.push({ sku, error: result.error });
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
      body: JSON.stringify({ error: 'Sync failed: ' + err.message }),
    };
  }
};
