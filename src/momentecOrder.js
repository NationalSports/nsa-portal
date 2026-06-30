// Momentec Brands order payload builder (REST API v2, POST /v2/Order).
// Docs: https://www.momentecbrands.com/rest-api
//
// Order lines key off the Momentec SKU/partNumber (style.color.size, e.g. "790.080.S").
// Portal lines carry style/color/size, so the SKU is resolved (see momentecResolveSkus
// in vendorApis.js) and stamped on before submit. `credentials` (logonId/password) are
// injected server-side by the proxy and never live in the client payload. Dry-run-safe:
// no network calls here.
//
// NOTE: packageType / isKitOrder / the storeId property and shipMode codes are pending
// confirmation from Momentec (their Sample Blank Order omits packageType/isKitOrder).
// Defaults below follow that sample; adjust once Momentec confirms the blank-order spec.

export const MT_SHIP_MODES = { ground: '103' }; // 103 = ground per the docs sample

// Flatten batch PO entries into Momentec order lines (one per size).
export function buildMomentecOrderLines(batchPOs) {
  const lines = [];
  const warnings = [];
  (batchPOs || []).forEach(bp => {
    (bp.items || []).forEach(it => {
      if (it.drop_ship) return; // drop-ship lines ship direct to the customer, not via the NSA-warehouse API order
      const style = it._mt_style || it.sku || '';
      const color = it._mt_color || it.color || '';
      const skuBySize = it._mt_skus || {};
      Object.entries(it.sizes || {}).forEach(([size, qty]) => {
        if (!qty || qty <= 0) return;
        const sku = String(skuBySize[size] || it._mt_sku || '');
        if (!sku) warnings.push(`Line (${[style, color, size].filter(Boolean).join(' ')}) is missing a Momentec SKU`);
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

// Build the Momentec order. Returns { order, lines, summary, warnings } where `order`
// is the JSON body POSTed to /v2/Order (minus credentials, which the proxy injects).
export function buildMomentecOrderPayload({
  poNumber,
  batchPOs,
  lineItems,
  shipTo,                  // { companyName, attentionTo, address1, address2, city, region, postalCode, phone }
  shipMode = '103',        // 103 = ground
  isKitOrder = 'N',        // blank goods = not a kit
  packageType = 'Blank',
  storeId = '',            // optional storeId property (per sample)
  addressId = '1',
} = {}) {
  let lines = lineItems, warnings = [];
  if (!lines) { const built = buildMomentecOrderLines(batchPOs); lines = built.lines; warnings = built.warnings; }
  const ship = shipTo || {};
  const order = {
    packageType,
    shipMode: String(shipMode),
    isKitOrder,
    poNum: poNumber || '',
    ...(storeId ? { properties: [{ key: 'storeId', value: storeId }] } : {}),
    items: lines.map(l => ({
      poNum: poNumber || '',
      addressId,
      sku: l.sku,
      designNumber: '',
      playerNumber: '',
      playerName: '',
      quantity: String(l.quantity),
    })),
    addresses: [{
      addressId,
      shipTo: ship.companyName || ship.customer || '',
      attention: ship.attentionTo || ship.attn || '',
      shipAddress1: ship.address1 || '',
      shipAddress2: ship.address2 || '',
      shipCity: ship.city || '',
      shipState: ship.region || ship.state || '',
      shipZip: ship.postalCode || ship.zip || '',
      shipCountry: ship.country || 'US',
      telePhone: ship.phone || '',
      residence: 'N',
      shipComplete: 'N',
      firstName: ship.firstName || '',
      lastName: ship.lastName || '',
    }],
  };
  const summary = {
    lineCount: lines.length,
    totalQty: lines.reduce((s, l) => s + l.quantity, 0),
    totalCost: lines.reduce((s, l) => s + l.quantity * (l.unitPrice || 0), 0),
  };
  return { order, lines, summary, warnings };
}
