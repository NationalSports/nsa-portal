const HEADER_ALIASES = {
  storeCode: ['storecode', 'salecode', 'omgsalecode', 'omgcode', 'code'],
  storeName: ['storename', 'storetitle', 'sale', 'saletitle'],
  products: ['products', 'productcount', 'itemcount', 'items', 'unitssold', 'units'],
  collected: ['collected', 'productcollected', 'totalcollected', 'productsales', 'sales'],
  cost: ['cost', 'itemcost', 'productcost', 'cogs', 'costofgoodssold'],
  profit: ['profit', 'productprofit', 'grossprofit'],
  margin: ['margin', 'marginpct', 'marginpercent', 'marginpercentage'],
  refunds: ['refunds', 'refund', 'refunded'],
  omgFees: ['omgfees', 'omgfee', 'platformfees', 'platformfee'],
  processingFees: ['processingfees', 'processingfee', 'creditcardfees', 'creditcardfee', 'ccfees', 'ccfee'],
  invoicedFees: ['invoicedfees', 'invoicedfee', 'otherfees', 'otherfee'],
  netProfit: ['netprofit', 'profitafterfees', 'finalprofit'],
};

const normalizeHeader = value => String(value == null ? '' : value)
  .trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const parseNumber = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let raw = String(value == null ? '' : value).trim();
  if (!raw) return 0;
  const negative = /^\(.*\)$/.test(raw);
  raw = raw.replace(/[,$%()\s]/g, '');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -Math.abs(parsed) : parsed;
};

const roundMoney = value => Math.round((Number(value) || 0) * 100) / 100;
const roundPct = value => Math.round((Number(value) || 0) * 10000) / 10000;

const indexedRow = row => Object.entries(row || {}).reduce((out, [key, value]) => {
  out[normalizeHeader(key)] = value;
  return out;
}, {});

const readAlias = (row, aliases) => {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias) && row[alias] !== '') return row[alias];
  }
  return '';
};

const normalizePeriodMonth = value => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`;
  }
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-01`;
  const us = raw.match(/^(\d{1,2})[\/-](\d{4})$/);
  if (us) return `${us[2]}-${String(Number(us[1])).padStart(2, '0')}-01`;
  return '';
};

const normalizeOmgProfitRow = (rawRow, options = {}) => {
  const row = indexedRow(rawRow);
  const storeCode = String(readAlias(row, HEADER_ALIASES.storeCode) || '').trim().toUpperCase();
  const storeName = String(readAlias(row, HEADER_ALIASES.storeName) || '').trim();
  const products = Math.max(0, Math.round(parseNumber(readAlias(row, HEADER_ALIASES.products))));
  const productCollected = roundMoney(parseNumber(readAlias(row, HEADER_ALIASES.collected)));
  // Cost/fee exports are inconsistent about signs. These columns are expenses,
  // so normalize parenthesized/negative accounting values to positive amounts.
  const itemCost = roundMoney(Math.abs(parseNumber(readAlias(row, HEADER_ALIASES.cost))));
  const importedProfit = readAlias(row, HEADER_ALIASES.profit);
  const productProfit = roundMoney(importedProfit === '' ? productCollected - itemCost : parseNumber(importedProfit));
  const importedMargin = readAlias(row, HEADER_ALIASES.margin);
  const marginPct = roundPct(importedMargin === ''
    ? (productCollected ? (productProfit / productCollected) * 100 : 0)
    : parseNumber(importedMargin));
  const refunds = roundMoney(Math.abs(parseNumber(readAlias(row, HEADER_ALIASES.refunds))));
  const omgFees = roundMoney(Math.abs(parseNumber(readAlias(row, HEADER_ALIASES.omgFees))));
  const processingFees = roundMoney(Math.abs(parseNumber(readAlias(row, HEADER_ALIASES.processingFees))));
  const invoicedFees = roundMoney(Math.abs(parseNumber(readAlias(row, HEADER_ALIASES.invoicedFees))));
  const importedNet = readAlias(row, HEADER_ALIASES.netProfit);
  const netProfit = roundMoney(importedNet === ''
    ? productProfit - refunds - omgFees - processingFees - invoicedFees
    : parseNumber(importedNet));

  return {
    storeCode,
    storeName,
    periodMonth: normalizePeriodMonth(options.periodMonth),
    isCumulative: options.isCumulative !== false,
    products,
    productCollected,
    itemCost,
    productProfit,
    marginPct,
    refunds,
    omgFees,
    processingFees,
    invoicedFees,
    netProfit,
  };
};

const monthlyValue = (current, previous, key) => {
  if (!current) return null;
  if (!current.is_cumulative) return Number(current[key]) || 0;
  if (!previous || !previous.is_cumulative) return null;
  return roundMoney((Number(current[key]) || 0) - (Number(previous[key]) || 0));
};

