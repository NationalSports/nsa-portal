const MONEY_EPSILON = 0.011;

const num = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value == null ? '' : value).trim().replace(/[,$%]/g, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};
const money = value => Math.round(num(value) * 100) / 100;
const attrsOf = resource => resource?.attributes || resource || {};
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const firstPresent = (obj, keys) => {
  for (const key of keys) if (hasOwn(obj, key) && obj[key] !== null && obj[key] !== '') return { found: true, value: obj[key], key };
  return { found: false, value: 0, key: null };
};

const monthStart = (value, timeZone = 'America/Los_Angeles') => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(date).reduce((out, p) => ({ ...out, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-01`;
};

const previousMonthStart = (now = new Date()) => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
};

const orderDate = order => {
  const a = attrsOf(order);
  return firstPresent(a, ['submitted_at', 'placed_at', 'ordered_at', 'completed_at', 'created_at', 'updated_at']).value;
};

const cancelledOrder = order => {
  const a = attrsOf(order);
  return /cancel|void|test/.test(String(a.status || a.state || '').toLowerCase());
};

const productMapFor = response => {
  const map = new Map();
  for (const resource of response?.included || []) {
    if (/^products?$/.test(String(resource.type || ''))) map.set(String(resource.id), attrsOf(resource));
  }
  return map;
};

const lineProduct = (line, products) => {
  const rel = line?.relationships?.product?.data;
  return rel?.id ? (products.get(String(rel.id)) || {}) : {};
};

const lineTotals = (line, product) => {
  const a = attrsOf(line);
  const qty = Math.max(0, num(firstPresent(a, ['quantity', 'qty', 'count']).value) || 1);
  const collectedTotal = firstPresent(a, ['product_collected', 'collected', 'line_total', 'extended_price', 'subtotal', 'total_price']);
  const collectedUnit = firstPresent(a, ['unit_price', 'sale_price', 'price']);
  const basePrice = firstPresent(product, ['base_price', 'price', 'retail_price']);
  const collected = collectedTotal.found ? num(collectedTotal.value)
    : collectedUnit.found ? num(collectedUnit.value) * qty
      : basePrice.found ? num(basePrice.value) * qty : 0;

  const costTotal = firstPresent(a, ['line_cost', 'extended_cost', 'total_cost', 'cogs_total']);
  const costUnit = firstPresent(a, ['unit_cost', 'cost', 'cogs']);
  const productCost = firstPresent(product, ['cogs', 'cost', 'unit_cost']);
  const cost = costTotal.found ? num(costTotal.value)
    : costUnit.found ? num(costUnit.value) * qty
      : productCost.found ? num(productCost.value) * qty : 0;

  return {
    qty,
    collected: money(collected),
    cost: money(Math.abs(cost)),
    // Product base_price is only a fallback display value and can omit option
    // upcharges. Closeout requires an order-line total/unit price from OMG.
    collectedFound: collectedTotal.found || collectedUnit.found,
    costFound: costTotal.found || costUnit.found || productCost.found,
  };
};

const expense = (attrs, keys) => {
  const hit = firstPresent(attrs, keys);
  return { found: hit.found, value: money(Math.abs(num(hit.value))) };
};

const emptyTotals = () => ({ products: 0, productCollected: 0, itemCost: 0, refunds: 0, omgFees: 0, processingFees: 0, invoicedFees: 0 });
const addMoney = (row, key, value) => { row[key] = money(row[key] + value); };

function aggregateStoreOrders(orderBundles, options = {}) {
  const months = new Map();
  const cumulative = emptyTotals();
  let lineCount = 0;
  let missingCollected = 0;
  let missingCost = 0;
  let feeOrders = 0;
  let includedOrders = 0;

  for (const bundle of orderBundles || []) {
    const order = bundle.order || bundle;
    if (cancelledOrder(order)) continue;
    const period = monthStart(orderDate(order), options.timeZone);
    if (!period) continue;
    includedOrders++;
    if (!months.has(period)) months.set(period, emptyTotals());
    const bucket = months.get(period);
    const response = bundle.response || { data: bundle.lines || [], included: bundle.included || [] };
    const products = productMapFor(response);
    for (const line of response.data || []) {
      const totals = lineTotals(line, lineProduct(line, products));
      lineCount++;
      if (!totals.collectedFound) missingCollected++;
      if (!totals.costFound) missingCost++;
      for (const target of [bucket, cumulative]) {
        target.products += totals.qty;
        addMoney(target, 'productCollected', totals.collected);
        addMoney(target, 'itemCost', totals.cost);
      }
    }

    const oa = attrsOf(order);
    const refunds = expense(oa, ['refunds', 'refund_amount', 'refunded_amount', 'product_refunds']);
    const omgFees = expense(oa, ['omg_fees', 'omg_fee', 'platform_fees', 'platform_fee', 'service_fees', 'service_fee']);
    const processingFees = expense(oa, ['processing_fees', 'processing_fee', 'payment_processing_fee', 'transaction_fee', 'credit_card_fee']);
    const invoicedFees = expense(oa, ['invoiced_fees', 'invoiced_fee', 'invoice_fees', 'other_fees']);
    if (omgFees.found || processingFees.found || invoicedFees.found) feeOrders++;
    for (const target of [bucket, cumulative]) {
      addMoney(target, 'refunds', refunds.value);
      addMoney(target, 'omgFees', omgFees.value);
      addMoney(target, 'processingFees', processingFees.value);
      addMoney(target, 'invoicedFees', invoicedFees.value);
    }
  }

  const finish = totals => {
    const productProfit = money(totals.productCollected - totals.itemCost);
    const feesAndRefunds = money(totals.refunds + totals.omgFees + totals.processingFees + totals.invoicedFees);
    return {
      ...totals,
      products: Math.round(totals.products),
      productProfit,
      marginPct: totals.productCollected ? Math.round(productProfit / totals.productCollected * 1000000) / 10000 : 0,
      netProfit: money(productProfit - feesAndRefunds),
    };
  };

  const pricingComplete = lineCount > 0 && missingCollected === 0;
  const cogsComplete = lineCount > 0 && missingCost === 0;
  // Fee keys must be present on every included order. This distinguishes a true
  // zero from an API payload that omitted accounting fields entirely.
  const feesComplete = includedOrders > 0 && feeOrders === includedOrders;
  const ready = pricingComplete && cogsComplete && feesComplete;
  const validation = { ready, pricingComplete, cogsComplete, feesComplete, includedOrders, lineCount, missingCollected, missingCost, feeOrders };
  return {
    months: [...months.entries()].map(([periodMonth, totals]) => ({ periodMonth, ...finish(totals), validation })),
    cumulative: { ...finish(cumulative), validation },
    validation,
  };
}

function commissionCloseout(totals, rep = {}) {
  const basis = rep.commission_basis === 'revenue' ? 'revenue' : 'gp';
  const rate = basis === 'revenue' ? (num(rep.commission_rate) || 0.01) : 0.30;
  const base = basis === 'revenue' ? money(totals.productCollected - totals.refunds) : totals.netProfit;
  return { basis, rate, amount: money(base * rate), base: money(base) };
}

const reconciles = (actual, expected, tolerance = MONEY_EPSILON) => Math.abs(num(actual) - num(expected)) <= tolerance;

module.exports = { aggregateStoreOrders, commissionCloseout, monthStart, previousMonthStart, lineTotals, reconciles, money };
