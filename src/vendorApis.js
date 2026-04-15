/* eslint-disable */
// ═══════════════════════════════════════════
// Vendor API integrations — all use Netlify proxy functions
// ═══════════════════════════════════════════
import { NSA } from './constants';
import { calcSOStatus } from './components';

// ─── ShipStation API Integration (via Netlify proxy to avoid CORS) ───
const shipStationCall = async (endpoint, options = {}) => {
  try {
    const method = options.method || 'GET';
    const proxyUrl = `/.netlify/functions/shipstation-proxy?path=${encodeURIComponent(endpoint)}`;
    const response = await fetch(proxyUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(options.body ? { body: options.body } : {})
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      // Try to extract a clean error message from ShipStation JSON response
      let cleanMsg = '';
      try { const errJson = JSON.parse(errText); cleanMsg = errJson.ExceptionMessage || errJson.Message || errText.slice(0, 200); } catch { cleanMsg = errText.slice(0, 200); }
      console.error('[ShipStation] API error:', response.status, errText);
      throw new Error(`ShipStation error (${response.status}): ${cleanMsg}`);
    }
    const data = await response.json();
    console.log('[ShipStation] API response:', endpoint, data);
    return data;
  } catch (error) {
    console.error('[ShipStation] API call failed:', endpoint, error);
    throw error;
  }
};

const testShipStationConnection = async () => {
  try {
    const stores = await shipStationCall('/stores');
    console.log('[ShipStation] Connection test successful:', stores);
    return true;
  } catch (error) {
    console.error('[ShipStation] Connection test failed:', error);
    return false;
  }
};

const convertSOToShipStation = (so, customer) => {
  const shipToAddress = customer.shipping_address_line1 ? {
    name: customer.name, company: customer.name,
    street1: customer.shipping_address_line1, street2: customer.shipping_address_line2 || '',
    city: customer.shipping_city, state: customer.shipping_state,
    postalCode: customer.shipping_zip, country: 'US',
    phone: customer.contacts?.[0]?.phone || '', residential: true
  } : {
    name: customer.name, company: customer.name,
    street1: customer.billing_address_line1, street2: customer.billing_address_line2 || '',
    city: customer.billing_city, state: customer.billing_state,
    postalCode: customer.billing_zip, country: 'US',
    phone: customer.contacts?.[0]?.phone || '', residential: true
  };
  const items = so.items.map(item => {
    const totalQty = Object.values(item.sizes).reduce((sum, qty) => sum + qty, 0);
    return {
      lineItemKey: `${so.id}-${item.sku}`, sku: item.sku, name: item.name, imageUrl: null,
      weight: { value: 1, units: 'pounds' }, quantity: totalQty, unitPrice: item.unit_sell,
      taxAmount: null, shippingAmount: null, warehouseLocation: null,
      options: Object.entries(item.sizes).filter(([, qty]) => qty > 0)
        .map(([size, qty]) => ({ name: 'Size', value: `${size} (${qty})` })),
      productId: item.product_id ? (() => { const id = parseInt(item.product_id.replace(/\D/g, ''), 10); return id && id <= 2147483647 ? id : null; })() : null, fulfillmentSku: item.sku, adjustment: false, upc: null
    };
  });
  return {
    orderNumber: so.id, orderKey: so.id, orderDate: so.created_at, paymentDate: so.created_at,
    shipByDate: so.expected_date, orderStatus: 'awaiting_shipment',
    customerUsername: customer.alpha_tag, customerEmail: customer.contacts?.[0]?.email || '',
    billTo: {
      name: customer.name, company: customer.name,
      street1: customer.billing_address_line1, street2: customer.billing_address_line2 || '',
      city: customer.billing_city, state: customer.billing_state,
      postalCode: customer.billing_zip, country: 'US',
      phone: customer.contacts?.[0]?.phone || '', residential: true
    },
    shipTo: shipToAddress, items,
    orderTotal: so.items.reduce((sum, item) => sum + (item.unit_sell * Object.values(item.sizes).reduce((a, b) => a + b, 0)), 0),
    amountPaid: 0, taxAmount: 0, shippingAmount: so.shipping_value || 0,
    customerNotes: so.memo || '', internalNotes: so.production_notes || '',
    gift: false, giftMessage: null, paymentMethod: null,
    requestedShippingService: 'Ground', carrierCode: null, serviceCode: null, packageCode: null,
    confirmation: 'none', shipDate: null, holdUntilDate: null,
    weight: { value: items.length, units: 'pounds' }, dimensions: null,
    insuranceOptions: { provider: null, insureShipment: false, insuredValue: 0 },
    internationalOptions: null,
    advancedOptions: {
      warehouseId: null, nonMachinable: false, saturdayDelivery: false, containsAlcohol: false,
      storeId: null, customField1: `NSA-SO-${so.id}`, customField2: customer.alpha_tag,
      customField3: so.created_by, source: 'NSA Portal',
      mergedOrSplit: false, mergedIds: [], parentId: null,
      billToParty: null, billToAccount: null, billToPostalCode: null, billToCountryCode: null
    }
  };
};

const pushSOToShipStation = async (so, customer) => {
  const shippableStatuses = ['in_production', 'ready_to_invoice', 'items_received', 'waiting_receive', 'needs_pull', 'need_order', 'partial_received'];
  const soStatus = calcSOStatus(so);
  if (!shippableStatuses.includes(so.status) && !shippableStatuses.includes(soStatus) && so.status !== 'complete') {
    throw new Error('Only active Sales Orders can be shipped');
  }
  const ssOrder = convertSOToShipStation(so, customer);
  return await shipStationCall('/orders/createorder', { method: 'POST', body: JSON.stringify(ssOrder) });
};

