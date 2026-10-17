import * as SIZE_NAMES from './sizeNames.shared';

const { SZ_NORM, normalizeFootwearSize } = SIZE_NAMES;
const TALL_TWO = /^[A-Z0-9]*T2$/;

// Canonical comparison name shared by the order screen and CLICK planner.
// Keep CLICK's exact label for imports; this value is only for matching.
export function normalizeAdidasSizeName(raw) {
  if (raw == null || raw === '') return raw;
  let size = String(raw).trim();
  const footwear = normalizeFootwearSize(size);
  if (footwear !== size) return footwear;

  // CLICK waist labels include an inch mark (28"…52"); portal sizes do not.
  if (/^\d+"$/.test(size)) return size.slice(0, -1);

  const upper = size.toUpperCase().replace(/\s+/g, '');
  // LT2/XLT2/2XT2 are distinct tall runs, not a 2-inch inseam suffix.
  if (TALL_TWO.test(upper)) return upper;

  // Garment variants/inseams: S 7", XL7", 2XS4, etc.
  const stripped = upper.replace(/\d+"?$/, '');
  if (stripped && /[A-Z]/.test(stripped)) size = stripped;
  else size = upper;

  const normalized = String(size).toUpperCase();
  if (SZ_NORM[normalized]) return SZ_NORM[normalized];
  const extraSmall = normalized.match(/^(\d+)XS$/);
  if (extraSmall) return `${'X'.repeat(Number(extraSmall[1]))}S`;
  return normalized;
}

export function adidasInventorySizeEntry(sizes, portalSize) {
  if (!sizes || portalSize == null) return null;
  return sizes[normalizeAdidasSizeName(portalSize)] || null;
}

export function aggregateAdidasInventoryRows(rows, freshnessBySource = {}) {
  const sizes = {};
  let fallbackLastSynced = null;
  const relevantFreshness = [];

  (rows || []).forEach((row) => {
    const label = normalizeAdidasSizeName(row.size);
    if (!label) return;
    const stockQty = Math.max(0, Number(row.stock_qty) || 0);
    const futureQty = Math.max(0, Number(row.future_delivery_qty) || 0);
    const entry = sizes[label] || (sizes[label] = {
      qty: 0,
      futureDate: null,
      futureQty: null,
      breakdown: [],
    });
    entry.qty += stockQty;
    if (futureQty > 0) entry.futureQty = (entry.futureQty || 0) + futureQty;
    if (row.future_delivery_date
      && (!entry.futureDate || new Date(row.future_delivery_date) < new Date(entry.futureDate))) {
      entry.futureDate = row.future_delivery_date;
    }
    entry.breakdown.push({ code: String(row.size).trim(), qty: stockQty });
    if (row.last_synced && (!fallbackLastSynced || new Date(row.last_synced) > new Date(fallbackLastSynced))) {
      fallbackLastSynced = row.last_synced;
    }
    // inventory_unified preserves the legacy source name "click" for rows
    // whose sync-run orchestration source is "api-materials".
    const freshnessSource = row.source === 'click' ? 'api-materials' : row.source;
    const runFinishedAt = freshnessSource && freshnessBySource[freshnessSource];
    if (runFinishedAt) relevantFreshness.push(runFinishedAt);
  });

  const lastSynced = relevantFreshness.reduce((latest, value) => (
    !latest || new Date(value) > new Date(latest) ? value : latest
  ), null) || fallbackLastSynced;
  return { sizes, lastSynced };
}
