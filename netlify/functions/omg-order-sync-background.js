// Nightly operational OMG refresh. This intentionally reads the global order
// feed and groups rows by their explicit sale relationship because OMG V1
// silently ignores sale filters. It updates display-only order metadata and
// never writes profit snapshots, monthly closeouts, or commission records.
const { getSupabaseAdmin, verifyUserOrInternal } = require('./_shared');

const API_BASE = (process.env.OMG_API_BASE_URL || 'https://app.ordermygear.com/v1').replace(/\/+$/, '');
const API_KEY = process.env.OMG_API_KEY || '';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const apiPath = link => {
  if (!link) return '';
  try {
    const url = new URL(link, API_BASE);
    return url.pathname.replace(/^\/v1/, '') + url.search;
  } catch (_) {
    return String(link);
  }
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

async function allOrderPages(path, maxPages = 500, getPage = omgGet) {
  const rows = [];
  const seen = new Set();
  const addPage = response => {
    const pageRows = Array.isArray(response.data) ? response.data : [];
    let added = 0;
    for (const row of pageRows) {
      if (!seen.has(String(row.id))) {
        seen.add(String(row.id));
        rows.push(row);
        added++;
      }
    }
    return { pageRows, added };
  };

  const first = await getPage(path);
  const firstPage = addPage(first);
  let pages = 1;
  let next = apiPath(first.links?.next);

  // OMG sometimes supplies JSON:API links.next. Follow it when present.
  while (next && pages < maxPages) {
    const response = await getPage(next);
    const { pageRows, added } = addPage(response);
    pages++;
    if (!pageRows.length || !added) return rows;
    next = apiPath(response.links?.next);
  }
  if (next) throw new Error(`OMG order pagination exceeded ${maxPages} pages; no store rows were changed`);

  // The global orders endpoint also commonly omits links.next even when the
  // first page is full. OMG uses page[after] cursors in that case. Prefer the
  // resource cursor when present; its API also accepts a base64 {id} cursor.
  // If OMG ignores the cursor, every row is a duplicate and we stop safely.
  if (!first.links?.next && firstPage.pageRows.length && firstPage.added) {
    const separator = path.includes('?') ? '&' : '?';
    let last = firstPage.pageRows[firstPage.pageRows.length - 1];
    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber++) {
      const cursor = last?.meta?.page?.cursor
        || Buffer.from(JSON.stringify({ id: last?.id })).toString('base64');
      const response = await getPage(`${path}${separator}page[after]=${encodeURIComponent(cursor)}`);
      const { pageRows, added } = addPage(response);
      if (!pageRows.length || !added) return rows;
      last = pageRows[pageRows.length - 1];
      if (pageRows.length < 100) return rows;
    }
    throw new Error(`OMG order pagination exceeded ${maxPages} pages; no store rows were changed`);
  }
  return rows;
}

