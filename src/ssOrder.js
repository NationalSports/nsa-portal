// S&S Activewear order payload builder (REST API v2, POST /v2/orders/).
// Docs: https://api.ssactivewear.com/V2/Orders_Post.aspx
//
// S&S keys each order line by its `identifier` — the size-specific S&S Sku
// (e.g. "B00760003"). Portal order lines carry style/color/size, so the Sku is
// resolved live from the Products API (see ssResolveSkus in vendorApis.js) and
// stamped onto each line before submit. This module is dry-run-safe: it makes no
// network calls — it just builds the JS payload for preview + submission.
//
// shippingMethod codes: 1 = UPS Ground, 2 = UPS Next Day, 3 = UPS 2nd Day, 14 = FedEx Ground.

export const SS_SHIP_METHODS = { ground: '1', next_day: '2', second_day: '3', fedex_ground: '14' };

// Flatten batch PO entries into S&S order lines (one per size). Each item carries
// style (its sku field), color and sizes{}. The S&S Sku is looked up per size; if
// absent we flag it via `warnings` so the preview blocks rather than send an
// invalid line.
export function buildSSOrderLines(batchPOs) {
  const lines = [];
  const warnings = [];
  (batchPOs || []).forEach(bp => {
    (bp.items || []).forEach(it => {
      if (it.drop_ship) return; // drop-ship lines ship direct to the customer, not via the NSA-warehouse API order
      const style = it._ss_style || it.sku || '';
      const color = it._ss_color || it.color || '';
      const skuBySize = it._ss_skus || it._ssSkus || {};
      Object.entries(it.sizes || {}).forEach(([size, qty]) => {
        if (!qty || qty <= 0) return;
        const sku = String(skuBySize[size] || it._ss_sku || '');
        if (!sku) warnings.push(`Line (${[style, color, size].filter(Boolean).join(' ')}) is missing an S&S SKU`);
        lines.push({
          key: `${style}|${color}|${size}`,
          style, color, size, sku,
          quantity: qty,
          unitPrice: it.unit_cost || 0,
          sourceSO: bp.so_id,
          name: it.name || '',
        });
      });
    });
  });
  return { lines, warnings };
}

// Build the S&S order. Returns { order, lines, summary, warnings } where `order` is
// the exact JSON body POSTed to /v2/orders/. Display-only data is kept out of
// `order` so it never leaks into the request.
export function buildSSOrderPayload({
  poNumber,
  batchPOs,
  lineItems,                    // optional pre-built lines (with resolved sku)
  shipTo,                       // { companyName, attentionTo, address1, address2, city, region, postalCode }
  shippingMethod = '1',         // 1 = UPS Ground
  emailConfirmation = '',
  testOrder = true,             // safe default — S&S creates & cancels test orders (nothing ships)
  autoselectWarehouse = true,
  residential = false,
} = {}) {
  let lines = lineItems, warnings = [];
  if (!lines) { const built = buildSSOrderLines(batchPOs); lines = built.lines; warnings = built.warnings; }
  const ship = shipTo || {};
  const order = {
    shippingAddress: {
      customer: ship.companyName || ship.customer || '',
      attn: ship.attentionTo || ship.attn || '',
      address: [ship.address1, ship.address2].filter(Boolean).join(' '),
      city: ship.city || '',
      state: ship.region || ship.state || '',
      zip: ship.postalCode || ship.zip || '',
      residential: !!residential,
    },
    shippingMethod: String(shippingMethod),
    shipBlind: false,
    poNumber: poNumber || '',
    emailConfirmation: emailConfirmation || '',
    testOrder: !!testOrder,
    autoselectWarehouse: !!autoselectWarehouse,
    rejectLineErrors: false,
    lines: lines.map(l => ({ identifier: l.sku, qty: l.quantity })),
  };
  const summary = {
    lineCount: lines.length,
    totalQty: lines.reduce((s, l) => s + l.quantity, 0),
    totalCost: lines.reduce((s, l) => s + l.quantity * (l.unitPrice || 0), 0),
  };
  return { order, lines, summary, warnings };
}
