// Netlify function: ingest an OMG *Player Report* into per-order tracking rows.
//
// Unlike omg-store-ingest.js (which parses the STORE report — sections = products
// grouped by SKU — into omg_stores/omg_store_products aggregates), the PLAYER
// report has sections = ORDERS (one per player), each with meta.order_number and
// rows = that order's line items. We turn each section into a webstore_orders row
// (+ webstore_order_items), reusing the webstore rails so the public order page,
// the line_status sync trigger, the ShipStation webhook, and Brevo all work
// unchanged. See migration 034 for the "shadow webstore" model.
//
// POST /.netlify/functions/omg-player-report-ingest
// Body: { "reportUrl": "https://report.ordermygear.com/<uuid>" }
//
// IMPORTANT: the player report contains NO buyer email or shipping address —
// those live only on the packing slip. This function creates the orders and
// line items; contact enrichment is a separate step (omg-packing-slip-ingest).
//
// Env: REACT_APP_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
const { createClient } = require('@supabase/supabase-js');

// Pull a SKU out of a string like "Black/White (KB9093)" → KB9093
const extractSku = (str) => {
  const m = (str || '').match(/\(([A-Za-z0-9]{4,10})\)/);
  return m ? m[1].toUpperCase() : '';
};
// "Black/White (KB9093)" → "Black/White"
const cleanColor = (str) => (str || '').replace(/\s*\([A-Za-z0-9]{4,10}\)\s*/g, '').trim();

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }
  const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let reportUrl;
  try {
    const body = JSON.parse(event.body || '{}');
    reportUrl = body.reportUrl || body.url || '';
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const uuidMatch = reportUrl.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!uuidMatch) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid report UUID found in URL' }) };
  }
  const reportId = uuidMatch[1];

  try {
    const reportResp = await fetch(`https://report.ordermygear.com/reports/${reportId}`);
    if (!reportResp.ok) throw new Error(`Report fetch failed: ${reportResp.status}`);
    const report = await reportResp.json();
    if (!report?.reports?.length) throw new Error('Report has no data');

    // Confirm this is a player report (sections carry order metadata).
    const saleCode = report.options?.filter?.find((f) => f.key === 'sale_code')?.value
      || report.reports[0]?.filter?.sale_code || '';
    const storeName = report.details?.title || `OMG Store ${saleCode}`;
    if (!saleCode) throw new Error('No sale_code found in report');

    // ── 1. Shadow webstore for this OMG sale (idempotent upsert by sale code) ──
    const slug = `omg-${String(saleCode).toLowerCase()}`;
    let store;
    {
      const { data: existing } = await sb.from('webstores').select('*').eq('omg_sale_code', saleCode).maybeSingle();
      if (existing) {
        store = existing;
        await sb.from('webstores').update({ name: storeName, logo_url: report.dealerLogo || existing.logo_url, updated_at: new Date().toISOString() }).eq('id', store.id);
      } else {
        const { data: created, error: cErr } = await sb.from('webstores').insert({
          slug, name: storeName, source: 'omg', omg_sale_code: saleCode,
          status: 'archived',            // not a live shopping store — only the order page is used
          payment_mode: 'paid', logo_url: report.dealerLogo || null,
        }).select().single();
        if (cErr) throw new Error(`Shadow webstore create failed: ${cErr.message}`);
        store = created;
      }
    }

    // ── 2. Parse each section into an order + its line items ──
    let ordersUpserted = 0, itemsInserted = 0, skipped = 0;
    const results = [];

    for (const r of report.reports || []) {
      for (const section of r.sections || []) {
        const meta = section.meta || {};
        const orderNumber = meta.order_number != null ? String(meta.order_number) : '';
        if (!orderNumber) { skipped++; continue; }

        const playerName = meta.player_name || '';
        const buyerName = (meta.billing_name || playerName || '').trim();

        // Build line items from rows.
        const lineItems = (section.rows || []).map((row) => {
          const sku = extractSku(row.color) || (row.sku || '').toUpperCase();
          return {
            sku,
            name: row.product || '',
            color: cleanColor(row.color),
            size: row.size || 'OS',
            qty: row.quantity || 0,
            unit_price: row.quantity ? (Number(row.paid || 0) / row.quantity) : Number(row.paid || 0),
            player_name: playerName,
            line_status: 'pending',
          };
        }).filter((li) => li.qty > 0);

        if (!lineItems.length) { skipped++; continue; }

        const subtotal = lineItems.reduce((a, li) => a + li.unit_price * li.qty, 0);
        const total = Number(meta.order_total != null ? meta.order_total : subtotal);

        // Upsert the order (idempotent by store + omg_order_number).
        const { data: existingOrder } = await sb.from('webstore_orders')
          .select('id,status_token').eq('store_id', store.id).eq('omg_order_number', orderNumber).maybeSingle();

        let orderId, statusToken;
        if (existingOrder) {
          orderId = existingOrder.id; statusToken = existingOrder.status_token;
          await sb.from('webstore_orders').update({
            buyer_name: buyerName, subtotal, total,
          }).eq('id', orderId);
          // Replace line items so re-ingest reflects the latest report.
          await sb.from('webstore_order_items').delete().eq('order_id', orderId);
        } else {
          const { data: createdOrder, error: oErr } = await sb.from('webstore_orders').insert({
            store_id: store.id, status: 'paid', payment_mode: 'paid',
            order_kind: 'individual', buyer_name: buyerName,
            subtotal, total, omg_order_number: orderNumber,
            notes: `OMG order ${orderNumber} · ${meta.order_date || ''}`.trim(),
          }).select('id,status_token').single();
          if (oErr) throw new Error(`Order insert failed (${orderNumber}): ${oErr.message}`);
          orderId = createdOrder.id; statusToken = createdOrder.status_token;
        }

        const rows = lineItems.map((li) => ({ ...li, order_id: orderId }));
        const { error: iErr } = await sb.from('webstore_order_items').insert(rows);
        if (iErr) throw new Error(`Items insert failed (${orderNumber}): ${iErr.message}`);

        ordersUpserted++;
        itemsInserted += rows.length;
        results.push({ orderNumber, player: playerName, items: rows.length, status_token: statusToken });
      }
    }

    console.log(`[OMG Player Ingest] ${storeName} (${saleCode}): ${ordersUpserted} orders, ${itemsInserted} items, ${skipped} skipped`);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        store: { id: store.id, slug: store.slug, name: storeName, saleCode },
        ordersUpserted, itemsInserted, skipped,
        orders: results,
        note: 'Buyer email + shipping address are not in the player report; run omg-packing-slip-ingest to enrich.',
      }),
    };
  } catch (error) {
    console.error('[OMG Player Ingest] Failed:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