const fetchShipStationUpdates = async (orderNumber) => {
  const orders = await shipStationCall(`/orders?orderNumber=${orderNumber}`);
  return orders?.orders?.[0] || null;
};

const fetchRecentShipments = async () => {
  const shipments = await shipStationCall('/shipments?createDateStart=' +
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  return shipments?.shipments || [];
};

// Create a ShipStation label for an order
const _ssCarrierMap = { 'UPS': { carrierCode: 'ups', serviceCode: 'ups_ground' }, 'FedEx': { carrierCode: 'fedex', serviceCode: 'fedex_ground' }, 'USPS': { carrierCode: 'stamps_com', serviceCode: 'usps_priority_mail' } };
const createShipStationLabel = async (so, customer, packageItems, weight, carrier, service, dimensions) => {
  // Validate customer address before calling API
  const hasShipAddr = customer.shipping_address_line1 && customer.shipping_city && customer.shipping_state && customer.shipping_zip;
  const hasBillAddr = customer.billing_address_line1 && customer.billing_city && customer.billing_state && customer.billing_zip;
  if (!hasShipAddr && !hasBillAddr) throw new Error('Customer has no shipping or billing address. Please add an address to the customer record first.');
  // Ensure order exists in ShipStation first
  let ssOrderId = so._shipstation_order_id;
  if (!ssOrderId) {
    const ssOrder = await pushSOToShipStation(so, customer);
    ssOrderId = ssOrder.orderId;
  }
  if (!ssOrderId) throw new Error('Could not create or find ShipStation order. Please check ShipStation connection.');
  const shipTo = hasShipAddr ? {
    name: customer.name, company: customer.name,
    street1: customer.shipping_address_line1, street2: customer.shipping_address_line2 || '',
    city: customer.shipping_city, state: customer.shipping_state,
    postalCode: customer.shipping_zip, country: 'US', phone: customer.contacts?.[0]?.phone || ''
  } : {
    name: customer.name, company: customer.name,
    street1: customer.billing_address_line1, street2: customer.billing_address_line2 || '',
    city: customer.billing_city, state: customer.billing_state,
    postalCode: customer.billing_zip, country: 'US', phone: customer.contacts?.[0]?.phone || ''
  };
  // Map carrier — dropdown values are lowercase ('fedex','ups','usps')
  const carrierLower = (carrier || 'fedex').toLowerCase();
  const carrierMap = { fedex: { carrierCode: 'fedex', serviceCode: 'fedex_ground' }, ups: { carrierCode: 'ups', serviceCode: 'ups_ground' }, usps: { carrierCode: 'stamps_com', serviceCode: 'usps_priority_mail' } };
  const cm = carrierMap[carrierLower] || { carrierCode: carrierLower, serviceCode: service || 'fedex_ground' };
  const labelPayload = {
    orderId: ssOrderId, carrierCode: cm.carrierCode, serviceCode: cm.serviceCode,
    packageCode: 'package', confirmation: 'none', shipDate: new Date().toISOString().split('T')[0],
    weight: { value: weight || 5, units: 'pounds' },
    dimensions: dimensions && dimensions.length && dimensions.width && dimensions.height
      ? { length: parseFloat(dimensions.length), width: parseFloat(dimensions.width), height: parseFloat(dimensions.height), units: 'inches' }
      : undefined,
    shipFrom: { name: NSA.name, company: NSA.name, street1: NSA.addr, city: NSA.city, state: NSA.state, postalCode: NSA.zip, country: 'US', phone: NSA.phone },
    shipTo, insuranceOptions: { provider: null, insureShipment: false, insuredValue: 0 },
    internationalOptions: null, advancedOptions: { customField1: `NSA-SO-${so.id}` },
    testLabel: false
  };
  console.log('[ShipStation] Label request payload:', JSON.stringify(labelPayload, null, 2));
  return await shipStationCall('/orders/createlabelfororder', { method: 'POST', body: JSON.stringify(labelPayload) });
};

// Fetch ShipStation rates for an order
const fetchShipStationRates = async (customer, weight) => {
  const shipTo = customer.shipping_address_line1 ? {
    city: customer.shipping_city, state: customer.shipping_state,
    postalCode: customer.shipping_zip, country: 'US'
  } : {
    city: customer.billing_city, state: customer.billing_state,
    postalCode: customer.billing_zip, country: 'US'
  };
  const ratePayload = {
    carrierCode: 'fedex', fromPostalCode: '90001',
    toState: shipTo.state, toCountry: 'US', toPostalCode: shipTo.postalCode, toCity: shipTo.city,
    weight: { value: weight || 5, units: 'pounds' }, confirmation: 'none', residential: true
  };
  try {
    return await shipStationCall('/shipments/getrates', { method: 'POST', body: JSON.stringify(ratePayload) });
  } catch { return []; }
};

// ─── OrderMyGear API Integration (via Netlify proxy to avoid CORS) ───

// Fetch all pages from a paginated OMG JSON:API endpoint.
// Pagination strategy (in priority order):
//   1. links.next from response (standard JSON:API)
//   2. meta.page.cursor on last record with page[after] (works for order_products)
//   3. Construct cursor from last record ID: btoa(JSON.stringify({id})) (fallback for orders)
const omgFetchAllPages = async (endpoint, maxPages = 50) => {
  let allData = [];
  const seenIds = new Set();
  // Extract base path without query for building pagination URLs
  const basePath = endpoint.split('?')[0];
  const baseQuery = endpoint.includes('?') ? '&' + endpoint.split('?')[1] : '';
  let nextUrl = endpoint;
  for (let page = 0; page < maxPages; page++) {
    const resp = await omgApiCall(nextUrl);
    const data = resp?.data || [];
    if (data.length === 0) break;
    // Deduplicate: constructed cursors can be inclusive (first record = last of prev page)
    const newRecords = data.filter(d => !seenIds.has(d.id));
    if (newRecords.length === 0) {
      console.warn(`[OMG] All records on page ${page + 1} are duplicates, stopping`);
      break;
    }
    newRecords.forEach(d => seenIds.add(d.id));
    allData = allData.concat(newRecords);
    if (data.length < 100) break; // last page
    // Determine next page URL
    // Strategy 1: links.next from response
    if (resp?.links?.next) {
      try {
        const u = new URL(resp.links.next);
        nextUrl = u.pathname.replace(/^\/v1/, '') + u.search;
        continue;
      } catch {
        nextUrl = resp.links.next.startsWith('/') ? resp.links.next : '/' + resp.links.next;
        continue;
      }
    }
    // Strategy 2: cursor from last record's meta
    const lastRecord = data[data.length - 1];
    const cursor = lastRecord?.meta?.page?.cursor;
    if (cursor) {
      nextUrl = `${basePath}?page[after]=${cursor}${baseQuery}`;
      continue;
    }
    // Strategy 3: construct cursor from last record ID
    if (lastRecord?.id) {
      const constructedCursor = btoa(JSON.stringify({ id: lastRecord.id }));
      nextUrl = `${basePath}?page[after]=${constructedCursor}${baseQuery}`;
      continue;
    }
    break; // no way to paginate
  }
  console.log(`[OMG] Fetched ${allData.length} total from ${basePath}`);
  return allData;
};

const omgApiCall = async (endpoint, options = {}, _retries = 0) => {
  try {
    const method = options.method || 'GET';
    const proxyUrl = `/.netlify/functions/omg-proxy?path=${encodeURIComponent(endpoint)}`;
    const response = await fetch(proxyUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(options.body ? { body: options.body } : {})
    });
    if (!response.ok) {
      // Retry on 409 (conflict/rate limit) and 429 (too many requests) with backoff
      if ((response.status === 409 || response.status === 429) && _retries < 3) {
        const delay = (2 ** _retries) * 1000;
        console.warn(`[OMG] ${response.status} on ${endpoint}, retrying in ${delay}ms (attempt ${_retries + 1}/3)`);
        await new Promise(r => setTimeout(r, delay));
        return omgApiCall(endpoint, options, _retries + 1);
      }
      const errText = await response.text().catch(() => '');
      let msg;
      try { msg = JSON.parse(errText)?.error; } catch {}
      throw new Error(msg || `OMG API error: ${response.status}`);
    }
    const data = await response.json();
    console.log('[OMG] API response:', endpoint, data);
    return data;
  } catch (error) { console.error('[OMG] API call failed:', endpoint, error); throw error; }
};

