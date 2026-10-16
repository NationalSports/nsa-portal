export function supportsLogoChoices(store) {
  return !!store
    && ['team', 'all_school'].includes(store.org_type || 'team')
    && store.source !== 'omg'
    && !store.omg_sale_code;
}

export function hasStorefrontLogoChoices(store, products = []) {
  return store?.org_type === 'all_school'
    || products.some((product) => product?.kind === 'single' && product.school_style_group_id);
}

// Garment-level fields of a storefront stock row (the blank's name, color, photos, stock).
const GARMENT_STOCK_FIELDS = ['product_id', 'sku', 'name', 'category', 'color', 'available_sizes', 'image_front_url', 'image_back_url', 'size_stock', 'on_order_qty', 'earliest_eta', 'vendor_size_stock', 'vendor_on_hand', 'vendor_eta', 'vendor_size_eta', 'vendor_size_incoming', 'vendor_synced_at', 'description', 'inventory_source'];

// The storefront stock feed only carries rows shoppers can see, so a HIDDEN logo choice
// arrives with no garment name, color or photo. Borrow those from a visible row of the
// same blank (same product_id) so editors still show the real garment. Mutates stockByWp.
export function fillHiddenRowStock(catalog = [], stockByWp = {}) {
  const byProduct = {};
  for (const row of catalog) { const s = stockByWp[row.id]; if (row.product_id && s && !byProduct[row.product_id]) byProduct[row.product_id] = s; }
  for (const row of catalog) {
    if (stockByWp[row.id] || !row.product_id || !byProduct[row.product_id]) continue;
    const src = byProduct[row.product_id]; const copy = { webstore_product_id: row.id };
    for (const key of GARMENT_STOCK_FIELDS) if (src[key] !== undefined) copy[key] = src[key];
    stockByWp[row.id] = copy;
  }
  return stockByWp;
}
