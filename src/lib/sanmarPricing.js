import { normSzName } from '../pricing';

// SanMar's JSON wrapper varies between SOAP methods. Keep every caller on the
// same normalization and, most importantly, the same account-price priority.
export const sanmarPricingRows = (data) => {
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items;
  if (data.listResponse) return Array.isArray(data.listResponse) ? data.listResponse : [data.listResponse];
  if (data.return) return Array.isArray(data.return) ? data.return : [data.return];
  if (data.size || data.labelSize || data.myPrice || data.salePrice || data.piecePrice) return [data];
  return [];
};

export const sanmarAccountPrice = (row = {}) => {
  for (const raw of [row.myPrice, row.salePrice, row.piecePrice, row.customerPrice]) {
    const value = Number.parseFloat(raw);
    if (value > 0) return value;
  }
  return 0;
};

const colorKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Return the exact SanMar account-price snapshot for a product color. SanMar
// sometimes ignores the requested color and returns the whole style, so filter
// the rows again client-side rather than letting another color's promo price win.
export const sanmarPricingSnapshot = (data, requestedColor = '') => {
  const rows = sanmarPricingRows(data).filter((row) => row && row.errorOccurred !== 'true' && row.errorOccured !== 'true');
  const wanted = colorKey(requestedColor);
  const rowColor = (row) => colorKey(row.catalogColor || row.color || row.colorName || row.productColor);
  const exact = wanted ? rows.filter((row) => rowColor(row) === wanted) : rows;
  // Rows without a color are already scoped by the API request. Only fall back
  // to all rows when SanMar returned no color metadata at all.
  const usable = exact.length ? exact : (rows.some((row) => rowColor(row)) ? [] : rows);
  const bySize = {};
  usable.forEach((row) => {
    const size = normSzName(row.size || row.labelSize || row.sizeCode || 'OSFA');
    const price = sanmarAccountPrice(row);
    if (size && price > 0 && (bySize[size] == null || price < bySize[size])) bySize[size] = price;
  });
  const values = Object.values(bySize);
  if (!values.length) return { baseCost: null, sizeCosts: null, prices: {} };
  const baseCost = Math.min(...values);
  const overrides = {};
  Object.entries(bySize).forEach(([size, price]) => {
    if (Math.abs(price - baseCost) > 0.001) overrides[size] = price;
  });
  return { baseCost, sizeCosts: Object.keys(overrides).length ? overrides : null, prices: bySize };
};

export const sanmarStyleFromSku = (sku) => String(sku || '').trim().toUpperCase().split('-')[0];