// ─── OMG API Probe (deep diagnostic) ───
// Goal: figure out EXACTLY how OMG's JSON:API links sales → orders → order_products → products
// so we can stop silently dropping every record. Dumps full structures to console and
// returns a summary for the UI so the user doesn't have to dig through the console.
const probeOMGEndpoints = async () => {
  const log = (...args) => console.log('[OMG-PROBE]', ...args);
  const report = [];
  const push = (line) => { report.push(line); log(line); };

  push('═══ OMG API PROBE START ═══');

  // ── STEP 1: Dump a sample sale's full structure ──
  let sampleSale = null;
  try {
    const salesResp = await omgApiCall('/sales?include=organization');
    sampleSale = salesResp?.data?.[0];
    if (sampleSale) {
      push(`✓ /sales returned ${salesResp.data.length} records`);
      log('SAMPLE SALE — full resource:', sampleSale);
      log('SAMPLE SALE — attributes:', sampleSale.attributes);
      log('SAMPLE SALE — relationships:', sampleSale.relationships);
      push(`Sale attribute keys: ${Object.keys(sampleSale.attributes || {}).join(', ')}`);
      push(`Sale relationship keys: ${Object.keys(sampleSale.relationships || {}).join(', ')}`);
      // CRITICAL: look for any attribute that might contain pre-computed totals
      const attrs = sampleSale.attributes || {};
      const candidates = ['total_sales','total','sales_total','revenue','amount','gross_total','net_total',
        'items_sold','total_items','quantity_sold','item_count','units_sold',
        'orders_count','order_count','orders_total','num_orders',
        'fundraise','fundraise_total','fundraise_raised','fundraise_amount','profit',
        'unique_buyers','buyer_count','customer_count'];
      const found = candidates.filter(k => attrs[k] !== undefined && attrs[k] !== null);
      if (found.length) push(`🎯 PRE-COMPUTED TOTALS FOUND on sale: ${found.map(k=>`${k}=${attrs[k]}`).join(', ')}`);
      else push('⚠ No pre-computed totals on sale attributes (checked common names)');
    } else {
      push('✗ /sales returned no records');
    }
  } catch (err) { push(`✗ /sales failed: ${err.message}`); }

  const saleId = sampleSale?.id;

  // ── STEP 2: Dump a sample order's full structure and see how it links to a sale ──
  let sampleOrder = null;
  try {
    const ordersResp = await omgApiCall('/orders');
    sampleOrder = ordersResp?.data?.[0];
    if (sampleOrder) {
      push(`✓ /orders returned ${ordersResp.data.length} records`);
      log('SAMPLE ORDER — full resource:', sampleOrder);
      log('SAMPLE ORDER — attributes:', sampleOrder.attributes);
      log('SAMPLE ORDER — relationships:', sampleOrder.relationships);
      push(`Order attribute keys: ${Object.keys(sampleOrder.attributes || {}).join(', ')}`);
      const rels = sampleOrder.relationships || {};
      push(`Order relationship keys: ${Object.keys(rels).join(', ')}`);
      // For each relationship, show whether it has data (needed for linking)
      for (const [k, v] of Object.entries(rels)) {
        const hasData = v?.data !== undefined && v?.data !== null;
        const dataInfo = hasData ? `data=${JSON.stringify(v.data)}` : '(no data, links only)';
        push(`  order.rel[${k}]: ${dataInfo}`);
      }
      // CRITICAL: which relationship (if any) links back to the sale?
      const saleLike = Object.entries(rels).find(([k]) =>
        /sale|store|pop.?up|team/i.test(k));
      if (saleLike) {
        push(`🎯 Order→Sale relationship name appears to be: "${saleLike[0]}"`);
      } else {
        push('⚠ No obvious sale-like relationship on order — linking will fail!');
      }
    } else {
      push('✗ /orders returned no records');
    }
  } catch (err) { push(`✗ /orders failed: ${err.message}`); }

  // ── STEP 3: Test /orders?include=sale to force relationship population ──
  try {
    const resp = await omgApiCall('/orders?include=sale');
    const first = resp?.data?.[0];
    const saleData = first?.relationships?.sale?.data;
    const incSales = (resp?.included || []).filter(i => i.type === 'sale' || i.type === 'sales');
    push(`/orders?include=sale → sale.data on first order: ${saleData ? JSON.stringify(saleData) : 'null/missing'}, included sales: ${incSales.length}`);
  } catch (err) { push(`✗ /orders?include=sale failed: ${err.message}`); }

  // ── STEP 4: Test /order_products relationships ──
  let sampleOP = null;
  try {
    const opResp = await omgApiCall('/order_products?include=product');
    sampleOP = opResp?.data?.[0];
    if (sampleOP) {
      log('SAMPLE ORDER_PRODUCT — full resource:', sampleOP);
      log('SAMPLE ORDER_PRODUCT — attributes:', sampleOP.attributes);
      log('SAMPLE ORDER_PRODUCT — relationships:', sampleOP.relationships);
      push(`OP attribute keys: ${Object.keys(sampleOP.attributes || {}).join(', ')}`);
      const rels = sampleOP.relationships || {};
      push(`OP relationship keys: ${Object.keys(rels).join(', ')}`);
      for (const [k, v] of Object.entries(rels)) {
        const hasData = v?.data !== undefined && v?.data !== null;
        push(`  op.rel[${k}]: ${hasData ? JSON.stringify(v.data) : '(no data)'}`);
      }
      const incTypes = [...new Set((opResp?.included || []).map(i => i.type))];
      push(`/order_products included types: ${incTypes.join(', ') || '(none)'}`);
    }
  } catch (err) { push(`✗ /order_products failed: ${err.message}`); }

  // ── STEP 5: Test filter[sale_id] approaches for a known sale ──
  if (saleId) {
    const filterTests = [
      `/orders?filter[sale_id]=${saleId}`,
      `/orders?filter[sale]=${saleId}`,
      `/orders?sale_id=${saleId}`,
      `/order_products?filter[sale_id]=${saleId}`,
      `/order_products?filter[sale]=${saleId}`,
      `/sales/${saleId}/orders`,
      `/sales/${saleId}/order_products`,
      `/sales/${saleId}?include=orders`,
      `/sales/${saleId}?include=orders.order_products.product`,
      `/sales/${saleId}?include=order_products.product`,
    ];
    for (const ep of filterTests) {
      try {
        const r = await omgApiCall(ep);
        const count = Array.isArray(r?.data) ? r.data.length : (r?.data ? 1 : 0);
        const incTypes = [...new Set((r?.included || []).map(i => i.type))];
        push(`  ${ep} → ${count} records, included: [${incTypes.join(',')}]`);
      } catch (err) {
        push(`  ${ep} → ERROR: ${err.message}`);
      }
    }
  }

  // ── STEP 6: Fetch a single order by ID with nested includes ──
  if (sampleOrder?.id) {
    const oid = sampleOrder.id;
    const nestedTests = [
      `/orders/${oid}?include=sale`,
      `/orders/${oid}?include=order_products.product`,
      `/orders/${oid}?include=sale,order_products.product`,
      `/orders/${oid}?include=line_items`,
    ];
    for (const ep of nestedTests) {
      try {
        const r = await omgApiCall(ep);
        const incTypes = [...new Set((r?.included || []).map(i => i.type))];
        push(`  ${ep} → included: [${incTypes.join(',')}] (${r?.included?.length || 0})`);
      } catch (err) {
        push(`  ${ep} → ERROR: ${err.message}`);
      }
    }
  }

  push('═══ OMG API PROBE END ═══');
  // Show the report in an alert so the user can read without console diving
  const summary = report.join('\n');
  console.log(summary);
  // Also stash it on window for easy copy-paste
  if (typeof window !== 'undefined') window.__omgProbeReport = summary;
  alert('OMG API probe complete!\n\nSummary:\n\n' + summary + '\n\n(Also in console + window.__omgProbeReport)');
};

