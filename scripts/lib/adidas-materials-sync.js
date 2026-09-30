'use strict';

const RAW_APPAREL_CODE = /^\d{3}$/;
const INVALID_APPAREL_LABEL = /^(?:6XL|7XL)$/i;

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function numberOrZero(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed >= 1_000_000 ? 9999 : Math.trunc(parsed);
}

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function materialItem(payload) {
  const root = asArray(payload)[0] || {};
  return root.item || root.material || root;
}

function sizeObjectsFromMaterials(payload) {
  const item = materialItem(payload);
  const found = new Map();
  const days = asArray(item.days);

  for (const dayGroup of days) {
    if (!dayGroup || typeof dayGroup !== 'object') continue;
    for (const dayValue of Object.values(dayGroup)) {
      const sizes = dayValue?.sizes || dayValue?.sizeRun || {};
      if (!sizes || typeof sizes !== 'object') continue;
      for (const [code, raw] of Object.entries(sizes)) {
        const value = raw && typeof raw === 'object' ? raw : { inventory: raw };
        const existing = found.get(String(code)) || {};
        found.set(String(code), {
          code: String(code),
          inventory: value.inventory ?? value.quantity ?? existing.inventory ?? 0,
          restockDate: value.restockDate ?? value.restock_date ?? existing.restockDate ?? null,
        });
      }
    }
  }

  if (found.size) return [...found.values()];

  const fallback = item.deliveryInformation?.sizeRun
    || item.delivery_information?.sizeRun
    || item.sizeRun
    || [];
  for (const raw of asArray(fallback)) {
    const code = typeof raw === 'object'
      ? raw.code ?? raw.sizeCode ?? raw.id ?? raw.value
      : raw;
    if (code == null || code === '') continue;
    found.set(String(code), { code: String(code), inventory: 0, restockDate: null });
  }
  return [...found.values()];
}

function catalogProducts(payload) {
  const roots = asArray(payload);
  const candidates = [
    ...roots,
    ...roots.flatMap((root) => asArray(root?.data)),
  ];
  for (const root of candidates) {
    const products = root?.products
      || root?._embedded?.products
      || root?.data?.products
      || root?.data?._embedded?.products;
    if (Array.isArray(products)) return products;
  }
  return [];
}

function normalizeCatalogProduct(raw) {
  const sku = String(raw?.articleNumber || raw?.sku || raw?.materialNumber || '').trim().toUpperCase();
  const codes = asArray(raw?.sizes || raw?.sizeRun || raw?.deliveryInformation?.sizeRun)
    .map((value) => String(typeof value === 'object'
      ? value.code ?? value.sizeCode ?? value.id ?? value.value ?? ''
      : value).trim())
    .filter(Boolean);
  return {
    sku,
    conversionId: String(raw?.conversionId || raw?.conversionID || '').trim(),
    codes,
    soldOut: raw?.soldOut === true,
  };
}

function resolveSizeLabel(code, context) {
  const raw = String(code || '').trim();
  if (!raw) return null;
  const durable = context?.codeLabels || {};
  const mapped = durable[raw] || durable[raw.toUpperCase()];
  if (mapped) return String(mapped).trim();

  const catalogCodes = context?.catalogCodes || [];
  const availableSizes = context?.availableSizes || [];
  if (catalogCodes.length && catalogCodes.length === availableSizes.length) {
    const index = catalogCodes.findIndex((candidate) => String(candidate) === raw);
    if (index >= 0 && availableSizes[index]) return String(availableSizes[index]).trim();
  }

  // CLICK already returns human labels for some products. Three-digit values are
  // internal apparel codes and must never be written without a verified mapping.
  if (!RAW_APPAREL_CODE.test(raw)) return raw;
  return null;
}

function buildInventoryRows({
  sku,
  payload,
  codeLabels = {},
  catalogCodes = [],
  availableSizes = [],
  projectedByDate = {},
  syncedAt = new Date().toISOString(),
}) {
  const rows = [];
  const unmappedCodes = [];
  for (const size of sizeObjectsFromMaterials(payload)) {
    const label = resolveSizeLabel(size.code, { codeLabels, catalogCodes, availableSizes });
    if (!label || RAW_APPAREL_CODE.test(label) || INVALID_APPAREL_LABEL.test(label)) {
      unmappedCodes.push(size.code);
      continue;
    }
    const futureDate = normalizeDate(size.restockDate);
    const projection = futureDate ? projectedByDate[futureDate]?.[String(size.code)] : null;
    const projected = projection == null ? null : Number(projection);
    rows.push({
      id: `${sku}-${label}`,
      sku,
      size: label,
      stock_qty: numberOrZero(size.inventory),
      future_delivery_date: futureDate,
      future_delivery_qty: Number.isFinite(projected) && projected < 1_000_000
        ? Math.max(0, Math.trunc(projected))
        : null,
      last_synced: syncedAt,
      source: 'api-materials',
    });
  }
  return { rows, unmappedCodes: [...new Set(unmappedCodes)] };
}

function projectedInventoryByCode(payload) {
  const projected = {};
  for (const size of sizeObjectsFromMaterials(payload)) {
    const value = Number(size.inventory);
    projected[String(size.code)] = Number.isFinite(value) && value >= 0
      ? Math.trunc(value)
      : 0;
  }
  return projected;
}

module.exports = {
  buildInventoryRows,
  catalogProducts,
  materialItem,
  normalizeCatalogProduct,
  normalizeDate,
  projectedInventoryByCode,
  resolveSizeLabel,
  sizeObjectsFromMaterials,
};
