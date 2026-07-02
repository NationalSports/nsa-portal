// Momentec Brands order payload builder (REST API v2, POST /v2/Order).
// Docs: https://www.momentecbrands.com/rest-api
//
// Order lines key off the Momentec SKU/partNumber (style.color.size, e.g. "790.080.S").
// Portal lines carry style/color/size, so the SKU is resolved (see momentecResolveSkus
// in vendorApis.js) and stamped on before submit. `credentials` (logonId/password) are
// injected server-side by the proxy and never live in the client payload. Dry-run-safe:
// no network calls here.
//
// Field values verified against Momentec's OpenAPI spec (momentec-v14-updated.yaml, the
// source behind momentecbrands.com/rest-api): isKitOrder allows 'true'/'false' only (blank
// orders are never kit orders), quantity is a string, and the address block requires
// addressId/shipTo/attention/shipAddress1/shipCity/shipZip/residence/shipComplete/shipCountry
// plus firstName-or-lastName. Their Sample Blank Order omits packageType/isKitOrder entirely;
// we send explicit spec-legal values. shipMode 103 = FedEx Ground per the spec's mode table.

export const MT_SHIP_MODES = { ground: '103' }; // 103 = FedEx Ground per the spec's shipping-mode table

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
        // No _mt_sku fallback here: it's the colorway (design.color) WITHOUT the size — a
        // truncated, invalid order SKU that would also skip the modal's live resolution and
        // missing-SKU submit block. Leave blank so the line resolves (or blocks) properly.
        const sku = String(skuBySize[size] || '');
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
  shipTo,                  // { companyName, attentionTo, firstName, lastName, address1, address2, city, region, postalCode, phone }
  shipMode = '103',        // 103 = FedEx Ground
  isKitOrder = 'false',    // blank goods = not a kit; spec allows 'true'/'false' only
  packageType = 'Blank',
  storeId = '',            // optional storeId property (per sample)
  addressId = '1',
} = {}) {
  let lines = lineItems, warnings = [];
  if (!lines) { const built = buildMomentecOrderLines(batchPOs); lines = built.lines; warnings = built.warnings; }
  const ship = shipTo || {};
  // Momentec keys the recipient name on the address off firstName/lastName — their spec
  // says "Either firstName or lastName is required", and orders sent with both blank
  // land nameless in their system even when shipTo/attention are filled. Derive a name
  // when the caller doesn't supply one: split a multi-word attention into first/last,
  // otherwise fall back to the company name.
  let firstName = ship.firstName || '';
  let lastName = ship.lastName || '';
  if (!firstName && !lastName) {
    const attn = String(ship.attentionTo || ship.attn || '').trim();
    const company = String(ship.companyName || ship.customer || '').trim();
    const words = attn.split(/\s+/).filter(Boolean);
    if (words.length >= 2) { firstName = words.slice(0, -1).join(' '); lastName = words[words.length - 1]; }
    else lastName = company || attn;
  }
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
      firstName,
      lastName,
    }],
  };
  const summary = {
    lineCount: lines.length,
    totalQty: lines.reduce((s, l) => s + l.quantity, 0),
    totalCost: lines.reduce((s, l) => s + l.quantity * (l.unitPrice || 0), 0),
  };
  return { order, lines, summary, warnings };
}
