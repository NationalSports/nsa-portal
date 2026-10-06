// Server-only adapter. The purchasing worker owns the durable claim/state machine;
// this module will send once only after that worker returns a claimed PO header.
// An ambiguous response is always unknown, never a signal to retry or send email.
const crypto = require('crypto');
const { buildSanMarPOPayload } = require('../../src/lib/sanmarPO.shared');
const { buildSSOrderPayload } = require('../../src/lib/ssOrder.shared');
const { reconcileVendorLines, exactVendorLineQuantities } = require('../../src/lib/vendorOrderGuards.shared');
const { createVendorResolvers } = require('../../src/lib/vendorResolvers.shared');

const held = error => ({ ok: false, state: 'held', error });
const unknown = (error, extra = {}) => ({ ok: false, state: 'unknown', error, ...extra });
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const records = data => Array.isArray(data) ? data : (data?.Orders || data?.orders || (data?.orderNumber || data?.OrderNumber ? [data] : []));
const orderNumber = row => String(row?.orderNumber || row?.OrderNumber || '').trim();
const poReference = row => String(row?.poNumber || row?.PoNumber || row?.PONumber || '').trim();

function normalizeShipTo(value = {}) {
  return {
    companyName: String(value.companyName || value.customer || '').trim(),
    attentionTo: String(value.attentionTo || value.attn || '').trim(),
    address1: String(value.address1 || value.address || '').trim(),
    address2: String(value.address2 || '').trim(), city: String(value.city || '').trim(),
    region: String(value.region || value.state || '').trim(),
    postalCode: String(value.postalCode || value.zip || '').trim(),
    country: String(value.country || 'US').trim().toUpperCase(),
  };
}

