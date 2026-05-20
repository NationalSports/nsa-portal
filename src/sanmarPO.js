// SanMar Purchase Order payload builder (PromoStandards sendPO).
//
// Spec: PromoStandards Purchase Order Service v1.0.0 — sendPO operation.
//   WSDL: https://ws.sanmar.com:8080/promostandards/POServiceBinding?WSDL
//   Namespace: http://www.promostandards.org/WSDL/PurchaseOrderService/1.0.0/
//   Shared types ns: http://www.promostandards.org/WSDL/PurchaseOrderService/1.0.0/SharedObjects/
//
// Each LineItem requires either (a) inventoryKey + sizeIndex OR
// (b) productId + partGroupDescription/partId style identifiers. We populate
// style/color/size strings and rely on SanMar's onboarding-validated mapping;
// for a real submit we'd resolve sizeIndex via GetPreSubmitPO first.
//
// This module is dry-run-safe: it never makes network calls. It only builds
// the JS payload + a SOAP envelope string for previewing in the UI.

// Flatten one or more batch PO entries into PromoStandards line items.
// Each batch PO entry has shape { items: [{ sku, color, sizes: {S:1, M:2}, unit_cost, ... }], ... }
export function buildSanMarLineItems(batchPOs) {
  const lines = [];
  let lineNumber = 1;
  (batchPOs || []).forEach(bp => {
    (bp.items || []).forEach(it => {
      // Style is typically embedded in the SKU. SanMar's SKU convention is
      // style + color suffix; the integration guide expects style/color/size
      // populated separately. We split on the first space/dash; integrators
      // can override via item._sanmar_style if their catalog records it.
      const style = it._sanmar_style || (String(it.sku || '').split(/[\s_]/)[0] || it.sku || '');
      const color = it._sanmar_color || it.color || '';
      // SanMar upcharges extended sizes (2XL, 3XL+). When per-size costs were
      // captured at PO time they live on _size_costs; otherwise fall back to
      // the blended unit_cost so the preview total still reconciles.
      const sizeCosts = it._size_costs || it._sizeCosts || {};
      Object.entries(it.sizes || {}).forEach(([size, qty]) => {
        if (!qty || qty <= 0) return;
        const unitPrice = sizeCosts[size] != null ? sizeCosts[size] : (it.unit_cost || 0);
        lines.push({
          lineNumber: lineNumber++,
          style,
          color,
          size,
          quantity: qty,
          unitPrice,
          sourceSO: bp.so_id,
          sourcePO: bp.po_id || '',
          productName: it.name || '',
        });
      });
    });
  });
  return lines;
}

// Build a PromoStandards sendPO request as a plain JS object. The proxy
// layer would wrap this in SOAP, or callers can pass it to buildSanMarPOSoap()
// for preview.
export function buildSanMarPOPayload({ poNumber, batchPOs, shipTo, orderType = 'Blank', customerNumber }) {
  const lines = buildSanMarLineItems(batchPOs);
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const totalCost = lines.reduce((s, l) => s + l.quantity * (l.unitPrice || 0), 0);
  return {
    wsVersion: '1.0.0',
    id: customerNumber || '',
    // password is injected by the proxy from SANMAR_PASSWORD env var; never put it in client-side payload
    PO: {
      orderType, // 'Blank' (no decoration) or 'Configured'
      orderReference: { poNumber },
      orderDate: new Date().toISOString().slice(0, 10),
      shipmentInfo: shipTo || null,
      lineItems: lines,
    },
    _summary: { totalQty, totalCost, lineCount: lines.length },
  };
}

// Render the payload as a SOAP envelope for human review. This is the exact
// XML the proxy would POST to SanMar's PromoStandards PO binding — minus the
// password, which is injected server-side.
export function buildSanMarPOSoap(payload, { username, customerNumber, includePassword = false } = {}) {
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = (payload.PO?.lineItems || []).map(l => `
        <shar:LineItem>
          <shar:lineNumber>${esc(l.lineNumber)}</shar:lineNumber>
          <shar:style>${esc(l.style)}</shar:style>
          <shar:color>${esc(l.color)}</shar:color>
          <shar:size>${esc(l.size)}</shar:size>
          <shar:quantity>${esc(l.quantity)}</shar:quantity>
          <shar:unitPrice>${esc((l.unitPrice || 0).toFixed(2))}</shar:unitPrice>
        </shar:LineItem>`).join('');
  const poRef = esc(payload.PO?.orderReference?.poNumber || '');
  const orderType = esc(payload.PO?.orderType || 'Blank');
  const orderDate = esc(payload.PO?.orderDate || '');
  const id = esc(customerNumber || payload.id || '');
  const user = esc(username || '');
  const pwd = includePassword ? '***INJECTED-BY-PROXY***' : '***REDACTED***';
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ns="http://www.promostandards.org/WSDL/PurchaseOrderService/1.0.0/"
                  xmlns:shar="http://www.promostandards.org/WSDL/PurchaseOrderService/1.0.0/SharedObjects/">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:SendPORequest>
      <shar:wsVersion>${esc(payload.wsVersion || '1.0.0')}</shar:wsVersion>
      <shar:id>${id}</shar:id>
      <shar:password>${pwd}</shar:password>
      <ns:PO>
        <shar:orderType>${orderType}</shar:orderType>
        <shar:orderReference>
          <shar:poNumber>${poRef}</shar:poNumber>
        </shar:orderReference>
        <shar:orderDate>${orderDate}</shar:orderDate>
        <shar:LineItemArray>${lines}
        </shar:LineItemArray>
      </ns:PO>
    </ns:SendPORequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}
