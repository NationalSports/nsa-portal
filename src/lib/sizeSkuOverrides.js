/* eslint-disable */

// size_skus started life as { size: "SKU" }. New rows also carry the supplier
// that owns that substitute SKU: { size: { sku, vendor_id } }. Keep both forms
// readable so existing webstores continue to work without a data migration.
export function normalizeSizeSkuOverride(raw, fallbackVendorId = '') {
  if (!raw) return { sku: '', vendor_id: fallbackVendorId || '', product_id: null, color: '' };
  if (typeof raw === 'string') return { sku: raw.trim().toUpperCase(), vendor_id: fallbackVendorId || '', product_id: null, color: '' };
  return {
    sku: String(raw.sku || '').trim().toUpperCase(),
    vendor_id: raw.vendor_id || fallbackVendorId || '',
    product_id: raw.product_id || null,
    color: String(raw.color || raw.base_color || '').trim(),
  };
}

export function sizeSkuCode(raw) {
  return normalizeSizeSkuOverride(raw).sku;
}

// Resolve an override SKU to a real catalog row without ever choosing an
// arbitrary duplicate SKU from another supplier. Explicit supplier wins;
// legacy string overrides prefer a matching garment brand and color, with the
// base supplier used only as a tie-breaker.
const colorKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const brandKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameColor = (a, b) => { const ak = colorKey(a); const bk = colorKey(b); return !ak || !bk || ak === bk || ak.includes(bk) || bk.includes(ak); };
const sameBrand = (a, b) => { const ak = brandKey(a); const bk = brandKey(b); return !!ak && !!bk && (ak === bk || ak.includes(bk) || bk.includes(ak)); };

export function resolveSizeSkuSource({ raw, lineSku = '', lineColor = '', baseProduct = null, candidates = [] }) {
  const baseVendorId = baseProduct?.vendor_id || '';
  const baseColor = baseProduct?.color || lineColor || '';
  const baseResult = () => ({ sku: String(lineSku || baseProduct?.sku || '').trim(), product_id: baseProduct?.id || null, vendor_id: baseVendorId || null, product: baseProduct, isOverride: false });
  const ov = normalizeSizeSkuOverride(raw);
  if (!ov.sku) return baseResult();
  // Overrides are scoped to the color row where they were configured. This is
  // the guard that prevents a White substitute from leaking onto Navy when a
  // webstore card has multiple colorways.
  if (ov.color && baseColor && !sameColor(ov.color, baseColor)) return baseResult();

  const exact = (candidates || []).filter((p) => String(p?.sku || '').trim().toUpperCase() === ov.sku);
  let pool = exact;
  if (ov.vendor_id) {
    const vendorMatches = exact.filter((p) => p.vendor_id === ov.vendor_id);
    if (vendorMatches.length) pool = vendorMatches;
  } else if (baseProduct?.brand) {
    // A fill-in item may intentionally come from another supplier (A1005 from
    // S&S, LH0083 from Adidas Golf). Prefer the same garment brand before the
    // base supplier so an unrelated duplicate SKU can never win.
    const brandMatches = exact.filter((p) => sameBrand(p.brand, baseProduct.brand));
    if (brandMatches.length) pool = brandMatches;
  }
  const colorMatches = pool.filter((p) => sameColor(p.color, baseColor));
  if (baseColor && pool.some((p) => colorKey(p.color)) && !colorMatches.length) return baseResult();
  if (colorMatches.length) pool = colorMatches;
  let chosen = null;
  if (ov.product_id) chosen = pool.find((p) => p.id === ov.product_id) || null;
  if (!chosen && ov.vendor_id) chosen = pool.find((p) => p.vendor_id === ov.vendor_id) || null;
  if (!chosen && baseVendorId) chosen = pool.find((p) => p.vendor_id === baseVendorId) || null;
  if (!chosen && pool.length === 1) chosen = pool[0];

  return {
    sku: ov.sku,
    product_id: chosen?.id || null,
    vendor_id: chosen?.vendor_id || ov.vendor_id || baseVendorId || null,
    product: chosen || baseProduct,
    isOverride: true,
  };
}
