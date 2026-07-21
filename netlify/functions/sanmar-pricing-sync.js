// Netlify function to re-cost SanMar products in Supabase from live SanMar pricing.
// Manual / on-demand only (no cron) — the daily cost refresh runs in
// sanmar-brands-sync-background. Run this to force a re-cost, e.g. after a bad or
// blended cost was imported onto a row the brand sync doesn't own.
//
// Pricing is looked up per SanMar STYLE (e.g. "ST520"). Product SKUs are stored
// color-suffixed ("ST520-Cardinal"), so the style is the segment before the first
// "-". SanMar prices per style+size (uniform across colors), so one lookup re-costs
// every color of a style. nsa_cost = the lowest (base, XS–XL) size price; size_costs
// holds the per-size upcharges (2XL/3XL+).
//
// Environment variables required:
//   SANMAR_USERNAME, SANMAR_PASSWORD — SanMar API credentials
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — Supabase access
//
// Trigger manually via: GET /.netlify/functions/sanmar-pricing-sync

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

// getSignInPricing returns one record per style/color/size. Capture the
// per-size price so extended-size upcharges (2XL/3XL+) survive instead of
// being collapsed to a single number. We split the response into record
// blocks (each holding a <size> and a price) and map size -> piecePrice
// (falling back to customerPrice/salePrice). Returns {} when the response
// has no per-size structure.
function parseSizeCosts(xml) {
  var map = {};
  var blocks = null;
  // SanMar's wrapper element name varies by service; use whichever repeats
  // and actually contains a <size>.
  var wrappers = ['listResponse', 'PriceInfo', 'productPricing', 'return', 'item'];
  for (var w = 0; w < wrappers.length; w++) {
    var re = new RegExp('<(?:[\\w]+:)?' + wrappers[w] + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?' + wrappers[w] + '>', 'gi');
    var found = [];
    var m;
    while ((m = re.exec(xml)) !== null) found.push(m[1]);
    if (found.length && found.some(function(b) { return /<(?:[\w]+:)?size\b/i.test(b); })) { blocks = found; break; }
  }
  if (!blocks) return map;
  blocks.forEach(function(b) {
    var size = extractTag(b, 'size');
    if (!size) return;
    var price = null;
    var keys = ['piecePrice', 'customerPrice', 'salePrice'];
    for (var k = 0; k < keys.length; k++) {
      var v = parseFloat(extractTag(b, keys[k]));
      if (v > 0) { price = v; break; }
    }
    if (price == null) return;
    var key = size.trim();
    // Keep the lowest price seen for a size (matches the min basis used for nsa_cost).
    if (map[key] == null || price < map[key]) map[key] = price;
  });
  return map;
}

// Stable stringify (sorted keys) so we can diff a freshly-parsed map against
// the stored jsonb without false positives from key ordering.
function stableSC(obj) {
  if (!obj || typeof obj !== 'object') return null;
  var keys = Object.keys(obj).sort();
  if (!keys.length) return null;
  var out = {};
  keys.forEach(function(k) { out[k] = obj[k]; });
  return JSON.stringify(out);
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

    // 2. Get SanMar products to re-cost: rows on a SanMar vendor OR tagged
    //    inventory_source='sanmar'. The inventory_source arm catches rows whose
    //    vendor_id is stale or missing (e.g. an item imported or hand-costed onto a
    //    non-SanMar vendor) — the old vendor-only filter skipped those, so a wrong
    //    cost on such a row could never be corrected here.
    const vendorIds = vendors.map(function(v) { return '"' + v.id + '"'; }).join(',');
    const pRes = await fetch(sbUrl + '/rest/v1/products?or=(vendor_id.in.(' + vendorIds + '),inventory_source.eq.sanmar)&select=id,sku,nsa_cost,size_costs,vendor_id,inventory_source&limit=100000', { headers: sbHeaders });
    const products = await pRes.json();
    if (!Array.isArray(products) || !products.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No SanMar products in database', updated: 0, vendors_found: vendors.length }) };
    }

    // 3. Group products by SanMar STYLE. Stored SKUs are color-suffixed
    //    ("ST520-Cardinal"); the SanMar style is the segment before the first "-".
    //    Pricing is per style+size (uniform across colors), so one lookup re-costs
    //    every color of the style. (The old code passed the full color-suffixed SKU
    //    as the style to getSignInPricing, which matched nothing — so brand-synced
    //    SanMar rows were never re-costed by this function.)
    var styleOf = function(sku) { return String(sku || '').split('-')[0].trim(); };
    var byStyle = {};
    products.forEach(function(p) { var st = styleOf(p.sku); if (!st) return; (byStyle[st] = byStyle[st] || []).push(p); });
    var styles = Object.keys(byStyle);

    var updated = 0;
    var errors = [];
    var changes = [];

    for (var i = 0; i < styles.length; i++) {
      var style = styles[i];
      try {
        if (i > 0) await new Promise(function(r) { setTimeout(r, 500); });

        // Call SanMar Pricing SOAP service with the bare style number.
        var soapBody = buildSoapEnvelope('getSignInPricing', { style: style, color: '', size: '' }, smUser, smPass);
        var smRes = await fetch('https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': 'getSignInPricing' },
          body: soapBody
        });

        if (!smRes.ok) { errors.push({ style: style, error: 'HTTP ' + smRes.status }); continue; }

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

        // Base cost = the lowest (XS–XL tier) size price. SanMar record order varies
        // (an upsized 2XL+ row can come first), so take the min — matching
        // sanmar-brands-sync and what the store editor shows as the item cost.
        var newCost = Math.min.apply(null, prices);

        // Build the per-size cost map. Only persist it when sizes actually
        // differ (an upcharge exists); a flat price needs no map and falls
        // back to nsa_cost in the app.
        var sizeCosts = parseSizeCosts(xml);
        var distinctVals = {};
        Object.keys(sizeCosts).forEach(function(s) { distinctVals[sizeCosts[s].toFixed(2)] = true; });
        var nextSizeCosts = Object.keys(distinctVals).length > 1 ? sizeCosts : null;
        var nextSCStr = stableSC(nextSizeCosts);

        var matching = byStyle[style];

        for (var j = 0; j < matching.length; j++) {
          var prod = matching[j];
          var costChanged = Math.abs((prod.nsa_cost || 0) - newCost) > 0.005;
          var scChanged = stableSC(prod.size_costs) !== nextSCStr;
          if (costChanged || scChanged) {
            var uRes = await fetch(sbUrl + '/rest/v1/products?id=eq.' + prod.id, {
              method: 'PATCH',
              headers: Object.assign({}, sbHeaders, { 'Prefer': 'return=minimal' }),
              body: JSON.stringify({ nsa_cost: newCost, size_costs: nextSizeCosts })
            });
            if (!uRes.ok) {
              var errTxt = await uRes.text();
              errors.push({ sku: prod.sku, error: errTxt });
            } else {
              updated++;
              changes.push({ sku: prod.sku, old: prod.nsa_cost, new: newCost, size_costs: nextSizeCosts || undefined });
            }
          }
        }
      } catch (err) {
        errors.push({ style: style, error: err.message });
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        message: 'SanMar pricing sync complete',
        total_styles: styles.length,
        updated: updated,
        changes: changes,
        errors: errors.length > 0 ? errors : undefined
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Sync crashed: ' + err.message }) };
  }
};