async function fetchAllOrders() {
  const endpoints = [
    '/orders?include=sale,customer_info&sort=-updated_at&page[size]=200',
    '/orders?include=sale&sort=-updated_at&page[size]=200',
    '/orders?include=sale',
    '/orders',
  ];
  let lastError;
  for (const endpoint of endpoints) {
    try { return await allOrderPages(endpoint); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error('No OMG global order endpoint worked');
}

const normalizeSaleCode = value => String(value || '').replace(/^sale_/i, '').trim().toUpperCase();

const saleCodeForOrder = order => normalizeSaleCode(
  order?.relationships?.sale?.data?.id
  || order?.relationships?.sales?.data?.id
  || order?.attributes?.sale_id
  || order?.attributes?.sale_code
);

const buyerKeyForOrder = order => String(
  order?.relationships?.customer_info?.data?.id
  || order?.relationships?.customer?.data?.id
  || order?.attributes?.customer_info_id
  || order?.attributes?.email
  || order?.attributes?.billing_email
  || order?.id
);

function summarizeOrders(orders) {
  const summaries = new Map();
  for (const order of orders || []) {
    const code = saleCodeForOrder(order);
    if (!code) continue;
    if (!summaries.has(code)) summaries.set(code, { orders: 0, buyers: new Set() });
    const summary = summaries.get(code);
    summary.orders++;
    summary.buyers.add(buyerKeyForOrder(order));
  }
  return new Map([...summaries].map(([code, row]) => [code, {
    orders: row.orders,
    uniqueBuyers: row.buyers.size,
  }]));
}

function buildStoreUpdate(store, summary, now) {
  const nextOrders = summary?.orders || 0;
  const currentOrders = Number(store.orders) || 0;
  // Cumulative 24/7 stores should not lose order rows. A lower count means the
  // global feed was incomplete or its relationship shape changed, so preserve
  // the known-good value and make the run partial instead of erasing data.
  if (nextOrders < currentOrders) {
    return {
      held: true,
      reason: `OMG returned ${nextOrders} orders, below stored count ${currentOrders}; preserved stored values`,
    };
  }
  const code = normalizeSaleCode(store._omg_sale_code);
  return {
    held: false,
    values: {
      orders: nextOrders,
      unique_buyers: summary?.uniqueBuyers || 0,
      _omg_id: store._omg_id || `sale_${code}`,
      _last_synced: now,
    },
  };
}

exports.handler = async event => {
  const auth = await verifyUserOrInternal(event);
  if (!auth.ok) return { statusCode: auth.status, body: auth.error };
  if (!API_KEY) return { statusCode: 500, body: 'OMG_API_KEY is not configured' };

  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data: stores, error: storeError } = await sb.from('omg_stores')
    .select('id,store_name,orders,unique_buyers,_omg_id,_omg_sale_code')
    .eq('channel_type', '24/7')
    .not('_omg_sale_code', 'is', null);
  if (storeError) return { statusCode: 500, body: storeError.message };

  const { data: run, error: runError } = await sb.from('omg_operational_sync_runs')
    .insert({ stores_requested: stores.length, started_at: now }).select('id').single();
  // A deploy and its migration can briefly cross. The operational refresh is
  // still safe without the audit row, so log that condition and use each
  // store's _last_synced timestamp as the durable completion marker.
  if (runError) console.warn('[omg-order-sync] audit row unavailable:', runError.message);
  const runId = run?.id || null;

  try {
    const orders = await fetchAllOrders();
    const summaries = summarizeOrders(orders);
    const errors = [];
    let synced = 0;
    let held = 0;

    for (const store of stores) {
      const code = normalizeSaleCode(store._omg_sale_code);
      const update = buildStoreUpdate(store, summaries.get(code), now);
      if (update.held) {
        held++;
        errors.push({ storeCode: code, message: update.reason });
        continue;
      }
      const { error } = await sb.from('omg_stores').update(update.values).eq('id', store.id);
      if (error) {
        errors.push({ storeCode: code, message: error.message });
      } else synced++;
    }

    const status = errors.length ? (synced ? 'partial' : 'failed') : 'complete';
    if (runId) {
      await sb.from('omg_operational_sync_runs').update({
        status,
        stores_synced: synced,
        stores_held: held,
        orders_seen: orders.length,
        errors,
        finished_at: new Date().toISOString(),
      }).eq('id', runId);
    }
    console.log('[omg-order-sync] complete', { status, stores: stores.length, synced, held, orders: orders.length, errors: errors.length });
    return { statusCode: status === 'failed' ? 500 : 200, body: JSON.stringify({ status, stores: stores.length, synced, held, orders: orders.length, errors }) };
  } catch (error) {
    const errors = [{ message: String(error?.message || error).slice(0, 500) }];
    if (runId) {
      await sb.from('omg_operational_sync_runs').update({
        status: 'failed', errors, finished_at: new Date().toISOString(),
      }).eq('id', runId);
    }
    console.error('[omg-order-sync]', error);
    return { statusCode: 500, body: errors[0].message };
  }
};

exports._test = { apiPath, allOrderPages, normalizeSaleCode, saleCodeForOrder, summarizeOrders, buildStoreUpdate };