function createVendorPurchaseAdapter({ sanmarHandler, ssHandler, env = process.env } = {}) {
  const sm = sanmarHandler || require('./sanmar-proxy').handler;
  const ss = ssHandler || require('./ss-proxy').handler;
  const secret = () => env.INTERNAL_FUNCTION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  async function invoke(handler, queryStringParameters, body, method = 'POST') {
    const response = await handler({ httpMethod: method, queryStringParameters,
      headers: { 'x-internal-secret': secret(), 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try { data = JSON.parse(response.body || '{}'); }
    catch (_) { throw new Error('Supplier returned an unreadable response'); }
    if (response.statusCode < 200 || response.statusCode >= 300 || data?.error) {
      // Avoid persisting raw SOAP/HTML or request/credential material from proxies.
      throw new Error(`Supplier request failed (HTTP ${response.statusCode})`);
    }
    return data;
  }


  async function resolveVendorPurchaseOrder({ purchaseOrder, lines, shipTo } = {}) {
    const po = purchaseOrder || {};
    if (!['SanMar', 'S&S Activewear'].includes(po.vendor)) return held('This supplier does not support automatic API purchasing');
    const externalPoNumber = String(po.po_number || '').trim();
    if (!externalPoNumber || externalPoNumber.length > 28 || /[\r\n,]/.test(externalPoNumber)) return held('A stable valid external PO reference is required');
    if (!secret()) return held('Internal supplier authentication is not configured');
    if (po.vendor === 'SanMar' && (!env.SANMAR_USERNAME || !env.SANMAR_PASSWORD)) return held('SanMar purchasing credentials are not configured');
    if (po.vendor === 'S&S Activewear' && (!env.SS_ACCOUNT_NUMBER || !env.SS_API_KEY)) return held('S&S purchasing credentials are not configured');
    const expectedAccount = po.vendor === 'SanMar'
      ? String(env.SANMAR_CUSTOMER_NUMBER || String(env.SANMAR_USERNAME || '').replace(/-.*$/, '')).trim()
      : String(env.SS_ACCOUNT_NUMBER || '').trim();
    if (po.supplier_account && String(po.supplier_account).trim() !== expectedAccount) return held('The configured purchasing account does not match this supplier connection');
    const ship = normalizeShipTo(shipTo || po.ship_to);
    if (!ship.companyName || !ship.address1 || !ship.city || !ship.region || !ship.postalCode || ship.country !== 'US') return held('A complete US supplier shipping address is required');
    if (po.vendor === 'S&S Activewear' && !/^\d{5}$/.test(ship.postalCode)) return held('S&S requires a five-digit shipping ZIP code');
    if (!Array.isArray(lines) || !lines.length || lines.length > 100) return held('The purchase must contain between 1 and 100 size lines');
    const seen = new Set();
    const sourceLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      const row = lines[index], meta = row.meta || {};
      const qty = Number(row.qty), cents = Number(row.unit_cost_cents);
      // Duplicate source rows indicate replayed need allocations; legitimate same SKU
      // purchases across different source lines are merged by the shared builders.
      const source = `${row.so_id || ''}|${row.so_item_id || ''}|${row.size || ''}`;
      if (!row.so_id || !row.so_item_id || seen.has(source)) return held('Duplicate or unidentified source purchase line');
      seen.add(source);
      if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 10000 || !Number.isSafeInteger(cents) || cents < 0) return held('Invalid supplier quantity or cost');
      const style = String(meta.vendor_style || row.sku || '').trim();
      const color = String(meta.color || row.color || '').trim();
      const size = String(row.size || '').trim();
      if (!style || !color || !size) return held('Supplier style, color, and size are required');
      sourceLines.push({ key: String(index), lineNumber: index + 1, style, color, size,
        quantity: qty, unitPrice: cents / 100, uom: 'EA', description: [style, color, size].join(' ').replace(/,/g, ' '),
        sourceSO: row.so_id, sourcePO: po.id, sourceItemIdx: index,
        partId: String(meta.sanmar_part_id || meta._sanmar_partId || meta.partId || ''),
        sku: String(meta.ss_sku || meta._ss_sku || ''),
      });
    }
    if (new Set(sourceLines.map(l => l.style)).size > 20) return held('Split this purchase into at most 20 supplier styles');
    const field = po.vendor === 'SanMar' ? 'partId' : 'sku';
    const missing = sourceLines.filter(l => !l[field]).map(l => ({ ...l, style: po.vendor === 'SanMar' ? l.style.split(/[\s_-]/)[0] : l.style }));
    if (missing.length) {
      let lookup;
      let lookupCalls = 0;
      const lookupInvoke = (...args) => {
        lookupCalls += 1;
        if (lookupCalls > 50) throw new Error('Supplier lookup request budget exceeded');
        return invoke(...args);
      };
      const resolvers = createVendorResolvers({
        sanmarGetProduct: (style, color = '', size = '') => lookupInvoke(sm, { service: 'product', action: 'getProductInfoByStyleColorSize' }, { style, color, size }),
        ssApiCall: (path) => lookupInvoke(ss, { path }, undefined, 'GET'),
      });
      try { lookup = await (po.vendor === 'SanMar' ? resolvers.sanmarResolvePartIds(missing) : resolvers.ssResolveSkus(missing)); }
      catch (_) { return held('Supplier item lookup failed before purchasing'); }
      sourceLines.forEach(l => { if (!l[field] && lookup.resolved[l.key]) l[field] = lookup.resolved[l.key]; });
    }
    if (sourceLines.some(l => !l[field])) return held('Every supplier item ID must resolve before purchasing');
    let payload, vendorLines;
    if (po.vendor === 'SanMar') {
      payload = buildSanMarPOPayload({ poNumber: externalPoNumber, lineItems: sourceLines, shipTo: ship });
      vendorLines = payload.PO.lineItems;
    } else {
      const built = buildSSOrderPayload({ poNumber: externalPoNumber, lineItems: sourceLines, shipTo: ship, testOrder: false });
      payload = { ...built.order, rejectLineErrors: true }; // automatic POs must not silently drop size lines
      vendorLines = built.merged;
    }
    return { ok: true, vendor: po.vendor, purchase_order_id: po.id, externalPoNumber,
      payload, vendor_lines: vendorLines, source_lines: sourceLines,
      payload_hash: digest(payload),
    };
  }

  async function submitResolvedVendorPurchaseOrder({ purchaseOrder, resolved } = {}) {
    const po = purchaseOrder || {};
    if (!resolved?.ok) return held('The supplier purchase has not been resolved');
    if (po.submission_state !== 'submitting' || !po.submission_token || !po.all_school_store_id || !po.id || po.id !== resolved.purchase_order_id
      || po.vendor !== resolved.vendor || String(po.po_number || '').trim() !== resolved.externalPoNumber) return held('A durable All School purchase claim is required before supplier submission');
    if (digest(resolved.payload) !== resolved.payload_hash) return held('The supplier payload changed after resolution');
    // Once this block begins, ALL failures are unknown: the request may have reached
    // the supplier even if the response was lost. The worker must never resend it.
    try {
      if (resolved.vendor === 'SanMar') {
        const data = await invoke(sm, { service: 'po', action: 'sendPO', env: 'prod' }, { ...resolved.payload, _allSchoolSubmissionToken: po.submission_token });
        if (!data.transactionId || data.orderNumber !== resolved.externalPoNumber) return unknown('SanMar did not confirm the expected PO reference');
        return { ok: true, api_order_id: String(data.transactionId), raw: data,
          vendor_lines: resolved.vendor_lines, verified: false, confirmation: 'transaction',
        }; // The existing SanMar proxy offers transaction acknowledgement, no line readback.
      }
      const placed = await invoke(ss, { path: '/orders' }, { ...resolved.payload, _allSchoolSubmissionToken: po.submission_token });
      const ids = records(placed).map(orderNumber).filter(Boolean);
      if (!ids.length) return unknown('S&S did not return a supplier order number');
      const readback = await invoke(ss, { path: `/Orders/${encodeURIComponent(resolved.externalPoNumber)}?lines=true` }, undefined, 'GET');
      const orders = records(readback).filter(row => poReference(row) === resolved.externalPoNumber && ids.includes(orderNumber(row)));
      const reconciliation = reconcileVendorLines(resolved.vendor_lines,
        { raw: orders, lineErrors: placed?.LineErrors || placed?.lineErrors || [] }, l => l.sku);
      if (!ids.every(id => orders.some(row => orderNumber(row) === id)) || !reconciliation.verified || !exactVendorLineQuantities(resolved.vendor_lines, orders, l => l.sku)) {
        return unknown('S&S acceptance could not be verified in full; reconcile this PO before any reorder', { api_order_id: ids.join(','), vendor_lines: resolved.vendor_lines });
      }
      return { ok: true, api_order_id: ids.join(','), raw: { orderNumbers: ids, confirmation: 'supplier-readback' },
        vendor_lines: resolved.vendor_lines, verified: true, confirmation: 'supplier-readback' };
    } catch (_) { return unknown('The supplier submission outcome is unknown; verify the external PO reference before any reorder'); }
  }
  async function submitVendorPurchaseOrder(args) {
    const resolved = await resolveVendorPurchaseOrder(args);
    return resolved.ok ? submitResolvedVendorPurchaseOrder({ purchaseOrder: args.purchaseOrder, resolved }) : resolved;
  }
  return { resolveVendorPurchaseOrder, submitResolvedVendorPurchaseOrder, submitVendorPurchaseOrder };
}
module.exports = { createVendorPurchaseAdapter, normalizeShipTo, ...createVendorPurchaseAdapter() };