const fetchOMGStores = async () => {
  // Strategy: try multiple approaches to get recent/open stores without
  // paginating through thousands of old ones.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const now = new Date();

  const isRelevant = (s) => {
    const status = (s.attributes?.status || '').toLowerCase();
    const expiresAt = s.attributes?.expires_at;
    const opensAt = s.attributes?.opens_at;
    if (status === 'pending' || status === 'scheduled') return true;
    if (status === 'open') return !expiresAt || new Date(expiresAt) >= now;
    if (['closed', 'finalized', 'fulfilled', 'archived'].includes(status)) {
      const closedAt = expiresAt || s.attributes?.closed_at || s.attributes?.updated_at;
      return closedAt && new Date(closedAt) >= thirtyDaysAgo;
    }
    const anyDate = expiresAt || opensAt || s.attributes?.updated_at;
    return anyDate && new Date(anyDate) >= thirtyDaysAgo;
  };

  // Helper: fetch one page
  const fetchPage = async (endpoint) => {
    const resp = await omgApiCall(endpoint);
    return { data: resp?.data || [], included: resp?.included || [] };
  };

  let allData = [], allIncluded = [];

  // Approach 1: Try sorting newest-first (avoids paginating through old stores)
  const sortFormats = [
    '/sales?include=organization&sort=-expires_at',
    '/sales?include=organization&sort=-created_at',
    '/sales?include=organization&sort=-id',
  ];
  for (const url of sortFormats) {
    try {
      const resp = await fetchPage(url);
      if (resp.data.length > 0) {
        // Check if it's actually sorted differently than default (oldest-first)
        const firstExpires = resp.data[0]?.attributes?.expires_at;
        const isRecent = firstExpires && new Date(firstExpires) > thirtyDaysAgo;
        if (isRecent) {
          console.log(`[OMG] Sort worked (${url}): ${resp.data.length} stores, first expires: ${firstExpires}`);
          allData = resp.data;
          allIncluded = resp.included;
          // Paginate a few more pages to be safe
          if (resp.data.length >= 25) {
            let offset = resp.data.length;
            for (let p = 0; p < 5; p++) {
              try {
                const next = await fetchPage(`${url}&offset=${offset}&limit=${resp.data.length}`);
                if (!next.data.length) break;
                allData = allData.concat(next.data);
                allIncluded = allIncluded.concat(next.included);
                // Stop if all stores on this page are old
                const anyRelevant = next.data.some(isRelevant);
                if (!anyRelevant) { console.log(`[OMG] Page ${p + 3}: all old, stopping`); break; }
                if (next.data.length < resp.data.length) break;
                offset += next.data.length;
              } catch { break; }
            }
          }
          break;
        }
      }
    } catch (e) {
      console.log(`[OMG] Sort format failed: ${url} — ${e.message}`);
    }
  }

  // Approach 2: If sorting didn't work, try filter[status]=open
  if (allData.length === 0) {
    console.log('[OMG] Sort approaches failed, trying filter[status]');
    for (const status of ['open', 'pending', 'scheduled']) {
      try {
        const resp = await fetchPage(`/sales?include=organization&filter[status]=${status}`);
        if (resp.data.length > 0) {
          console.log(`[OMG] filter[status]=${status}: ${resp.data.length} stores`);
          allData = allData.concat(resp.data);
          allIncluded = allIncluded.concat(resp.included);
        }
      } catch { /* skip */ }
    }
    // Also try recently closed
    try {
      const resp = await fetchPage('/sales?include=organization&filter[status]=closed');
      if (resp.data.length > 0) {
        const recent = resp.data.filter(isRelevant);
        console.log(`[OMG] filter[status]=closed: ${resp.data.length} total, ${recent.length} recent`);
        allData = allData.concat(recent);
        allIncluded = allIncluded.concat(resp.included);
      }
    } catch { /* skip */ }
  }

  // Approach 3: Last resort — paginate unfiltered but cap at 10 pages
  if (allData.length === 0) {
    console.log('[OMG] Filter approaches failed, paginating unfiltered (max 10 pages)');
    const first = await fetchPage('/sales?include=organization');
    allData = first.data;
    allIncluded = first.included;
    const pageSize = first.data.length;
    if (pageSize >= 25) {
      let offset = pageSize;
      for (let p = 0; p < 9; p++) {
        try {
          const resp = await fetchPage(`/sales?include=organization&offset=${offset}&limit=${pageSize}`);
          if (!resp.data.length) break;
          allData = allData.concat(resp.data);
          allIncluded = allIncluded.concat(resp.included);
          // Stop early if we found relevant stores
          if (allData.some(isRelevant)) {
            console.log(`[OMG] Found relevant stores on page ${p + 2}, stopping pagination`);
            break;
          }
          if (resp.data.length < pageSize) break;
          offset += resp.data.length;
        } catch { break; }
      }
    }
  }

  // Deduplicate
  const seen = new Map();
  allData.forEach(s => { if (!seen.has(s.id)) seen.set(s.id, s); });
  allData = [...seen.values()];

  // Filter to relevant stores only
  const total = allData.length;
  allData = allData.filter(isRelevant);
  console.log(`[OMG] Result: ${allData.length} relevant stores from ${total} fetched. Statuses:`, [...new Set(allData.map(s => s.attributes?.status))]);
  return { data: allData, included: allIncluded };
};

