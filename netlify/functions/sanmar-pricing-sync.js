// Netlify function to re-cost SanMar products in Supabase from live SanMar pricing.
// Manual / on-demand only (no cron) — the daily cost refresh runs in
// sanmar-brands-sync-background. Run this to force a re-cost, e.g. after a bad or
// blended cost was imported onto a row the brand sync doesn't own.
//
// Pricing is looked up per SanMar STYLE (e.g. "ST520"). Product SKUs are stored
// color-suffixed ("ST520-Cardinal"), so the style is the segment before the first
// "-". One style lookup can return multiple colors and sizes; those dimensions must
// remain scoped so a promotion on one color never re-costs the others. nsa_cost is
// the lowest base-tier price for that color; size_costs holds 2XL/3XL+ differences.
//
// Environment variables required:
//   SANMAR_USERNAME, SANMAR_PASSWORD — SanMar API credentials
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — Supabase access
//
// Trigger manually via: GET /.netlify/functions/sanmar-pricing-sync
//   Defaults to a DRY RUN (returns the proposed nsa_cost/size_costs diffs, writes
//   nothing). Add ?commit=1 to actually apply them:
//     GET /.netlify/functions/sanmar-pricing-sync            → preview
//     GET /.netlify/functions/sanmar-pricing-sync?commit=1   → apply

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

// getPricing returns one record per style/color/size. Capture the
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
    // Account price first — same field priority as the Order Editor's proven
    // SanMar pricing path (myPrice → salePrice → piecePrice).
    var price = null;
    var keys = ['myPrice', 'salePrice', 'piecePrice', 'customerPrice'];
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

function parsePricingRows(xml) {
  var rows = [];
  var wrappers = ['listResponse', 'PriceInfo', 'productPricing', 'return', 'item'];
  var blocks = null;
  for (var w = 0; w < wrappers.length; w++) {
    var re = new RegExp('<(?:[\\w]+:)?' + wrappers[w] + '\\b[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?' + wrappers[w] + '>', 'gi');
    var found = [];
    var m;
    while ((m = re.exec(xml)) !== null) found.push(m[1]);
    if (found.length && found.some(function(b) { return /<(?:[\w]+:)?size\b/i.test(b); })) { blocks = found; break; }
  }
  if (!blocks) return rows;
  blocks.forEach(function(b) {
    var size = extractTag(b, 'size') || extractTag(b, 'labelSize');
    if (!size) return;
    var color = extractTag(b, 'catalogColor') || extractTag(b, 'color') || extractTag(b, 'colorName') || extractTag(b, 'productColor') || '';
    var price = 0;
    ['myPrice', 'salePrice', 'piecePrice', 'customerPrice'].some(function(key) {
      var n = parseFloat(extractTag(b, key));
      if (n > 0) { price = n; return true; }
      return false;
    });
    if (price > 0) rows.push({ color: color, size: size.trim(), price: price });
  });
  return rows;
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

    // Safety: default to a DRY RUN (compute the diffs, write nothing). This tool
    // re-costs every SanMar product from live pricing, so require an explicit
    // ?commit=1 (or ?write=1) to actually PATCH the rows. Preview first, confirm the
    // before/after looks right (e.g. ST520 10.37 → 8.37), then commit.
    var qp = (event && event.queryStringParameters) || {};
    var commit = /^(1|true|yes)$/i.test(String(qp.commit || qp.write || ''));

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
    const pRes = await fetch(sbUrl + '/rest/v1/products?or=(vendor_id.in.(' + vendorIds + '),inventory_source.eq.sanmar)&select=id,sku,color,nsa_cost,size_costs,vendor_id,inventory_source&limit=100000', { headers: sbHeaders });
    const products = await pRes.json();
    if (!Array.isArray(products) || !products.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No SanMar products in database', updated: 0, vendors_found: vendors.length }) };
    }

    // 3. Group products by SanMar STYLE. Stored SKUs are color-suffixed
    //    ("ST520-Cardinal"); the SanMar style is the segment before the first "-".
    //    One style lookup returns all available color/size prices, so it can re-cost
    //    every color without discarding color scope. (The old code passed the full color-suffixed SKU
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

        // Call SanMar Pricing SOAP service with the bare style number. getPricing is
        // the action the Order Editor's live pricing uses (returns myPrice — our
        // account price); getSignInPricing returned catalog-tier numbers.
        var soapBody = buildSoapEnvelope('getPricing', { style: style, color: '', size: '' }, smUser, smPass);
        var smRes = await fetch('https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort', {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': 'getPricing' },
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

        var pricingRows = parsePricingRows(xml);
        if (!pricingRows.length && !prices.length) continue;
        var colorKey = function(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
        var hasColoredRows = pricingRows.some(function(r) { return colorKey(r.color); });

        var matching = byStyle[style];

        for (var j = 0; j < matching.length; j++) {
          var prod = matching[j];
          var wanted = colorKey(prod.color);
          var scopedRows = wanted ? pricingRows.filter(function(r) { return colorKey(r.color) === wanted; }) : pricingRows;
          // An exact-color miss must not silently inherit another color's promo.
          if (!scopedRows.length && !hasColoredRows) scopedRows = pricingRows;
          var sizeCosts = {};
          scopedRows.forEach(function(r) {
            if (sizeCosts[r.size] == null || r.price < sizeCosts[r.size]) sizeCosts[r.size] = r.price;
          });
          var scVals = Object.keys(sizeCosts).map(function(s) { return sizeCosts[s]; });
          if (!scVals.length && hasColoredRows) continue;
          var newCost = scVals.length ? Math.min.apply(null, scVals) : Math.min.apply(null, prices);
          var distinctVals = {};
          Object.keys(sizeCosts).forEach(function(s) { distinctVals[sizeCosts[s].toFixed(2)] = true; });
          var nextSizeCosts = Object.keys(distinctVals).length > 1 ? Object.fromEntries(Object.entries(sizeCosts).filter(function(entry) { return Math.abs(entry[1] - newCost) > 0.001; })) : null;
          var nextSCStr = stableSC(nextSizeCosts);
          var costChanged = Math.abs((prod.nsa_cost || 0) - newCost) > 0.005;
          var scChanged = stableSC(prod.size_costs) !== nextSCStr;
          if (costChanged || scChanged) {
            var change = { sku: prod.sku, old: prod.nsa_cost, new: newCost, size_costs: nextSizeCosts || undefined };
            if (!commit) { changes.push(change); continue; } // dry run: record the diff, write nothing
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
              changes.push(change);
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
        message: commit
          ? 'SanMar pricing sync complete'
          : 'SanMar pricing DRY RUN — nothing written. Add ?commit=1 to apply these changes.',
        dry_run: !commit,
        total_styles: styles.length,
        proposed: changes.length,
        updated: updated,
        changes: changes,
        errors: errors.length > 0 ? errors : undefined
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Sync crashed: ' + err.message }) };
  }
};

exports._test = { parseSizeCosts, parsePricingRows };
