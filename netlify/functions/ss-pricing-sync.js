// Netlify scheduled function to sync S&S Activewear pricing into Supabase products
// Schedule: daily at 5:00 AM CT (11:00 UTC)
//
// Environment variables required:
//   SS_ACCOUNT_NUMBER, SS_API_KEY — S&S API credentials
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — Supabase access
//
// Can also be triggered manually via: GET /.netlify/functions/ss-pricing-sync

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  try {
    const ssAccount = process.env.SS_ACCOUNT_NUMBER;
    const ssKey = process.env.SS_API_KEY;
    const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

    if (!ssAccount || !ssKey) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'SS_ACCOUNT_NUMBER and SS_API_KEY not configured' }) };
    }
    if (!sbUrl || !sbKey) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Supabase not configured. REACT_APP_SUPABASE_URL=' + (sbUrl ? 'set' : 'missing') + ', SUPABASE_SERVICE_ROLE_KEY=' + (sbKey ? 'set' : 'missing') }) };
    }

    const ssAuth = Buffer.from(ssAccount + ':' + ssKey).toString('base64');
    const sbHeaders = { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json' };

    // 1. Get S&S vendor IDs from Supabase
    const vRes = await fetch(sbUrl + '/rest/v1/vendors?api_provider=eq.ss_activewear&select=id', { headers: sbHeaders });
    const vendors = await vRes.json();
    if (!Array.isArray(vendors) || !vendors.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No S&S vendors in database', updated: 0 }) };
    }

    // 2. Get products for these vendors
    const vendorIds = vendors.map(function(v) { return '"' + v.id + '"'; }).join(',');
    const pRes = await fetch(sbUrl + '/rest/v1/products?vendor_id=in.(' + vendorIds + ')&select=id,sku,nsa_cost,vendor_id', { headers: sbHeaders });
    const products = await pRes.json();
    if (!Array.isArray(products) || !products.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No S&S products in database', updated: 0, vendors_found: vendors.length }) };
    }

    // 3. Fetch pricing from S&S for each SKU
    var uniqueSkus = [];
    var seen = {};
    products.forEach(function(p) { if (!seen[p.sku]) { seen[p.sku] = true; uniqueSkus.push(p.sku); } });

    var updated = 0;
    var errors = [];
    var changes = [];

    for (var i = 0; i < uniqueSkus.length; i++) {
      var sku = uniqueSkus[i];
      try {
        if (i > 0) await new Promise(function(r) { setTimeout(r, 1100); });

        var ssRes = await fetch('https://api.ssactivewear.com/V2/Products?style=' + encodeURIComponent(sku), {
          headers: { 'Authorization': 'Basic ' + ssAuth, 'Accept': 'application/json' }
        });

        if (!ssRes.ok) { errors.push({ sku: sku, error: 'HTTP ' + ssRes.status }); continue; }

        var data = await ssRes.json();
        var items = Array.isArray(data) ? data : [data];
        if (!items.length) continue;

        var prices = [];
        items.forEach(function(it) {
          var p = parseFloat(it.customerPrice) || parseFloat(it.piecePrice) || 0;
          if (p > 0) prices.push(p);
        });
        if (!prices.length) continue;

        var newCost = Math.min.apply(null, prices);
        var matching = products.filter(function(p) { return p.sku === sku; });

        for (var j = 0; j < matching.length; j++) {
          var prod = matching[j];
          if (Math.abs((prod.nsa_cost || 0) - newCost) > 0.005) {
            var uRes = await fetch(sbUrl + '/rest/v1/products?id=eq.' + prod.id, {
              method: 'PATCH',
              headers: Object.assign({}, sbHeaders, { 'Prefer': 'return=minimal' }),
              body: JSON.stringify({ nsa_cost: newCost })
            });
            if (!uRes.ok) {
              var errTxt = await uRes.text();
              errors.push({ sku: sku, error: errTxt });
            } else {
              updated++;
              changes.push({ sku: sku, old: prod.nsa_cost, new: newCost });
            }
          }
        }
      } catch (err) {
        errors.push({ sku: sku, error: err.message });
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        message: 'S&S pricing sync complete',
        total_skus: uniqueSkus.length,
        updated: updated,
        changes: changes,
        errors: errors.length > 0 ? errors : undefined
      })
    };
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: 'Sync crashed: ' + err.message }) };
  }
};