// Fetch order/product details for a single OMG store
const fetchOMGStoreDetail = async (saleResource, allIncluded) => {
  const saleId = saleResource.id;
  const saleCode = saleResource.attributes?.sale_code || '';
  const saleData = { data: saleResource, included: allIncluded };

  // Try multiple endpoint patterns for orders
  const orderEndpoints = [
    `/sales/${saleId}/orders`,
    `/sales/${saleId}/orders?include=customer_info`,
    `/orders?filter[sale_id]=${saleId}`,
    `/orders?filter[sale_id]=${saleId}&include=customer_info`,
    `/orders?sale_id=${saleId}`,
    ...(saleCode ? [`/orders?filter[sale_code]=${saleCode}`] : []),
  ];
  let orders = null;
  for (const ep of orderEndpoints) {
    try {
      orders = await omgApiCall(ep);
      if (orders?.data) {
        console.log(`[OMG] Sale ${saleId} (${saleCode}): ${orders.data.length} orders via ${ep}`);
        break;
      }
    } catch (e) {
      console.log(`[OMG] Orders endpoint failed: ${ep} — ${e.message}`);
    }
  }
  const orderList = orders?.data || [];

  // Try to get order products for each order
  const orderProducts = await Promise.all(
    orderList.map(async (o) => {
      const productEndpoints = [
        `/orders/${o.id}/order_products?include=product`,
        `/orders/${o.id}/order_products`,
        `/order_products?filter[order_id]=${o.id}&include=product`,
        `/order_products?filter[order_id]=${o.id}`,
      ];
      for (const ep of productEndpoints) {
        try {
          const resp = await omgApiCall(ep);
          if (resp?.data) return resp;
        } catch { /* try next */ }
      }
      return { data: [], included: [] };
    })
  );
  return { ...saleData, orders: orderList, orderProducts };
};

