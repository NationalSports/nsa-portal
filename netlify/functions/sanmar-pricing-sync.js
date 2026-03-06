// Netlify scheduled function to sync SanMar pricing into Supabase products
// Schedule: daily at 5:30 AM CT (11:30 UTC)
//
// Environment variables required:
//   SANMAR_USERNAME, SANMAR_PASSWORD — SanMar API credentials
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — Supabase access
//
// Can also be triggered manually via: GET /.netlify/functions/sanmar-pricing-sync

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unescapeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function buildSoapEnvelope(action, params, username, password) {
  const paramXml = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(String(v ?? ''))}</${k}>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:web="http://ws.sanmar.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:${action}>
      <arg0>
        <sanMarCustomerNumber>${escapeXml(username)}</sanMarCustomerNumber>
        <sanMarUserName>${escapeXml(username)}</sanMarUserName>
        <sanMarUserPassword>${escapeXml(password)}</sanMarUserPassword>
        ${paramXml}
      </arg0>
    </web:${action}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// Simple XML tag value extractor
function extractTagValues(xml, tag) {
  const results = [];
  const re = new RegExp('<(?:[\\w]+:)?' + tag + '[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?' + tag + '>', 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) results.push(unescapeXml(m[1].trim()));
  return results;
}

function extractTag(xml, tag) {
  const vals = extractTagValues(xml, tag);
  return vals.length > 0 ? vals[0] : null;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  try {
    const smUser = process.env.SANMAR_USERNAME;
    const smPass = process.env.SANMAR_PASSWORD;
    const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

    if (!smUser || !smPass) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'SANMAR_USERNAME and SANMAR_PASSWORD not configured' }) };
    }
    if (!sbUrl || !sbKey) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
    }

    const sbHeaders = { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json' };

    // 1. Get SanMar vendor IDs from Supabase
    const vRes = await fetch(sbUrl + '/rest/v1/vendors?api_provider=eq.sanmar&select=id', { headers: sbHeaders });
    const vendors = await vRes.json();
    if (!Array.isArray(vendors) || !vendors.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No SanMar vendors in database', updated: 0 }) };
    }

    // 2. Get products for these vendors
    const vendorIds = vendors.map(function(v) { return '"' + v.id + '"'; }).join(',');
    const pRes = await fetch(sbUrl + '/rest/v1/products?vendor_id=in.(' + vendorIds + ')&select=id,sku,nsa_cost,vendor_id', { headers: sbHeaders });
    const products = await pRes.json();
    if (!Array.isArray(products) || !products.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No SanMar products in database', updated: 0, vendors_found: vendors.length }) };
    }

    // 3. Fetch pricing from SanMar for each unique SKU
    var uniqueSkus = [];
    var seen = {};
    products.forEach(function(p) { if (!seen[p.sku]) { seen[p.sku] = true; uniqueSkus.push(p.sku); } });

    var updated = 0;
    var errors = [];
    var changes = [];

    for (var i = 0; i < uniqueSkus.length; i++) {
      var sku = uniqueSkus[i];
      try {
        if (i > 0) await new Promise(function(r) { setTimeout(r, 500); });

        // Call SanMar Pricing SOAP service
        var soapBody = buildSoapEnvelope('getSignInPricing', { style: sku, color: '', size: '' }, smUser, smPass);
        var smRes = await fetch('https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': 'getSignInPricing' },
          body: soapBody
        });

        if (!smRes.ok) { errors.push({ sku: sku, error: 'HTTP ' + smRes.status }); continue; }

        var xml = await smRes.text();

        // Extract piecePrice values from response
        var prices = extractTagValues(xml, 'piecePrice')
          .map(function(v) { return parseFloat(v); })
          .filter(function(v) { return v > 0; });

        // Also check customerPrice
        if (!prices.length) {
          prices = extractTagValues(xml, 'customerPrice')
            .map(function(v) { return parseFloat(v); })
            .filter(function(v) { return v > 0; });
        }

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
        message: 'SanMar pricing sync complete',
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
