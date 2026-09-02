// Nightly OMG profit sync (Netlify background function; 15-minute budget).
// Pulls every mapped store by its stable OMG sale id/code, writes monthly and
// daily audit totals, then idempotently closes the prior commission month.
const { getSupabaseAdmin, verifyUserOrInternal } = require('./_shared');
const { aggregateStoreOrders, commissionCloseout, monthStart, previousMonthStart } = require('./_omgProfit');

const API_BASE = (process.env.OMG_API_BASE_URL || 'https://app.ordermygear.com/v1').replace(/\/+$/, '');
const API_KEY = process.env.OMG_API_KEY || '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const apiPath = link => {
  if (!link) return '';
  try {
    const url = new URL(link, API_BASE);
    return url.pathname.replace(/^\/v1/, '') + url.search;
  } catch (_) { return String(link); }
};

async function omgGet(path, attempt = 0) {
  const response = await fetch(API_BASE + path, {
    headers: { 'X-ACCESS-TOKEN': API_KEY, Accept: 'application/json', 'User-Agent': 'NSA-Portal/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if ((response.status === 409 || response.status === 429 || response.status >= 500) && attempt < 3) {
    await pause(750 * (2 ** attempt));
    return omgGet(path, attempt + 1);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`OMG ${path} -> ${response.status}: ${text.slice(0, 180)}`);
  try { return JSON.parse(text); } catch (_) { throw new Error(`OMG ${path} returned non-JSON data`); }
}

async function allPages(path, maxPages = 100) {
  const data = [];
  const included = [];
  const seen = new Set();
  let next = path;
  for (let page = 0; next && page < maxPages; page++) {
    const response = await omgGet(next);
    const pageRows = Array.isArray(response.data) ? response.data : [];
    let added = 0;
    for (const row of pageRows) {
      if (!seen.has(String(row.id))) { seen.add(String(row.id)); data.push(row); added++; }
    }
    included.push(...(response.included || []));
    const linked = response.links?.next;
    if (linked) next = apiPath(linked);
    else if (pageRows.length >= 100 && added > 0) {
      const last = pageRows[pageRows.length - 1];
      const cursor = last?.meta?.page?.cursor || Buffer.from(JSON.stringify({ id: last?.id })).toString('base64');
      next = path + (path.includes('?') ? '&' : '?') + 'page[after]=' + encodeURIComponent(cursor);
    } else next = '';
  }
  return { data, included };
}

async function findSale(store) {
  if (store._omg_id) {
    const response = await omgGet('/sales/' + encodeURIComponent(store._omg_id));
    return response.data || response;
  }
  const code = encodeURIComponent(store._omg_sale_code);
  const response = await allPages(`/sales?filter[sale_code]=${code}`, 5);
  return response.data.find(s => String(s.attributes?.sale_code || '').toUpperCase() === String(store._omg_sale_code).toUpperCase()) || null;
}

async function fetchOrders(sale) {
  const id = encodeURIComponent(sale.id);
  const code = encodeURIComponent(sale.attributes?.sale_code || '');
  const endpoints = [
    `/sales/${id}/orders`,
    `/orders?filter[sale_id]=${id}`,
    `/orders?sale_id=${id}`,
    ...(code ? [`/orders?filter[sale_code]=${code}`] : []),
  ];
  let lastError, emptyResponse = null;
  for (const endpoint of endpoints) {
    try { const response = await allPages(endpoint); if (response.data.length) return response; emptyResponse = emptyResponse || response; } catch (error) { lastError = error; }
  }
  if (emptyResponse) return emptyResponse;
  throw lastError || new Error(`No order endpoint worked for sale ${sale.id}`);
}

async function fetchOrderProducts(orderId) {
  const id = encodeURIComponent(orderId);
  const endpoints = [
    `/orders/${id}/order_products?include=product`,
    `/order_products?filter[order_id]=${id}&include=product`,
    `/orders/${id}/order_products`,
    `/order_products?filter[order_id]=${id}`,
  ];
  let lastError, emptyResponse = null;
  for (const endpoint of endpoints) {
    try { const response = await allPages(endpoint); if (response.data.length) return response; emptyResponse = emptyResponse || response; } catch (error) { lastError = error; }
  }
  if (emptyResponse) return emptyResponse;
  throw lastError || new Error(`No order-products endpoint worked for order ${orderId}`);
}

async function bundlesFor(orders) {
  const out = [];
  for (let i = 0; i < orders.length; i += 5) {
    const batch = orders.slice(i, i + 5);
    const responses = await Promise.all(batch.map(async order => ({ order, response: await fetchOrderProducts(order.id) })));
    out.push(...responses);
  }
  return out;
}

const snapshotRow = (store, repId, sale, monthly, now) => ({
  store_id: store.id,
  store_code: String(store._omg_sale_code).toUpperCase(),
  period_month: monthly.periodMonth,
  is_cumulative: false,
  customer_id: store.customer_id || null,
  rep_id: repId || null,
  products: monthly.products,
  product_collected: monthly.productCollected,
  item_cost: monthly.itemCost,
  product_profit: monthly.productProfit,
  margin_pct: monthly.marginPct,
  refunds: monthly.refunds,
  omg_fees: monthly.omgFees,
  processing_fees: monthly.processingFees,
  invoiced_fees: monthly.invoicedFees,
  net_profit: monthly.netProfit,
  source_file: 'OMG API nightly',
  source_mode: 'omg_api',
  source_sale_id: String(sale.id),
  validation_status: monthly.validation.ready ? 'ready' : 'held',
  validation: monthly.validation,
  last_synced_at: now,
  updated_at: now,
});

async function upsertMonthly(sb, row) {
  const { data, error } = await sb.from('omg_store_profit_snapshots')
    .upsert(row, { onConflict: 'store_id,period_month' }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function closeCommissionMonth(sb, store, rep, monthly, sourceSnapshotId, priorMonth, now, linkedSoIds = []) {
  if (monthly.periodMonth !== priorMonth || monthly.products <= 0) return false;
  const { data: existing, error: existingError } = await sb.from('omg_store_commission_months')
    .select('id,status').eq('store_id', store.id).eq('period_month', priorMonth).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === 'finalized') return false;
  const result = commissionCloseout(monthly, rep || {});
  const ready = !!monthly.validation.ready && !!rep?.id && !!store.customer_id && linkedSoIds.length === 0;
  const reasons = [];
  if (!store.customer_id) reasons.push('Store is not assigned to a customer');
  if (!rep?.id) reasons.push('Store/customer is not assigned to a commission rep');
  if (!monthly.validation.pricingComplete) reasons.push('OMG line prices are incomplete');
  if (!monthly.validation.cogsComplete) reasons.push('OMG item costs are incomplete');
  if (!monthly.validation.feesComplete) reasons.push('OMG fee fields are incomplete');
  if (linkedSoIds.length) reasons.push('Store is linked to portal sales order(s); held to prevent duplicate commission');
  const validation = { ...monthly.validation, linkedSoIds };
  const row = {
    store_id: store.id,
    store_code: String(store._omg_sale_code).toUpperCase(),
    period_month: priorMonth,
    customer_id: store.customer_id || null,
    rep_id: rep?.id || null,
    product_collected: monthly.productCollected,
    item_cost: monthly.itemCost,
    product_profit: monthly.productProfit,
    fees_and_refunds: Math.round((monthly.refunds + monthly.omgFees + monthly.processingFees + monthly.invoicedFees) * 100) / 100,
    net_profit: monthly.netProfit,
    commission_basis: result.basis,
    commission_rate: result.rate,
    commission_amount: ready ? result.amount : 0,
    status: ready ? 'finalized' : 'held',
    hold_reason: ready ? null : reasons.join('; '),
    validation,
    source_snapshot_id: sourceSnapshotId,
    finalized_at: ready ? now : null,
    updated_at: now,
  };
  const { error } = await sb.from('omg_store_commission_months').upsert(row, { onConflict: 'store_id,period_month' });
  if (error) throw error;
  return ready;
}

async function syncStore(sb, store, customers, reps, linkedSalesOrders, runId, now) {
  const customer = customers.get(store.customer_id) || null;
  const repId = store.rep_id || customer?.primary_rep_id || null;
  const rep = reps.get(repId) || null;
  const sale = await findSale(store);
  if (!sale) throw new Error(`No OMG sale matched code ${store._omg_sale_code}`);
  const orderResponse = await fetchOrders(sale);
  const currentMonth = monthStart(new Date(now));
  const priorMonth = previousMonthStart(new Date(now));
  // Only hydrate line items for the two months that can still change. Always-open
  // stores can carry years of orders; re-fetching every historical line nightly
  // would eventually exceed the background-function budget.
  const byMonth = new Map();
  for (const order of orderResponse.data) {
    const a = order.attributes || {};
    const period = monthStart(a.submitted_at || a.placed_at || a.ordered_at || a.completed_at || a.created_at || a.updated_at);
    if (period !== currentMonth && period !== priorMonth) continue;
    if (!byMonth.has(period)) byMonth.set(period, []);
    byMonth.get(period).push(order);
  }
  const months = [];
  for (const orders of byMonth.values()) {
    const aggregation = aggregateStoreOrders(await bundlesFor(orders));
    months.push(...aggregation.months);
  }
  let finalized = 0;
  const linkedSoIds = linkedSalesOrders.get(store.id) || [];
  for (const monthly of months) {
    const snapshotId = await upsertMonthly(sb, snapshotRow(store, repId, sale, monthly, now));
    if (await closeCommissionMonth(sb, store, rep, monthly, snapshotId, priorMonth, now, linkedSoIds)) finalized++;
  }
  const current = months.find(m => m.periodMonth === currentMonth) || {
    products: 0, productCollected: 0, itemCost: 0, productProfit: 0, refunds: 0, omgFees: 0,
    processingFees: 0, invoicedFees: 0, netProfit: 0,
    validation: { ready: true, noOrders: true, pricingComplete: true, cogsComplete: true, feesComplete: true, includedOrders: 0, lineCount: 0 },
  };
  const daily = {
    store_id: store.id, store_code: String(store._omg_sale_code).toUpperCase(), snapshot_date: now.slice(0, 10),
    period_month: currentMonth, customer_id: store.customer_id || null, rep_id: repId, products: current.products,
    product_collected: current.productCollected, item_cost: current.itemCost, product_profit: current.productProfit,
    refunds: current.refunds, omg_fees: current.omgFees, processing_fees: current.processingFees,
    invoiced_fees: current.invoicedFees, net_profit: current.netProfit,
    validation_status: current.validation.ready ? 'ready' : 'held', validation: current.validation,
    sync_run_id: runId, captured_at: now,
  };
  const { error: dailyError } = await sb.from('omg_store_profit_daily_snapshots').upsert(daily, { onConflict: 'store_id,snapshot_date' });
  if (dailyError) throw dailyError;
  return { held: months.some(m => !m.validation.ready), finalized };
}

exports.handler = async event => {
  const auth = await verifyUserOrInternal(event);
  if (!auth.ok) return { statusCode: auth.status, body: auth.error };
  // OMG's V1 order filters are not sale-scoped: the API can return the same
  // global rows for different sale ids. Never write accounting or commission
  // data unless the account has explicitly opted into a verified API mode.
  if (process.env.OMG_PROFIT_API_SYNC_ENABLED !== 'true') {
    return {
      statusCode: 503,
      body: 'Automatic OMG profit sync is disabled because sale-filtered order costs are not reliable. Import the monthly Margin Report snapshot instead.',
    };
  }
  if (!API_KEY) return { statusCode: 500, body: 'OMG_API_KEY is not configured' };
  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data: stores, error: storeError } = await sb.from('omg_stores')
    .select('id,store_name,customer_id,rep_id,_omg_id,_omg_sale_code').not('_omg_sale_code', 'is', null);
  if (storeError) return { statusCode: 500, body: storeError.message };
  const { data: customerRows, error: customerError } = await sb.from('customers').select('id,primary_rep_id');
  if (customerError) return { statusCode: 500, body: customerError.message };
  const { data: repRows, error: repError } = await sb.from('team_members').select('id,commission_basis,commission_rate');
  if (repError) return { statusCode: 500, body: repError.message };
  const { data: linkedSoRows, error: linkedSoError } = await sb.from('sales_orders')
    .select('id,omg_store_id').not('omg_store_id', 'is', null).is('deleted_at', null);
  if (linkedSoError) return { statusCode: 500, body: linkedSoError.message };
  const { data: run, error: runError } = await sb.from('omg_profit_sync_runs')
    .insert({ run_date: now.slice(0, 10), stores_requested: stores.length, started_at: now }).select('id').single();
  if (runError) return { statusCode: 500, body: runError.message };

  const customers = new Map((customerRows || []).map(row => [row.id, row]));
  const reps = new Map((repRows || []).map(row => [row.id, row]));
  const linkedSalesOrders = new Map();
  for (const so of linkedSoRows || []) {
    if (!linkedSalesOrders.has(so.omg_store_id)) linkedSalesOrders.set(so.omg_store_id, []);
    linkedSalesOrders.get(so.omg_store_id).push(so.id);
  }
  let synced = 0, held = 0, finalized = 0;
  const errors = [];
  // Keep enough parallelism to finish every mapped store inside Netlify's
  // background-function window without flooding OMG's API. Checkpoint each
  // batch so the portal shows real progress and an interrupted run is auditable.
  const batchSize = 3;
  for (let index = 0; index < (stores || []).length; index += batchSize) {
    const batch = stores.slice(index, index + batchSize);
    const results = await Promise.all(batch.map(async store => {
      try {
        const result = await syncStore(sb, store, customers, reps, linkedSalesOrders, run.id, now);
        return { ok: true, result };
      } catch (error) {
        console.error('[omg-profit-sync]', store._omg_sale_code, error);
        return {
          ok: false,
          error: { storeCode: store._omg_sale_code, message: String(error?.message || error).slice(0, 500) },
        };
      }
    }));
    for (const item of results) {
      if (item.ok) {
        synced++;
        held += item.result.held ? 1 : 0;
        finalized += item.result.finalized;
      } else errors.push(item.error);
    }
    await sb.from('omg_profit_sync_runs').update({
      stores_synced: synced, stores_held: held, commissions_finalized: finalized, errors,
    }).eq('id', run.id);
  }
  const status = errors.length ? (synced ? 'partial' : 'failed') : 'complete';
  await sb.from('omg_profit_sync_runs').update({ status, stores_synced: synced, stores_held: held, commissions_finalized: finalized, errors, finished_at: new Date().toISOString() }).eq('id', run.id);
  console.log('[omg-profit-sync] complete', { status, stores: stores.length, synced, held, finalized, errors: errors.length });
  return { statusCode: status === 'failed' ? 500 : 200, body: JSON.stringify({ status, stores: stores.length, synced, held, finalized, errors }) };
};

exports._test = { apiPath, snapshotRow };
