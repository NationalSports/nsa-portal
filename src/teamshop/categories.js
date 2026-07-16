// Team Shop launch category taxonomy — single source of truth for the 9
// categories the storefront browses at launch, mapped onto the REAL
// products.category values (verified against the live table — see the task
// that added this file; Shorts added after initial launch scoping, product.
// category 'Shorts', ~6,972 live rows, verified; Footwear added per owner
// request, product.category 'Footwear', 546 live rows, verified). Everything
// not listed here (Jersey, Socks, Pants, Crew, accessories, '(none)', ...)
// stays OUT of the Team Shop browse entirely.
//
// dbValues is an array because a couple of categories have a small number of
// rows under an alternate/legacy spelling (~11 'Hood' singular rows besides
// 'Hoods', ~5 'Beanies' rows besides 'Hats') that conceptually belong here.
// Cheap to handle as a values array for CLIENT-SIDE matching
// (categoryForProduct/inLaunchCategories, used for the 'All' view and for
// ProductPage's breadcrumb). The SERVER-side p_category filter (Catalog.js's
// per-category fetch) only takes ONE value, so it uses dbValues[0] (the
// primary/majority value) — see the TODO(server-category-list) note in
// Catalog.js for what a fully-exact per-category server fetch would need.
export const LAUNCH_CATEGORIES = [
  { key: 'quarter_zips', label: '1/4 Zips', dbValues: ['1/4 Zips'] },
  { key: 'hoodies', label: 'Hoodies & Fleece', dbValues: ['Hoods', 'Hood'] },
  { key: 'polos', label: 'Polos', dbValues: ['Polos'] },
  { key: 'outerwear', label: 'Outerwear', dbValues: ['Outerwear'] },
  { key: 'hats', label: 'Hats', dbValues: ['Hats', 'Beanies'] },
  { key: 'tees', label: 'Tees', dbValues: ['Tees'] },
  { key: 'bags', label: 'Bags', dbValues: ['Bags'] },
  { key: 'shorts', label: 'Shorts', dbValues: ['Shorts'] },
  { key: 'footwear', label: 'Footwear', dbValues: ['Footwear'] },
];

const BY_KEY = new Map(LAUNCH_CATEGORIES.map((c) => [c.key, c]));

// Look up a launch category definition by its key. Returns undefined if the
// key isn't a launch category.
export function categoryByKey(key) {
  return BY_KEY.get(key);
}

// Which launch category (if any) a product belongs to, by matching
// product.category against each category's dbValues. Returns the category
// object, or null if the product's category isn't part of the launch set.
export function categoryForProduct(product) {
  const raw = product && product.category;
  if (!raw) return null;
  for (const cat of LAUNCH_CATEGORIES) {
    if (cat.dbValues.includes(raw)) return cat;
  }
  return null;
}

// Whether a product belongs to any launch category — used to client-filter
// the 'All' view so non-launch categories (socks, jerseys, ...) never render.
export function inLaunchCategories(product) {
  return categoryForProduct(product) !== null;
}
