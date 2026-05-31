// SanMar Purchase Order payload builder (PromoStandards sendPO).
//
// Spec: SanMar PO Integration Guide v24.3 — "PromoStandards SendPO Service"
//   TEST WSDL: https://test-ws.sanmar.com:8080/promostandards/POServiceBinding?WSDL
//   PROD WSDL: https://ws.sanmar.com:8080/promostandards/POServiceBinding?WSDL
//   Operation namespace:  http://www.promostandards.org/WSDL/PO/1.0.0/        (ns:)
//   Shared objects ns:    http://www.promostandards.org/WSDL/PO/1.0.0/SharedObjects/  (shar:)
//
// IMPORTANT (per guide, pp.31-36):
//   • Line items are keyed by `partId` — the SanMar Unique_Key, NOT style/color/size.
//     The style/color/size we carry here are for the human-readable description only.
//   • The `id` is your SanMar.com USERNAME and `password` your SanMar.com password.
//     Both are injected server-side by the proxy and never live in the client payload.
//   • Fields flagged "SanMar does not use" by the guide are still required by the
//     PromoStandards schema, so we emit them with safe defaults.
//   • Do NOT put extra commas in any field — comma is SanMar's order-file delimiter.
//
// This module is dry-run-safe: it never makes network calls. It builds the JS
// payload + the exact SOAP envelope string (password redacted) for previewing.

export const SANMAR_PO_ENDPOINTS = {
  test: 'https://test-ws.sanmar.com:8080/promostandards/POServiceBinding',
  prod: 'https://ws.sanmar.com:8080/promostandards/POServiceBinding',
};

// SanMar's documented Test environment product IDs (guide p.13). Use these for
// onboarding test orders — the test env inventory/pricing does not mirror prod.
export const SANMAR_TEST_PRODUCTS = [
  { partId: '118862',  style: 'PC61',   color: 'Charcoal',       size: 'S' },
  { partId: '251712',  style: 'PC61',   color: 'Brown',          size: 'S' },
  { partId: '708992',  style: 'PC55',   color: 'Aquatic Blue',   size: 'S' },
  { partId: '441863',  style: 'S508',   color: 'Maui Blue',      size: 'M' },
  { partId: '659761',  style: 'DT5001', color: 'Kelly Green',    size: 'XS' },
  { partId: '1057752', style: 'T200',   color: 'White/Lime Shk', size: 'S' },
];

// Flatten one or more batch PO entries into PromoStandards parts (one per size).
// Each batch PO entry has shape:
//   { items: [{ sku, color, sizes: {S:1, M:2}, unit_cost, _sanmar_partId?, ... }], ... }
// The SanMar Unique_Key (partId) is required for a real submit. We look for it on
// the item under several common keys; if absent we flag it via `_warnings` so the
// preview makes the gap obvious rather than silently sending an invalid part.
export function buildSanMarLineItems(batchPOs) {
  const lines = [];
  const warnings = [];
  let lineNumber = 1;
  (batchPOs || []).forEach(bp => {
    (bp.items || []).forEach(it => {
      const style = it._sanmar_style || (String(it.sku || '').split(/[\s_]/)[0] || it.sku || '');
      const color = it._sanmar_color || it.color || '';
      // SanMar upcharges extended sizes (2XL+). Per-size costs (if captured at PO
      // time) live on _size_costs; otherwise fall back to the blended unit_cost.
      const sizeCosts = it._size_costs || it._sizeCosts || {};
      // partId map keyed by size, or a single partId for all sizes.
      const partIdBySize = it._sanmar_partIds || it._partIds || {};
      Object.entries(it.sizes || {}).forEach(([size, qty]) => {
        if (!qty || qty <= 0) return;
        const unitPrice = sizeCosts[size] != null ? sizeCosts[size] : (it.unit_cost || 0);
        const partId = String(
          partIdBySize[size] || it._sanmar_partId || it.partId || it.unique_key || it.uniqueKey || ''
        );
        if (!partId) warnings.push(`Line ${lineNumber} (${style} ${color} ${size}) is missing a SanMar partId / Unique_Key`);
        lines.push({
          lineNumber: lineNumber++,
          partId,
          uom: 'EA',
          style,
          color,
          size,
          // Comma-free description (comma is SanMar's delimiter).
          description: [style, color, size].filter(Boolean).join(' ').replace(/,/g, ' '),
          quantity: qty,
          unitPrice,
          sourceSO: bp.so_id,
          sourcePO: bp.po_id || '',
          productName: it.name || '',
        });
      });
    });
  });
  return { lines, warnings };
}