// Convert OMG JSON:API response to NSA store format
// OMG API v1 returns: { data: { id, type, attributes: {...}, relationships: {...} }, included: [...] }
const convertOMGStore = (omgResponse, nsaCustomers) => {
  // Handle both single resource and already-unwrapped formats
  const resource = omgResponse.data || omgResponse;
  const attrs = resource.attributes || resource;
  const rels = resource.relationships || {};
  const included = omgResponse.included || [];

  // Find organization name from included resources
  const orgRel = rels.organization?.data;
  const orgIncluded = orgRel ? included.find(i => i.id === orgRel.id && i.type === orgRel.type) : null;
  const orgName = orgIncluded?.attributes?.name || '';

  const matchedCustomer = nsaCustomers.find(c =>
    (orgName && c.name.toLowerCase().includes(orgName.toLowerCase())) ||
    (attrs.name && c.name.toLowerCase().includes(attrs.name.toLowerCase()))
  );

  // Map OMG status to NSA status (OMG: open, closed, pending, ordered, fulfilled, scheduled, finalized, archived)
  const statusMap = { open: 'open', closed: 'closed', finalized: 'closed', archived: 'closed', fulfilled: 'closed' };
  const nsaStatus = statusMap[attrs.status] || 'draft';

  // Aggregate order product data across all orders
  const allOrderProducts = (omgResponse.orderProducts || []).flatMap(resp => resp?.data || []);
  const allIncluded = (omgResponse.orderProducts || []).flatMap(resp => resp?.included || []);

  // Build product map and image map from included resources
  const productMap = {};
  const productRels = {};
  const imageMap = {};
  allIncluded.forEach(i => {
    if (i.type === 'product' || i.type === 'products') {
      productMap[i.id] = i.attributes;
      productRels[i.id] = i.relationships || {};
    } else if (i.type === 'image' || i.type === 'images') {
      imageMap[i.id] = i.attributes?.asset_url || '';
    }
  });

  // Calculate totals from order products
  let totalItems = 0;
  let totalSales = 0;
  let fundraiseTotal = 0;
  const productSummary = {};

  allOrderProducts.forEach(op => {
    const opAttrs = op.attributes || {};
    const qty = opAttrs.quantity || 0;
    totalItems += qty;

    // Look up product details from included resources
    const productRel = op.relationships?.product?.data;
    const product = productRel ? productMap[productRel.id] : null;
    const basePrice = product?.base_price || 0;
    totalSales += basePrice * qty;

    // Get product image URL from sideloaded images
    let imageUrl = '';
    if (productRel) {
      const imgRels = productRels[productRel.id]?.images?.data || productRels[productRel.id]?.image?.data;
      if (Array.isArray(imgRels) && imgRels.length > 0) {
        imageUrl = imageMap[imgRels[0].id] || '';
      } else if (imgRels?.id) {
        imageUrl = imageMap[imgRels.id] || '';
      }
    }

    // Track unique products by SKU
    const sku = opAttrs.sku || product?.style || op.id;
    if (!productSummary[sku]) {
      productSummary[sku] = {
        sku, name: product?.name || '', style: product?.style || '',
        retail: basePrice, cost: product?.cogs || 0,
        deco_type: '', deco_cost: 0, qty: 0, image_url: imageUrl
      };
    }
    productSummary[sku].qty += qty;
  });

  // Count unique buyers from customer_info on orders
  const buyerIds = new Set((omgResponse.orders || []).map(o => o.relationships?.customer_info?.data?.id).filter(Boolean));

  // ── FALLBACK: read pre-computed totals directly from sale.attributes ──
  // OMG's own admin dashboard shows these numbers per store, so they're almost
  // certainly on the sale resource. We don't know the exact field names, so try
  // several common candidates. This works even when the order_product chain
  // fails to link properly (which has historically been the main bug).
  const firstNum = (...keys) => {
    for (const k of keys) {
      const v = attrs[k];
      if (v !== undefined && v !== null && v !== '') {
        const n = typeof v === 'number' ? v : parseFloat(v);
        if (!isNaN(n)) return n;
      }
    }
    return null;
  };
  const attrOrders = firstNum('orders_count','order_count','num_orders','orders_total','total_orders');
  const attrItems  = firstNum('items_sold','total_items','quantity_sold','item_count','units_sold','total_quantity');
  const attrSales  = firstNum('total_sales','sales_total','revenue','amount','gross_total','net_total','total','gross','gross_sales');
  const attrFund   = firstNum('fundraise','fundraise_total','fundraise_raised','fundraise_amount','profit','fundraising_total');
  const attrBuyers = firstNum('unique_buyers','buyer_count','customer_count','buyers_count');

  return {
    id: `OMG-${resource.id}`, store_name: attrs.name || attrs.sale_code,
    customer_id: matchedCustomer?.id || null, rep_id: matchedCustomer?.primary_rep_id || null,
    status: nsaStatus,
    open_date: attrs.opens_at ? new Date(attrs.opens_at).toLocaleDateString() : '',
    close_date: attrs.expires_at ? new Date(attrs.expires_at).toLocaleDateString() : '',
    orders: attrOrders !== null ? attrOrders : (omgResponse.orders?.length || 0),
    total_sales: attrSales !== null ? attrSales : totalSales,
    fundraise_total: attrFund !== null ? attrFund : fundraiseTotal,
    items_sold: attrItems !== null ? attrItems : totalItems,
    unique_buyers: attrBuyers !== null ? attrBuyers : buyerIds.size,
    products: Object.values(productSummary).map(p => ({
      sku: p.sku, name: p.name, color: '', retail: p.retail, cost: p.cost,
      deco_type: p.deco_type, deco_cost: p.deco_cost, sizes: {},
      image_url: p.image_url || ''
    })),
    subdomain: attrs.subdomain || '',
    channel_type: attrs.channel_type || 'pop-up',
    _omg_source: true, _omg_id: resource.id, _omg_sale_code: attrs.sale_code,
    _last_synced: new Date().toISOString()
  };
};

