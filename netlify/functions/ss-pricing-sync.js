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
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — Supabase admin access
//
// Can also be triggered manually via: GET /.netlify/functions/ss-pricing-sync

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const ssAccount = process.env.SS_ACCOUNT_NUMBER;
  const ssKey = process.env.SS_API_KEY;
  const sbUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

  if (!ssAccount || !ssKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'SS_ACCOUNT_NUMBER and SS_API_KEY required' }) };
  }
  if (!sbUrl || !sbKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required' }) };
  }

  const supabase = createClient(sbUrl, sbKey);
  const auth = Buffer.from(`${ssAccount}:${ssKey}`).toString('base64');

  // 1. Get all S&S vendor IDs
  const { data: vendors } = await supabase
    .from('vendors')
    .select('id')
    .eq('api_provider', 'ss_activewear');

  if (!vendors?.length) {
    return { statusCode: 200, body: JSON.stringify({ message: 'No S&S Activewear vendors found', updated: 0 }) };
  }

  const vendorIds = vendors.map(v => v.id);

  // 2. Get all products for these vendors
  const { data: products } = await supabase
    .from('products')
    .select('id, sku, nsa_cost, vendor_id')
    .in('vendor_id', vendorIds);

  if (!products?.length) {
    return { statusCode: 200, body: JSON.stringify({ message: 'No S&S products found', updated: 0 }) };
  }

  // 3. Fetch pricing from S&S for each unique SKU (batch by style to reduce API calls)
  const uniqueSkus = [...new Set(products.map(p => p.sku))];
  let updated = 0;
  const errors = [];
  const changes = [];

  for (const sku of uniqueSkus) {
    try {
      // Rate limit: 60 req/min — add small delay between calls
      if (uniqueSkus.indexOf(sku) > 0) {
        await new Promise(r => setTimeout(r, 1100)); // ~54 req/min to stay safe
      }

      const url = `https://api.ssactivewear.com/V2/Products?style=${encodeURIComponent(sku)}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${auth}`,
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
        // Only update if price actually changed (avoid unnecessary writes)
        if (Math.abs((prod.nsa_cost || 0) - newCost) > 0.005) {
          const { error } = await supabase
            .from('products')
            .update({ nsa_cost: newCost })
            .eq('id', prod.id);

          if (error) {
            errors.push({ sku, error: error.message });
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
    message: `S&S pricing sync complete`,
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
};