// Build a PromoStandards sendPO request as a plain JS object. The proxy wraps
// this in SOAP (injecting id/password); callers can pass it to buildSanMarPOSoap()
// for a redacted preview.
export function buildSanMarPOPayload({
  poNumber,
  batchPOs,
  lineItems,          // optional pre-built parts (e.g. for a fixed test order)
  shipTo,             // { attentionTo, companyName, address1, address2, city, region, postalCode, country, email }
  contact,            // order contact; defaults to shipTo when omitted
  orderType = 'Blank',
  lineType = 'New',
  carrier = 'UPS',
  service = 'Ground',
  currency = 'USD',
  customerPickup = false,
  allowConsolidation = true,   // Warehouse Consolidation = ship complete from closest warehouse
  termsAndConditions = 'N/A',  // schema-required by PromoStandards; SanMar does not use it
} = {}) {
  let lines = lineItems;
  let warnings = [];
  if (!lines) {
    const built = buildSanMarLineItems(batchPOs);
    lines = built.lines;
    warnings = built.warnings;
  }
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const totalAmount = lines.reduce((s, l) => s + l.quantity * (l.unitPrice || 0), 0);
  const ship = shipTo || null;
  return {
    wsVersion: '1.0.0',
    // id/password are injected by the proxy from env; never in the client payload.
    PO: {
      orderType,                              // 'Blank' | 'Sample' | 'Simple' | 'Configured'
      orderNumber: poNumber,                  // guide field name is orderNumber (max 28 chars)
      orderDate: new Date().toISOString().slice(0, 10) + 'T00:00:00',
      totalAmount: Number(totalAmount.toFixed(2)),
      currency,
      rush: false,
      orderContact: contact || ship,          // OrderContactArray > Contact(type=Order)
      shipment: {                              // ShipmentArray > Shipment
        shipReferences: poNumber,
        allowConsolidation,
        blindShip: false,
        packingListRequired: false,
        carrier,
        service,
        customerPickup,
        shipmentId: 1,
        shipTo: ship,
      },
      lineType,
      lineItems: lines,
      termsAndConditions,
    },
    _summary: { totalQty, totalCost: totalAmount, lineCount: lines.length },
    _warnings: warnings,
  };
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Render a <ContactDetails> block (used by both OrderContact and ShipTo).
function contactDetailsXml(c, { withAttention = false } = {}) {
  if (!c) return '';
  const attn = withAttention && c.attentionTo ? `\n                <shar:attentionTo>${esc(c.attentionTo)}</shar:attentionTo>` : '';
  return `<shar:ContactDetails>${attn}
                <shar:companyName>${esc(c.companyName)}</shar:companyName>
                <shar:address1>${esc(c.address1)}</shar:address1>${c.address2 ? `\n                <shar:address2>${esc(c.address2)}</shar:address2>` : ''}
                <shar:city>${esc(c.city)}</shar:city>
                <shar:region>${esc(c.region)}</shar:region>
                <shar:postalCode>${esc(c.postalCode)}</shar:postalCode>
                <shar:country>${esc(c.country || 'US')}</shar:country>${c.email ? `\n                <shar:email>${esc(c.email)}</shar:email>` : ''}
              </shar:ContactDetails>`;
}

// Render the payload as a SanMar v24.3 SendPO SOAP envelope for human review.
// This is the exact XML the proxy POSTs — minus id/password, which are injected
// server-side. Pass includeCreds (server only) to substitute real credentials.
export function buildSanMarPOSoap(payload, { id = '<from env>', password, includeCreds = false } = {}) {
  const po = payload.PO || {};
  const pwd = includeCreds ? esc(password) : '***INJECTED-BY-PROXY***';
  const idVal = includeCreds ? esc(id) : esc(id || '<from env>');

  const lineItemsXml = (po.lineItems || []).map(l => `
        <ns:LineItem>
          <ns:lineNumber>${esc(l.lineNumber)}</ns:lineNumber>
          <shar:description>${esc(l.description || l.style)}</shar:description>
          <ns:lineType>${esc(po.lineType || 'New')}</ns:lineType>
          <shar:ToleranceDetails>
            <shar:tolerance>AllowOverrun</shar:tolerance>
          </shar:ToleranceDetails>
          <ns:allowPartialShipments>false</ns:allowPartialShipments>
          <ns:lineItemTotal>${esc((l.quantity * (l.unitPrice || 0)).toFixed(2))}</ns:lineItemTotal>
          <ns:PartArray>
            <shar:Part>
              <shar:partId>${esc(l.partId)}</shar:partId>
              <shar:customerSupplied>false</shar:customerSupplied>
              <shar:Quantity>
                <shar:uom>${esc(l.uom || 'EA')}</shar:uom>
                <shar:value>${esc(l.quantity)}</shar:value>
              </shar:Quantity>
            </shar:Part>
          </ns:PartArray>
        </ns:LineItem>`).join('');

  const shp = po.shipment || {};
  const shipmentXml = `
        <ns:ShipmentArray>
          <shar:Shipment>
            <shar:shipReferences>${esc(shp.shipReferences || po.orderNumber)}</shar:shipReferences>
            <shar:allowConsolidation>${shp.allowConsolidation === false ? 'false' : 'true'}</shar:allowConsolidation>
            <shar:blindShip>${shp.blindShip ? 'true' : 'false'}</shar:blindShip>
            <shar:packingListRequired>${shp.packingListRequired ? 'true' : 'false'}</shar:packingListRequired>
            <shar:FreightDetails>
              <shar:carrier>${esc(shp.carrier || 'UPS')}</shar:carrier>
              <shar:service>${esc(shp.service || 'Ground')}</shar:service>
            </shar:FreightDetails>
            <shar:ShipTo>
              <shar:customerPickup>${shp.customerPickup ? 'true' : 'false'}</shar:customerPickup>
              ${contactDetailsXml(shp.shipTo, { withAttention: true })}
              <shar:shipmentId>${esc(shp.shipmentId || 1)}</shar:shipmentId>
            </shar:ShipTo>
          </shar:Shipment>
        </ns:ShipmentArray>`;

  const orderContactXml = po.orderContact ? `
        <ns:OrderContactArray>
          <shar:Contact>
            <shar:contactType>Order</shar:contactType>
            ${contactDetailsXml(po.orderContact)}
          </shar:Contact>
        </ns:OrderContactArray>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/PO/1.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/PO/1.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:SendPORequest>
      <shar:wsVersion>${esc(payload.wsVersion || '1.0.0')}</shar:wsVersion>
      <shar:id>${idVal}</shar:id>
      <shar:password>${pwd}</shar:password>
      <ns:PO>
        <ns:orderType>${esc(po.orderType || 'Blank')}</ns:orderType>
        <ns:orderNumber>${esc(po.orderNumber || '')}</ns:orderNumber>
        <ns:orderDate>${esc(po.orderDate || '')}</ns:orderDate>
        <ns:totalAmount>${esc(Number(po.totalAmount || 0).toFixed(2))}</ns:totalAmount>
        <ns:rush>${po.rush ? 'true' : 'false'}</ns:rush>
        <shar:currency>${esc(po.currency || 'USD')}</shar:currency>${orderContactXml}${shipmentXml}
        <ns:LineItemArray>${lineItemsXml}
        </ns:LineItemArray>
        <ns:termsAndConditions>${esc(po.termsAndConditions || 'N/A')}</ns:termsAndConditions>
      </ns:PO>
    </ns:SendPORequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}