// ─── SanMar API Integration (via Netlify proxy — SOAP/XML → JSON) ───
// Requires SANMAR_USERNAME + SANMAR_PASSWORD in Netlify env vars
// Contact sanmarintegrations@sanmar.com for access
const sanmarApiCall = async (service, action, params = {}) => {
  try {
    const qs = `service=${encodeURIComponent(service)}&action=${encodeURIComponent(action)}`;
    const proxyUrl = `/.netlify/functions/sanmar-proxy?${qs}`;
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      console.error('[SanMar] API error details:', data.raw || data);
      throw new Error(data.error || `SanMar API error: ${response.status}`);
    }
    console.log('[SanMar] API response:', action, data);
    return data;
  } catch (error) { console.error('[SanMar] API call failed:', action, error); throw error; }
};

const sanmarGetProduct = async (style, color, size) => {
  const params = { style };
  if (color) params.color = color;
  if (size) params.size = size;
  return await sanmarApiCall('product', 'getProductInfoByStyleColorSize', params);
};

const sanmarGetProductByBrand = async (brand) =>
  await sanmarApiCall('product', 'getProductInfoByBrand', { brand });

const sanmarGetInventory = async (style, color, size) =>
  await sanmarApiCall('inventory', 'getInventoryQtyForStyleColorSize', { style, color: color || '', size: size || '' });

const sanmarGetPricing = async (style, color, size) =>
  await sanmarApiCall('pricing', 'getPricing', { style, color: color || '', size: size || '' });

// PromoStandards inventory — uses getInventoryLevels via InventoryServiceBinding
const sanmarGetPromoInventory = async (productId) =>
  await sanmarApiCall('promostandards', 'getInventoryLevels', {
    wsVersion: '1.2.1', productId, productIDtype: 'Supplier'
  });

const testSanMarConnection = async () => {
  try { await sanmarGetProduct('PC61'); console.log('[SanMar] Connection test successful'); return true; }
  catch (error) { console.error('[SanMar] Connection test failed:', error); return false; }
};

// ─── S&S Activewear API Integration (via Netlify proxy — REST/JSON) ───
// Requires SS_ACCOUNT_NUMBER + SS_API_KEY in Netlify env vars
// Docs: https://api.ssactivewear.com/V2/Default.aspx
const ssApiCall = async (endpoint, options = {}) => {
  try {
    const method = options.method || 'GET';
    const proxyUrl = `/.netlify/functions/ss-proxy?path=${encodeURIComponent(endpoint)}`;
    const response = await fetch(proxyUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(options.body ? { body: options.body } : {})
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let msg; try { msg = JSON.parse(errText)?.error; } catch {}
      throw new Error(msg || `S&S API error: ${response.status}`);
    }
    const data = await response.json();
    console.log('[S&S] API response:', endpoint, Array.isArray(data) ? `${data.length} items` : data);
    return data;
  } catch (error) { console.error('[S&S] API call failed:', endpoint, error); throw error; }
};

