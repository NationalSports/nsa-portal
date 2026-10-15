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
