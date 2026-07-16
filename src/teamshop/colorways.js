// Team Shop colorway grouping — pure helpers, no React/DOM.
//
// THE PROBLEM (owner report, verified in live data): each colorway of a style
// is its own `products` row — identical brand+name, unique sku/id/image per
// color (e.g. 'Adidas 3 Stripe LS 1/4 ZIP' x 'Navy/White', 'Power Red/White',
// ... 15+ rows) — so an ungrouped grid shows near-identical cards repeated.
// `products.color` holds the real colorway string ('Power Red/White').
// `products.color_category` is UNRELIABLE (it says 'White' for every one of
// those rows) — never read it here.
//
// groupByStyle folds those rows back into one "style" per (brand, name),
// carrying every colorway row as a `variants` entry so the UI can pick one
// variant (image/sku/stock/id) at a time while keeping the full row shape
// (the exact row search_products returned) flowing downstream unchanged.

// Case/whitespace-insensitive key so trivial formatting differences ('Nike '
// vs 'Nike') don't split one style into two groups.
const norm = (s) => String(s || '').trim().toLowerCase();

// Group rows into one entry per (brand, name), preserving first-seen order.
// Each group's variants are sorted by color name (A-Z, unset colors last).
export function groupByStyle(rows) {
  const map = new Map();
  const order = [];
  (rows || []).forEach((row) => {
    if (!row) return;
    const brand = row.brand || '';
    const name = row.name || row.sku || '';
    const key = `${norm(brand)}|${norm(name)}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key, brand, name, category: row.category || null, variants: [],
      };
      map.set(key, group);
      order.push(group);
    }
    group.variants.push(row);
  });
  order.forEach((group) => {
    group.variants.sort((a, b) => {
      const ca = a.color || '';
      const cb = b.color || '';
      if (!ca && !cb) return 0;
      if (!ca) return 1;
      if (!cb) return -1;
      return ca.localeCompare(cb);
    });
  });
  return order;
}

// A colorway string like 'Power Red/White' pairs a primary color with a
// trim/secondary color. The primary (first) segment is what identifies the
// swatch family — 'power red' here, not 'white'.
export function primaryColorToken(colorString) {
  if (!colorString) return '';
  const first = String(colorString).split('/')[0];
  return first.trim().toLowerCase();
}

// Canonical color families for filter pills / swatch dots. Order here is the
// display order of the Color filter row. Hex values are sensible swatch
// approximations, not brand-exact.
export const COLOR_FAMILIES = [
  { key: 'navy', label: 'Navy', hex: '#192853' },
  { key: 'black', label: 'Black', hex: '#1B1E24' },
  { key: 'white', label: 'White', hex: '#F5F6F8' },
  { key: 'grey', label: 'Grey', hex: '#8790A5' },
  { key: 'red', label: 'Red', hex: '#962C32' },
  { key: 'royal', label: 'Royal', hex: '#1E40AF' },
  { key: 'light_blue', label: 'Light Blue', hex: '#6FA8DC' },
  { key: 'green', label: 'Green', hex: '#2F6B45' },
  { key: 'gold', label: 'Gold', hex: '#C5A44E' },
  { key: 'orange', label: 'Orange', hex: '#E0651A' },
  { key: 'purple', label: 'Purple', hex: '#6B3FA0' },
  { key: 'maroon', label: 'Maroon', hex: '#5B1A24' },
  { key: 'brown', label: 'Brown', hex: '#6B4226' },
  { key: 'pink', label: 'Pink', hex: '#D6698A' },
  { key: 'other', label: 'Other', hex: '#9AA1B2' },
];

// Alias -> family key. Every alias is already a `primaryColorToken()` shape
// (lowercase, trimmed, single segment). Note: 'maroon' is its OWN family, not
// folded into 'red' — despite a superficial resemblance, the owner called
// this out explicitly.
const ALIASES = {
  navy: 'navy',
  black: 'black',
  white: 'white',
  grey: 'grey',
  gray: 'grey',
  charcoal: 'grey',
  red: 'red',
  'power red': 'red',
  'team red': 'red',
  scarlet: 'red',
  royal: 'royal',
  'royal blue': 'royal',
  'light blue': 'light_blue',
  'columbia blue': 'light_blue',
  'carolina blue': 'light_blue',
  green: 'green',
  'dark green': 'green',
  'team green': 'green',
  forest: 'green',
  'forest green': 'green',
  kelly: 'green',
  gold: 'gold',
  'athletic gold': 'gold',
  'vegas gold': 'gold',
  yellow: 'gold',
  orange: 'orange',
  'bright orange': 'orange',
  purple: 'purple',
  maroon: 'maroon',
  brown: 'brown',
  vegas: 'brown',
  pink: 'pink',
};

const FAMILY_KEYS = new Set(COLOR_FAMILIES.map((f) => f.key));

// Map a raw primary color token to a canonical family key. Exact-match first
// (the common case — every alias above is already a primary-token shape);
// falls back to substring matching for the rare token that carries extra
// words (e.g. a stray 'Team Navy'), then 'other'.
export function familyForToken(token) {
  const t = norm(token);
  if (!t) return 'other';
  if (ALIASES[t]) return ALIASES[t];
  const aliasKeys = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliasKeys) {
    if (t.includes(alias)) return ALIASES[alias];
  }
  return 'other';
}

// Family key for a product row's colorway (products.color — NEVER
// color_category, see the file header).
export function familyForVariant(row) {
  const key = familyForToken(primaryColorToken(row && row.color));
  return FAMILY_KEYS.has(key) ? key : 'other';
}