const latestMonthlyProfit = rows => {
  const sorted = [...(rows || [])].sort((a, b) => String(a.period_month).localeCompare(String(b.period_month)));
  const current = sorted[sorted.length - 1] || null;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  if (!current) return { current: null, previous: null, productProfit: null, netProfit: null, baseline: false };
  return {
    current,
    previous,
    productProfit: monthlyValue(current, previous, 'product_profit'),
    netProfit: monthlyValue(current, previous, 'net_profit'),
    collected: monthlyValue(current, previous, 'product_collected'),
    itemCost: monthlyValue(current, previous, 'item_cost'),
    baseline: !!current.is_cumulative && !previous,
  };
};

const monthlySnapshotTotals = (current, previous) => {
  if (!current) return { kind: 'held', reason: 'Current snapshot is missing', totals: null };
  if (current.is_cumulative && !previous) return { kind: 'baseline', reason: 'First cumulative snapshot establishes the baseline', totals: null };
  if (current.is_cumulative && !previous.is_cumulative) {
    return { kind: 'held', reason: 'A cumulative snapshot requires a prior cumulative snapshot', totals: null };
  }
  const value = key => current.is_cumulative
    ? roundMoney((Number(current[key]) || 0) - (Number(previous[key]) || 0))
    : roundMoney(Number(current[key]) || 0);
  return {
    kind: 'ready',
    reason: '',
    totals: {
      productCollected: value('product_collected'),
      itemCost: value('item_cost'),
      productProfit: value('product_profit'),
      refunds: value('refunds'),
      omgFees: value('omg_fees'),
      processingFees: value('processing_fees'),
      invoicedFees: value('invoiced_fees'),
      netProfit: value('net_profit'),
    },
  };
};

const buildManualCommissionCloseout = ({ snapshot, previousSnapshot, store, customer, rep, linkedSoIds = [], now }) => {
  const calculation = monthlySnapshotTotals(snapshot, previousSnapshot);
  if (calculation.kind === 'baseline') return { ...calculation, row: null };
  const totals = calculation.totals || {
    productCollected: 0, itemCost: 0, productProfit: 0, refunds: 0,
    omgFees: 0, processingFees: 0, invoicedFees: 0, netProfit: 0,
  };
  const basis = rep?.commission_basis === 'revenue' ? 'revenue' : 'gp';
  const rate = basis === 'revenue' ? (Number(rep?.commission_rate) || 0.01) : 0.30;
  const reasons = [];
  if (calculation.kind !== 'ready') reasons.push(calculation.reason);
  if (!store?.customer_id || !customer?.id) reasons.push('Store is not assigned to a customer');
  if (!rep?.id) reasons.push('Store/customer is not assigned to a commission rep');
  if (linkedSoIds.length) reasons.push('Store is linked to portal sales order(s); held to prevent duplicate commission');
  const status = reasons.length ? 'held' : 'finalized';
  const base = basis === 'revenue'
    ? roundMoney(totals.productCollected - totals.refunds)
    : totals.netProfit;
  const timestamp = now || new Date().toISOString();
  return {
    kind: status,
    reason: reasons.join('; '),
    totals,
    row: {
      store_id: store.id,
      store_code: String(store._omg_sale_code || snapshot?.store_code || '').trim().toUpperCase(),
      period_month: snapshot.period_month,
      customer_id: store.customer_id || null,
      rep_id: rep?.id || null,
      product_collected: totals.productCollected,
      item_cost: totals.itemCost,
      product_profit: totals.productProfit,
      fees_and_refunds: roundMoney(totals.refunds + totals.omgFees + totals.processingFees + totals.invoicedFees),
      net_profit: totals.netProfit,
      commission_basis: basis,
      commission_rate: rate,
      commission_amount: status === 'finalized' ? roundMoney(base * rate) : 0,
      status,
      hold_reason: status === 'held' ? reasons.join('; ') : null,
      validation: {
        ready: status === 'finalized',
        source: 'manual_import',
        isCumulative: !!snapshot.is_cumulative,
        previousSnapshotId: previousSnapshot?.id || null,
        linkedSoIds,
      },
      source_snapshot_id: snapshot.id,
      finalized_at: status === 'finalized' ? timestamp : null,
      updated_at: timestamp,
    },
  };
};

export {
  HEADER_ALIASES,
  normalizeHeader,
  parseNumber,
  normalizePeriodMonth,
  normalizeOmgProfitRow,
  monthlyValue,
  latestMonthlyProfit,
  monthlySnapshotTotals,
  buildManualCommissionCloseout,
};
