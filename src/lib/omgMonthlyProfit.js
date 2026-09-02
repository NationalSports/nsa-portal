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

module.exports = {
  HEADER_ALIASES,
  normalizeHeader,
  parseNumber,
  normalizePeriodMonth,
  normalizeOmgProfitRow,
  monthlyValue,
  latestMonthlyProfit,
};
