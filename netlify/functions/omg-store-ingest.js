// Netlify function: webhook endpoint for ingesting OMG shared reports.
// Called by Google Apps Script (or manually) with a report URL.
// Fetches the report JSON, parses products, upserts the store + products into Supabase.
//
// POST /.netlify/functions/omg-store-ingest
// Body: { "reportUrl": "https://report.ordermygear.com/48ff450f-..." }
//
// Environment variables required:
//   REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  let reportUrl;
  try {
    const body = JSON.parse(event.body || '{}');
    reportUrl = body.reportUrl || body.url || '';
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // Extract UUID from various URL formats
  const uuidMatch = reportUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!uuidMatch) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid report UUID found in URL' }) };
  }
  const reportId = uuidMatch[1];

  try {
    // Fetch the report JSON
    const reportResp = await fetch(`https://report.ordermygear.com/reports/${reportId}`);
    if (!reportResp.ok) throw new Error(`Report fetch failed: ${reportResp.status}`);
    const report = await reportResp.json();

    if (!report?.reports?.length) throw new Error('Report has no data');

    // Extract store metadata from the report
    const saleCode = report.options?.filter?.find(f => f.key === 'sale_code')?.value || '';
    const storeName = report.details?.title || `OMG Store ${saleCode}`;
    const storeId = `OMG-sale_${saleCode}`;

    // Parse products from report sections
    const products = [];
    let totalQty = 0, totalSales = 0;

    (report.reports || []).forEach(r => {
      (r.sections || []).forEach(section => {
        const meta = section.meta || {};
        const rows = section.rows || [];
        const sizes = {};
        let productQty = 0, productPaid = 0;
        const colors = new Set();

        rows.forEach(row => {
          const sz = row.size || 'OS';
          const qty = row.quantity || 0;
          sizes[sz] = (sizes[sz] || 0) + qty;
          productQty += qty;
          productPaid += (row.paid || 0);
          if (row.color) colors.add(row.color);
        });

        const artwork = (meta.artwork || [])[0];
        products.push({
          store_id: storeId,
          sku: meta.sku || '',
          name: meta.name || '',
          color: [...colors].join(', '),
          retail: meta.base_price || 0,
          cost: meta.cogs || 0,
          deco_type: '',
          deco_cost: 0,
          sizes,
          image_url: artwork?.link || artwork?.thumbnail || '',
        });

        totalQty += productQty;
        totalSales += productPaid;
      });
    });

    // Upsert store into Supabase
    const store = {
      id: storeId,
      store_name: storeName,
      status: 'open',
      _omg_source: true,
      _omg_id: `sale_${saleCode}`,
      _omg_sale_code: saleCode,
      _last_synced: new Date().toISOString(),
      items_sold: totalQty,
      total_sales: totalSales,
      orders: 0,
      fundraise_total: 0,
      unique_buyers: 0,
      channel_type: 'pop-up',
    };

    const storeResp = await fetch(`${sbUrl}/rest/v1/omg_stores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(store),
    });

    if (!storeResp.ok) {
      const errText = await storeResp.text();
      console.error('Supabase store upsert failed:', errText);
    }

    // Upsert products into Supabase
    if (products.length > 0) {
      // Delete existing products for this store first
      await fetch(`${sbUrl}/rest/v1/omg_store_products?store_id=eq.${encodeURIComponent(storeId)}`, {
        method: 'DELETE',
        headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` },
      });

      // Insert new products
      const prodResp = await fetch(`${sbUrl}/rest/v1/omg_store_products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': sbKey,
          'Authorization': `Bearer ${sbKey}`,
        },
        body: JSON.stringify(products),
      });

      if (!prodResp.ok) {
        const errText = await prodResp.text();
        console.error('Supabase products insert failed:', errText);
      }
    }

    console.log(`[OMG Ingest] Created store "${storeName}" (${saleCode}) with ${products.length} products, ${totalQty} items, $${totalSales}`);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        store: { id: storeId, name: storeName, saleCode },
        products: products.length,
        totalItems: totalQty,
        totalSales,
      }),
    };
  } catch (error) {
    console.error('[OMG Ingest] Failed:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