const ssGetProducts = async (filter) => {
  let endpoint = '/Products';
  if (filter?.sku) endpoint = `/Products/${encodeURIComponent(filter.sku)}`;
  else if (filter?.style) endpoint = `/Products?style=${encodeURIComponent(filter.style)}`;
  else if (filter?.brand) endpoint = `/Products?style=${encodeURIComponent(filter.brand)}`;
  return await ssApiCall(endpoint);
};

const ssGetInventory = async () => await ssApiCall('/Inventory');
const ssGetStyles = async () => await ssApiCall('/Styles');
const ssGetBrands = async () => await ssApiCall('/Brands');
const ssGetCategories = async () => await ssApiCall('/Categories');

const testSSConnection = async () => {
  try { await ssGetBrands(); console.log('[S&S] Connection test successful'); return true; }
  catch (error) { console.error('[S&S] Connection test failed:', error); return false; }
};

// ─── Richardson API Integration (via Netlify proxy) ───
// Requires RICHARDSON_API_KEY + RICHARDSON_API_BASE_URL in Netlify env vars
// May also be accessible through S&S Activewear API (Richardson products carried by S&S)
const richardsonApiCall = async (endpoint, options = {}) => {
  try {
    const method = options.method || 'GET';
    const proxyUrl = `/.netlify/functions/richardson-proxy?path=${encodeURIComponent(endpoint)}`;
    const response = await fetch(proxyUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(options.body ? { body: options.body } : {})
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let msg; try { msg = JSON.parse(errText)?.error; } catch {}
      throw new Error(msg || `Richardson API error: ${response.status}`);
    }
    const data = await response.json();
    console.log('[Richardson] API response:', endpoint, data);
    return data;
  } catch (error) { console.error('[Richardson] API call failed:', endpoint, error); throw error; }
};

const richardsonGetProducts = async () => await richardsonApiCall('/products');
const richardsonGetInventory = async () => await richardsonApiCall('/inventory');

const testRichardsonConnection = async () => {
  try { await richardsonApiCall('/products?limit=1'); console.log('[Richardson] Connection test successful'); return true; }
  catch (error) { console.error('[Richardson] Connection test failed:', error); return false; }
};

// ─── Momentec Brands API Integration (via Netlify proxy) ───
// HCL Commerce REST API — catalog endpoints are public, no auth required
// Proxy rewrites paths under /wcs/resources/store/{storeId}/
const momentecApiCall = async (endpoint, options = {}) => {
  try {
    const method = options.method || 'GET';
    const proxyUrl = `/.netlify/functions/momentec-proxy?path=${encodeURIComponent(endpoint)}`;
    const response = await fetch(proxyUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(options.body ? { body: options.body } : {})
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let msg; try { msg = JSON.parse(errText)?.error; } catch {}
      throw new Error(msg || `Momentec API error: ${response.status}`);
    }
    const data = await response.json();
    console.log('[Momentec] API response:', endpoint, data);
    return data;
  } catch (error) { console.error('[Momentec] API call failed:', endpoint, error); throw error; }
};

const momentecGetProducts = async (pageSize = 50, pageNumber = 1) =>
  await momentecApiCall(`/productview/bySearchTerm/*?pageSize=${pageSize}&pageNumber=${pageNumber}`);

const momentecGetProductById = async (productId) =>
  await momentecApiCall(`/productview/byId/${productId}`);

const momentecGetProductByPartNumber = async (partNumber) =>
  await momentecApiCall(`/productview/byPartNumber/${encodeURIComponent(partNumber)}`);

const momentecGetProductsByCategory = async (categoryId, pageSize = 50, pageNumber = 1) =>
  await momentecApiCall(`/productview/byCategory/${categoryId}?pageSize=${pageSize}&pageNumber=${pageNumber}`);

const momentecSearchProducts = async (term, pageSize = 50, pageNumber = 1) =>
  await momentecApiCall(`/productview/bySearchTerm/${encodeURIComponent(term)}*?pageSize=${pageSize}&pageNumber=${pageNumber}`);

const momentecGetCategories = async () =>
  await momentecApiCall('/categoryview/@top?depthAndLimit=11,11');

const testMomentecConnection = async () => {
  try { await momentecApiCall('/productview/bySearchTerm/*?pageSize=1'); console.log('[Momentec] Connection test successful'); return true; }
  catch (error) { console.error('[Momentec] Connection test failed:', error); return false; }
};


export { shipStationCall, testShipStationConnection, convertSOToShipStation, pushSOToShipStation, fetchShipStationUpdates, fetchRecentShipments, createShipStationLabel, fetchShipStationRates, omgFetchAllPages, omgApiCall, probeOMGEndpoints, fetchOMGStores, fetchOMGStoreDetail, convertOMGStore, sanmarApiCall, sanmarGetProduct, sanmarGetProductByBrand, sanmarGetInventory, sanmarGetPricing, sanmarGetPromoInventory, testSanMarConnection, ssApiCall, ssGetProducts, ssGetInventory, ssGetStyles, ssGetBrands, ssGetCategories, testSSConnection, richardsonApiCall, richardsonGetProducts, richardsonGetInventory, testRichardsonConnection, momentecApiCall, momentecGetProducts, momentecGetProductById, momentecGetProductByPartNumber, momentecGetProductsByCategory, momentecSearchProducts, momentecGetCategories, testMomentecConnection };
