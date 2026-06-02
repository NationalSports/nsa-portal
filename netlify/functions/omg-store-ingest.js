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

    // Pull a SKU out of a string like "Black/White (KB9093)" → KB9093
    const extractSku = (str) => {
      const m = (str || '').match(/\(([A-Za-z0-9]{4,10})\)/);
      return m ? m[1].toUpperCase() : '';
    };
    // NSA SKUs never contain a space, so the catalog SKU is the first token
    // ("KF5972 - 7" → "KF5972"). Drops OMG's internal " - N" variant suffix.
    const cleanSku = (str) => ((str || '').trim().split(/\s+/)[0] || '').toUpperCase();

    (report.reports || []).forEach(r => {
      (r.sections || []).forEach(section => {
        const meta = section.meta || {};
        const rows = section.rows || [];
        const artworkList = meta.artwork || [];
        const sectionSku = meta.sku || '';
        const cleanSectionSku = cleanSku(sectionSku);
        const sectionSkuOk = cleanSectionSku && !cleanSectionSku.includes(' ') && cleanSectionSku.length <= 15;

        // Same product can ship multiple SKUs (one per color), e.g. KB9093 in
        // black and KB9097 in grey — split each SKU into its own product row.
        const groups = {};
        rows.forEach(row => {
          const sz = row.size || 'OS';
          const qty = row.quantity || 0;
          const rowSku = extractSku(row.color) || (sectionSkuOk ? cleanSectionSku : '');
          const key = rowSku || '__nosku__';
          if (!groups[key]) groups[key] = { sku: rowSku, sizes: {}, qty: 0, paid: 0, colors: new Set() };
          const g = groups[key];
          g.sizes[sz] = (g.sizes[sz] || 0) + qty;
          g.qty += qty;
          g.paid += (row.paid || 0);
          if (row.color) g.colors.add(row.color);
        });

        Object.values(groups).forEach(g => {
          let sku = g.sku;
          if (!sku) {
            const fromText = extractSku([...g.colors].join(' ') + ' ' + (meta.name || ''));
            sku = fromText || cleanSku(sectionSku);
          }
          const matchedArt = sku
            ? artworkList.filter(a => `${a.caption||''} ${a.color||''} ${a.name||''} ${a.label||''}`.toUpperCase().includes(sku))
            : [];
          const artwork = (matchedArt.length ? matchedArt : artworkList)[0];
          products.push({
            store_id: storeId,
            sku,
            name: meta.name || '',
            color: [...g.colors].join(', '),
            retail: meta.base_price || 0,
            cost: meta.cogs || 0,
            deco_type: '',
            deco_cost: 0,
            sizes: g.sizes,
            image_url: artwork?.link || artwork?.thumbnail || '',
          });

          totalQty += g.qty;
          totalSales += g.paid;
        });
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
